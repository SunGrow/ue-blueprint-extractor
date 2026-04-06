import * as path from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sleep } from '../helpers/formatting.js';
import {
  canFallbackFromLiveCoding,
  enrichLiveCodingResult,
} from '../helpers/live-coding.js';
import { assertRequestMatchesActiveEditor } from '../helpers/active-editor-utils.js';
import {
  explainProjectResolutionFailure,
  supportsConnectionProbe,
} from '../helpers/project-utils.js';
import {
  EditorContextResultSchema,
  ListMessageLogListingsResultSchema,
  ReadMessageLogResultSchema,
  ReadOutputLogResultSchema,
} from '../schemas/tool-results.js';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';
import { filesystemPathsEqual } from '../helpers/workspace-project.js';
import { ActiveEditorSession } from '../active-editor-session.js';
import type { EditorInstanceSnapshot } from '../editor-instance-types.js';
import type {
  BuildConfiguration,
  BuildPlatform,
  CompileProjectCodeResult,
  ProjectControllerLike,
} from '../project-controller.js';
import type {
  EditorContextSnapshot,
  ProjectAutomationContext,
  ResolvedProjectInputs,
} from '../tool-context.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type ConnectionProbeCapable = {
  checkConnection?: (() => Promise<boolean>) | undefined;
};

type GetProjectAutomationContext = (
  forceRefresh?: boolean,
) => Promise<ProjectAutomationContext>;

type ResolveProjectInputs = (
  request: {
    engine_root?: string;
    project_path?: string;
    target?: string;
  },
) => Promise<ResolvedProjectInputs>;

type RegisterProjectControlToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  client: ConnectionProbeCapable;
  projectController: ProjectControllerLike;
  callSubsystemJson: JsonSubsystemCaller;
  getProjectAutomationContext: GetProjectAutomationContext;
  resolveProjectInputs: ResolveProjectInputs;
  rememberExternalBuild: (result: CompileProjectCodeResult) => void;
  getLastExternalBuildContext: () => Record<string, unknown> | null;
  clearProjectAutomationContext: () => void;
  activeEditorSession?: ActiveEditorSession | null;
  buildPlatformSchema: z.ZodTypeAny;
  buildConfigurationSchema: z.ZodTypeAny;
  editorPollIntervalMs: number;
};

function trimBuildOutput(build: Record<string, unknown>): Record<string, unknown> {
  const trimmed = { ...build };
  delete trimmed.stdout;
  delete trimmed.stderr;
  delete trimmed.output;
  return trimmed;
}

function buildInputResolution(resolved: ResolvedProjectInputs): Record<string, unknown> {
  return {
    engineRoot: resolved.sources.engineRoot,
    projectPath: resolved.sources.projectPath,
    target: resolved.sources.target,
    contextError: resolved.contextError,
  };
}

export async function getEditorContext(
  activeEditorSession: ActiveEditorSession | null | undefined,
): Promise<EditorContextSnapshot> {
  if (!activeEditorSession) {
    throw new Error('Session-bound editor selection is unavailable for this server instance.');
  }

  return await activeEditorSession.getEditorContext();
}

function isAbsoluteFilesystemPath(candidate: string): boolean {
  return path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate);
}

