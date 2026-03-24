# Module Decomposition Plan for blueprint-extractor-mcp/index.ts

Generated: 2026-03-23
Source: `MCP/src/index.ts` (9340 lines, 97 tools)
Current source files: `index.ts`, `ue-client.ts`, `types.ts`, `compactor.ts`, `project-controller.ts`, `automation-controller.ts`

## Status Update (2026-03-24)

This plan has now been implemented substantially beyond the original target shape.

- `MCP/src/index.ts` is now a **19-line CLI shim + re-export layer**.
- Server construction moved into `MCP/src/server-factory.ts` (**115 lines**).
- The source tree is split across **47 files** under `MCP/src/`.
- Tool registration, resource registration, prompts, catalogs, helper layers, and bootstrap configuration have all been extracted from the original monolith.
- Public API compatibility was preserved through `src/index.ts` re-exports.

The remainder of this document is still useful as historical rationale and mapping, but the repository is no longer in the "planned decomposition" state described below.

---

## 1. Proposed File Structure

```
MCP/src/
  index.ts                          ~120 lines   Factory + server startup + main()
  tool-context.ts                   ~80 lines    ToolRegistrationContext interface + types
  schemas/
    shared.ts                       ~200 lines   v2 envelope, verification surfaces, execution metadata
    extraction.ts                   ~60 lines    scopeEnum, CascadeResultSchema
    verification.ts                 ~250 lines   Verification artifact, comparison, capture, motion schemas
    widget.ts                       ~150 lines   WidgetNodeSchema, WidgetBlueprintMutationOperationSchema, animation schemas
    material.ts                     ~200 lines   Material expression/connection/parameter/layer/graph schemas
    data-assets.ts                  ~120 lines   DataTable, Curve, CurveTable, UserDefinedStruct/Enum schemas
    ai-trees.ts                     ~80 lines    Blackboard, BehaviorTree, StateTree mutation schemas
    animation.ts                    ~60 lines    AnimSequence, AnimMontage, BlendSpace mutation schemas
    blueprint.ts                    ~40 lines    BlueprintMember/Graph mutation schemas
    import.ts                       ~120 lines   Import item, payload, job, texture/mesh option schemas
    project.ts                      ~30 lines    BuildPlatform/Configuration schemas
    enhanced-input.ts               ~20 lines    EnhancedInputValueType, InputMapping schemas
    common.ts                       ~40 lines    JsonObjectSchema, StringMapSchema, WidgetSelectorSchemas, PropertyEntrySchema
  helpers/
    envelope.ts                     ~300 lines   normalizeToolSuccess, normalizeToolError, inferExecutionMetadata, classifyRecoverableToolFailure, defaultNextSteps
    subsystem.ts                    ~40 lines    callSubsystemJson, jsonToolSuccess, jsonToolError
    verification-normalize.ts       ~320 lines   normalizeVerificationArtifact, normalizeComparison, normalizeAutomationRunResult, etc.
    commonui.ts                     ~100 lines   normalizeCommonUIButtonStyleInput, extractCommonUIButtonStyle, field mappings
    formatting.ts                   ~80 lines    isRecord, isPlainObject, coerceStringArray, formatPromptValue/List/Block, sleep, tryParseJsonText, firstDefinedString, maybeBoolean, etc.
    project-resolution.ts           ~100 lines   resolveProjectInputs, buildProjectResolutionDiagnostics, explainProjectResolutionFailure, getProjectAutomationContext, rememberExternalBuild
    capture.ts                      ~60 lines    buildResourceLinkContent, maybeBuildInlineImageContent, buildCaptureResourceUri, MAX_INLINE_CAPTURE_BYTES
    live-coding.ts                  ~60 lines    canFallbackFromLiveCoding, deriveLiveCodingFallbackReason, enrichLiveCodingResult
    widget-utils.ts                 ~20 lines    getWidgetIdentifier, buildGeneratedBlueprintClassPath, supportsConnectionProbe
  tools/
    extraction.ts                   ~550 lines   15 extract_* tools + search_assets + list_assets
    widget.ts                       ~620 lines   create/extract/build/modify/compile widget tools + CommonUI 4 tools
    widget-animation.ts             ~350 lines   extract/create/modify_widget_animation
    verification.ts                 ~600 lines   capture_widget_preview, capture_widget_motion_checkpoints, compare_capture_to_reference, compare_motion_capture_bundle, list_captures, cleanup_captures
    data-assets.ts                  ~350 lines   create/modify data_asset, data_table, curve, curve_table + input action/mapping
    material.ts                     ~500 lines   create/modify material_instance, material, material_function + composable tools + compile_material_asset
    ai-trees.ts                     ~330 lines   create/modify blackboard, behavior_tree, state_tree
    animation.ts                    ~350 lines   create/modify anim_sequence, anim_montage, blend_space
    blueprint.ts                    ~280 lines   create_blueprint, modify_blueprint_members, modify_blueprint_graphs
    project.ts                      ~700 lines   wait_for_editor, compile_project_code, trigger_live_coding, restart_editor, sync_project_code, apply_window_ui_changes, get_project_automation_context
    import.ts                       ~250 lines   import_assets, reimport_assets, get_import_job, list_import_jobs, import_textures, import_meshes
    widget-blueprint-mutate.ts      ~200 lines   modify_widget_blueprint (standalone due to complexity)
    save.ts                         ~40 lines    save_assets
    struct-enum.ts                  ~200 lines   create/modify user_defined_struct, user_defined_enum
  resources/
    static-resources.ts             ~550 lines   All 15 static text resources
    template-resources.ts           ~160 lines   examples, widget-patterns, captures, automation-test-runs templates + unsupported-surfaces, ui-redesign-workflow
  prompts/
    catalog.ts                      ~200 lines   promptCatalog definitions
    examples.ts                     ~400 lines   exampleCatalog definitions + designSpecSchemaExample
  constants.ts                      ~30 lines    EDITOR_UNAVAILABLE_MESSAGE_FRAGMENT, SUBSYSTEM_UNAVAILABLE_MESSAGE_FRAGMENT, EDITOR_POLL_INTERVAL_MS, taskAwareTools, serverInstructions, commonUI field mappings
  compactor.ts                      (existing, unchanged)
  ue-client.ts                      (existing, unchanged)
  types.ts                          (existing, unchanged)
  project-controller.ts             (existing, unchanged)
  automation-controller.ts          (existing, unchanged)
```

