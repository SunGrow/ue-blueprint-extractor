import { z } from 'zod';

export const toolResultSchema = z.object({
  success: z.boolean(),
  operation: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
  recoverable: z.boolean().optional(),
  next_steps: z.array(z.string()).optional(),
  diagnostics: z.array(z.object({
    severity: z.string().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
    path: z.string().optional(),
  })).optional(),
  execution: z.object({
    mode: z.enum(['immediate', 'task_aware']),
    task_support: z.enum(['optional', 'required', 'forbidden']),
    status: z.string().optional(),
    progress_message: z.string().optional(),
  }).optional(),
});

export const windowUiVerificationSchema = z.object({
  required: z.boolean(),
  status: z.enum(['compile_pending', 'unverified']),
  surface: z.literal('editor_offscreen'),
  recommendedTool: z.literal('capture_widget_preview'),
  partialAllowed: z.boolean(),
  reason: z.string(),
});

export const CompositeStepResultSchema = z.object({
  step: z.string(),
  status: z.enum(['success', 'failure', 'skipped']),
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  diagnostics: z.array(z.object({
    severity: z.string().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
    path: z.string().optional(),
  })).optional(),
});

export const CompositeToolResultSchema = toolResultSchema.extend({
  steps: z.array(CompositeStepResultSchema),
  partial_state: z.object({
    completed_steps: z.array(z.string()),
    failed_step: z.string(),
    editor_state: z.string(),
  }).optional(),
});

export const applyWindowUiChangesResultSchema = toolResultSchema.extend({
  stoppedAt: z.string().optional(),
  failedAfterStep: z.string().optional(),
  steps: z.array(z.record(z.string(), z.unknown())).optional(),
  verification: windowUiVerificationSchema.optional(),
});

export const cascadeManifestEntrySchema = z.object({
  assetPath: z.string(),
  assetType: z.string(),
  outputFile: z.string().optional(),
  depth: z.number().int().min(0),
  status: z.string(),
  error: z.string().optional(),
});

export const CascadeResultSchema = toolResultSchema.extend({
  extracted_count: z.number().int().min(0),
  skipped_count: z.number().int().min(0),
  total_count: z.number().int().min(0),
  output_directory: z.string(),
  manifest: z.array(cascadeManifestEntrySchema),
});

export const verificationSurfaceSchema = z.enum([
  'editor_offscreen',
  'pie_runtime',
  'editor_tool_viewport',
  'external_packaged',
  'widget_motion_checkpoint',
]);

export const verificationContextSchema = z.record(z.string(), z.unknown());

export const verificationComparisonSchema = z.object({
  capturePath: z.string().optional(),
  referencePath: z.string().optional(),
  tolerance: z.number().min(0).optional(),
  pass: z.boolean().optional(),
  rmse: z.number().min(0).optional(),
  maxPixelDelta: z.number().int().min(0).optional(),
  mismatchPixelCount: z.number().int().min(0).optional(),
  mismatchPercentage: z.number().min(0).optional(),
  diffCaptureId: z.string().optional(),
  diffArtifactPath: z.string().optional(),
});

export const verificationArtifactSchema = z.object({
  captureId: z.string(),
  captureType: z.string().min(1),
  surface: verificationSurfaceSchema,
  scenarioId: z.string(),
  assetPath: z.string(),
  assetPaths: z.array(z.string()),
  widgetClass: z.string().optional(),
  captureDirectory: z.string(),
  artifactPath: z.string(),
  metadataPath: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  fileSizeBytes: z.number().int().min(0),
  createdAt: z.string(),
  worldContext: verificationContextSchema.optional(),
  cameraContext: verificationContextSchema.optional(),
  comparison: verificationComparisonSchema.optional(),
  projectDir: z.string().optional(),
  motionCaptureId: z.string().optional(),
  checkpointName: z.string().optional(),
  checkpointMs: z.number().min(0).optional(),
  playbackSource: z.string().optional(),
  triggerMode: z.enum(['asset_animation', 'scenario_trigger']).optional(),
});

export const verificationArtifactReferenceSchema = z.object({
  captureId: z.string(),
  captureType: z.string().min(1),
  surface: verificationSurfaceSchema,
  scenarioId: z.string(),
  assetPath: z.string().optional(),
  assetPaths: z.array(z.string()),
  artifactPath: z.string(),
  resourceUri: z.string(),
  createdAt: z.string(),
  metadataPath: z.string().optional(),
  captureDirectory: z.string().optional(),
  width: z.number().int().min(1).optional(),
  height: z.number().int().min(1).optional(),
  fileSizeBytes: z.number().int().min(0).optional(),
  widgetClass: z.string().optional(),
  worldContext: verificationContextSchema.optional(),
  cameraContext: verificationContextSchema.optional(),
  comparison: verificationComparisonSchema.optional(),
  projectDir: z.string().optional(),
  motionCaptureId: z.string().optional(),
  checkpointName: z.string().optional(),
  checkpointMs: z.number().min(0).optional(),
  playbackSource: z.string().optional(),
  triggerMode: z.enum(['asset_animation', 'scenario_trigger']).optional(),
  mimeType: z.string().optional(),
  relativePath: z.string().optional(),
});

export const CaptureResultSchema = toolResultSchema.extend({
  resourceUri: z.string(),
}).merge(verificationArtifactSchema);

export const CompareCaptureResultSchema = toolResultSchema.extend({
  capturePath: z.string(),
  referencePath: z.string(),
  tolerance: z.number().min(0),
  pass: z.boolean(),
  rmse: z.number().min(0),
  maxPixelDelta: z.number().int().min(0),
  mismatchPixelCount: z.number().int().min(0),
  mismatchPercentage: z.number().min(0),
  diffCaptureId: z.string(),
  diffArtifactPath: z.string(),
  diffResourceUri: z.string(),
  comparison: verificationComparisonSchema,
});

