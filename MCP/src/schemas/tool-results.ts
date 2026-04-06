import { z } from 'zod';

export const toolResultSchema = z.object({
  success: z.boolean(),
  operation: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
  recoverable: z.boolean().optional(),
  next_steps: z.array(z.string()).optional(),
  _hints: z.array(z.string()).optional(),
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

export const assetSearchResultItemSchema = z.record(z.string(), z.unknown());

export const SearchAssetsResultSchema = toolResultSchema.extend({
  results: z.array(assetSearchResultItemSchema),
  page: z.number().int().min(1),
  per_page: z.number().int().min(1),
  total_count: z.number().int().min(0),
  total_pages: z.number().int().min(1),
  has_more: z.boolean(),
  _filtered_count: z.number().int().min(0).optional(),
});

export const ListAssetsResultSchema = toolResultSchema.extend({
  assets: z.array(assetSearchResultItemSchema),
  page: z.number().int().min(1),
  per_page: z.number().int().min(1),
  total_count: z.number().int().min(0),
  total_pages: z.number().int().min(1),
  has_more: z.boolean(),
});

export const CheckAssetExistsResultSchema = toolResultSchema.extend({
  exists: z.boolean(),
  asset_class: z.string().nullable(),
  package_path: z.string(),
});

export const analysisSeveritySchema = z.enum(['low', 'medium', 'high']);

export const analysisFindingCategorySchema = z.enum([
  'logic_flow',
  'null_validity_ordering',
  'reference_hygiene',
  'naming_convention',
  'replication_authority',
]);

export const analysisFindingSchema = z.object({
  severity: analysisSeveritySchema,
  category: analysisFindingCategorySchema,
  title: z.string(),
  asset_path: z.string(),
  subject: z.string(),
  graph_name: z.string().optional(),
  evidence: z.array(z.string()).min(1),
  next_steps: z.array(z.string()).min(1),
});

export const severityCountSchema = z.object({
  low: z.number().int().min(0),
  medium: z.number().int().min(0),
  high: z.number().int().min(0),
});

export const analysisSummarySchema = z.object({
  asset_path: z.string(),
  blueprint_name: z.string(),
  finding_count: z.number().int().min(0),
  categories_reviewed: z.array(analysisFindingCategorySchema),
  findings_by_severity: severityCountSchema,
});

export const contextSourceTypeSchema = z.enum(['asset', 'doc', 'prompt', 'resource']);

export const contextSnippetSchema = z.object({
  field: z.enum(['title', 'description', 'content', 'metadata']),
  text: z.string(),
  match_start: z.number().int().min(0).optional(),
  match_end: z.number().int().min(0).optional(),
});

export const contextSearchResultSchema = z.object({
  source_id: z.string(),
  source_type: contextSourceTypeSchema,
  title: z.string(),
  score: z.number().min(0),
  stale: z.boolean(),
  uri: z.string().optional(),
  path: z.string().optional(),
  asset_path: z.string().optional(),
  asset_class: z.string().optional(),
  snippets: z.array(contextSnippetSchema).min(1),
});

export const auditFindingCategorySchema = z.enum([
  'naming',
  'package_hygiene',
  'asset_family_coverage',
  'content_budget',
  'orphan_detection',
]);

export const auditFindingSchema = z.object({
  severity: analysisSeveritySchema,
  category: auditFindingCategorySchema,
  title: z.string(),
  asset_path: z.string(),
  asset_name: z.string(),
  asset_class: z.string(),
  evidence: z.array(z.string()).min(1),
  next_steps: z.array(z.string()).min(1),
});

export const auditCheckSummarySchema = z.object({
  category: auditFindingCategorySchema,
  finding_count: z.number().int().min(0),
});

export const assetFamilyCountSchema = z.object({
  asset_class: z.string(),
  count: z.number().int().min(0),
});

export const auditSummarySchema = z.object({
  package_path: z.string(),
  asset_count: z.number().int().min(0),
  finding_count: z.number().int().min(0),
  findings_by_severity: severityCountSchema,
  check_summaries: z.array(auditCheckSummarySchema),
  asset_family_counts: z.array(assetFamilyCountSchema),
});

export const ReviewBlueprintResultSchema = toolResultSchema.extend({
  asset_path: z.string(),
  review: analysisSummarySchema,
  findings: z.array(analysisFindingSchema),
});

export const ProjectIndexStatusResultSchema = toolResultSchema.extend({
  package_path: z.string(),
  generated_at: z.string().nullable(),
  age_ms: z.number().int().min(0).nullable(),
  stale: z.boolean(),
  asset_count: z.number().int().min(0),
  repo_doc_count: z.number().int().min(0),
  prompt_count: z.number().int().min(0),
  resource_count: z.number().int().min(0),
  entry_count: z.number().int().min(0),
});

export const RefreshProjectIndexResultSchema = ProjectIndexStatusResultSchema.extend({
  refreshed: z.boolean(),
});

export const SearchProjectContextResultSchema = toolResultSchema.extend({
  query: z.string(),
  page: z.number().int().min(1),
  per_page: z.number().int().min(1),
  total_count: z.number().int().min(0),
  total_pages: z.number().int().min(1),
  has_more: z.boolean(),
  stale: z.boolean(),
  generated_at: z.string().nullable(),
  results: z.array(contextSearchResultSchema),
});

export const AuditProjectAssetsResultSchema = toolResultSchema.extend({
  package_path: z.string(),
  audit: auditSummarySchema,
  findings: z.array(auditFindingSchema),
});

export const editorContextPieSummarySchema = z.object({
  isPlayingInEditor: z.boolean().optional(),
  isSimulatingInEditor: z.boolean().optional(),
  worldName: z.string().optional(),
  worldPath: z.string().optional(),
});

export const EditorContextResultSchema = toolResultSchema.extend({
  instanceId: z.string(),
  projectName: z.string().optional(),
  projectFilePath: z.string(),
  projectDir: z.string().optional(),
  engineRoot: z.string().optional(),
  editorTarget: z.string().optional(),
  remoteControlHost: z.string().optional(),
  remoteControlPort: z.number().int().positive().optional(),
  lastSeenAt: z.string().optional(),
  selectedAssetPaths: z.array(z.string()).optional(),
  selectedActorNames: z.array(z.string()).optional(),
  openAssetEditors: z.array(z.string()).optional(),
  activeLevel: z.string().optional(),
  pieSummary: editorContextPieSummarySchema.optional(),
  partial: z.boolean().optional(),
  unsupportedSections: z.array(z.string()).optional(),
});

export const nameCountSchema = z.object({
  name: z.string(),
  count: z.number().int().min(0),
});

export const OutputLogEntrySchema = z.object({
  sequence: z.number().int().min(0),
  category: z.string(),
  verbosity: z.string(),
  message: z.string(),
  capturedAtUtc: z.string(),
  engineTime: z.number().optional(),
});

export const ReadOutputLogResultSchema = toolResultSchema.extend({
  snapshotAtUtc: z.string(),
  bufferedCount: z.number().int().min(0),
  matchedCount: z.number().int().min(0),
  returnedCount: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
  hasMore: z.boolean(),
  categoryCounts: z.array(nameCountSchema),
  verbosityCounts: z.array(nameCountSchema),
  entries: z.array(OutputLogEntrySchema),
});

export const MessageLogListingSummarySchema = z.object({
  listingName: z.string(),
  listingLabel: z.string().optional(),
  registered: z.boolean(),
  messageCount: z.number().int().min(0).optional(),
  filteredMessageCount: z.number().int().min(0).optional(),
  filterCount: z.number().int().min(0).optional(),
});

export const ListMessageLogListingsResultSchema = toolResultSchema.extend({
  snapshotAtUtc: z.string(),
  discoveryMode: z.literal('known_candidates'),
  candidateCount: z.number().int().min(0),
  listingCount: z.number().int().min(0),
  includeUnregistered: z.boolean(),
  listings: z.array(MessageLogListingSummarySchema),
});

export const MessageLogTokenSchema = z.object({
  type: z.string(),
  text: z.string(),
});

export const MessageLogEntrySchema = z.object({
  index: z.number().int().min(0),
  severity: z.string(),
  text: z.string(),
  identifier: z.string().optional(),
  tokenCount: z.number().int().min(0),
  hasMessageLink: z.boolean(),
  messageLinkText: z.string().optional(),
  tokens: z.array(MessageLogTokenSchema).optional(),
});

export const ReadMessageLogResultSchema = toolResultSchema.extend({
  snapshotAtUtc: z.string(),
  listingName: z.string(),
  listingLabel: z.string().optional(),
  messageCount: z.number().int().min(0),
  filteredMessageCount: z.number().int().min(0),
  matchedCount: z.number().int().min(0),
  returnedCount: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
  hasMore: z.boolean(),
  filterCount: z.number().int().min(0),
  severityCounts: z.array(nameCountSchema),
  entries: z.array(MessageLogEntrySchema),
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