**Estimated total after decomposition: ~7,500 lines across ~35 files (vs. 9,340 lines in one file)**
The line savings come from eliminating duplicated import blocks and removing some redundant inline type assertions that the module boundary makes unnecessary.

---

## 2. ToolRegistrationContext Interface

```typescript
// MCP/src/tool-context.ts

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import type { UEClientLike } from './index.js';
import type { ProjectControllerLike, BuildPlatform, BuildConfiguration, CompileProjectCodeResult } from './project-controller.js';
import type { AutomationControllerLike } from './automation-controller.js';

/**
 * Mutable state owned by the factory closure.
 * Tool modules read/write through accessor functions
 * rather than holding direct references.
 */
export interface ServerState {
  /** Cached editor-derived project context. Cleared on restart_editor. */
  getCachedProjectAutomationContext(): ProjectAutomationContext | null;
  setCachedProjectAutomationContext(value: ProjectAutomationContext | null): void;

  /** Last external build result used for Live Coding fallback enrichment. */
  getLastExternalBuildContext(): Record<string, unknown> | null;
  setLastExternalBuildContext(value: Record<string, unknown> | null): void;
}

/**
 * Context object passed to every tool registration module.
 * Provides access to all closure variables from createBlueprintExtractorServer().
 */
export interface ToolRegistrationContext {
  /** The McpServer instance (with the monkey-patched registerTool wrapper). */
  server: McpServer;

  /** UE Remote Control client for subsystem calls. */
  client: UEClientLike;

  /** Host-side project build, restart, reconnect orchestration. */
  projectController: ProjectControllerLike;

  /** Host-side automation test execution. */
  automationController: AutomationControllerLike;

  /** Mutable server state (accessor-based to avoid stale closure captures). */
  state: ServerState;
}

/**
 * Standard signature for a tool registration module.
 * Each file exports a single function that registers its tools on the server.
 */
export type RegisterToolsFunction = (ctx: ToolRegistrationContext) => void;

export type ProjectAutomationContext = {
  success?: boolean;
  operation?: string;
  projectName?: string;
  projectFilePath?: string;
  projectDir?: string;
  engineDir?: string;
  engineRoot?: string;
  editorTarget?: string;
  hostPlatform?: string;
  supportsLiveCoding?: boolean;
  liveCodingAvailable?: boolean;
  liveCodingEnabled?: boolean;
  liveCodingStarted?: boolean;
  liveCodingError?: string;
};
```

### Why accessor functions for state instead of direct mutable references

Direct mutable references (`{ cachedProjectAutomationContext: ProjectAutomationContext | null }`) are fragile because:
- A tool module could destructure the state object at import time and hold a stale copy.
- TypeScript cannot enforce "always re-read" semantics on a plain property.

Accessor functions (get/set) guarantee every read goes through the canonical holder. The factory closure implements the `ServerState` interface trivially:

```typescript
// Inside createBlueprintExtractorServer():
let cachedProjectAutomationContext: ProjectAutomationContext | null = null;
let lastExternalBuildContext: Record<string, unknown> | null = null;

const state: ServerState = {
  getCachedProjectAutomationContext: () => cachedProjectAutomationContext,
  setCachedProjectAutomationContext: (v) => { cachedProjectAutomationContext = v; },
  getLastExternalBuildContext: () => lastExternalBuildContext,
  setLastExternalBuildContext: (v) => { lastExternalBuildContext = v; },
};
```

