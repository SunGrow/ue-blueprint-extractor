import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  canFallbackFromLiveCoding,
  enrichLiveCodingResult,
} from '../helpers/live-coding.js';
import { supportsConnectionProbe } from '../helpers/project-utils.js';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';
import { getWidgetIdentifier } from '../helpers/widget-utils.js';
import type {
  BuildConfiguration,
  BuildPlatform,
  CompileProjectCodeResult,
  ProjectControllerLike,
} from '../project-controller.js';
import type { ResolvedProjectInputs } from '../tool-context.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type ConnectionProbeCapable = {
  checkConnection?: (() => Promise<boolean>) | undefined;
};

type ResolveProjectInputs = (
  request: {
    engine_root?: string;
    project_path?: string;
    target?: string;
  },
) => Promise<ResolvedProjectInputs>;

type ApplyWindowUiSyncProjectCodeArgs = {
  changed_paths: string[];
  force_rebuild?: boolean;
  engine_root?: string;
  project_path?: string;
  target?: string;
  platform?: string;
  configuration?: string;
  save_dirty_assets?: boolean;
  build_timeout_seconds?: number;
  disconnect_timeout_seconds?: number;
  reconnect_timeout_seconds?: number;
  include_output?: boolean;
  clear_uht_cache?: boolean;
  restart_first?: boolean;
};

type ApplyWindowUiArgs = {
  asset_path: string;
  variable_widgets: Array<{
    widget_name?: string;
    widget_path?: string;
    is_variable: boolean;
  }>;
  class_defaults?: Record<string, unknown>;
  font_import?: {
    destination_path: string;
    font_asset_path?: string;
    items: Array<{
      file_path: string;
      entry_name?: string;
      replace_existing?: boolean;
    }>;
  };
  font_applications?: Array<{
    widget_name?: string;
    widget_path?: string;
    font_asset: string;
    typeface?: string;
    size: number;
  }>;
  compile_after: boolean;
  save_after: boolean;
  checkpoint_after_mutation_steps: boolean;
  save_asset_paths?: string[];
  sync_project_code?: ApplyWindowUiSyncProjectCodeArgs;
};

type RegisterWindowUiToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  client: ConnectionProbeCapable;
  projectController: ProjectControllerLike;
  callSubsystemJson: JsonSubsystemCaller;
  resolveProjectInputs: ResolveProjectInputs;
  rememberExternalBuild: (result: CompileProjectCodeResult) => void;
  getLastExternalBuildContext: () => Record<string, unknown> | null;
  clearProjectAutomationContext: () => void;
  applyWindowUiChangesResultSchema: z.ZodTypeAny;
  widgetSelectorFieldsSchema: z.AnyZodObject;
  fontImportItemSchema: z.ZodTypeAny;
  windowFontApplicationSchema: z.ZodTypeAny;
  buildPlatformSchema: z.ZodTypeAny;
  buildConfigurationSchema: z.ZodTypeAny;
};

function buildInputResolution(resolved: ResolvedProjectInputs): Record<string, unknown> {
  return {
    engineRoot: resolved.sources.engineRoot,
    projectPath: resolved.sources.projectPath,
    target: resolved.sources.target,
    contextError: resolved.contextError,
  };
}

function summarizeStep(entry: Record<string, unknown>): Record<string, unknown> {
  const step = typeof entry.step === 'string' ? entry.step : 'unknown';
  const result = entry.result as Record<string, unknown> | undefined;
  const success = result?.success !== false;
  const parts: string[] = [];

  if (typeof result?.operation === 'string') {
    parts.push(result.operation as string);
  }
  if (typeof result?.message === 'string') {
    parts.push(result.message as string);
  }
  if (typeof entry.strategy === 'string') {
    parts.push(`strategy=${entry.strategy}`);
  }

  return {
    step,
    success,
    summary: parts.length > 0 ? parts.join(' — ') : (success ? 'ok' : 'failed'),
  };
}

/**
 * Wraps callSubsystemJson so that thrown UE error responses are returned as
 * result objects instead of propagating. This lets the step-by-step orchestrator
 * inspect `result.success === false` rather than losing control to the outer catch.
 */
