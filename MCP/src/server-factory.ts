import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { UEClient } from './ue-client.js';
import { packageVersion } from './helpers/package-metadata.js';
import {
  ProjectController,
  type ProjectControllerLike,
  type CompileProjectCodeResult,
} from './project-controller.js';
import {
  AutomationController,
  type AutomationControllerLike,
} from './automation-controller.js';
import type {
  ProjectAutomationContext,
  ResolvedProjectInputs,
} from './tool-context.js';
import { firstDefinedString } from './helpers/formatting.js';
import type { ToolHelpEntry } from './helpers/tool-help.js';
import { installNormalizedToolRegistration } from './helpers/tool-registration.js';
import { createToolResultNormalizers } from './helpers/tool-results.js';
import { callSubsystemJson as callSubsystemJsonWithClient, type SubsystemCallOptions } from './helpers/subsystem.js';
import {
  getProjectAutomationContext as getProjectAutomationContextWithState,
  rememberExternalBuild as buildExternalBuildContext,
  resolveProjectInputs as resolveProjectInputsWithDeps,
} from './helpers/project-resolution.js';
import { registerServerResources } from './register-server-resources.js';
import { registerServerTools } from './register-server-tools.js';
import {
  EDITOR_POLL_INTERVAL_MS,
  classifyRecoverableToolFailure,
  serverInstructions,
  taskAwareTools,
  TOOL_MODE_ANNOTATIONS,
} from './server-config.js';
import { toolResultSchema } from './schemas/tool-results.js';
import {
  ToolSurfaceManager,
  WORKFLOW_SCOPE_IDS,
  CORE_TOOLS,
  type WorkflowScopeId,
} from './tool-surface-manager.js';
import { EditorAdapter } from './execution/adapters/editor-adapter.js';
import { LazyCommandletAdapter } from './execution/adapters/lazy-commandlet-adapter.js';
import { ExecutionModeDetector } from './execution/execution-mode-detector.js';
import { AdaptiveExecutor } from './execution/adaptive-executor.js';
import { ActiveEditorSession } from './active-editor-session.js';

export type UEClientLike = Pick<UEClient, 'callSubsystem'>
  & Partial<Pick<UEClient, 'checkConnection'>>
  & {
    editorModeAvailable?: (() => Promise<boolean>) | undefined;
  };

export type BlueprintExtractorServerResult = {
  server: McpServer;
  toolSurfaceManager: ToolSurfaceManager;
  executor: AdaptiveExecutor;
};