---

## 3. Tool -> Module Mapping (All 97 Tools)

### tools/extraction.ts (19 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 1 | extract_blueprint | 3149 | simple-extract | callSubsystemJson, compactBlueprint, scopeEnum |
| 2 | extract_statetree | 3223 | simple-extract | callSubsystemJson |
| 3 | extract_dataasset | 3263 | simple-extract | callSubsystemJson |
| 4 | extract_datatable | 3303 | simple-extract | callSubsystemJson |
| 5 | extract_behavior_tree | 3347 | simple-extract | callSubsystemJson |
| 6 | extract_blackboard | 3387 | simple-extract | callSubsystemJson |
| 7 | extract_user_defined_struct | 3427 | simple-extract | callSubsystemJson |
| 8 | extract_user_defined_enum | 3467 | simple-extract | callSubsystemJson |
| 9 | extract_curve | 3507 | simple-extract | callSubsystemJson |
| 10 | extract_curvetable | 3547 | simple-extract | callSubsystemJson |
| 11 | extract_material_instance | 3587 | simple-extract | callSubsystemJson |
| 12 | extract_material | 3622 | simple-extract | callSubsystemJson |
| 13 | extract_material_function | 3656 | simple-extract | callSubsystemJson |
| 14 | extract_anim_sequence | 3691 | simple-extract | callSubsystemJson |
| 15 | extract_anim_montage | 3731 | simple-extract | callSubsystemJson |
| 16 | extract_blend_space | 3771 | simple-extract | callSubsystemJson |
| 17 | extract_cascade | 3811 | simple-extract | callSubsystemJson, CascadeResultSchema |
| 18 | search_assets | 3892 | simple-extract | callSubsystemJson |
| 19 | list_assets | 3938 | simple-extract | client.callSubsystem (direct, legacy) |

### tools/widget.ts (8 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 20 | create_widget_blueprint | 4454 | crud | callSubsystemJson |
| 21 | extract_widget_blueprint | 4488 | simple-extract | callSubsystemJson |
| 22 | build_widget_tree | 4648 | crud | callSubsystemJson, WidgetNodeSchema |
| 23 | modify_widget | 4687 | crud | callSubsystemJson, maybeBoolean, getWidgetIdentifier |
| 24 | compile_widget_blueprint | 4752 | simple-extract | callSubsystemJson |
| 25 | create_commonui_button_style | 4780 | crud | callSubsystemJson, normalizeCommonUIButtonStyleInput |
| 26 | extract_commonui_button_style | 4830 | simple-extract | callSubsystemJson, extractCommonUIButtonStyle |
| 27 | modify_commonui_button_style | 4868 | crud | callSubsystemJson, normalizeCommonUIButtonStyleInput |
| 28 | apply_commonui_button_style | 4915 | crud | callSubsystemJson, buildGeneratedBlueprintClassPath |

### tools/widget-animation.ts (3 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 29 | extract_widget_animation | 4522 | simple-extract | callSubsystemJson, ExtractWidgetAnimationResultSchema |
| 30 | create_widget_animation | 4557 | crud | callSubsystemJson, CreateModifyWidgetAnimationResultSchema |
| 31 | modify_widget_animation | 4600 | polymorphic | callSubsystemJson, CreateModifyWidgetAnimationResultSchema |

### tools/widget-blueprint-mutate.ts (1 tool)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 32 | modify_widget_blueprint | 6498 | polymorphic | callSubsystemJson, WidgetBlueprintMutationOperationSchema, WidgetNodeSchema, maybeBoolean |

### tools/verification.ts (6 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 33 | capture_widget_preview | 4964 | custom | callSubsystemJson, normalizeVerificationArtifact, buildResourceLinkContent, maybeBuildInlineImageContent |
| 34 | capture_widget_motion_checkpoints | 5026 | custom | callSubsystemJson, normalizeVerificationArtifactReference, resolveProjectInputs, normalizeAutomationRunResult, automationController, buildResourceLinkContent, maybeBuildInlineImageContent |
| 35 | compare_capture_to_reference | 5206 | custom | callSubsystemJson, normalizeVerificationComparison, normalizeVerificationArtifact, buildResourceLinkContent, maybeBuildInlineImageContent |
| 36 | compare_motion_capture_bundle | 6683 | custom | callSubsystemJson, normalizeVerificationComparison, normalizeVerificationArtifactReference, buildResourceLinkContent |
| 37 | list_captures | 5267 | simple-extract | callSubsystemJson, normalizeVerificationArtifact |
| 38 | cleanup_captures | 5305 | simple-extract | callSubsystemJson |