async function safeCallSubsystemJson(
  callSubsystemJson: (method: string, params: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<Record<string, unknown>>,
  method: string,
  params: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  try {
    return options
      ? await callSubsystemJson(method, params, options)
      : await callSubsystemJson(method, params);
  } catch (error) {
    const ueResponse = (error as Record<string, unknown>).ueResponse as Record<string, unknown> | undefined;
    if (ueResponse) return ueResponse;
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function buildStoppedResult(
  stoppedAt: string,
  steps: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  return jsonToolSuccess({
    success: false,
    operation: 'apply_window_ui_changes',
    stoppedAt,
    steps,
    ...extra,
  });
}

export function registerWindowUiTools({
  server,
  client,
  projectController,
  callSubsystemJson,
  resolveProjectInputs,
  rememberExternalBuild,
  getLastExternalBuildContext,
  clearProjectAutomationContext,
  applyWindowUiChangesResultSchema,
  widgetSelectorFieldsSchema,
  fontImportItemSchema,
  windowFontApplicationSchema,
  buildPlatformSchema,
  buildConfigurationSchema,
}: RegisterWindowUiToolsOptions): void {
  server.registerTool(
    'apply_window_ui_changes',
    {
      title: 'Apply Window UI Changes',
      description: 'Apply variable flags, class defaults, font work, compile, optional save, and optional code sync in one ordered flow.\n\n'
        + 'Example:\n'
        + '  {\n'
        + '    "asset_path": "/Game/UI/WBP_Window",\n'
        + '    "variable_widgets": [\n'
        + '      { "widget_path": "WindowRoot/TitleBar/TitleText", "is_variable": true }\n'
        + '    ],\n'
        + '    "class_defaults": {\n'
        + '      "ActiveTitleBarMaterial": "/Game/UI/MI_TitleBarActive.MI_TitleBarActive"\n'
        + '    },\n'
        + '    "compile_after": true,\n'
        + '    "save_after": false\n'
        + '  }',
      outputSchema: applyWindowUiChangesResultSchema,
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the WidgetBlueprint to update.',
        ),
        variable_widgets: z.array(widgetSelectorFieldsSchema.extend({
          is_variable: z.boolean().default(true),
        }).refine((value) => Boolean(value.widget_name || value.widget_path), {
          message: 'widget_name or widget_path is required',
        })).default([]).describe(
          'Optional widget selectors to toggle as variables before the compile/save pass.',
        ),
        class_defaults: z.record(z.string(), z.unknown()).optional().describe(
          'Optional widget Blueprint generated-class defaults to patch.',
        ),
        font_import: z.object({
          destination_path: z.string(),
          font_asset_path: z.string().optional(),
          items: z.array(fontImportItemSchema).min(1),
        }).optional().describe(
          'Optional explicit-file-path font import payload passed through to ImportFonts.',
        ),
        font_applications: z.array(windowFontApplicationSchema).optional().describe(
          'Optional compact font applications passed through to ApplyWidgetFonts.',
        ),
        compile_after: z.boolean().default(true).describe(
          'When true, compile the widget Blueprint after the requested mutations.',
        ),
        save_after: z.boolean().default(false).describe(
          'When true, save the widget asset and any explicit extra save paths after a successful compile. Leave false to keep visual verification ahead of final persistence.',
        ),
        checkpoint_after_mutation_steps: z.boolean().default(false).describe(
          'When true, save checkpoint assets after each successful mutation step so multi-step UI flows can recover from later interruptions.',
        ),
        save_asset_paths: z.array(z.string()).optional().describe(
          'Optional extra asset paths to save with the widget asset.',
        ),
        sync_project_code: z.object({
          changed_paths: z.array(z.string()).min(1),
          force_rebuild: z.boolean().default(false).optional(),
          engine_root: z.string().optional(),
          project_path: z.string().optional(),
          target: z.string().optional(),
          platform: buildPlatformSchema.optional(),
          configuration: buildConfigurationSchema.optional(),
          save_dirty_assets: z.boolean().default(true).optional(),
          build_timeout_seconds: z.number().int().positive().optional(),
          disconnect_timeout_seconds: z.number().int().positive().default(60).optional(),
          reconnect_timeout_seconds: z.number().int().positive().default(180).optional(),
          include_output: z.boolean().default(false).optional(),
          clear_uht_cache: z.boolean().default(false).optional(),
          restart_first: z.boolean().default(false).optional(),
        }).optional().describe(
          'Optional project-code sync step to run after the widget asset work succeeds.',
        ),
      },
      annotations: {
        title: 'Apply Window UI Changes',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const {
          asset_path,
          variable_widgets,
          class_defaults,
          font_import,
          font_applications,
          compile_after,
          save_after,
          checkpoint_after_mutation_steps,
          save_asset_paths,
          sync_project_code,
        } = args as ApplyWindowUiArgs;
        // Use safe wrapper so thrown UE error responses become result objects
        // that the step-by-step orchestrator can inspect via result.success === false.
        const safeCall = (method: string, params: Record<string, unknown>, options?: { timeoutMs?: number }) =>
          safeCallSubsystemJson(callSubsystemJson, method, params, options);
        const steps: Array<Record<string, unknown>> = [];
        const buildVerification = () => {
          const status: 'compile_pending' | 'unverified' = compile_after ? 'unverified' : 'compile_pending';
          return {
            required: true,
            status,
            surface: 'editor_offscreen',
            recommendedTool: 'capture_widget_preview',
            partialAllowed: true,
            reason: compile_after
              ? 'apply_window_ui_changes completed the mutation flow but did not perform the final rendered-widget verification step.'
              : 'apply_window_ui_changes completed the mutation flow without compiling the widget, so compile and visual verification are still pending.',
          };
        };
        const buildVerificationNextSteps = (status: 'compile_pending' | 'unverified') => {
          if (status === 'compile_pending') {
            return [
              'Compile the widget blueprint or rerun apply_window_ui_changes with compile_after=true before visual verification.',
              `Run capture_widget_preview for ${asset_path} after the compile result is clean.`,
              'If preview capture is blocked, report partial verification explicitly with the blocking reason.',
            ];
          }

          return [
            `Run capture_widget_preview for ${asset_path} to visually confirm the rendered widget before calling the change verified.`,
            'If preview capture is blocked, report partial verification explicitly with the blocking reason.',
          ];
        };
        const collectCheckpointAssetPaths = (extraPaths: string[] = []) => {
          const assetPaths = new Set<string>([asset_path]);
          for (const extraPath of save_asset_paths ?? []) {
            assetPaths.add(extraPath);
          }
          if (font_import?.font_asset_path) {
            assetPaths.add(font_import.font_asset_path);
          }
          for (const extraPath of extraPaths) {
            assetPaths.add(extraPath);
          }
          return Array.from(assetPaths);
        };
        const checkpointMutationStep = async (stepName: string, extraPaths: string[] = []) => {
          if (!checkpoint_after_mutation_steps) {
            return null;
          }

          const result = await safeCall('SaveAssets', {
            AssetPathsJson: JSON.stringify(collectCheckpointAssetPaths(extraPaths)),
          });
          steps.push({
            step: 'checkpoint_after_mutation_step',
            afterStep: stepName,
            result,
          });
          if (result.success === false) {
            return buildStoppedResult('checkpoint_after_mutation_step', steps, {
              failedAfterStep: stepName,
            });
          }

          return null;
        };

        for (const selector of variable_widgets) {
          const widgetIdentifier = getWidgetIdentifier(selector.widget_name, selector.widget_path);
          if (!widgetIdentifier) {
            return jsonToolError(new Error('variable_widgets entries require widget_name or widget_path'));
          }

          const result = await safeCall('ModifyWidget', {
            AssetPath: asset_path,
            WidgetName: widgetIdentifier,
            PropertiesJson: JSON.stringify({}),
            SlotJson: JSON.stringify({}),
            WidgetOptionsJson: JSON.stringify({ is_variable: selector.is_variable }),
            bValidateOnly: false,
          });
          steps.push({
            step: 'mark_widget_variable',
            selector,
            result,
          });
          if (result.success === false) {
            return buildStoppedResult('mark_widget_variable', steps);
          }
          const checkpointResult = await checkpointMutationStep('mark_widget_variable');
          if (checkpointResult) {
            return checkpointResult;
          }
        }

        if (class_defaults) {
          const result = await safeCall('ModifyWidgetBlueprintStructure', {
            AssetPath: asset_path,
            Operation: 'patch_class_defaults',
            PayloadJson: JSON.stringify({ classDefaults: class_defaults }),
            bValidateOnly: false,
          });
          steps.push({
            step: 'patch_class_defaults',
            result,
          });
          if (result.success === false) {
            return buildStoppedResult('patch_class_defaults', steps);
          }
          const checkpointResult = await checkpointMutationStep('patch_class_defaults');
          if (checkpointResult) {
            return checkpointResult;
          }
        }

        if (font_import) {
          const result = await safeCall('ImportFonts', {
            PayloadJson: JSON.stringify(font_import),
            bValidateOnly: false,
          });
          steps.push({
            step: 'import_fonts',
            result,
          });
          if (result.success === false) {
            return buildStoppedResult('import_fonts', steps);
          }
          const importedAssetPaths = Array.isArray(result.importedObjects)
            ? result.importedObjects
              .map((value) => (typeof value === 'object' && value !== null && typeof value.assetPath === 'string' ? value.assetPath : null))
              .filter((value): value is string => value !== null)
            : [];
          const checkpointResult = await checkpointMutationStep('import_fonts', importedAssetPaths);
          if (checkpointResult) {
            return checkpointResult;
          }
        }

        if (font_applications && font_applications.length > 0) {
          const result = await safeCall('ApplyWidgetFonts', {
            AssetPath: asset_path,
            PayloadJson: JSON.stringify({ applications: font_applications }),
            bValidateOnly: false,
          });
          steps.push({
            step: 'apply_widget_fonts',
            result,
          });
          if (result.success === false) {
            return buildStoppedResult('apply_widget_fonts', steps);
          }
          const checkpointResult = await checkpointMutationStep('apply_widget_fonts');
          if (checkpointResult) {
            return checkpointResult;
          }
        }

        if (compile_after) {
          const result = await safeCall('CompileWidgetBlueprint', {
            AssetPath: asset_path,
          });
          steps.push({
            step: 'compile_widget_blueprint',
            result,
          });
          if (result.success === false) {
            return buildStoppedResult('compile_widget_blueprint', steps);
          }
          const checkpointResult = await checkpointMutationStep('compile_widget_blueprint');
          if (checkpointResult) {
            return checkpointResult;
          }
        }

        if (save_after) {
          const assetPaths = new Set<string>([asset_path]);
          for (const extraPath of save_asset_paths ?? []) {
            assetPaths.add(extraPath);
          }
          if (font_import?.font_asset_path) {
            assetPaths.add(font_import.font_asset_path);
          }

          const result = await safeCall('SaveAssets', {
            AssetPathsJson: JSON.stringify(Array.from(assetPaths)),
          });
          steps.push({
            step: 'save_assets',
            result,
          });
          if (result.success === false) {
            return buildStoppedResult('save_assets', steps);
          }
        }

        if (sync_project_code) {
          const syncPlan = projectController.classifyChangedPaths(
            sync_project_code.changed_paths,
            sync_project_code.force_rebuild ?? false,
          );
          const resolvedProjectInputs = await resolveProjectInputs({
            engine_root: sync_project_code.engine_root,
            project_path: sync_project_code.project_path,
            target: sync_project_code.target,
          });
          let needsBuildRestart = syncPlan.strategy === 'build_and_restart' || !projectController.liveCodingSupported;

          if (syncPlan.strategy === 'live_coding' && projectController.liveCodingSupported) {
            const liveCoding = enrichLiveCodingResult(await safeCall('TriggerLiveCoding', {
              bEnableForSession: true,
              bWaitForCompletion: true,
            }), sync_project_code.changed_paths, getLastExternalBuildContext());
            if (!canFallbackFromLiveCoding(liveCoding)) {
              steps.push({
                step: 'sync_project_code',
                strategy: 'live_coding',
                result: liveCoding,
              });
              if (liveCoding.success === false) {
                return buildStoppedResult('sync_project_code', steps);
              }
            } else {
              steps.push({
                step: 'sync_project_code_precheck',
                strategy: 'live_coding',
                result: liveCoding,
              });
              needsBuildRestart = true;
            }
          }

          if (needsBuildRestart) {
            const useRestartFirst = sync_project_code.restart_first ?? false;

            if (useRestartFirst) {
              const preRestart = await safeCall('RestartEditor', {
                bWarn: false,
                bSaveDirtyAssets: sync_project_code.save_dirty_assets ?? true,
                bRelaunch: false,
              });
              clearProjectAutomationContext();
              const preDisconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
                disconnectTimeoutMs: (sync_project_code.disconnect_timeout_seconds ?? 60) * 1000,
                reconnectTimeoutMs: (sync_project_code.reconnect_timeout_seconds ?? 180) * 1000,
                waitForReconnect: false,
              });
              steps.push({
                step: 'sync_project_code_pre_restart',
                strategy: 'restart_first',
                restartRequest: preRestart,
                disconnect: preDisconnect,
              });
              if (preRestart.success === false || !preDisconnect.success) {
                return buildStoppedResult('sync_project_code_pre_restart', steps);
              }
            }

            const build = await projectController.compileProjectCode({
              engineRoot: resolvedProjectInputs.engineRoot,
              projectPath: resolvedProjectInputs.projectPath,
              target: resolvedProjectInputs.target,
              platform: sync_project_code.platform as BuildPlatform | undefined,
              configuration: sync_project_code.configuration as BuildConfiguration | undefined,
              buildTimeoutMs: typeof sync_project_code.build_timeout_seconds === 'number'
                ? sync_project_code.build_timeout_seconds * 1000
                : undefined,
              includeOutput: sync_project_code.include_output ?? false,
              clearUhtCache: sync_project_code.clear_uht_cache ?? false,
            });
            rememberExternalBuild(build);
            steps.push({
              step: 'compile_project_code',
              result: build,
              inputResolution: buildInputResolution(resolvedProjectInputs),
            });
            if (!build.success) {
              return buildStoppedResult('compile_project_code', steps);
            }

            if (useRestartFirst) {
              const editorLaunch = await projectController.launchEditor({
                engineRoot: resolvedProjectInputs.engineRoot,
                projectPath: resolvedProjectInputs.projectPath,
              });
              clearProjectAutomationContext();
              const reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
                disconnectTimeoutMs: (sync_project_code.disconnect_timeout_seconds ?? 60) * 1000,
                reconnectTimeoutMs: (sync_project_code.reconnect_timeout_seconds ?? 180) * 1000,
                waitForDisconnect: false,
              });
              steps.push({
                step: 'sync_project_code',
                strategy: 'restart_first',
                editorLaunch,
                reconnect,
              });
              if (!editorLaunch.success || !reconnect.success) {
                return buildStoppedResult('sync_project_code', steps);
              }
            } else {
              const restartRequest = await safeCall('RestartEditor', {
                bWarn: false,
                bSaveDirtyAssets: sync_project_code.save_dirty_assets ?? true,
                bRelaunch: true,
              });
              clearProjectAutomationContext();
              const reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
                disconnectTimeoutMs: (sync_project_code.disconnect_timeout_seconds ?? 60) * 1000,
                reconnectTimeoutMs: (sync_project_code.reconnect_timeout_seconds ?? 180) * 1000,
              });
              steps.push({
                step: 'sync_project_code',
                strategy: 'build_and_restart',
                restartRequest,
                saveDirtyAssetsAccepted: sync_project_code.save_dirty_assets ?? true,
                reconnect,
              });
              if (restartRequest.success === false || !reconnect.success) {
                return buildStoppedResult('sync_project_code', steps);
              }
            }
          }
        }

        const verification = buildVerification();
        return jsonToolSuccess({
          success: true,
          operation: 'apply_window_ui_changes',
          steps: steps.map(summarizeStep),
          verification,
          next_steps: buildVerificationNextSteps(verification.status),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