export function registerProjectControlTools({
  server,
  client,
  projectController,
  callSubsystemJson,
  getProjectAutomationContext,
  resolveProjectInputs,
  rememberExternalBuild,
  getLastExternalBuildContext,
  clearProjectAutomationContext,
  activeEditorSession,
  buildPlatformSchema,
  buildConfigurationSchema,
  editorPollIntervalMs,
}: RegisterProjectControlToolsOptions): void {
  const buildRunningEditorLabel = (entry: {
    projectName?: string;
    projectFilePath: string;
    engineVersion?: string;
    processId?: number;
    remoteControlHost: string;
    remoteControlPort: number;
  }) => [
    entry.projectName ?? entry.projectFilePath,
    entry.engineVersion ?? 'unknown-engine',
    `pid ${entry.processId ?? 'unknown'}`,
    `${entry.remoteControlHost}:${entry.remoteControlPort}`,
  ].join(' | ');

  const toLabeledActiveEditor = (snapshot: EditorInstanceSnapshot): Record<string, unknown> => ({
    ...snapshot,
    label: buildRunningEditorLabel(snapshot),
  });

  const resolveEditorIdentity = (
    previousEditor: EditorInstanceSnapshot | undefined,
    fallback: {
      projectPath?: string;
      engineRoot?: string;
      target?: string;
    },
  ) => ({
    projectPath: previousEditor?.projectFilePath ?? fallback.projectPath,
    engineRoot: previousEditor?.engineRoot ?? fallback.engineRoot,
    target: previousEditor?.editorTarget ?? fallback.target,
  });

  const recoverEditorViaHostRelaunch = async (request: {
    previousEditor?: EditorInstanceSnapshot;
    projectPath?: string;
    engineRoot?: string;
    target?: string;
    reconnectTimeoutSeconds: number;
    initialReconnect?: Awaited<ReturnType<ProjectControllerLike['waitForEditorRestart']>>;
    initialError?: string;
  }): Promise<{
    success: boolean;
    reconnect?: Awaited<ReturnType<ProjectControllerLike['waitForEditorRestart']>>;
    activeEditor?: Record<string, unknown>;
    recovery: Record<string, unknown>;
  }> => {
    const recovery: Record<string, unknown> = {
      strategy: 'host_relaunch_after_failed_graceful_restart',
      ...(request.initialReconnect ? { initialReconnect: request.initialReconnect } : {}),
      ...(request.initialError ? { initialError: request.initialError } : {}),
    };

    if (!request.previousEditor?.processId) {
      recovery.message = 'Automatic recovery requires a known active editor process id.';
      return { success: false, recovery };
    }

    if (!request.projectPath || !request.engineRoot) {
      recovery.message = 'Automatic recovery requires both project_path and engine_root.';
      return { success: false, recovery };
    }

    const previousEditor = request.previousEditor;

    try {
      const kill = await projectController.killEditorProcess({ processId: previousEditor.processId });
      recovery.kill = kill;
      if (!kill.killed) {
        recovery.message = kill.error ?? 'killEditorProcess returned killed=false';
        return { success: false, recovery };
      }

      clearProjectAutomationContext();

      const editorLaunch = await projectController.launchEditor({
        engineRoot: request.engineRoot,
        projectPath: request.projectPath,
      });
      recovery.editorLaunch = editorLaunch;
      if (!editorLaunch.success) {
        recovery.message = 'launchEditor returned success=false during recovery';
        return { success: false, recovery };
      }

      let reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
        reconnectTimeoutMs: request.reconnectTimeoutSeconds * 1000,
        waitForDisconnect: false,
      });

      let rebound: Record<string, unknown> | undefined;
      if (activeEditorSession) {
        const reboundSnapshot = await activeEditorSession.refreshActiveEditorAfterReconnect({
          projectPath: request.projectPath,
          engineRoot: request.engineRoot,
          target: request.target,
        });
        if (reboundSnapshot) {
          rebound = toLabeledActiveEditor(reboundSnapshot);
          recovery.activeEditor = rebound;
          if (!reconnect.success) {
            reconnect = {
              ...reconnect,
              success: true,
              reconnected: true,
              diagnostics: [
                ...reconnect.diagnostics,
                'Recovered by rebinding the relaunched editor from the registry.',
              ],
            };
          }
        }
      }

      recovery.reconnect = reconnect;
      recovery.success = reconnect.success;
      return {
        success: reconnect.success,
        reconnect,
        activeEditor: rebound,
        recovery,
      };
    } catch (error) {
      recovery.message = error instanceof Error ? error.message : String(error);
      return { success: false, recovery };
    }
  };

  server.registerTool(
    'list_running_editors',
    {
      title: 'List Running Editors',
      description: 'List the running Unreal Editor instances known to the session-scoped editor registry.',
      inputSchema: {},
      annotations: {
        title: 'List Running Editors',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        if (!activeEditorSession) {
          return jsonToolSuccess({
            success: true,
            operation: 'list_running_editors',
            workspaceProjectPath: undefined,
            activeEditorInstanceId: undefined,
            editorCount: 0,
            editors: [],
            message: 'Session-bound editor selection is unavailable for this server instance.',
          });
        }

        const [editors, workspaceProjectPath, activeEditor] = await Promise.all([
          activeEditorSession.listRunningEditors(),
          activeEditorSession.getWorkspaceProjectPath(),
          activeEditorSession.getActiveEditorState({ autoBindIfNeeded: false }),
        ]);

        return jsonToolSuccess({
          success: true,
          operation: 'list_running_editors',
          workspaceProjectPath,
          activeEditorInstanceId: activeEditor.activeEditor?.instanceId,
          editorCount: editors.length,
          editors: editors.map((entry) => ({
            ...entry,
            label: buildRunningEditorLabel(entry),
            matchesWorkspace: filesystemPathsEqual(entry.projectFilePath, workspaceProjectPath),
            isActive: entry.instanceId === activeEditor.activeEditor?.instanceId,
          })),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'get_active_editor',
    {
      title: 'Get Active Editor',
      description: 'Read the current session-bound active editor selection and its health state.',
      inputSchema: {},
      annotations: {
        title: 'Get Active Editor',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        if (!activeEditorSession) {
          return jsonToolSuccess({
            success: true,
            operation: 'get_active_editor',
            active: false,
            selectionSource: 'none',
            healthy: false,
            autoBindAllowed: false,
            message: 'Session-bound editor selection is unavailable for this server instance.',
          });
        }

        const state = await activeEditorSession.getActiveEditorState({ autoBindIfNeeded: true });
        return jsonToolSuccess({
          success: true,
          operation: 'get_active_editor',
          ...state,
          activeEditorLabel: state.activeEditor ? buildRunningEditorLabel(state.activeEditor) : undefined,
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'select_editor',
    {
      title: 'Select Editor',
      description: 'Set the active editor for this MCP session by instance_id or process_id.',
      inputSchema: {
        instance_id: z.string().optional().describe(
          'Editor instance id.',
        ),
        process_id: z.number().int().positive().optional().describe(
          'OS process id.',
        ),
      },
      annotations: {
        title: 'Select Editor',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ instance_id, process_id }) => {
      try {
        if (!activeEditorSession) {
          return jsonToolError(new Error('Session-bound editor selection is unavailable for this server instance.'));
        }
        if (!instance_id && typeof process_id !== 'number') {
          return jsonToolError(new Error('select_editor requires instance_id or process_id.'));
        }

        const selected = await activeEditorSession.selectEditor({
          instanceId: instance_id,
          processId: process_id,
        });
        clearProjectAutomationContext();
        return jsonToolSuccess({
          success: true,
          operation: 'select_editor',
          selectionSource: 'manual',
          activeEditor: selected,
          activeEditorLabel: buildRunningEditorLabel(selected),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'clear_editor_selection',
    {
      title: 'Clear Editor Selection',
      description: 'Clear the current session-bound active editor so editor-backed tools stay unbound until you select or launch another editor.',
      inputSchema: {},
      annotations: {
        title: 'Clear Editor Selection',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        if (!activeEditorSession) {
          return jsonToolSuccess({
            success: true,
            operation: 'clear_editor_selection',
            active: false,
            selectionSource: 'none',
            healthy: false,
            autoBindAllowed: false,
            message: 'Session-bound editor selection is unavailable for this server instance.',
          });
        }

        const result = activeEditorSession.clearSelection();
        clearProjectAutomationContext();
        return jsonToolSuccess({
          success: true,
          operation: 'clear_editor_selection',
          ...result,
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'get_project_automation_context',
    {
      title: 'Get Project Automation Context',
      description: 'Read the current editor-derived project, engine, and target context used by project-control tools.',
      inputSchema: {},
      annotations: {
        title: 'Get Project Automation Context',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const parsed = await getProjectAutomationContext(true);
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'get_editor_context',
    {
      title: 'Get Editor Context',
      description: 'Read bounded selected-asset, selected-actor, active-level, open-editor, and PIE context from the active editor session.',
      inputSchema: {},
      outputSchema: EditorContextResultSchema,
      annotations: {
        title: 'Get Editor Context',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const parsed = await getEditorContext(activeEditorSession);
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'read_output_log',
    {
      title: 'Read Output Log',
      description: 'Read buffered Unreal Editor Output Log entries with query, category, verbosity, time, and paging filters.',
      inputSchema: {
        query: z.string().optional().describe(
          'Case-insensitive substring filter applied to message text and category.',
        ),
        categories: z.array(z.string()).default([]).describe(
          'Exact log categories to include.',
        ),
        verbosities: z.array(z.string()).default([]).describe(
          'Verbosity values to include (error, warning, log, verbose, etc.).',
        ),
        since_utc: z.string().optional().describe(
          'ISO-8601 lower bound for captured entries.',
        ),
        since_seconds: z.number().min(0).optional().describe(
          'Include only entries captured within the last N seconds.',
        ),
        offset: z.number().int().min(0).default(0).describe(
          'Matched-entry offset after filtering.',
        ),
        limit: z.number().int().min(1).max(1000).default(200).describe(
          'Max entries to return.',
        ),
        reverse: z.boolean().default(true).describe(
          'Return newest entries first when true.',
        ),
      },
      outputSchema: ReadOutputLogResultSchema,
      annotations: {
        title: 'Read Output Log',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, categories, verbosities, since_utc, since_seconds, offset, limit, reverse }) => {
      try {
        const parsed = await callSubsystemJson('ReadOutputLog', {
          FilterJson: JSON.stringify({
            query,
            categories,
            verbosities,
            since_utc,
            since_seconds,
            offset,
            limit,
            reverse,
          }),
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'list_message_log_listings',
    {
      title: 'List Message Log Listings',
      description: 'List registered Unreal Message Log listings from known built-in and caller-supplied candidate names.',
      inputSchema: {
        candidate_names: z.array(z.string()).default([]).describe(
          'Extra listing names to probe in addition to built-in candidates.',
        ),
        include_unregistered: z.boolean().default(false).describe(
          'Include probed names that are currently not registered.',
        ),
      },
      outputSchema: ListMessageLogListingsResultSchema,
      annotations: {
        title: 'List Message Log Listings',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ candidate_names, include_unregistered }) => {
      try {
        const parsed = await callSubsystemJson('ListMessageLogListings', {
          PayloadJson: JSON.stringify({
            candidate_names,
            include_unregistered,
          }),
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'read_message_log',
    {
      title: 'Read Message Log',
      description: 'Read one Unreal Message Log listing with text, severity, token, and paging filters.',
      inputSchema: {
        listing_name: z.string().describe(
          'Registered Message Log listing name.',
        ),
        query: z.string().optional().describe(
          'Case-insensitive substring filter applied to message and token text.',
        ),
        severities: z.array(z.string()).default([]).describe(
          'Severity values to include (error, warning, info, performance_warning).',
        ),
        token_types: z.array(z.string()).default([]).describe(
          'Token kinds to include (text, object, asset_name, url, etc.).',
        ),
        include_tokens: z.boolean().default(false).describe(
          'Include per-token payloads in each entry.',
        ),
        offset: z.number().int().min(0).default(0).describe(
          'Matched-entry offset after filtering.',
        ),
        limit: z.number().int().min(1).max(1000).default(200).describe(
          'Max entries to return.',
        ),
        reverse: z.boolean().default(true).describe(
          'Return newest filtered entries first when true.',
        ),
      },
      outputSchema: ReadMessageLogResultSchema,
      annotations: {
        title: 'Read Message Log',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ listing_name, query, severities, token_types, include_tokens, offset, limit, reverse }) => {
      try {
        const parsed = await callSubsystemJson('ReadMessageLog', {
          ListingName: listing_name,
          FilterJson: JSON.stringify({
            query,
            severities,
            token_types,
            include_tokens,
            offset,
            limit,
            reverse,
          }),
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'launch_editor',
    {
      title: 'Launch Editor',
      description: 'Launch a new Unreal Editor process for the resolved project and bind it as the active editor for this MCP session.',
      inputSchema: {
        engine_root: z.string().optional().describe(
          'UE root. Falls back to UE_ENGINE_ROOT.',
        ),
        project_path: z.string().optional().describe(
          '.uproject path. Falls back to UE_PROJECT_PATH.',
        ),
        target: z.string().optional().describe(
          'Editor target name.',
        ),
        reconnect_timeout_seconds: z.number().int().positive().default(180).describe(
          'Max seconds to wait for editor.',
        ),
      },
      annotations: {
        title: 'Launch Editor',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ engine_root, project_path, target, reconnect_timeout_seconds }) => {
      try {
        const resolved = await resolveProjectInputs({ engine_root, project_path, target });
        if (!resolved.engineRoot || !resolved.projectPath) {
          throw explainProjectResolutionFailure(
            'launch_editor requires engine_root and project_path',
            resolved,
          );
        }

        const launched = await projectController.launchEditor({
          engineRoot: resolved.engineRoot,
          projectPath: resolved.projectPath,
        });
        clearProjectAutomationContext();

        let activeEditor: Record<string, unknown> | undefined;
        if (activeEditorSession) {
          const bound = await activeEditorSession.bindLaunchedEditor({
            processId: launched.processId,
            projectPath: resolved.projectPath,
            engineRoot: resolved.engineRoot,
            target: resolved.target,
            timeoutMs: reconnect_timeout_seconds * 1000,
          });
          activeEditor = toLabeledActiveEditor(bound);
        }

        return jsonToolSuccess({
          ...launched,
          inputResolution: buildInputResolution(resolved),
          activeEditor,
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'start_pie',
    {
      title: 'Start PIE',
      description: 'Request a Play-In-Editor session from the active editor.',
      inputSchema: {
        simulate: z.boolean().default(false).describe(
          'Use Simulate-In-Editor.',
        ),
      },
      annotations: {
        title: 'Start PIE',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ simulate }) => {
      try {
        const parsed = await callSubsystemJson('StartPIE', {
          bSimulateInEditor: simulate,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'stop_pie',
    {
      title: 'Stop PIE',
      description: 'Stop the current Play-In-Editor session if one is active.',
      inputSchema: {},
      annotations: {
        title: 'Stop PIE',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const parsed = await callSubsystemJson('StopPIE', {});
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'relaunch_pie',
    {
      title: 'Relaunch PIE',
      description: 'Restart the current Play-In-Editor session by stopping it and scheduling a fresh launch.',
      inputSchema: {
        simulate: z.boolean().default(false).describe(
          'Use Simulate-In-Editor.',
        ),
      },
      annotations: {
        title: 'Relaunch PIE',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ simulate }) => {
      try {
        const parsed = await callSubsystemJson('RelaunchPIE', {
          bSimulateInEditor: simulate,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'wait_for_editor',
    {
      title: 'Wait For Editor',
      description: 'Poll the editor connection once per second until Remote Control responds again or the timeout elapses.',
      inputSchema: {
        timeout_seconds: z.number().int().positive().default(180).describe(
          'Max seconds to wait.',
        ),
      },
      annotations: {
        title: 'Wait For Editor',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ timeout_seconds }) => {
      if (activeEditorSession) {
        const activeState = await activeEditorSession.getActiveEditorState({ autoBindIfNeeded: true });
        if (!activeState.active) {
          return jsonToolSuccess({
            success: false,
            operation: 'wait_for_editor',
            connected: false,
            elapsedMs: 0,
            timeoutMs: timeout_seconds * 1_000,
            attempts: 0,
            code: 'no_active_editor',
            recoverable: true,
            message: activeState.message,
            next_steps: [
              'Call list_running_editors to inspect the available Unreal Editor instances.',
              'Call select_editor to bind this MCP session to the intended editor, or call launch_editor to start one.',
            ],
          });
        }
      }

      const probe = supportsConnectionProbe(client);
      const timeoutMs = timeout_seconds * 1_000;
      if (!probe) {
        return jsonToolSuccess({
          success: false,
          operation: 'wait_for_editor',
          connected: false,
          elapsedMs: 0,
          timeoutMs,
          attempts: 0,
          code: 'connection_probe_unavailable',
          recoverable: false,
          message: 'wait_for_editor requires a client implementation with checkConnection().',
          next_steps: [
            'Use a UE client implementation that exposes checkConnection() before calling wait_for_editor.',
          ],
        });
      }

      const startedAt = Date.now();
      let attempts = 0;

      while (true) {
        attempts += 1;
        const connected = await probe();
        const elapsedMs = Date.now() - startedAt;
        if (connected) {
          let activeEditor: Record<string, unknown> | undefined;
          const expectedActive = activeEditorSession?.getBoundSnapshot();
          if (activeEditorSession && expectedActive) {
            activeEditor = await activeEditorSession.refreshActiveEditorAfterReconnect({
              projectPath: expectedActive.projectFilePath,
              engineRoot: expectedActive.engineRoot,
              target: expectedActive.editorTarget,
            });
          }
          return jsonToolSuccess({
            success: true,
            operation: 'wait_for_editor',
            connected: true,
            elapsedMs,
            timeoutMs,
            attempts,
            ...(activeEditor ? { activeEditor } : {}),
          });
        }

        if (elapsedMs >= timeoutMs) {
          return jsonToolSuccess({
            success: false,
            operation: 'wait_for_editor',
            connected: false,
            elapsedMs,
            timeoutMs,
            attempts,
            code: 'editor_unavailable',
            recoverable: true,
            retry_after_ms: editorPollIntervalMs,
            message: `Timed out waiting for the UE editor after ${timeout_seconds}s.`,
            next_steps: [
              'Retry wait_for_editor if the editor is still restarting.',
              'Once the editor is back, rerun the blocked editor-backed tool.',
            ],
          });
        }

        await sleep(editorPollIntervalMs);
      }
    },
  );

  server.registerTool(
    'compile_project_code',
    {
      title: 'Compile Project Code',
      description: 'Run an external UBT build from the MCP host for the current project/editor target.',
      inputSchema: {
        engine_root: z.string().optional().describe(
          'UE root. Falls back to UE_ENGINE_ROOT.',
        ),
        project_path: z.string().optional().describe(
          '.uproject path. Falls back to UE_PROJECT_PATH.',
        ),
        target: z.string().optional().describe(
          'Build target. Falls back to UE_PROJECT_TARGET.',
        ),
        platform: buildPlatformSchema.optional().describe(
          'Build platform.',
        ),
        configuration: buildConfigurationSchema.optional().describe(
          'Build config. Default: Development.',
        ),
        build_timeout_seconds: z.number().int().positive().optional().describe(
          'Build timeout seconds. Default: 1800.',
        ),
        include_output: z.boolean().default(false).describe(
          'Include full build output.',
        ),
        clear_uht_cache: z.boolean().default(false).describe(
          'Delete UHT cache before building.',
        ),
      },
      annotations: {
        title: 'Compile Project Code',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ engine_root, project_path, target, platform, configuration, build_timeout_seconds, include_output, clear_uht_cache }) => {
      try {
        await assertRequestMatchesActiveEditor(activeEditorSession, {
          engine_root,
          project_path,
          target,
        });
        const resolved = await resolveProjectInputs({ engine_root, project_path, target });
        const parsed = await projectController.compileProjectCode({
          engineRoot: resolved.engineRoot,
          projectPath: resolved.projectPath,
          target: resolved.target,
          platform: platform as BuildPlatform | undefined,
          configuration: configuration as BuildConfiguration | undefined,
          buildTimeoutMs: typeof build_timeout_seconds === 'number' ? build_timeout_seconds * 1000 : undefined,
          includeOutput: include_output,
          clearUhtCache: clear_uht_cache,
        });
        rememberExternalBuild(parsed);
        return jsonToolSuccess({
          ...parsed,
          inputResolution: buildInputResolution(resolved),
        });
      } catch (error) {
        const resolved = await resolveProjectInputs({ engine_root, project_path, target });
        return jsonToolError(explainProjectResolutionFailure(
          error instanceof Error ? error.message : String(error),
          resolved,
        ));
      }
    },
  );

  server.registerTool(
    'trigger_live_coding',
    {
      title: 'Trigger Live Coding',
      description: 'Request an editor-side Live Coding compile. Unsupported host platforms return a structured unsupported result.',
      inputSchema: {
        changed_paths: z.array(z.string()).optional().describe(
          'Changed file paths.',
        ),
        wait_for_completion: z.boolean().default(true).describe(
          'Wait for synchronous result.',
        ),
      },
      annotations: {
        title: 'Trigger Live Coding',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ changed_paths, wait_for_completion }) => {
      try {
        if (!projectController.liveCodingSupported) {
          return jsonToolSuccess({
            success: false,
            operation: 'trigger_live_coding',
            status: 'unsupported',
            supported: false,
            reason: 'Host-side Live Coding automation is only supported on Windows.',
          });
        }

        const parsed = await callSubsystemJson('TriggerLiveCoding', {
          bEnableForSession: true,
          bWaitForCompletion: wait_for_completion,
        });

        return jsonToolSuccess(enrichLiveCodingResult(
          parsed,
          changed_paths ?? [],
          getLastExternalBuildContext(),
        ));
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'restart_editor',
    {
      title: 'Restart Editor',
      description: 'Request an editor restart, then wait for Remote Control to disconnect and reconnect.',
      inputSchema: {
        save_dirty_assets: z.boolean().default(true).describe(
          'Save dirty assets before restart.',
        ),
        force_kill: z.boolean().default(false).describe(
          'Force-kill instead of graceful shutdown.',
        ),
        wait_for_reconnect: z.boolean().default(true).describe(
          'Wait for reconnect.',
        ),
        disconnect_timeout_seconds: z.number().int().positive().default(60).describe(
          'Disconnect timeout seconds.',
        ),
        reconnect_timeout_seconds: z.number().int().positive().default(180).describe(
          'Reconnect timeout seconds.',
        ),
      },
      annotations: {
        title: 'Restart Editor',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ save_dirty_assets, force_kill, wait_for_reconnect, disconnect_timeout_seconds, reconnect_timeout_seconds }) => {
      try {
        const activeEditorBeforeRestart = activeEditorSession?.getBoundSnapshot();

        // Pre-flight: verify editor is connected before attempting restart
        const probe = supportsConnectionProbe(client);
        if (!force_kill && probe) {
          try {
            const connected = await probe();
            if (!connected) {
              return jsonToolError(new Error('Editor is not connected. Cannot restart.'));
            }
          } catch {
            return jsonToolError(new Error('Editor is not connected. Cannot restart.'));
          }
        }

        // Pre-flight: reject restart if editor is in PIE mode (skip for force_kill)
        if (!force_kill) {
          try {
            const ctx = await getProjectAutomationContext(true);
            if ((ctx as Record<string, unknown>).isPlayingInEditor === true) {
              return jsonToolError(new Error('Cannot restart during Play-In-Editor session. Stop PIE first.'));
            }
          } catch {
            // Context query failed — proceed with restart attempt anyway
          }
        }

        let restartRequest: Record<string, unknown>;

        if (force_kill) {
          const killOptions = activeEditorBeforeRestart?.processId
            ? { processId: activeEditorBeforeRestart.processId }
            : undefined;

          // Force-kill path: terminate the selected editor process directly. When the
          // session is bound to a concrete editor identity, relaunch the same project.
          const killResult = await projectController.killEditorProcess(killOptions);
          clearProjectAutomationContext();
          restartRequest = {
            success: killResult.killed,
            operation: 'restart_editor',
            strategy: 'force_kill',
            ...(killResult.error ? { error: killResult.error } : {}),
          };
          if (
            killResult.killed
            && activeEditorBeforeRestart?.projectFilePath
            && activeEditorBeforeRestart.engineRoot
          ) {
            const launched = await projectController.launchEditor({
              engineRoot: activeEditorBeforeRestart.engineRoot,
              projectPath: activeEditorBeforeRestart.projectFilePath,
            });
            restartRequest.editorLaunch = launched;
            if (activeEditorSession && launched.success) {
              restartRequest.activeEditor = await activeEditorSession.bindLaunchedEditor({
                processId: launched.processId,
                projectPath: activeEditorBeforeRestart.projectFilePath,
                engineRoot: activeEditorBeforeRestart.engineRoot,
                target: activeEditorBeforeRestart.editorTarget,
                timeoutMs: reconnect_timeout_seconds * 1000,
              });
            }
          }
        } else {
          // Graceful path: attempt restart with one retry on transient failure
          try {
            restartRequest = await callSubsystemJson('RestartEditor', {
              bWarn: false,
              bSaveDirtyAssets: save_dirty_assets,
              bRelaunch: true,
            });
          } catch (firstError) {
            await sleep(2000);
            try {
              restartRequest = await callSubsystemJson('RestartEditor', {
                bWarn: false,
                bSaveDirtyAssets: save_dirty_assets,
                bRelaunch: true,
              });
            } catch (retryError) {
              return jsonToolError(new Error(
                `restart_editor failed after retry: ${retryError instanceof Error ? retryError.message : String(retryError)}` +
                ` (first attempt: ${firstError instanceof Error ? firstError.message : String(firstError)})`,
              ));
            }
          }

          clearProjectAutomationContext();
        }

        if (!wait_for_reconnect || restartRequest.success === false) {
          return jsonToolSuccess({
            ...restartRequest,
            saveDirtyAssetsAccepted: save_dirty_assets,
            saveDirtyAssetsAppliedByEditor: save_dirty_assets,
          });
        }

        let reconnect = await projectController.waitForEditorRestart(probe, {
          disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
          reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
          waitForDisconnect: !force_kill,
        });

        let activeEditor: Record<string, unknown> | undefined;
        let recovery: Record<string, unknown> | undefined;
        if (!force_kill && !reconnect.success) {
          const recovered = await recoverEditorViaHostRelaunch({
            previousEditor: activeEditorBeforeRestart,
            projectPath: activeEditorBeforeRestart?.projectFilePath,
            engineRoot: activeEditorBeforeRestart?.engineRoot,
            target: activeEditorBeforeRestart?.editorTarget,
            reconnectTimeoutSeconds: reconnect_timeout_seconds,
            initialReconnect: reconnect,
          });
          recovery = recovered.recovery;
          if (recovered.success && recovered.reconnect) {
            reconnect = recovered.reconnect;
            activeEditor = recovered.activeEditor;
          }
        }

        if (!activeEditor && activeEditorSession && reconnect.success && activeEditorBeforeRestart && !force_kill) {
          activeEditor = await activeEditorSession.refreshActiveEditorAfterReconnect({
            projectPath: activeEditorBeforeRestart.projectFilePath,
            engineRoot: activeEditorBeforeRestart.engineRoot,
            target: activeEditorBeforeRestart.editorTarget,
          });
        }

        return jsonToolSuccess({
          ...restartRequest,
          saveDirtyAssetsAccepted: save_dirty_assets,
          saveDirtyAssetsAppliedByEditor: save_dirty_assets,
          reconnect,
          ...(recovery ? { recovery } : {}),
          ...(activeEditor ? { activeEditor } : {}),
          success: restartRequest.success !== false && reconnect.success,
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'sync_project_code',
    {
      title: 'Sync Project Code',
      description: 'Sync C++ code changes via Live Coding or build-and-restart based on explicit changed_paths.\n\n'
        + 'Example:\n'
        + '  {\n'
        + '    "changed_paths": ["Source/MyGame/Private/MyActor.cpp"],\n'
        + '    "project_path": "C:/Projects/MyGame/MyGame.uproject",\n'
        + '    "engine_root": "C:/Program Files/Epic Games/UE_5.7",\n'
        + '    "target": "MyGameEditor"\n'
        + '  }',
      inputSchema: {
        changed_paths: z.array(z.string()).min(1).describe(
          'Changed file paths (explicit).',
        ),
        force_rebuild: z.boolean().default(false).describe(
          'Force build-and-restart.',
        ),
        engine_root: z.string().optional().describe(
          'UE root. Falls back to UE_ENGINE_ROOT.',
        ),
        project_path: z.string().optional().describe(
          '.uproject path. Falls back to UE_PROJECT_PATH.',
        ),
        target: z.string().optional().describe(
          'Build target. Falls back to UE_PROJECT_TARGET.',
        ),
        platform: buildPlatformSchema.optional().describe(
          'Build platform.',
        ),
        configuration: buildConfigurationSchema.optional().describe(
          'Build config. Default: Development.',
        ),
        save_dirty_assets: z.boolean().default(true).describe(
          'Save dirty assets before restart.',
        ),
        save_asset_paths: z.array(z.string()).optional().describe(
          'Extra asset paths to save.',
        ),
        build_timeout_seconds: z.number().int().positive().optional().describe(
          'Build timeout seconds. Default: 1800.',
        ),
        disconnect_timeout_seconds: z.number().int().positive().default(60).describe(
          'Disconnect timeout seconds.',
        ),
        reconnect_timeout_seconds: z.number().int().positive().default(180).describe(
          'Reconnect timeout seconds.',
        ),
        include_output: z.boolean().default(false).describe(
          'Include full build output.',
        ),
        clear_uht_cache: z.boolean().default(false).describe(
          'Delete UHT cache before building.',
        ),
        restart_first: z.boolean().default(false).describe(
          'Shut down editor before building.',
        ),
      },
      annotations: {
        title: 'Sync Project Code',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      changed_paths,
      force_rebuild,
      engine_root,
      project_path,
      target,
      platform,
      configuration,
      save_dirty_assets,
      save_asset_paths,
      build_timeout_seconds,
      disconnect_timeout_seconds,
      reconnect_timeout_seconds,
      include_output,
      clear_uht_cache,
      restart_first,
    }) => {
      const stepErrors: Record<string, string> = {};
      let currentStep = 'init';
      try {
        await assertRequestMatchesActiveEditor(activeEditorSession, {
          engine_root,
          project_path,
          target,
        });
        const resolvedProjectInputs = await resolveProjectInputs({ engine_root, project_path, target });
        const activeEditorBeforeSync = activeEditorSession?.getBoundSnapshot();

        // Normalize changed_paths to absolute paths
        const projectRoot = resolvedProjectInputs.projectPath
          ? path.dirname(resolvedProjectInputs.projectPath)
          : '';
        const pathWarnings: string[] = [];
        const normalizedPaths = changed_paths.map((p: string) => {
          if (isAbsoluteFilesystemPath(p)) return p;
          if (projectRoot) return path.resolve(projectRoot, p);
          // No project root available — keep as-is but warn
          pathWarnings.push(`Cannot resolve relative path without project root: "${p}"`);
          return p;
        });
        changed_paths.forEach((original: string, i: number) => {
          if (normalizedPaths[i] !== original) {
            pathWarnings.push(`Normalized relative path: "${original}" → "${normalizedPaths[i]}"`);
          }
        });

        const plan = projectController.classifyChangedPaths(normalizedPaths, force_rebuild);
        const structuredResult: Record<string, unknown> = {
          success: false,
          operation: 'sync_project_code',
          changedPaths: normalizedPaths,
          plan,
          inputResolution: buildInputResolution(resolvedProjectInputs),
        };
        if (pathWarnings.length > 0) {
          structuredResult.pathWarnings = pathWarnings;
        }

        currentStep = 'live_coding';
        if (plan.strategy === 'live_coding') {
          if (!projectController.liveCodingSupported) {
            structuredResult.plan = {
              strategy: 'build_and_restart',
              restartRequired: true,
              reasons: ['live_coding_unsupported_on_host'],
            };
          } else {
            let liveCoding: Record<string, unknown>;
            try {
              liveCoding = enrichLiveCodingResult(
                await callSubsystemJson('TriggerLiveCoding', {
                  bEnableForSession: true,
                  bWaitForCompletion: true,
                }),
                normalizedPaths,
                getLastExternalBuildContext(),
              );
            } catch (lcError) {
              stepErrors.liveCoding = lcError instanceof Error ? lcError.message : String(lcError);
              liveCoding = { success: false, error: stepErrors.liveCoding };
            }

            if (!canFallbackFromLiveCoding(liveCoding)) {
              const lcResult: Record<string, unknown> = {
                success: liveCoding.success === true,
                operation: 'sync_project_code',
                strategy: 'live_coding',
                changedPaths: normalizedPaths,
                plan,
                liveCoding,
                failedStep: liveCoding.success !== true ? currentStep : undefined,
              };
              if (pathWarnings.length > 0) lcResult.pathWarnings = pathWarnings;
              if (Object.keys(stepErrors).length > 0) lcResult.stepErrors = stepErrors;
              return jsonToolSuccess(lcResult);
            }

            structuredResult.liveCoding = liveCoding;
            structuredResult.plan = {
              strategy: 'build_and_restart',
              restartRequired: true,
              reasons: [...plan.reasons, 'live_coding_precondition_failed'],
            };
          }
        }

        if (restart_first) {
          currentStep = 'pre_save';
          if (Array.isArray(save_asset_paths) && save_asset_paths.length > 0) {
            try {
              const preSave = await callSubsystemJson('SaveAssets', {
                AssetPathsJson: JSON.stringify(save_asset_paths),
              });
              structuredResult.preSave = preSave;
            } catch (preSaveError) {
              stepErrors.preSave = preSaveError instanceof Error ? preSaveError.message : String(preSaveError);
              // Pre-save is non-critical — continue to restart
            }
          }

          currentStep = 'pre_restart';
          try {
            const preRestart = await callSubsystemJson('RestartEditor', {
              bWarn: false,
              bSaveDirtyAssets: save_dirty_assets,
              bRelaunch: false,
            });
            clearProjectAutomationContext();
            structuredResult.preRestart = preRestart;
            if (preRestart.success === false) {
              stepErrors.preRestart = 'RestartEditor returned success=false';
              structuredResult.strategy = 'restart_first';
              structuredResult.failedStep = currentStep;
              if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
              return jsonToolSuccess(structuredResult);
            }
          } catch (preRestartError) {
            stepErrors.preRestart = preRestartError instanceof Error ? preRestartError.message : String(preRestartError);
            structuredResult.strategy = 'restart_first';
            structuredResult.success = false;
            structuredResult.failedStep = currentStep;
            if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
            return jsonToolSuccess(structuredResult);
          }

          try {
            const preDisconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
              disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
              reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
              waitForReconnect: false,
            });
            structuredResult.preDisconnect = preDisconnect;
            if (!preDisconnect.success) {
              stepErrors.preDisconnect = 'Editor did not disconnect within timeout';
              structuredResult.strategy = 'restart_first';
              structuredResult.failedStep = currentStep;
              if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
              return jsonToolSuccess(structuredResult);
            }
          } catch (preDisconnectError) {
            stepErrors.preDisconnect = preDisconnectError instanceof Error ? preDisconnectError.message : String(preDisconnectError);
            structuredResult.strategy = 'restart_first';
            structuredResult.success = false;
            structuredResult.failedStep = currentStep;
            if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
            return jsonToolSuccess(structuredResult);
          }
        }

        currentStep = 'build';
        let build: CompileProjectCodeResult;
        try {
          build = await projectController.compileProjectCode({
            engineRoot: resolvedProjectInputs.engineRoot,
            projectPath: resolvedProjectInputs.projectPath,
            target: resolvedProjectInputs.target,
            platform: platform as BuildPlatform | undefined,
            configuration: configuration as BuildConfiguration | undefined,
            buildTimeoutMs: typeof build_timeout_seconds === 'number' ? build_timeout_seconds * 1000 : undefined,
            includeOutput: include_output,
            clearUhtCache: clear_uht_cache,
          });
          rememberExternalBuild(build);
        } catch (buildError) {
          stepErrors.build = buildError instanceof Error ? buildError.message : String(buildError);
          structuredResult.strategy = restart_first ? 'restart_first' : 'build_and_restart';
          structuredResult.success = false;
          structuredResult.failedStep = currentStep;
          if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
          return jsonToolSuccess(structuredResult);
        }

        structuredResult.strategy = restart_first ? 'restart_first' : 'build_and_restart';
        structuredResult.build = build;

        if (!build.success) {
          structuredResult.failedStep = currentStep;
          if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
          return jsonToolSuccess(structuredResult);
        }

        currentStep = 'save';
        if (!restart_first && Array.isArray(save_asset_paths) && save_asset_paths.length > 0) {
          try {
            const saveResult = await callSubsystemJson('SaveAssets', {
              AssetPathsJson: JSON.stringify(save_asset_paths),
            });
            structuredResult.save = saveResult;
            if (saveResult.success === false) {
              stepErrors.save = 'SaveAssets returned success=false';
              structuredResult.failedStep = currentStep;
              if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
              return jsonToolSuccess(structuredResult);
            }
          } catch (saveError) {
            stepErrors.save = saveError instanceof Error ? saveError.message : String(saveError);
            // Save is non-critical before restart — continue
          }
        }

        currentStep = 'restart';
        let reconnect: Awaited<ReturnType<ProjectControllerLike['waitForEditorRestart']>> | undefined;
        const connectionProbe = supportsConnectionProbe(client);
        const expectedRestartIdentity = resolveEditorIdentity(activeEditorBeforeSync, {
          projectPath: resolvedProjectInputs.projectPath,
          engineRoot: resolvedProjectInputs.engineRoot,
          target: resolvedProjectInputs.target,
        });
        if (restart_first) {
          try {
            const launch = await projectController.launchEditor({
              engineRoot: resolvedProjectInputs.engineRoot,
              projectPath: resolvedProjectInputs.projectPath,
            });
            clearProjectAutomationContext();
            structuredResult.editorLaunch = launch;
            if (!launch.success) {
              stepErrors.editorLaunch = 'launchEditor returned success=false';
              structuredResult.failedStep = currentStep;
              if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
              return jsonToolSuccess(structuredResult);
            }
            if (activeEditorSession && launch.success && resolvedProjectInputs.projectPath) {
              structuredResult.activeEditor = await activeEditorSession.bindLaunchedEditor({
                processId: launch.processId,
                projectPath: resolvedProjectInputs.projectPath,
                engineRoot: resolvedProjectInputs.engineRoot,
                target: resolvedProjectInputs.target,
                timeoutMs: reconnect_timeout_seconds * 1000,
              });
            }
          } catch (launchError) {
            stepErrors.editorLaunch = launchError instanceof Error ? launchError.message : String(launchError);
            structuredResult.success = false;
            structuredResult.failedStep = currentStep;
            if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
            return jsonToolSuccess(structuredResult);
          }

          currentStep = 'reconnect';
          try {
            reconnect = await projectController.waitForEditorRestart(connectionProbe, {
              disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
              reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
              waitForDisconnect: false,
            });
            if (activeEditorSession && reconnect.success && !structuredResult.activeEditor && resolvedProjectInputs.projectPath) {
              structuredResult.activeEditor = await activeEditorSession.bindLaunchedEditor({
                projectPath: resolvedProjectInputs.projectPath,
                engineRoot: resolvedProjectInputs.engineRoot,
                target: resolvedProjectInputs.target,
                timeoutMs: reconnect_timeout_seconds * 1000,
              });
            }
          } catch (reconnectError) {
            stepErrors.reconnect = reconnectError instanceof Error ? reconnectError.message : String(reconnectError);
          }
        } else {
          try {
            const restartRequest = await callSubsystemJson('RestartEditor', {
              bWarn: false,
              bSaveDirtyAssets: save_dirty_assets,
              bRelaunch: true,
            });
            clearProjectAutomationContext();
            structuredResult.restartRequest = restartRequest;
            structuredResult.restartRequestSaveDirtyAssetsAccepted = save_dirty_assets;
            if (restartRequest.success === false) {
              stepErrors.restart = 'RestartEditor returned success=false';
              structuredResult.failedStep = currentStep;
              if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
              return jsonToolSuccess(structuredResult);
            }
          } catch (restartError) {
            stepErrors.restart = restartError instanceof Error ? restartError.message : String(restartError);
            structuredResult.success = false;
            structuredResult.failedStep = currentStep;
            if (Object.keys(stepErrors).length > 0) structuredResult.stepErrors = stepErrors;
            return jsonToolSuccess(structuredResult);
          }

          currentStep = 'reconnect';
          try {
            reconnect = await projectController.waitForEditorRestart(connectionProbe, {
              disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
              reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
            });
            if (!reconnect.success) {
              const recovered = await recoverEditorViaHostRelaunch({
                previousEditor: activeEditorBeforeSync,
                ...expectedRestartIdentity,
                reconnectTimeoutSeconds: reconnect_timeout_seconds,
                initialReconnect: reconnect,
              });
              structuredResult.restartRecovery = recovered.recovery;
              if (recovered.success && recovered.reconnect) {
                reconnect = recovered.reconnect;
                if (recovered.activeEditor) {
                  structuredResult.activeEditor = recovered.activeEditor;
                }
              }
            }
            if (activeEditorSession && reconnect.success) {
              structuredResult.activeEditor ??= await activeEditorSession.refreshActiveEditorAfterReconnect({
                ...expectedRestartIdentity,
              });
            }
          } catch (reconnectError) {
            const recovered = await recoverEditorViaHostRelaunch({
              previousEditor: activeEditorBeforeSync,
              ...expectedRestartIdentity,
              reconnectTimeoutSeconds: reconnect_timeout_seconds,
              initialError: reconnectError instanceof Error ? reconnectError.message : String(reconnectError),
            });
            structuredResult.restartRecovery = recovered.recovery;
            if (recovered.success && recovered.reconnect) {
              reconnect = recovered.reconnect;
              if (recovered.activeEditor) {
                structuredResult.activeEditor = recovered.activeEditor;
              }
            } else {
              stepErrors.reconnect = reconnectError instanceof Error ? reconnectError.message : String(reconnectError);
            }
          }
        }

        if (reconnect) {
          structuredResult.reconnect = reconnect;
          structuredResult.success = reconnect.success === true;
        } else {
          structuredResult.success = false;
        }
        if (structuredResult.success && structuredResult.build) {
          structuredResult.build = trimBuildOutput(structuredResult.build as Record<string, unknown>);
        }
        if (Object.keys(stepErrors).length > 0) {
          structuredResult.stepErrors = stepErrors;
        }
        return jsonToolSuccess(structuredResult);
      } catch (error) {
        // Preserve accumulated step context even in unhandled exception path.
        const resolved = await resolveProjectInputs({ engine_root, project_path, target }).catch(() => ({}));
        const errorMessage = error instanceof Error ? error.message : String(error);
        const failurePayload: Record<string, unknown> = {
          success: false,
          operation: 'sync_project_code',
          message: String(explainProjectResolutionFailure(errorMessage, resolved as Parameters<typeof explainProjectResolutionFailure>[1])),
          failedStep: currentStep,
          stepErrors,
          changedPaths: changed_paths,
        };
        if (error instanceof Error && error.stack) {
          failurePayload.stack = error.stack;
        }
        return jsonToolSuccess(failurePayload);
      }
    },
  );
}
