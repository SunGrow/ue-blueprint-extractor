import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AutomationControllerLike } from '../automation-controller.js';
import { buildCaptureResourceUri, buildResourceLinkContent, maybeBuildInlineImageContent } from '../helpers/capture.js';
import { explainProjectResolutionFailure } from '../helpers/project-utils.js';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';
import {
  normalizeAutomationRunResult,
  normalizeVerificationArtifact,
  normalizeVerificationArtifactReference,
  normalizeVerificationComparison,
} from '../helpers/verification.js';
import type { ResolvedProjectInputs } from '../tool-context.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type ResolveProjectInputs = (
  request: {
    engine_root?: string;
    project_path?: string;
    target?: string;
  },
) => Promise<ResolvedProjectInputs>;

type RegisterWidgetVerificationToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  automationController: AutomationControllerLike;
  resolveProjectInputs: ResolveProjectInputs;
  captureResultSchema: z.ZodTypeAny;
  widgetAnimationCheckpointSchema: z.ZodTypeAny;
  motionCaptureModeSchema: z.ZodTypeAny;
  motionCaptureBundleResultSchema: z.ZodTypeAny;
  compareCaptureResultSchema: z.ZodTypeAny;
  listCapturesResultSchema: z.ZodTypeAny;
  cleanupCapturesResultSchema: z.ZodTypeAny;
  compareMotionCaptureBundleResultSchema: z.ZodTypeAny;
};