### tools/data-assets.ts (12 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 39 | create_data_asset | 5336 | crud | callSubsystemJson |
| 40 | modify_data_asset | 5392 | crud | callSubsystemJson |
| 41 | create_input_action | 5444 | crud | callSubsystemJson, EnhancedInputValueTypeSchema |
| 42 | modify_input_action | 5486 | crud | callSubsystemJson |
| 43 | create_input_mapping_context | 5528 | crud | callSubsystemJson, InputMappingSchema |
| 44 | modify_input_mapping_context | 5570 | crud | callSubsystemJson, InputMappingSchema |
| 45 | create_data_table | 5616 | crud | callSubsystemJson, DataTableRowSchema |
| 46 | modify_data_table | 5672 | crud | callSubsystemJson, DataTableRowSchema |
| 47 | create_curve | 5735 | crud | callSubsystemJson, CurveTypeSchema, CurveChannelSchema |
| 48 | modify_curve | 5791 | crud | callSubsystemJson, CurveKeyUpsertSchema, CurveKeyDeleteSchema |
| 49 | create_curve_table | 5854 | crud | callSubsystemJson, CurveTableModeSchema, CurveTableRowSchema |
| 50 | modify_curve_table | 5910 | crud | callSubsystemJson, CurveTableRowSchema |

### tools/material.ts (11 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 51 | create_material_instance | 5973 | crud | callSubsystemJson, MaterialParameterSchemas, MaterialLayerStackSchema |
| 52 | modify_material_instance | 6017 | crud | callSubsystemJson, MaterialParameterSchemas, MaterialLayerStackSchema |
| 53 | create_material | 6086 | crud | callSubsystemJson, MaterialGraphPayloadSchema |
| 54 | set_material_settings | 6128 | crud | callSubsystemJson |
| 55 | add_material_expression | 6172 | crud | callSubsystemJson, MaterialNodePositionSchema |
| 56 | connect_material_expressions | 6236 | crud | callSubsystemJson, MaterialConnectionSelectorFieldsSchema |
| 57 | bind_material_property | 6277 | crud | callSubsystemJson, MaterialExpressionSelectorFieldsSchema |
| 58 | modify_material | 6332 | crud | callSubsystemJson, MaterialGraphPayloadSchema |
| 59 | create_material_function | 6379 | crud | callSubsystemJson, MaterialFunctionAssetKindSchema, MaterialGraphPayloadSchema |
| 60 | modify_material_function | 6421 | crud | callSubsystemJson, MaterialGraphPayloadSchema |
| 61 | compile_material_asset | 6468 | simple-extract | callSubsystemJson |

### tools/ai-trees.ts (6 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 62 | create_blackboard | 8179 | crud | callSubsystemJson, BlackboardKeySchema |
| 63 | modify_blackboard | 8231 | polymorphic | callSubsystemJson, BlackboardMutationOperationSchema, BlackboardKeySchema |
| 64 | create_behavior_tree | 8290 | crud | callSubsystemJson |
| 65 | modify_behavior_tree | 8339 | polymorphic | callSubsystemJson, BehaviorTreeMutationOperationSchema |
| 66 | create_state_tree | 8397 | crud | callSubsystemJson |
| 67 | modify_state_tree | 8448 | polymorphic | callSubsystemJson, StateTreeMutationOperationSchema |

### tools/animation.ts (6 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 68 | create_anim_sequence | 8514 | crud | callSubsystemJson |
| 69 | modify_anim_sequence | 8569 | polymorphic | callSubsystemJson, AnimSequenceMutationOperationSchema |
| 70 | create_anim_montage | 8631 | crud | callSubsystemJson |
| 71 | modify_anim_montage | 8688 | polymorphic | callSubsystemJson, AnimMontageMutationOperationSchema |
| 72 | create_blend_space | 8750 | crud | callSubsystemJson, BlendParameterSchema |
| 73 | modify_blend_space | 8806 | polymorphic | callSubsystemJson, BlendSpaceMutationOperationSchema |

### tools/blueprint.ts (3 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 74 | create_blueprint | 8865 | crud | callSubsystemJson |
| 75 | modify_blueprint_members | 8922 | polymorphic | callSubsystemJson, BlueprintMemberMutationOperationSchema |
| 76 | modify_blueprint_graphs | 8988 | polymorphic | callSubsystemJson, BlueprintGraphMutationOperationSchema |

