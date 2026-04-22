import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  AutomationControllerLike,
} from './automation-controller.js';
import { exampleCatalog } from './catalogs/example-catalog.js';
import {
  collectRelatedResources,
  collectToolExampleFamilies as collectToolExampleFamiliesFromCatalog,
  summarizeOutputSchema,
  summarizeSchemaFields,
  type ToolHelpEntry,
} from './helpers/tool-help.js';
import type {
  ProjectControllerLike,
  CompileProjectCodeResult,
} from './project-controller.js';
import {
  getToolExecutionCompatibility,
} from './server-config.js';
import {
  AnimMontageMutationOperationSchema,
  AnimationNotifySelectorSchema,
  AnimSequenceMutationOperationSchema,
  BehaviorTreeMutationOperationSchema,
  BehaviorTreeNodeSelectorSchema,
  BlackboardKeySchema,
  BlackboardMutationOperationSchema,
  BlendParameterSchema,
  BlendSpaceMutationOperationSchema,
  BlendSpaceSampleSchema,
  BlueprintGraphMutationOperationSchema,
  BlueprintMemberMutationOperationSchema,
  BuildConfigurationSchema,
  BuildPlatformSchema,
  CurveChannelSchema,
  CurveKeyDeleteSchema,
  CurveKeyUpsertSchema,
  CurveTableModeSchema,
  CurveTableRowSchema,
  CurveTypeSchema,
  DataTableRowSchema,
  ExtractAssetTypeSchema,
  EnhancedInputValueTypeSchema,
  FontImportItemSchema,
  ImportJobListSchema,
  ImportJobSchema,
  InputMappingSchema,
  JsonObjectSchema,
  MaterialConnectionSelectorFieldsSchema,
  MaterialFontParameterSchema,
  MaterialGraphOperationKindSchema,
  MaterialGraphOperationSchema,
  MaterialLayerStackSchema,
  MaterialNodePositionSchema,
  MaterialScalarParameterSchema,
  MaterialStaticSwitchParameterSchema,
  MaterialTextureParameterSchema,
  MaterialVectorParameterSchema,
  MeshImportOptionsSchema,
  StateTreeEditorNodeSelectorSchema,
  StateTreeMutationOperationSchema,
  StateTreeStateSelectorSchema,
  StateTreeTransitionSelectorSchema,
  StateTreeBindingsObjectSchema,
  TextureImportOptionsSchema,
  UserDefinedEnumEntrySchema,
  UserDefinedEnumMutationOperationSchema,
  UserDefinedStructFieldSchema,
  UserDefinedStructMutationOperationSchema,
  WidgetNodeSchema,
  WidgetSelectorFieldsSchema,
  WindowFontApplicationSchema,
} from './schemas/tool-inputs.js';
import {
  applyWindowUiChangesResultSchema,
  AutomationRunListSchema,
  automationRunSchema,
  CaptureResultSchema,
  CascadeResultSchema,
  CleanupCapturesResultSchema,
  CompareCaptureResultSchema,
  CompareMotionCaptureBundleResultSchema,
  CreateModifyWidgetAnimationResultSchema,
  ExtractWidgetAnimationResultSchema,
  ListCapturesResultSchema,
  motionCaptureModeSchema,
  MotionCaptureBundleResultSchema,
  widgetAnimationCheckpointSchema,
} from './schemas/tool-results.js';
import type {
  ProjectAutomationContext,
  ResolvedProjectInputs,
} from './tool-context.js';
import { registerAnimationAuthoringTools } from './tools/animation-authoring.js';
import { registerAnalysisTools } from './tools/analysis-tools.js';
import { registerAutomationRunTools } from './tools/automation-runs.js';
import { registerBlueprintAuthoringTools } from './tools/blueprint-authoring.js';
import { registerCompositeTools } from './tools/composite-tools.js';
import { registerCompositeWorkflowTools } from './tools/composite-workflows.js';
import { registerRecipeTools } from './tools/recipe-tools.js';
import { registerCommonUIButtonStyleTools } from './tools/commonui-button-style.js';
import { registerDataAndInputTools } from './tools/data-and-input.js';
import { registerExtractionTools } from './tools/extraction.js';
import { registerImportJobTools } from './tools/import-jobs.js';
import { registerMaterialAuthoringTools } from './tools/material-authoring.js';
import { registerMaterialInstanceTools } from './tools/material-instance.js';
import { registerProjectIntelligenceTools } from './tools/project-intelligence.js';
import { registerProjectControlTools } from './tools/project-control.js';
import { registerSchemaAndAiAuthoringTools } from './tools/schema-and-ai-authoring.js';
import { registerTablesAndCurvesTools } from './tools/tables-and-curves.js';
import { registerUtilityTools } from './tools/utility-tools.js';
import { registerWidgetAnimationAuthoringTools } from './tools/widget-animation-authoring.js';
import { registerWidgetExtractionTools } from './tools/widget-extraction.js';
import { registerWidgetStructureTools } from './tools/widget-structure.js';
import { registerWidgetVerificationTools } from './tools/widget-verification.js';
import { registerWindowUiTools } from './tools/window-ui.js';
import { UEClient } from './ue-client.js';
import { ActiveEditorSession } from './active-editor-session.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<Record<string, unknown>>;