export function createBlueprintExtractorServer(
  client?: UEClientLike,
  projectController: ProjectControllerLike = new ProjectController(),
  automationController: AutomationControllerLike = new AutomationController(),
): BlueprintExtractorServerResult {
  let cachedProjectAutomationContext: ProjectAutomationContext | null = null;
  let lastExternalBuildContext: Record<string, unknown> | null = null;
  const toolHelpRegistry = new Map<string, ToolHelpEntry>();
  const registeredToolMap = new Map<string, RegisteredTool>();
  const clearProjectAutomationContext = () => {
    cachedProjectAutomationContext = null;
  };
  const activeEditorSession = client
    ? null
    : new ActiveEditorSession({
      onSelectionChanged: clearProjectAutomationContext,
    });
  const effectiveClient = client ?? activeEditorSession!;

  const server = new McpServer({
    name: 'blueprint-extractor',
    version: packageVersion,
  }, {
    instructions: serverInstructions,
  });
  const defaultOutputSchema = toolResultSchema.catchall(z.unknown());

  // Direct editor path — preserves callSubsystemJson error-checking layer and
  // avoids recursive executor routing while resolving commandlet fallback inputs.
  const directCallSubsystemJson = (method: string, params: Record<string, unknown>, options?: SubsystemCallOptions) => (
    callSubsystemJsonWithClient(effectiveClient, method, params, options)
  );

  const getDirectProjectAutomationContext = async (forceRefresh = false): Promise<ProjectAutomationContext> => (
    getProjectAutomationContextWithState({
      forceRefresh,
      cachedContext: cachedProjectAutomationContext,
      setCachedContext: (value) => {
        cachedProjectAutomationContext = value;
      },
      callSubsystemJson: directCallSubsystemJson,
    })
  );

  const {
    normalizeToolError,
    normalizeToolSuccess,
  } = createToolResultNormalizers({
    taskAwareTools,
    classifyRecoverableToolFailure,
  });

  // Dual-mode execution: create adapter + detector + executor BEFORE tool
  // registration so the executor is available for activeToolName tracking.
  const editorAdapter = new EditorAdapter(effectiveClient);
  const commandletAdapter = new LazyCommandletAdapter({
    resolveInputs: async () => {
      const resolved = await resolveProjectInputsWithDeps({}, {
        getProjectAutomationContext: getDirectProjectAutomationContext,
        firstDefinedString,
        env: process.env,
        workspaceProjectPath: await activeEditorSession?.getWorkspaceProjectPath(),
      });

      return {
        engineRoot: resolved.engineRoot,
        projectPath: resolved.projectPath,
      };
    },
  });
  const modeDetector = new ExecutionModeDetector(editorAdapter, commandletAdapter);
  const executor = new AdaptiveExecutor(editorAdapter, commandletAdapter, modeDetector);

  // Apply tool mode annotations
  for (const [toolName, mode] of TOOL_MODE_ANNOTATIONS) {
    executor.setToolMode(toolName, mode);
  }

  installNormalizedToolRegistration({
    server,
    toolHelpRegistry,
    registeredToolMap,
    defaultOutputSchema,
    normalizeToolError,
    normalizeToolSuccess,
    executor,
  });

  // Executor-routed callSubsystemJson: when a tool handler is active, routes
  // through the executor which checks mode annotations and can fall back to
  // commandlet. For editor mode (or when no tool context), delegates to the
  // direct path preserving all error checking from helpers/subsystem.ts.
  const callSubsystemJson = (method: string, params: Record<string, unknown>, options?: SubsystemCallOptions) => (
    executor.executeRouted(directCallSubsystemJson, method, params, options)
  );

  function rememberExternalBuild(result: CompileProjectCodeResult): void {
    lastExternalBuildContext = buildExternalBuildContext(result);
  }

  async function getProjectAutomationContext(forceRefresh = false): Promise<ProjectAutomationContext> {
    return await getDirectProjectAutomationContext(forceRefresh);
  }

  async function resolveProjectInputs(
    request: {
      engine_root?: string;
      project_path?: string;
      target?: string;
    },
  ): Promise<ResolvedProjectInputs> {
    return await resolveProjectInputsWithDeps(request, {
      getProjectAutomationContext,
      firstDefinedString,
      env: process.env,
      workspaceProjectPath: await activeEditorSession?.getWorkspaceProjectPath(),
    });
  }

  registerServerResources({
    server,
    automationController,
    callSubsystemJson,
  });

  registerServerTools({
    server,
    client: effectiveClient,
    projectController,
    automationController,
    callSubsystemJson,
    resolveProjectInputs,
    getProjectAutomationContext,
    rememberExternalBuild,
    getLastExternalBuildContext: () => lastExternalBuildContext,
    clearProjectAutomationContext,
    activeEditorSession,
    getToolHelpEntry: (toolName) => toolHelpRegistry.get(toolName),
    toolHelpRegistry,
    editorPollIntervalMs: EDITOR_POLL_INTERVAL_MS,
  });

  const toolSurfaceManager = new ToolSurfaceManager(registeredToolMap);

  // Register the activate_workflow_scope tool
  server.registerTool(
    'activate_workflow_scope',
    {
      title: 'Activate Workflow Scope',
      description: [
        'Switch the active tool surface to a workflow-specific scope.',
        `Available scopes: ${WORKFLOW_SCOPE_IDS.join(', ')}.`,
        'Use additive=true to merge the new scope with currently active tools.',
        'Core tools (extraction, search, project control) are always available.',
      ].join(' '),
      inputSchema: {
        scope: z.enum(WORKFLOW_SCOPE_IDS as unknown as [string, ...string[]]).describe(
          'The workflow scope to activate.',
        ),
        additive: z.boolean().default(false).describe(
          'When true, merge the scope tools with currently active tools instead of replacing.',
        ),
      },
      annotations: {
        title: 'Activate Workflow Scope',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>) => {
      const scopeId = args.scope as WorkflowScopeId;
      const additive = (args.additive as boolean) ?? false;
      toolSurfaceManager.activateScope(scopeId, additive);
      const activeTools = toolSurfaceManager.getActiveTools();
      const scopeDef = toolSurfaceManager.getScopeDefinition(scopeId);
      const structuredContent = {
        scope: scopeId,
        description: scopeDef.description,
        additive,
        active_tool_count: activeTools.size,
        core_tool_count: CORE_TOOLS.size,
        scope_tools: scopeDef.tools,
      };
      return { content: [], structuredContent };
    },
  );

  // Wire oninitialized to detect client capabilities
  (server as any).server.oninitialized = () => {
    const caps = (server as any).server.getClientCapabilities();
    if (caps?.tools?.listChanged) {
      toolSurfaceManager.enableScopedMode();
    } else {
      toolSurfaceManager.enableFlatMode();
    }
  };

  return { server, toolSurfaceManager, executor };
}