### tools/project.ts (10 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 77 | get_project_automation_context | 6659 | simple-extract | getProjectAutomationContext |
| 78 | wait_for_editor | 6821 | custom | client.checkConnection (direct), sleep, EDITOR_POLL_INTERVAL_MS |
| 79 | run_automation_tests | 6901 | custom | resolveProjectInputs, automationController, normalizeAutomationRunResult |
| 80 | get_automation_test_run | 6991 | custom | automationController, normalizeAutomationRunResult |
| 81 | list_automation_test_runs | 7042 | custom | automationController |
| 82 | compile_project_code | 7076 | custom | resolveProjectInputs, projectController, rememberExternalBuild |
| 83 | trigger_live_coding | 7145 | custom | projectController.liveCodingSupported, callSubsystemJson, enrichLiveCodingResult |
| 84 | restart_editor | 7190 | custom | callSubsystemJson, projectController.waitForEditorRestart, supportsConnectionProbe, state.setCachedProjectAutomationContext |
| 85 | sync_project_code | 7253 | custom | resolveProjectInputs, projectController, enrichLiveCodingResult, callSubsystemJson, rememberExternalBuild, supportsConnectionProbe |
| 86 | apply_window_ui_changes | 7484 | custom | callSubsystemJson, getWidgetIdentifier, maybeBoolean, resolveProjectInputs, enrichLiveCodingResult, applyWindowUiChangesResultSchema |

### tools/import.ts (6 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 87 | import_assets | 9083 | crud | callSubsystemJson, ImportPayloadSchema |
| 88 | reimport_assets | 9125 | crud | callSubsystemJson |
| 89 | get_import_job | 9167 | simple-extract | callSubsystemJson |
| 90 | list_import_jobs | 9204 | simple-extract | callSubsystemJson |
| 91 | import_textures | 9241 | crud | callSubsystemJson, TextureImportPayloadSchema |
| 92 | import_meshes | 9283 | crud | callSubsystemJson, MeshImportPayloadSchema |

### tools/save.ts (1 tool)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 93 | save_assets | 9046 | simple-extract | callSubsystemJson |

### tools/struct-enum.ts (4 tools)

| # | Tool Name | Line | Pattern | Dependencies |
|---|-----------|------|---------|--------------|
| 94 | create_user_defined_struct | 7965 | crud | callSubsystemJson, UserDefinedStructFieldSchema |
| 95 | modify_user_defined_struct | 8010 | polymorphic | callSubsystemJson, UserDefinedStructMutationOperationSchema |
| 96 | create_user_defined_enum | 8071 | crud | callSubsystemJson, UserDefinedEnumEntrySchema |
| 97 | modify_user_defined_enum | 8121 | polymorphic | callSubsystemJson, UserDefinedEnumMutationOperationSchema |

**Total: 97 tools across 14 tool module files.**

---

## 4. Shared Dependencies Graph

```
index.ts (factory)
  |
  +-- tool-context.ts (ToolRegistrationContext, ServerState, ProjectAutomationContext)
  |
  +-- constants.ts (taskAwareTools, serverInstructions, EDITOR_*, commonUI field mappings)
  |
  +-- schemas/
  |     |-- shared.ts <-- v2ToolResultSchema (used by ALL output schemas)
  |     |                  verificationSurfaceSchema (used by verification + project tools)
  |     |-- verification.ts (all verification artifact/comparison schemas)
  |     |     depends on: shared.ts
  |     |-- widget.ts (WidgetNodeSchema, WidgetBlueprintMutationOp, animation schemas)
  |     |     depends on: shared.ts, verification.ts (for motion schemas)
  |     |-- material.ts (all material parameter/graph/expression schemas)
  |     |     depends on: common.ts
  |     |-- data-assets.ts (DataTable, Curve, CurveTable row/channel schemas)
  |     |     depends on: common.ts
  |     |-- ai-trees.ts (Blackboard, BehaviorTree, StateTree mutation ops + selector schemas)
  |     |     depends on: common.ts
  |     |-- animation.ts (AnimSequence/Montage/BlendSpace mutation ops)
  |     |     depends on: common.ts
  |     |-- blueprint.ts (BlueprintMember/Graph mutation ops)
  |     |-- import.ts (Import item/payload/job schemas)
  |     |     depends on: common.ts
  |     |-- extraction.ts (scopeEnum, CascadeResultSchema)
  |     |     depends on: shared.ts
  |     |-- common.ts (JsonObjectSchema, StringMapSchema, WidgetSelectorSchemas, PropertyEntrySchema)
  |     |-- project.ts (BuildPlatform/Configuration schemas)
  |     +-- enhanced-input.ts (EnhancedInputValueType, InputMapping)
  |
  +-- helpers/
  |     |-- envelope.ts <-- normalizeToolSuccess/Error (used by registerTool wrapper)
  |     |     depends on: constants.ts, formatting.ts
  |     |-- subsystem.ts <-- callSubsystemJson, jsonToolSuccess, jsonToolError
  |     |     depends on: tool-context.ts (for client reference)
  |     |-- verification-normalize.ts (all normalizeVerificationArtifact* functions)
  |     |     depends on: formatting.ts
  |     |-- commonui.ts (normalize/extract button style helpers)
  |     |     depends on: formatting.ts, constants.ts
  |     |-- formatting.ts <-- isRecord, isPlainObject, firstDefinedString, sleep,
  |     |                      tryParseJsonText, maybeBoolean (MOST SHARED)
  |     |-- project-resolution.ts (resolveProjectInputs, getProjectAutomationContext)
  |     |     depends on: subsystem.ts, formatting.ts, tool-context.ts
  |     |-- capture.ts (buildResourceLinkContent, maybeBuildInlineImageContent)
  |     |-- live-coding.ts (enrichLiveCodingResult, canFallbackFromLiveCoding)
  |     |     depends on: formatting.ts, tool-context.ts
  |     +-- widget-utils.ts (getWidgetIdentifier, buildGeneratedBlueprintClassPath,
  |                          supportsConnectionProbe)
  |
  +-- tools/ (each receives ToolRegistrationContext; most import from schemas/ and helpers/)
  |
  +-- resources/
  |     |-- static-resources.ts
  |     +-- template-resources.ts (depends on: verification-normalize, callSubsystemJson,
  |                                automationController)
  |
  +-- prompts/
        |-- catalog.ts (depends on: formatting.ts for coerceStringArray/formatPromptList/Block)
        +-- examples.ts (depends on: constants.ts for designSpecSchemaExample)
```