type UEClientLike = Pick<UEClient, 'callSubsystem'> & Partial<Pick<UEClient, 'checkConnection'>>;

type ResolveProjectInputsFn = (
  request: {
    engine_root?: string;
    project_path?: string;
    target?: string;
  },
) => Promise<ResolvedProjectInputs>;

type GetProjectAutomationContextFn = (
  forceRefresh?: boolean,
) => Promise<ProjectAutomationContext>;

type RegisterServerToolsOptions = {
  server: McpServer;
  client: UEClientLike;
  projectController: ProjectControllerLike;
  automationController: AutomationControllerLike;
  callSubsystemJson: JsonSubsystemCaller;
  resolveProjectInputs: ResolveProjectInputsFn;
  getProjectAutomationContext: GetProjectAutomationContextFn;
  rememberExternalBuild: (result: CompileProjectCodeResult) => void;
  getLastExternalBuildContext: () => Record<string, unknown> | null;
  clearProjectAutomationContext: () => void;
  activeEditorSession?: ActiveEditorSession | null;
  getToolHelpEntry: (toolName: string) => ToolHelpEntry | undefined;
  toolHelpRegistry: Map<string, ToolHelpEntry>;
  editorPollIntervalMs: number;
};

const scopeEnum = z.enum([
  'ClassLevel',
  'Variables',
  'Components',
  'FunctionsShallow',
  'Full',
  'FullWithBytecode',
]);

