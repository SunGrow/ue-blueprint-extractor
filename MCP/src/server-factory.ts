import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UEClient } from './ue-client.js';
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
import { callSubsystemJson as callSubsystemJsonWithClient } from './helpers/subsystem.js';
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
} from './server-config.js';
import { toolResultSchema } from './schemas/tool-results.js';

export type UEClientLike = Pick<UEClient, 'callSubsystem'> & Partial<Pick<UEClient, 'checkConnection'>>;

export function createBlueprintExtractorServer(
  client: UEClientLike = new UEClient(),
  projectController: ProjectControllerLike = new ProjectController(),
  automationController: AutomationControllerLike = new AutomationController(),
) {
  let cachedProjectAutomationContext: ProjectAutomationContext | null = null;
  let lastExternalBuildContext: Record<string, unknown> | null = null;
  const toolHelpRegistry = new Map<string, ToolHelpEntry>();

  const server = new McpServer({
    name: 'blueprint-extractor',
    version: '3.0.0',
  }, {
    instructions: serverInstructions,
  });

  const {
    normalizeToolError,
    normalizeToolSuccess,
  } = createToolResultNormalizers({
    taskAwareTools,
    classifyRecoverableToolFailure,
  });

  installNormalizedToolRegistration({
    server,
    toolHelpRegistry,
    defaultOutputSchema: toolResultSchema,
    normalizeToolError,
    normalizeToolSuccess,
  });

  const callSubsystemJson = (method: string, params: Record<string, unknown>) => (
    callSubsystemJsonWithClient(client, method, params)
  );

  function rememberExternalBuild(result: CompileProjectCodeResult): void {
    lastExternalBuildContext = buildExternalBuildContext(result);
  }

  async function getProjectAutomationContext(forceRefresh = false): Promise<ProjectAutomationContext> {
    return await getProjectAutomationContextWithState({
      forceRefresh,
      cachedContext: cachedProjectAutomationContext,
      setCachedContext: (value) => {
        cachedProjectAutomationContext = value;
      },
      callSubsystemJson,
    });
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
    });
  }

  registerServerResources({
    server,
    automationController,
    callSubsystemJson,
  });

  registerServerTools({
    server,
    client,
    projectController,
    automationController,
    callSubsystemJson,
    resolveProjectInputs,
    getProjectAutomationContext,
    rememberExternalBuild,
    getLastExternalBuildContext: () => lastExternalBuildContext,
    clearProjectAutomationContext: () => {
      cachedProjectAutomationContext = null;
    },
    getToolHelpEntry: (toolName) => toolHelpRegistry.get(toolName),
    editorPollIntervalMs: EDITOR_POLL_INTERVAL_MS,
  });

  return server;
}