### Critical shared nodes (highest fan-out)

| Helper/Schema | Used by (tool module count) |
|---------------|---------------------------|
| `callSubsystemJson` | 13 tool modules + resources |
| `jsonToolSuccess` / `jsonToolError` | 13 tool modules |
| `isRecord` (formatting.ts) | envelope, verification-normalize, commonui, live-coding, capture, project-resolution |
| `v2ToolResultSchema` | ALL output schemas (19 derived schemas) |
| `normalizeVerificationArtifact*` | verification tools, project tools (automation), resources |
| `resolveProjectInputs` | project tools, verification tools (automation_scenario mode) |
| `firstDefinedString` | project-resolution, live-coding, verification-normalize |

---

## 5. Extraction Difficulty Assessment

| Module | Difficulty | Reason |
|--------|-----------|--------|
| tools/extraction.ts | **Easy** | All 19 tools are simple callSubsystemJson + parse. Zero cross-tool coupling. |
| tools/data-assets.ts | **Easy** | Uniform CRUD pattern. Only needs callSubsystemJson + local schemas. |
| tools/ai-trees.ts | **Easy** | Uniform CRUD/polymorphic. No shared state. |
| tools/animation.ts | **Easy** | Uniform CRUD/polymorphic. No shared state. |
| tools/blueprint.ts | **Easy** | Uniform CRUD/polymorphic. No shared state. |
| tools/import.ts | **Easy** | Uniform CRUD. Only needs callSubsystemJson + local schemas. |
| tools/struct-enum.ts | **Easy** | Uniform CRUD/polymorphic. |
| tools/save.ts | **Easy** | Single tool, callSubsystemJson only. |
| tools/material.ts | **Easy-Medium** | Many tools but all use callSubsystemJson + local material schemas. The composable tools (set_settings, add_expression, connect, bind) are small. |
| tools/widget.ts | **Medium** | CommonUI tools need the normalizeCommonUIButtonStyleInput/extract helpers. modify_widget needs maybeBoolean. |
| tools/widget-animation.ts | **Medium** | Needs widget animation schemas and CreateModifyWidgetAnimationResultSchema. |
| tools/verification.ts | **Medium-Hard** | capture_widget_motion_checkpoints uses resolveProjectInputs + automationController. All tools use verification-normalize helpers + capture helpers. Heavy schema dependency. |
| tools/widget-blueprint-mutate.ts | **Medium** | Single complex polymorphic tool. Many input schema refs but self-contained handler. |
| tools/project.ts | **Hard** | sync_project_code, apply_window_ui_changes, restart_editor all mutate server state, use resolveProjectInputs, enrichLiveCodingResult, and interact with projectController + automationController. apply_window_ui_changes is 300+ lines with inline closures. |
| schemas/ (all) | **Easy** | Pure data definitions. Zero logic. Mechanical extraction. |
| helpers/envelope.ts | **Medium** | The monkey-patched registerTool wrapper is the thorniest piece. Must stay in the factory or be carefully injected. |
| helpers/verification-normalize.ts | **Medium** | Large but pure functions. Just needs isRecord, firstDefinedString, and type imports. |
| resources/ | **Easy-Medium** | Static text resources are trivial. Template resources (captures, automation-test-runs) need callSubsystemJson + automationController. |
| prompts/ | **Easy** | Pure data + buildPrompt functions. Only formatting helpers. |

---

## 6. Migration Strategy (Extraction Order)

### Phase 1: Foundations (no tool behavior changes)

**Goal: Extract schemas, constants, types, and pure helpers. No tool code moves yet.**

