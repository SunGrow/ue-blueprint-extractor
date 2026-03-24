import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sleep } from '../helpers/formatting.js';
import {
  canFallbackFromLiveCoding,
  enrichLiveCodingResult,
} from '../helpers/live-coding.js';
import {
  explainProjectResolutionFailure,
  supportsConnectionProbe,
} from '../helpers/project-utils.js';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';
import type {
  BuildConfiguration,
  BuildPlatform,
  CompileProjectCodeResult,
  ProjectControllerLike,
} from '../project-controller.js';
import type {
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
  buildPlatformSchema,
  buildConfigurationSchema,
  editorPollIntervalMs,
}: RegisterProjectControlToolsOptions): void {
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
    'wait_for_editor',
    {
      title: 'Wait For Editor',
      description: 'Poll the editor connection once per second until Remote Control responds again or the timeout elapses.',
      inputSchema: {
        timeout_seconds: z.number().int().positive().default(180).describe(
          'Maximum number of seconds to wait for the editor connection to return.',
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
          return jsonToolSuccess({
            success: true,
            operation: 'wait_for_editor',
            connected: true,
            elapsedMs,
            timeoutMs,
            attempts,
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
          'Optional Unreal Engine root. Falls back to UE_ENGINE_ROOT.',
        ),
        project_path: z.string().optional().describe(
          'Optional .uproject path. Falls back to UE_PROJECT_PATH.',
        ),
        target: z.string().optional().describe(
          'Optional build target such as MyGameEditor. Falls back to UE_PROJECT_TARGET or UE_EDITOR_TARGET.',
        ),
        platform: buildPlatformSchema.optional().describe(
          'Optional build platform. Defaults from the host OS.',
        ),
        configuration: buildConfigurationSchema.optional().describe(
          'Optional build configuration. Defaults to Development.',
        ),
        build_timeout_seconds: z.number().int().positive().optional().describe(
          'Optional build timeout in seconds. Defaults to 1800.',
        ),
        include_output: z.boolean().default(false).describe(
          'When true, include full stdout and stderr in the result. Failure cases include output automatically.',
        ),
        clear_uht_cache: z.boolean().default(false).describe(
          'When true, delete UHT cache files (.uhtpath, .uhtsettings) from Intermediate/ before building so that Unreal Header Tool regenerates headers for any new or changed UPROPERTYs.',
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
          'Optional explicit changed paths to pass through to the editor-side automation surface.',
        ),
        wait_for_completion: z.boolean().default(true).describe(
          'When true, request a synchronous/terminal Live Coding result from the editor-side method.',
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
          'When true, ask the editor-side restart path to save dirty assets before relaunching.',
        ),
        wait_for_reconnect: z.boolean().default(true).describe(
          'When true, wait for the editor to disconnect and reconnect before returning.',
        ),
        disconnect_timeout_seconds: z.number().int().positive().default(60).describe(
          'Maximum seconds to wait for the editor to disconnect after the restart request.',
        ),
        reconnect_timeout_seconds: z.number().int().positive().default(180).describe(
          'Maximum seconds to wait for Remote Control to return after the editor restarts.',
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
    async ({ save_dirty_assets, wait_for_reconnect, disconnect_timeout_seconds, reconnect_timeout_seconds }) => {
      try {
        const restartRequest = await callSubsystemJson('RestartEditor', {
          bWarn: false,
          bSaveDirtyAssets: save_dirty_assets,
          bRelaunch: true,
        });

        clearProjectAutomationContext();

        if (!wait_for_reconnect || restartRequest.success === false) {
          return jsonToolSuccess({
            ...restartRequest,
            saveDirtyAssetsAccepted: save_dirty_assets,
            saveDirtyAssetsAppliedByEditor: save_dirty_assets,
          });
        }

        const reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
          disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
          reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
        });

        return jsonToolSuccess({
          ...restartRequest,
          saveDirtyAssetsAccepted: save_dirty_assets,
          saveDirtyAssetsAppliedByEditor: save_dirty_assets,
          reconnect,
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
      description: 'Sync C++ code changes via Live Coding or build-and-restart based on explicit changed_paths.',
      inputSchema: {
        changed_paths: z.array(z.string()).min(1).describe(
          'Explicit changed file paths. This tool does not infer them from source control.',
        ),
        force_rebuild: z.boolean().default(false).describe(
          'When true, force the build-and-restart path regardless of changed_paths.',
        ),
        engine_root: z.string().optional().describe(
          'Optional Unreal Engine root. Falls back to UE_ENGINE_ROOT.',
        ),
        project_path: z.string().optional().describe(
          'Optional .uproject path. Falls back to UE_PROJECT_PATH.',
        ),
        target: z.string().optional().describe(
          'Optional build target such as MyGameEditor. Falls back to UE_PROJECT_TARGET or UE_EDITOR_TARGET.',
        ),
        platform: buildPlatformSchema.optional().describe(
          'Optional build platform. Defaults from the host OS.',
        ),
        configuration: buildConfigurationSchema.optional().describe(
          'Optional build configuration. Defaults to Development.',
        ),
        save_dirty_assets: z.boolean().default(true).describe(
          'When true, ask the editor restart path to save dirty assets before relaunching.',
        ),
        save_asset_paths: z.array(z.string()).optional().describe(
          'Optional explicit asset paths to save through save_assets before the editor restart.',
        ),
        build_timeout_seconds: z.number().int().positive().optional().describe(
          'Optional external build timeout in seconds. Defaults to 1800.',
        ),
        disconnect_timeout_seconds: z.number().int().positive().default(60).describe(
          'Maximum seconds to wait for the editor to disconnect after a restart request.',
        ),
        reconnect_timeout_seconds: z.number().int().positive().default(180).describe(
          'Maximum seconds to wait for Remote Control to return after the editor restarts.',
        ),
        include_output: z.boolean().default(false).describe(
          'When true, include full build stdout and stderr in the result. Failure cases include output automatically.',
        ),
        clear_uht_cache: z.boolean().default(false).describe(
          'When true, delete UHT cache files (.uhtpath, .uhtsettings) from Intermediate/ before building so that Unreal Header Tool regenerates headers for any new or changed UPROPERTYs.',
        ),
        restart_first: z.boolean().default(false).describe(
          'When true, shut the editor down before building to release locked DLLs, then launch it from the MCP host after the build finishes. Use this when a previous build failed due to a locked DLL (errorCategory: locked_file).',
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
      try {
        const plan = projectController.classifyChangedPaths(changed_paths, force_rebuild);
        const resolvedProjectInputs = await resolveProjectInputs({ engine_root, project_path, target });
        const structuredResult: Record<string, unknown> = {
          success: false,
          operation: 'sync_project_code',
          changedPaths: changed_paths,
          plan,
          inputResolution: buildInputResolution(resolvedProjectInputs),
        };

        if (plan.strategy === 'live_coding') {
          if (!projectController.liveCodingSupported) {
            structuredResult.plan = {
              strategy: 'build_and_restart',
              restartRequired: true,
              reasons: ['live_coding_unsupported_on_host'],
            };
          } else {
            const liveCoding = enrichLiveCodingResult(
              await callSubsystemJson('TriggerLiveCoding', {
                bEnableForSession: true,
                bWaitForCompletion: true,
              }),
              changed_paths,
              getLastExternalBuildContext(),
            );

            if (!canFallbackFromLiveCoding(liveCoding)) {
              return jsonToolSuccess({
                success: liveCoding.success === true,
                operation: 'sync_project_code',
                strategy: 'live_coding',
                changedPaths: changed_paths,
                plan,
                liveCoding,
              });
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
          if (Array.isArray(save_asset_paths) && save_asset_paths.length > 0) {
            const preSave = await callSubsystemJson('SaveAssets', {
              AssetPathsJson: JSON.stringify(save_asset_paths),
            });
            structuredResult.preSave = preSave;
          }

          const preRestart = await callSubsystemJson('RestartEditor', {
            bWarn: false,
            bSaveDirtyAssets: save_dirty_assets,
            bRelaunch: false,
          });
          clearProjectAutomationContext();
          structuredResult.preRestart = preRestart;
          if (preRestart.success === false) {
            structuredResult.strategy = 'restart_first';
            return jsonToolSuccess(structuredResult);
          }

          const preDisconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
            disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
            reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
            waitForReconnect: false,
          });
          structuredResult.preDisconnect = preDisconnect;
          if (!preDisconnect.success) {
            structuredResult.strategy = 'restart_first';
            return jsonToolSuccess(structuredResult);
          }
        }

        const build = await projectController.compileProjectCode({
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

        structuredResult.strategy = restart_first ? 'restart_first' : 'build_and_restart';
        structuredResult.build = build;

        if (!build.success) {
          return jsonToolSuccess(structuredResult);
        }

        if (!restart_first && Array.isArray(save_asset_paths) && save_asset_paths.length > 0) {
          const saveResult = await callSubsystemJson('SaveAssets', {
            AssetPathsJson: JSON.stringify(save_asset_paths),
          });
          structuredResult.save = saveResult;
          if (saveResult.success === false) {
            return jsonToolSuccess(structuredResult);
          }
        }

        let reconnect: Awaited<ReturnType<ProjectControllerLike['waitForEditorRestart']>>;
        if (restart_first) {
          const launch = await projectController.launchEditor({
            engineRoot: resolvedProjectInputs.engineRoot,
            projectPath: resolvedProjectInputs.projectPath,
          });
          clearProjectAutomationContext();
          structuredResult.editorLaunch = launch;
          if (!launch.success) {
            return jsonToolSuccess(structuredResult);
          }
          reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
            disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
            reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
            waitForDisconnect: false,
          });
        } else {
          const restartRequest = await callSubsystemJson('RestartEditor', {
            bWarn: false,
            bSaveDirtyAssets: save_dirty_assets,
            bRelaunch: true,
          });
          clearProjectAutomationContext();
          structuredResult.restartRequest = restartRequest;
          structuredResult.restartRequestSaveDirtyAssetsAccepted = save_dirty_assets;
          if (restartRequest.success === false) {
            return jsonToolSuccess(structuredResult);
          }
          reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
            disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
            reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
          });
        }

        structuredResult.reconnect = reconnect;
        structuredResult.success = reconnect.success === true;
        if (structuredResult.success && structuredResult.build) {
          structuredResult.build = trimBuildOutput(structuredResult.build as Record<string, unknown>);
        }
        return jsonToolSuccess(structuredResult);
      } catch (error) {
        const resolved = await resolveProjectInputs({ engine_root, project_path, target });
        return jsonToolError(explainProjectResolutionFailure(
          error instanceof Error ? error.message : String(error),
          resolved,
        ));
      }
    },
  );
}