export function registerServerTools({
  server,
  client,
  projectController,
  automationController,
  callSubsystemJson,
  resolveProjectInputs,
  getProjectAutomationContext,
  rememberExternalBuild,
  getLastExternalBuildContext,
  clearProjectAutomationContext,
  activeEditorSession,
  getToolHelpEntry,
  toolHelpRegistry,
  editorPollIntervalMs,
}: RegisterServerToolsOptions): void {
  const collectToolExampleFamilies = (toolName: string) => (
    collectToolExampleFamiliesFromCatalog(exampleCatalog, toolName)
  );

  registerExtractionTools({
    server,
    callSubsystemJson,
    scopeEnum,
    extractAssetTypeSchema: ExtractAssetTypeSchema,
    cascadeResultSchema: CascadeResultSchema,
  });

  registerWidgetStructureTools({
    server,
    callSubsystemJson,
    widgetNodeSchema: WidgetNodeSchema,
  });

  registerWidgetExtractionTools({
    server,
    callSubsystemJson,
    extractWidgetAnimationResultSchema: ExtractWidgetAnimationResultSchema,
  });

  registerWidgetAnimationAuthoringTools({
    server,
    callSubsystemJson,
    jsonObjectSchema: JsonObjectSchema,
    createModifyWidgetAnimationResultSchema: CreateModifyWidgetAnimationResultSchema,
  });

  registerCommonUIButtonStyleTools({
    server,
    callSubsystemJson,
    jsonObjectSchema: JsonObjectSchema,
  });

  registerWidgetVerificationTools({
    server,
    callSubsystemJson,
    automationController,
    resolveProjectInputs,
    activeEditorSession,
    captureResultSchema: CaptureResultSchema,
    widgetAnimationCheckpointSchema,
    motionCaptureModeSchema,
    motionCaptureBundleResultSchema: MotionCaptureBundleResultSchema,
    compareCaptureResultSchema: CompareCaptureResultSchema,
    listCapturesResultSchema: ListCapturesResultSchema,
    cleanupCapturesResultSchema: CleanupCapturesResultSchema,
    compareMotionCaptureBundleResultSchema: CompareMotionCaptureBundleResultSchema,
  });

  registerDataAndInputTools({
    server,
    callSubsystemJson,
    jsonObjectSchema: JsonObjectSchema,
    enhancedInputValueTypeSchema: EnhancedInputValueTypeSchema,
    inputMappingSchema: InputMappingSchema,
  });

  registerTablesAndCurvesTools({
    server,
    callSubsystemJson,
    dataTableRowSchema: DataTableRowSchema,
    curveTypeSchema: CurveTypeSchema,
    curveChannelSchema: CurveChannelSchema,
    curveKeyDeleteSchema: CurveKeyDeleteSchema,
    curveKeyUpsertSchema: CurveKeyUpsertSchema,
    curveTableModeSchema: CurveTableModeSchema,
    curveTableRowSchema: CurveTableRowSchema,
  });

  registerMaterialInstanceTools({
    server,
    callSubsystemJson,
    materialScalarParameterSchema: MaterialScalarParameterSchema,
    materialVectorParameterSchema: MaterialVectorParameterSchema,
    materialTextureParameterSchema: MaterialTextureParameterSchema,
    materialFontParameterSchema: MaterialFontParameterSchema,
    materialStaticSwitchParameterSchema: MaterialStaticSwitchParameterSchema,
    materialLayerStackSchema: MaterialLayerStackSchema,
  });

  registerMaterialAuthoringTools({
    server,
    callSubsystemJson,
    jsonObjectSchema: JsonObjectSchema,
    materialNodePositionSchema: MaterialNodePositionSchema,
    materialConnectionSelectorFieldsSchema: MaterialConnectionSelectorFieldsSchema,
    materialGraphOperationKindSchema: MaterialGraphOperationKindSchema,
    materialGraphOperationSchema: MaterialGraphOperationSchema,
  });

  registerAutomationRunTools({
    server,
    automationController,
    resolveProjectInputs,
    activeEditorSession,
    automationRunSchema,
    automationRunListSchema: AutomationRunListSchema,
  });

  registerAnalysisTools({
    server,
    callSubsystemJson,
  });

  registerProjectControlTools({
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
    buildPlatformSchema: BuildPlatformSchema,
    buildConfigurationSchema: BuildConfigurationSchema,
    editorPollIntervalMs,
  });

  registerProjectIntelligenceTools({
    server,
    callSubsystemJson,
  });

  registerWindowUiTools({
    server,
    client,
    projectController,
    callSubsystemJson,
    resolveProjectInputs,
    activeEditorSession,
    rememberExternalBuild,
    getLastExternalBuildContext,
    clearProjectAutomationContext,
    applyWindowUiChangesResultSchema,
    widgetSelectorFieldsSchema: WidgetSelectorFieldsSchema,
    fontImportItemSchema: FontImportItemSchema,
    windowFontApplicationSchema: WindowFontApplicationSchema,
    buildPlatformSchema: BuildPlatformSchema,
    buildConfigurationSchema: BuildConfigurationSchema,
  });

  registerSchemaAndAiAuthoringTools({
    server,
    callSubsystemJson,
    jsonObjectSchema: JsonObjectSchema,
    userDefinedStructMutationOperationSchema: UserDefinedStructMutationOperationSchema,
    userDefinedStructFieldSchema: UserDefinedStructFieldSchema,
    userDefinedEnumMutationOperationSchema: UserDefinedEnumMutationOperationSchema,
    userDefinedEnumEntrySchema: UserDefinedEnumEntrySchema,
    blackboardMutationOperationSchema: BlackboardMutationOperationSchema,
    blackboardKeySchema: BlackboardKeySchema,
    behaviorTreeMutationOperationSchema: BehaviorTreeMutationOperationSchema,
    behaviorTreeNodeSelectorSchema: BehaviorTreeNodeSelectorSchema,
    stateTreeMutationOperationSchema: StateTreeMutationOperationSchema,
    stateTreeStateSelectorSchema: StateTreeStateSelectorSchema,
    stateTreeEditorNodeSelectorSchema: StateTreeEditorNodeSelectorSchema,
    stateTreeTransitionSelectorSchema: StateTreeTransitionSelectorSchema,
    stateTreeBindingsObjectSchema: StateTreeBindingsObjectSchema,
  });

  registerAnimationAuthoringTools({
    server,
    callSubsystemJson,
    jsonObjectSchema: JsonObjectSchema,
    animSequenceMutationOperationSchema: AnimSequenceMutationOperationSchema,
    animMontageMutationOperationSchema: AnimMontageMutationOperationSchema,
    animationNotifySelectorSchema: AnimationNotifySelectorSchema,
    blendSpaceMutationOperationSchema: BlendSpaceMutationOperationSchema,
    blendParameterSchema: BlendParameterSchema,
    blendSpaceSampleSchema: BlendSpaceSampleSchema,
  });

  registerBlueprintAuthoringTools({
    server,
    callSubsystemJson,
    jsonObjectSchema: JsonObjectSchema,
    blueprintMemberMutationOperationSchema: BlueprintMemberMutationOperationSchema,
    blueprintGraphMutationOperationSchema: BlueprintGraphMutationOperationSchema,
  });

  registerImportJobTools({
    server,
    callSubsystemJson,
    importJobSchema: ImportJobSchema,
    importJobListSchema: ImportJobListSchema,
    textureImportOptionsSchema: TextureImportOptionsSchema,
    meshImportOptionsSchema: MeshImportOptionsSchema,
  });

  registerCompositeTools({
    server,
    callSubsystemJson,
    toolHelpRegistry,
  });

  registerCompositeWorkflowTools({
    server,
    callSubsystemJson,
    toolHelpRegistry,
  });

  registerRecipeTools({
    server,
    callSubsystemJson,
    toolHelpRegistry,
  });

  registerUtilityTools({
    server,
    callSubsystemJson,
    getToolHelpEntry,
    summarizeSchemaFields,
    summarizeOutputSchema,
    collectRelatedResources,
    collectToolExampleFamilies,
    getToolExecutionCompatibility,
  });
}