export function registerWidgetVerificationTools({
  server,
  callSubsystemJson,
  automationController,
  resolveProjectInputs,
  captureResultSchema,
  widgetAnimationCheckpointSchema,
  motionCaptureModeSchema,
  motionCaptureBundleResultSchema,
  compareCaptureResultSchema,
  listCapturesResultSchema,
  cleanupCapturesResultSchema,
  compareMotionCaptureBundleResultSchema,
}: RegisterWidgetVerificationToolsOptions): void {
  server.registerTool(
    'capture_widget_preview',
    {
      title: 'Capture Widget Preview',
      description: 'Render a WidgetBlueprint offscreen and return preview capture artifacts.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the WidgetBlueprint to preview.',
        ),
        width: z.number().int().min(64).max(2048).default(512).describe(
          'Requested capture width in pixels. The editor clamps to a safe range.',
        ),
        height: z.number().int().min(64).max(2048).default(512).describe(
          'Requested capture height in pixels. The editor clamps to a safe range.',
        ),
      },
      outputSchema: captureResultSchema,
      annotations: {
        title: 'Capture Widget Preview',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, width, height }) => {
      try {
        const parsed = await callSubsystemJson('CaptureWidgetPreview', {
          AssetPath: asset_path,
          Width: width,
          Height: height,
        });
        const artifact = normalizeVerificationArtifact(parsed);
        const captureId = typeof artifact.captureId === 'string' ? artifact.captureId : '';
        const resourceUri = buildCaptureResourceUri(captureId);
        const extraContent: ContentBlock[] = [];
        if (captureId) {
          extraContent.push(buildResourceLinkContent(
            resourceUri,
            `Capture ${captureId}`,
            'image/png',
            'Rendered widget preview capture.',
          ));
        }

        const inlineImage = await maybeBuildInlineImageContent(
          typeof artifact.artifactPath === 'string' ? artifact.artifactPath : undefined,
        );
        if (inlineImage) {
          extraContent.push(inlineImage);
        }

        return jsonToolSuccess({
          ...artifact,
          resourceUri,
        }, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'capture_widget_motion_checkpoints',
    {
      title: 'Capture Widget Motion Checkpoints',
      description: 'Play a widget animation or automation scenario and capture named motion checkpoints.\n\n'
        + 'Example (editor_preview):\n'
        + '  {\n'
        + '    "mode": "editor_preview",\n'
        + '    "asset_path": "/Game/UI/Screens/WBP_MainMenu",\n'
        + '    "animation_name": "OpenSequence",\n'
        + '    "checkpoints": [\n'
        + '      { "name": "closed", "timeMs": 0 },\n'
        + '      { "name": "open", "timeMs": 260 }\n'
        + '    ]\n'
        + '  }',
      inputSchema: {
        mode: motionCaptureModeSchema.describe(
          'editor_preview for menu/shell widgets, automation_scenario for HUD/runtime flows.',
        ),
        asset_path: z.string().optional().describe(
          'Required for editor_preview mode. UE content path to the WidgetBlueprint.',
        ),
        animation_name: z.string().optional().describe(
          'Required for editor_preview mode. Widget animation name to play.',
        ),
        checkpoints: z.array(widgetAnimationCheckpointSchema).optional().describe(
          'Optional named checkpoints. If omitted, use marked frames or inferred defaults.',
        ),
        width: z.number().int().min(64).max(2048).default(512).describe(
          'Requested checkpoint capture width in pixels for editor_preview mode.',
        ),
        height: z.number().int().min(64).max(2048).default(512).describe(
          'Requested checkpoint capture height in pixels for editor_preview mode.',
        ),
        automation_filter: z.string().regex(
          /^[A-Za-z0-9_.+* -]+$/u,
          'automation_filter must contain only alphanumeric, dots, underscores, plus, asterisk, hyphen, and spaces',
        ).optional().describe(
          'Required for automation_scenario mode. Automation filter passed to run_automation_tests.',
        ),
        engine_root: z.string().optional().describe(
          'Optional Unreal Engine root for automation_scenario mode.',
        ),
        project_path: z.string().optional().describe(
          'Optional project path for automation_scenario mode.',
        ),
        target: z.string().optional().describe(
          'Optional editor target name for automation_scenario mode.',
        ),
        report_output_dir: z.string().optional().describe(
          'Optional report output directory for automation_scenario mode.',
        ),
        timeout_seconds: z.number().int().positive().default(3600).describe(
          'Maximum wall-clock time for automation_scenario playback.',
        ),
        null_rhi: z.boolean().default(false).describe(
          'When false, allow rendering for screenshot-backed motion verification in automation_scenario mode.',
        ),
      },
      outputSchema: motionCaptureBundleResultSchema,
      annotations: {
        title: 'Capture Widget Motion Checkpoints',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ mode, asset_path, animation_name, checkpoints, width, height, automation_filter, engine_root, project_path, target, report_output_dir, timeout_seconds, null_rhi }) => {
      try {
        if (mode === 'editor_preview') {
          if (!asset_path || !animation_name) {
            return jsonToolError(new Error('editor_preview mode requires asset_path and animation_name'));
          }

          const parsed = await callSubsystemJson('CaptureWidgetMotionCheckpoints', {
            AssetPath: asset_path,
            PayloadJson: JSON.stringify({
              animation_name,
              checkpoints: checkpoints ?? [],
              width,
              height,
            }),
          });

          const verificationArtifacts = Array.isArray(parsed.verificationArtifacts)
            ? parsed.verificationArtifacts.map((artifact) => normalizeVerificationArtifactReference(artifact))
            : [];
          const extraContent: ContentBlock[] = verificationArtifacts
            .slice(0, 6)
            .map((artifact) => buildResourceLinkContent(
              String(artifact.resourceUri ?? ''),
              `Checkpoint ${String(artifact.checkpointName ?? artifact.captureId ?? 'capture')}`,
              'image/png',
              typeof artifact.checkpointName === 'string'
                ? `Motion checkpoint ${artifact.checkpointName}`
                : 'Motion checkpoint capture.',
            ));
          for (const artifact of verificationArtifacts.slice(0, 3)) {
            const inlineImage = await maybeBuildInlineImageContent(artifact.artifactPath);
            if (inlineImage) {
              extraContent.push(inlineImage);
            }
          }

          return jsonToolSuccess({
            ...parsed,
            mode: 'editor_preview',
            triggerMode: 'asset_animation',
            playbackSource: typeof parsed.playbackSource === 'string' && parsed.playbackSource.length > 0
              ? parsed.playbackSource
              : animation_name,
            checkpointCount: verificationArtifacts.length,
            verificationArtifacts,
          }, { extraContent });
        }

        if (!automation_filter) {
          return jsonToolError(new Error('automation_scenario mode requires automation_filter'));
        }

        const resolved = await resolveProjectInputs({ engine_root, project_path, target });
        if (!resolved.engineRoot || !resolved.projectPath) {
          throw explainProjectResolutionFailure(
            'capture_widget_motion_checkpoints in automation_scenario mode requires engine_root and project_path',
            resolved,
          );
        }

        const run = normalizeAutomationRunResult(await automationController.runAutomationTests({
          automationFilter: automation_filter,
          engineRoot: resolved.engineRoot,
          projectPath: resolved.projectPath,
          target: resolved.target,
          reportOutputDir: report_output_dir,
          timeoutMs: timeout_seconds * 1000,
          nullRhi: null_rhi,
        }));
        const verificationArtifacts = (Array.isArray(run.verificationArtifacts) ? run.verificationArtifacts : [])
          .map((artifact) => normalizeVerificationArtifactReference(artifact))
          .filter((artifact) => (
            artifact.surface === 'widget_motion_checkpoint'
            || typeof artifact.checkpointName === 'string'
          ));

        const partialVerification = verificationArtifacts.length === 0;
        const diagnostics = Array.isArray(run.diagnostics)
          ? run.diagnostics.map((entry) => String(entry))
          : [];
        if (partialVerification) {
          diagnostics.push('Automation scenario did not expose widget motion checkpoint artifacts yet. Treat this as partial verification until the scenario exports named checkpoint captures.');
        }

        const extraContent: ContentBlock[] = verificationArtifacts
          .slice(0, 6)
          .map((artifact) => buildResourceLinkContent(
            String(artifact.resourceUri ?? ''),
            `Checkpoint ${String(artifact.checkpointName ?? artifact.captureId ?? 'capture')}`,
            'image/png',
            typeof artifact.relativePath === 'string' ? artifact.relativePath : 'Automation-exported checkpoint capture.',
          ));
        for (const artifact of verificationArtifacts.slice(0, 3)) {
          const inlineImage = await maybeBuildInlineImageContent(artifact.artifactPath);
          if (inlineImage) {
            extraContent.push(inlineImage);
          }
        }

        return jsonToolSuccess({
          success: true,
          operation: 'capture_widget_motion_checkpoints',
          motionCaptureId: String(run.runId ?? automation_filter),
          mode: 'automation_scenario',
          triggerMode: 'scenario_trigger',
          playbackSource: automation_filter,
          checkpointCount: verificationArtifacts.length,
          partialVerification,
          diagnostics,
          verificationArtifacts,
          automationRun: run,
          inputResolution: {
            engineRoot: resolved.sources.engineRoot,
            projectPath: resolved.sources.projectPath,
            target: resolved.sources.target,
            contextError: resolved.contextError,
          },
        }, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'compare_capture_to_reference',
    {
      title: 'Compare Capture To Reference',
      description: 'Compare a saved capture or PNG against a reference and return diff artifacts.',
      inputSchema: {
        capture: z.string().describe(
          'Capture id or absolute PNG path for the actual result.',
        ),
        reference: z.string().describe(
          'Capture id or absolute PNG path for the expected reference.',
        ),
        tolerance: z.number().min(0).default(0.01).describe(
          'Normalized RMSE tolerance. 0 is pixel-perfect.',
        ),
      },
      outputSchema: compareCaptureResultSchema,
      annotations: {
        title: 'Compare Capture To Reference',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ capture, reference, tolerance }) => {
      try {
        const parsed = await callSubsystemJson('CompareCaptureToReference', {
          CaptureIdOrPath: capture,
          ReferenceIdOrPath: reference,
          Tolerance: tolerance,
        });
        const comparison = normalizeVerificationComparison(parsed);
        const diffCaptureId = typeof parsed.diffCaptureId === 'string' ? parsed.diffCaptureId : '';
        const diffResourceUri = buildCaptureResourceUri(diffCaptureId);
        const extraContent: ContentBlock[] = [];
        if (diffCaptureId) {
          extraContent.push(buildResourceLinkContent(
            diffResourceUri,
            `Diff ${diffCaptureId}`,
            'image/png',
            'Pixel-diff image for the comparison result.',
          ));
        }

        const inlineImage = await maybeBuildInlineImageContent(parsed.diffArtifactPath);
        if (inlineImage) {
          extraContent.push(inlineImage);
        }

        return jsonToolSuccess({
          ...parsed,
          diffResourceUri,
          comparison,
        }, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'list_captures',
    {
      title: 'List Captures',
      description: 'List saved visual verification captures recorded by the editor-side verification lane.',
      inputSchema: {
        asset_path_filter: z.string().default('').describe(
          'Optional exact asset path filter for captures created from one asset.',
        ),
      },
      outputSchema: listCapturesResultSchema,
      annotations: {
        title: 'List Captures',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path_filter }) => {
      try {
        const parsed = await callSubsystemJson('ListCaptures', {
          AssetPathFilter: asset_path_filter,
        });
        const captures = Array.isArray(parsed.captures)
          ? parsed.captures.map((capture) => normalizeVerificationArtifact(capture))
          : [];
        return jsonToolSuccess({
          ...parsed,
          captureCount: captures.length,
          captures,
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'cleanup_captures',
    {
      title: 'Cleanup Captures',
      description: 'Delete old capture artifacts from Saved/BlueprintExtractor/Captures without touching UE assets.',
      inputSchema: {
        max_age_days: z.number().int().min(0).default(7).describe(
          'Delete capture directories older than this many days. 0 removes all captures.',
        ),
      },
      outputSchema: cleanupCapturesResultSchema,
      annotations: {
        title: 'Cleanup Captures',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ max_age_days }) => {
      try {
        const parsed = await callSubsystemJson('CleanupCaptures', {
          MaxAgeDays: max_age_days,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'compare_motion_capture_bundle',
    {
      title: 'Compare Motion Capture Bundle',
      description: 'Compare motion checkpoint captures against reference frames or another bundle.',
      inputSchema: {
        capture_artifacts: z.array(z.record(z.string(), z.unknown())).describe(
          'Captured checkpoint artifacts from capture_widget_motion_checkpoints.',
        ),
        reference_frames: z.array(z.object({
          checkpoint_name: z.string(),
          reference: z.string(),
        }).passthrough()).optional().describe(
          'Optional checkpoint-to-reference frame mapping.',
        ),
        reference_artifacts: z.array(z.record(z.string(), z.unknown())).optional().describe(
          'Optional reference checkpoint bundle from capture_widget_motion_checkpoints.',
        ),
        tolerance: z.number().min(0).default(0.01).describe(
          'Normalized RMSE tolerance. 0 is pixel-perfect.',
        ),
      },
      outputSchema: compareMotionCaptureBundleResultSchema,
      annotations: {
        title: 'Compare Motion Capture Bundle',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ capture_artifacts, reference_frames, reference_artifacts, tolerance }) => {
      try {
        const captures = capture_artifacts.map((artifact) => normalizeVerificationArtifactReference(artifact));
        const frameReferences = new Map(
          (reference_frames ?? []).map((entry) => [entry.checkpoint_name, entry.reference] as const),
        );
        const artifactReferences = new Map(
          (reference_artifacts ?? []).map((artifact) => {
            const normalized = normalizeVerificationArtifactReference(artifact);
            return [String(normalized.checkpointName ?? ''), normalized] as const;
          }),
        );
        const mode: 'reference_frames' | 'reference_bundle' = frameReferences.size > 0 ? 'reference_frames' : 'reference_bundle';
        const comparisons: Array<Record<string, unknown>> = [];
        const extraContent: ContentBlock[] = [];
        let matchedCount = 0;
        let pass = captures.length > 0;

        for (const captureArtifact of captures) {
          const checkpointName = String(captureArtifact.checkpointName ?? '');
          const captureRef = typeof captureArtifact.captureId === 'string' && captureArtifact.captureId.length > 0
            ? captureArtifact.captureId
            : String(captureArtifact.artifactPath ?? '');

          if (!checkpointName) {
            comparisons.push({
              checkpointName: '',
              matched: false,
              skipped: true,
              captureArtifact,
            });
            pass = false;
            continue;
          }

          let referenceValue: string | undefined;
          let referenceArtifact: Record<string, unknown> | undefined;
          if (mode === 'reference_frames') {
            referenceValue = frameReferences.get(checkpointName);
          } else {
            referenceArtifact = artifactReferences.get(checkpointName);
            referenceValue = referenceArtifact
              ? (typeof referenceArtifact.captureId === 'string' && referenceArtifact.captureId.length > 0
                ? referenceArtifact.captureId
                : String(referenceArtifact.artifactPath ?? ''))
              : undefined;
          }

          if (!referenceValue) {
            comparisons.push({
              checkpointName,
              matched: false,
              skipped: true,
              captureArtifact,
              ...(referenceArtifact ? { referenceArtifact } : {}),
            });
            pass = false;
            continue;
          }

          const parsed = await callSubsystemJson('CompareCaptureToReference', {
            CaptureIdOrPath: captureRef,
            ReferenceIdOrPath: referenceValue,
            Tolerance: tolerance,
          });
          const comparison = normalizeVerificationComparison(parsed);
          const diffCaptureId = typeof parsed.diffCaptureId === 'string' ? parsed.diffCaptureId : '';
          if (diffCaptureId) {
            extraContent.push(buildResourceLinkContent(
              buildCaptureResourceUri(diffCaptureId),
              `Diff ${checkpointName}`,
              'image/png',
              `Motion diff for checkpoint ${checkpointName}.`,
            ));
          }

          matchedCount += 1;
          if (comparison.pass !== true) {
            pass = false;
          }

          comparisons.push({
            checkpointName,
            matched: true,
            reference: mode === 'reference_frames' ? referenceValue : undefined,
            captureArtifact,
            ...(referenceArtifact ? { referenceArtifact } : {}),
            comparison,
          });
        }

        return jsonToolSuccess({
          success: true,
          operation: 'compare_motion_capture_bundle',
          mode,
          tolerance,
          captureCount: captures.length,
          matchedCount,
          pass,
          comparisons,
        }, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