export const ListCapturesResultSchema = toolResultSchema.extend({
  assetPathFilter: z.string(),
  captureCount: z.number().int().min(0),
  captures: z.array(verificationArtifactSchema),
});

export const CleanupCapturesResultSchema = toolResultSchema.extend({
  deletedCount: z.number().int().min(0),
  freedBytes: z.number().int().min(0),
  maxAgeDays: z.number().int().min(0),
});

export const widgetAnimationTrackKindSchema = z.enum([
  'render_opacity',
  'render_transform_translation',
  'render_transform_scale',
  'render_transform_angle',
  'color_and_opacity',
]);

export const widgetAnimationTrackSchema = z.object({
  widget_name: z.string().optional(),
  widget_path: z.string().optional(),
  property: widgetAnimationTrackKindSchema,
  keys: z.array(z.record(z.string(), z.unknown())),
});

export const widgetAnimationCheckpointSchema = z.object({
  name: z.string(),
  timeMs: z.number().min(0).optional(),
  time_ms: z.number().min(0).optional(),
});

export const widgetAnimationTimelineSchema = z.object({
  duration_ms: z.number().min(0).optional(),
  fps: z.number().int().positive().optional(),
  tracks: z.array(widgetAnimationTrackSchema),
});

export const extractedWidgetAnimationSchema = z.object({
  name: z.string(),
  displayLabel: z.string().optional(),
  durationMs: z.number().min(0),
  playback: z.record(z.string(), z.unknown()).optional(),
  bindings: z.array(z.record(z.string(), z.unknown())),
  supportedTracks: z.array(widgetAnimationTrackKindSchema).optional(),
  tracks: z.array(widgetAnimationTrackSchema),
  checkpoints: z.array(widgetAnimationCheckpointSchema).optional(),
});

export const ExtractWidgetAnimationResultSchema = toolResultSchema.extend({
  assetPath: z.string(),
  animationName: z.string(),
  supportedTracks: z.array(widgetAnimationTrackKindSchema),
  animation: extractedWidgetAnimationSchema,
});

export const CreateModifyWidgetAnimationResultSchema = toolResultSchema.extend({
  assetPath: z.string(),
  animationName: z.string().optional(),
  supportedTracks: z.array(widgetAnimationTrackKindSchema).optional(),
  animation: extractedWidgetAnimationSchema.optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
  compile: z.record(z.string(), z.unknown()).optional(),
  dirtyPackages: z.array(z.string()).optional(),
  changedObjects: z.array(z.string()).optional(),
});

export const motionCaptureModeSchema = z.enum(['editor_preview', 'automation_scenario']);
export const motionTriggerModeSchema = z.enum(['asset_animation', 'scenario_trigger']);

export const MotionCaptureBundleResultSchema = toolResultSchema.extend({
  motionCaptureId: z.string(),
  mode: motionCaptureModeSchema,
  triggerMode: motionTriggerModeSchema,
  playbackSource: z.string(),
  assetPath: z.string().optional(),
  animationName: z.string().optional(),
  checkpointCount: z.number().int().min(0),
  partialVerification: z.boolean().optional(),
  verificationArtifacts: z.array(verificationArtifactReferenceSchema),
});

export const motionCaptureComparisonEntrySchema = z.object({
  checkpointName: z.string(),
  matched: z.boolean(),
  skipped: z.boolean().optional(),
  reference: z.string().optional(),
  captureArtifact: verificationArtifactReferenceSchema.optional(),
  referenceArtifact: verificationArtifactReferenceSchema.optional(),
  comparison: verificationComparisonSchema.optional(),
});

export const CompareMotionCaptureBundleResultSchema = toolResultSchema.extend({
  mode: z.enum(['reference_frames', 'reference_bundle']),
  tolerance: z.number().min(0),
  captureCount: z.number().int().min(0),
  matchedCount: z.number().int().min(0),
  pass: z.boolean(),
  comparisons: z.array(motionCaptureComparisonEntrySchema),
});

export const automationArtifactSchema = z.object({
  name: z.string(),
  path: z.string(),
  mimeType: z.string(),
  resourceUri: z.string(),
  relativePath: z.string().optional(),
});

export const automationRunSummarySchema = z.object({
  successful: z.boolean(),
  totalTests: z.number().int().optional(),
  passedTests: z.number().int().optional(),
  failedTests: z.number().int().optional(),
  skippedTests: z.number().int().optional(),
  warningCount: z.number().int().optional(),
  reportAvailable: z.boolean(),
});

export const automationRunSchema = toolResultSchema.extend({
  runId: z.string(),
  automationFilter: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled']),
  terminal: z.boolean(),
  engineRoot: z.string(),
  projectPath: z.string(),
  projectDir: z.string(),
  target: z.string().optional(),
  reportOutputDir: z.string(),
  command: z.object({
    executable: z.string(),
    args: z.array(z.string()),
  }),
  diagnostics: z.array(z.string()),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().int().min(0).optional(),
  exitCode: z.number().int().optional(),
  timeoutMs: z.number().int().positive(),
  nullRhi: z.boolean(),
  artifacts: z.array(automationArtifactSchema),
  verificationArtifacts: z.array(verificationArtifactReferenceSchema).optional(),
  summary: automationRunSummarySchema.optional(),
});

export const AutomationRunListSchema = toolResultSchema.extend({
  includeCompleted: z.boolean(),
  runCount: z.number().int().min(0),
  runs: z.array(automationRunSchema),
});