1. **constants.ts** -- Extract `serverInstructions`, `taskAwareTools`, `EDITOR_*` constants, `commonUIButton*Fields`, `designSpecSchemaExample`. Zero risk.
2. **tool-context.ts** -- Define `ToolRegistrationContext`, `ServerState`, `ProjectAutomationContext`, and `RegisterToolsFunction` types. Zero runtime change.
3. **schemas/common.ts** -- Extract `JsonObjectSchema`, `StringMapSchema`, `WidgetSelectorSchemas`, `PropertyEntrySchema`.
4. **schemas/shared.ts** -- Extract `v2ToolResultSchema`, `verificationSurfaceSchema`, `verificationContextSchema`. Import from common.ts.
5. **schemas/** (remaining) -- Extract all schema files mechanically. Each file is a pure export with no logic.
6. **helpers/formatting.ts** -- Extract `isRecord`, `isPlainObject`, `coerceStringArray`, `formatPromptValue`, `formatPromptList`, `formatPromptBlock`, `sleep`, `tryParseJsonText`, `firstDefinedString`, `maybeBoolean`.
7. **helpers/commonui.ts** -- Extract `normalizeCommonUIButtonStyleInput`, `extractCommonUIButtonStyle`.
8. **helpers/capture.ts** -- Extract `buildResourceLinkContent`, `maybeBuildInlineImageContent`, `buildCaptureResourceUri`, `MAX_INLINE_CAPTURE_BYTES`.
9. **helpers/verification-normalize.ts** -- Extract all `normalizeVerification*`, `normalizeAutomation*`, `inferAutomationArtifactCaptureType`, `inferVerificationSurface`, `isImageMimeType` functions.
10. **helpers/widget-utils.ts** -- Extract `getWidgetIdentifier`, `buildGeneratedBlueprintClassPath`, `supportsConnectionProbe`.
11. **helpers/envelope.ts** -- Extract `normalizeToolSuccess`, `normalizeToolError`, `inferExecutionMetadata`, `classifyRecoverableToolFailure`, `defaultNextSteps`, `extractToolPayload`, `extractTextContent`, `extractExtraContent`, `isContentBlock`.
12. **helpers/subsystem.ts** -- Extract `callSubsystemJson`, `jsonToolSuccess`, `jsonToolError`. These need the `client` reference, so they accept `ToolRegistrationContext` or the client directly.
13. **helpers/project-resolution.ts** -- Extract `resolveProjectInputs`, `getProjectAutomationContext`, `buildProjectResolutionDiagnostics`, `explainProjectResolutionFailure`, `rememberExternalBuild`.
14. **helpers/live-coding.ts** -- Extract `canFallbackFromLiveCoding`, `deriveLiveCodingFallbackReason`, `enrichLiveCodingResult`.

**Validation gate: Run existing tests. index.ts re-exports everything; no public API change.**

### Phase 2: Extract low-risk tool modules

**Goal: Move the easiest, most uniform tool groups out of index.ts.**

15. **tools/extraction.ts** -- 19 tools. Purely `callSubsystemJson` + parse. Highest tool count, lowest coupling.
16. **tools/data-assets.ts** -- 12 tools. Uniform CRUD pattern.
17. **tools/ai-trees.ts** -- 6 tools. Uniform pattern.
18. **tools/animation.ts** -- 6 tools. Uniform pattern.
19. **tools/blueprint.ts** -- 3 tools. Uniform pattern.
20. **tools/struct-enum.ts** -- 4 tools. Uniform pattern.
21. **tools/import.ts** -- 6 tools.
22. **tools/save.ts** -- 1 tool.
23. **tools/material.ts** -- 11 tools. Slightly more complex but still uniform.

**Validation gate: Full test suite. index.ts is now ~3,000 lines.**

### Phase 3: Extract medium-risk tool modules

24. **tools/widget.ts** -- 8 tools. Needs CommonUI helpers and widget schemas.
25. **tools/widget-animation.ts** -- 3 tools.
26. **tools/widget-blueprint-mutate.ts** -- 1 tool (modify_widget_blueprint). Large but self-contained.
27. **tools/verification.ts** -- 6 tools. Needs verification-normalize and capture helpers.

**Validation gate: Full test suite + e2e integration test. index.ts is now ~1,500 lines.**

### Phase 4: Extract hard-coupled tool modules

28. **tools/project.ts** -- 10 tools (including apply_window_ui_changes and get_project_automation_context). Heavily uses state, projectController, automationController, resolveProjectInputs.

**Validation gate: Full test suite + e2e integration test + project automation tests.**

### Phase 5: Extract resources and prompts

29. **prompts/examples.ts** -- Pure data.
30. **prompts/catalog.ts** -- Pure data + buildPrompt.
31. **resources/static-resources.ts** -- 15 static text resources.
32. **resources/template-resources.ts** -- Template resources with callSubsystemJson dependencies.

**Validation gate: Full test suite. index.ts is now ~120 lines (factory + startup).**

### Phase 6: Finalize index.ts

33. **index.ts** -- Becomes:
    - `createBlueprintExtractorServer()` factory that creates `McpServer`, builds `ToolRegistrationContext`, applies the `registerTool` wrapper, and calls each module's registration function.
    - `main()` startup.
    - Re-exports for test compatibility.

---

## 7. Risk Assessment

### Low Risk
- **Schema extraction** -- Pure type definitions. If a schema is wrong, TypeScript catches it at compile time.
- **Constants extraction** -- Pure values. Zero behavioral risk.
- **Prompt/example extraction** -- Pure data. Easily verified by diffing generated prompt text.
- **Simple-extract tools** -- Uniform pattern. Each is <30 lines with no shared state.

### Medium Risk
- **Helper extraction** -- Functions like `normalizeVerificationArtifact` have subtle object-spread semantics. Must preserve exact field precedence.
- **`callSubsystemJson` closure capture** -- Currently closes over `client`. The extracted version must accept `client` as a parameter or via context.
- **The `registerTool` monkey-patch** -- The wrapper at lines 1681-1698 intercepts ALL tool callbacks. It must remain in the factory or be injected identically. If the wrapper stops wrapping a tool, that tool loses structured error recovery.
- **Import cycle risk** -- `schemas/widget.ts` depends on `schemas/verification.ts` (for motion schemas). Ensure no circular imports.

### High Risk
- **`apply_window_ui_changes` extraction** -- 300+ lines with inline closures (`buildVerification`, `checkpointMutationStep`, `collectCheckpointAssetPaths`). These closures capture the outer `callSubsystemJson` and multiple schema variables. Must be carefully lifted.
- **`sync_project_code` extraction** -- Multi-branch flow touching `projectController`, `automationController`, `resolveProjectInputs`, `enrichLiveCodingResult`, `rememberExternalBuild`, `supportsConnectionProbe`, `callSubsystemJson`, and mutable state (`cachedProjectAutomationContext`). Highest coupling density of any single tool.
- **`restart_editor` state mutation** -- Clears `cachedProjectAutomationContext`. The state accessor pattern handles this, but the test must verify the clear actually propagates.
- **Test coupling** -- `server-contract.test.ts` and `live.e2e.test.ts` import from `index.ts` and may depend on internal structure. Must verify re-exports work.

### Mitigations

1. **Re-export everything from index.ts initially.** Tests keep working. Remove re-exports only after confirming no external consumers.
2. **Extract one module at a time, run tests between each.** Never batch more than one tool module extraction without a passing test run.
3. **Use the `RegisterToolsFunction` type constraint.** If a module forgets a context dependency, TypeScript catches it.
4. **Freeze the `registerTool` wrapper position.** Keep it in the factory. Tool modules never need to know about it.
5. **Lint for circular imports.** Add an ESLint rule or a CI check (`madge --circular`) after Phase 1.

---

## 8. Detailed Closure Variable Inventory

All variables captured by the `createBlueprintExtractorServer()` closure that tool handlers reference:

| Variable | Type | Mutated? | Used by | Exposed via |
|----------|------|----------|---------|-------------|
| `client` | `UEClientLike` | No | callSubsystemJson (86 tools), wait_for_editor, list_assets | `ctx.client` |
| `projectController` | `ProjectControllerLike` | No | compile_project_code, trigger_live_coding, restart_editor, sync_project_code, apply_window_ui_changes | `ctx.projectController` |
| `automationController` | `AutomationControllerLike` | No | run/get/list_automation_tests, capture_widget_motion_checkpoints, template resources | `ctx.automationController` |
| `server` | `McpServer` | No (config only) | All tool registrations, resources, prompts | `ctx.server` |
| `cachedProjectAutomationContext` | `ProjectAutomationContext \| null` | **Yes** | getProjectAutomationContext (read), restart_editor (clear) | `ctx.state.get/setCachedProjectAutomationContext()` |
| `lastExternalBuildContext` | `Record<string, unknown> \| null` | **Yes** | rememberExternalBuild (write), enrichLiveCodingResult (read) | `ctx.state.get/setLastExternalBuildContext()` |

Only 2 variables are mutable. Both are simple nullable caches with clear/set semantics.

---

## 9. Summary Metrics

| Metric | Before | After |
|--------|--------|-------|
| Files | 1 | ~35 |
| Largest file | 9,340 lines | ~700 lines (tools/project.ts) |
| Median file | 9,340 lines | ~150 lines |
| Max tool count per file | 97 | 19 (tools/extraction.ts) |
| Shared function fan-out | 86 (callSubsystemJson in one file) | Same count, but via explicit imports |
| Circular dependencies | N/A (monolith) | 0 (designed acyclic) |
| Type safety of context | Closure capture (implicit) | `ToolRegistrationContext` (explicit) |
| Phases to complete | -- | 6 phases, 33 extraction steps |

The decomposition preserves 100% behavioral compatibility. No tool signatures, schemas, or result shapes change. The only public-facing change is that `createBlueprintExtractorServer` internally delegates to module registration functions instead of inline tool definitions.
