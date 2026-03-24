# MCP Tool Inventory — Blueprint Extractor MCP v2

**Source:** `MCP/src/index.ts` (9340 lines)
**Total Registered Tools:** 97
**Generated:** 2026-03-23

> Status note (2026-03-24): this is a historical baseline snapshot captured before the decomposition and follow-up non-breaking optimizations landed. The current repository no longer has a 9,340-line `index.ts`; see [SUMMARY.md](SUMMARY.md) for the implemented state.

---

## Complete Tool Inventory

| # | Name | Desc Chars | Params | OutputSchema | Subsystem Fn | Pattern | Annotations | Est. Tokens |
|---|------|-----------|--------|-------------|-------------|---------|-------------|-------------|
| 1 | extract_blueprint | 1167 | 5 | default (v2ToolResultSchema) | ExtractBlueprint | simple-extract | readOnly, idempotent | 487 |
| 2 | extract_statetree | 398 | 1 | default | ExtractStateTree | simple-extract | readOnly, idempotent | 131 |
| 3 | extract_dataasset | 384 | 1 | default | ExtractDataAsset | simple-extract | readOnly, idempotent | 128 |
| 4 | extract_datatable | 372 | 1 | default | ExtractDataTable | simple-extract | readOnly, idempotent | 125 |
| 5 | extract_behavior_tree | 457 | 1 | default | ExtractBehaviorTree | simple-extract | readOnly, idempotent | 148 |
| 6 | extract_blackboard | 408 | 1 | default | ExtractBlackboard | simple-extract | readOnly, idempotent | 135 |
| 7 | extract_user_defined_struct | 406 | 1 | default | ExtractUserDefinedStruct | simple-extract | readOnly, idempotent | 139 |
| 8 | extract_user_defined_enum | 377 | 1 | default | ExtractUserDefinedEnum | simple-extract | readOnly, idempotent | 131 |
| 9 | extract_curve | 382 | 1 | default | ExtractCurve | simple-extract | readOnly, idempotent | 127 |
| 10 | extract_curvetable | 350 | 1 | default | ExtractCurveTable | simple-extract | readOnly, idempotent | 119 |
| 11 | extract_material_instance | 445 | 1 | default | ExtractMaterialInstance | simple-extract | readOnly, idempotent | 147 |
| 12 | extract_material | 56 | 2 | default | ExtractMaterial | simple-extract | readOnly, idempotent | 55 |
| 13 | extract_material_function | 86 | 2 | default | ExtractMaterialFunction | simple-extract | readOnly, idempotent | 65 |
| 14 | extract_anim_sequence | 420 | 1 | default | ExtractAnimSequence | simple-extract | readOnly, idempotent | 140 |
| 15 | extract_anim_montage | 375 | 1 | default | ExtractAnimMontage | simple-extract | readOnly, idempotent | 127 |
| 16 | extract_blend_space | 367 | 1 | default | ExtractBlendSpace | simple-extract | readOnly, idempotent | 125 |
| 17 | extract_cascade | 772 | 4 | CascadeResultSchema | ExtractCascade | simple-extract | idempotent | 272 |
| 18 | search_assets | 592 | 3 | default | SearchAssets | simple-extract | readOnly, idempotent | 264 |
| 19 | list_assets | 391 | 3 | default | ListAssets | simple-extract | readOnly, idempotent | 164 |
| 20 | create_widget_blueprint | 64 | 2 | default | CreateWidgetBlueprint | crud | idempotent | 60 |
| 21 | extract_widget_blueprint | 107 | 2 | default | ExtractWidgetBlueprint | simple-extract | readOnly, idempotent | 72 |
| 22 | extract_widget_animation | 121 | 2 | ExtractWidgetAnimationResultSchema | ExtractWidgetAnimation | simple-extract | readOnly, idempotent | 74 |
| 23 | create_widget_animation | 98 | 4 | CreateModifyWidgetAnimationResultSchema | CreateWidgetAnimation | crud | -- | 85 |
| 24 | modify_widget_animation | 143 | 5 | CreateModifyWidgetAnimationResultSchema | ModifyWidgetAnimation | polymorphic | -- | 110 |
| 25 | build_widget_tree | 67 | 3 | default | BuildWidgetTree | crud | destructive, idempotent | 72 |
| 26 | modify_widget | 114 | 7 | default | ModifyWidget | crud | idempotent | 131 |
| 27 | compile_widget_blueprint | 72 | 1 | default | CompileWidgetBlueprint | simple-extract | idempotent | 40 |
| 28 | create_commonui_button_style | 84 | 4 | default | CreateBlueprint | crud | -- | 82 |
| 29 | extract_commonui_button_style | 85 | 1 | default | ExtractBlueprint | simple-extract | readOnly, idempotent | 44 |
| 30 | modify_commonui_button_style | 82 | 3 | default | ModifyBlueprintMembers | crud | idempotent | 66 |
| 31 | apply_commonui_button_style | 126 | 3 | default | ModifyWidgetBlueprintStructure | crud | idempotent | 84 |
| 32 | capture_widget_preview | 128 | 3 | CaptureResultSchema | CaptureWidgetPreview | custom | readOnly | 92 |
| 33 | capture_widget_motion_checkpoints | 128 | 12 | MotionCaptureBundleResultSchema | CaptureWidgetMotionCheckpoints | custom | readOnly | 253 |
| 34 | compare_capture_to_reference | 135 | 3 | CompareCaptureResultSchema | CompareCaptureToReference | custom | readOnly | 86 |
| 35 | list_captures | 85 | 1 | ListCapturesResultSchema | ListCaptures | simple-extract | readOnly, idempotent | 48 |
| 36 | cleanup_captures | 88 | 1 | CleanupCapturesResultSchema | CleanupCaptures | simple-extract | destructive | 46 |
| 37 | create_data_asset | 351 | 4 | default | CreateDataAsset | crud | -- | 148 |
| 38 | modify_data_asset | 348 | 3 | default | ModifyDataAsset | crud | -- | 130 |
| 39 | create_input_action | 97 | 4 | default | CreateInputAction | crud | -- | 97 |
| 40 | modify_input_action | 93 | 4 | default | ModifyInputAction | crud | -- | 96 |
| 41 | create_input_mapping_context | 105 | 4 | default | CreateInputMappingContext | crud | -- | 108 |
| 42 | modify_input_mapping_context | 107 | 5 | default | ModifyInputMappingContext | crud | -- | 115 |
| 43 | create_data_table | 385 | 4 | default | CreateDataTable | crud | -- | 148 |
| 44 | modify_data_table | 407 | 5 | default | ModifyDataTable | crud | -- | 152 |
| 45 | create_curve | 374 | 4 | default | CreateCurve | crud | -- | 137 |
| 46 | modify_curve | 416 | 5 | default | ModifyCurve | crud | -- | 146 |
| 47 | create_curve_table | 389 | 4 | default | CreateCurveTable | crud | -- | 138 |
| 48 | modify_curve_table | 408 | 5 | default | ModifyCurveTable | crud | -- | 147 |
| 49 | create_material_instance | 293 | 3 | default | CreateMaterialInstance | crud | -- | 104 |
| 50 | modify_material_instance | 430 | 11 | default | ModifyMaterialInstance | crud | -- | 226 |
| 51 | create_material | 81 | 4 | default | CreateMaterial | crud | -- | 84 |
| 52 | set_material_settings | 98 | 3 | default | ModifyMaterial | crud | idempotent | 73 |
| 53 | add_material_expression | 89 | 6 | default | ModifyMaterial | crud | -- | 118 |
| 54 | connect_material_expressions | 89 | 10 | default | ModifyMaterial | crud | -- | 140 |
| 55 | bind_material_property | 91 | 8 | default | ModifyMaterial | crud | -- | 142 |
| 56 | modify_material | 135 | 6 | default | ModifyMaterial | polymorphic | -- | 120 |
| 57 | create_material_function | 79 | 4 | default | CreateMaterialFunction | crud | -- | 83 |
| 58 | modify_material_function | 93 | 6 | default | ModifyMaterialFunction | polymorphic | -- | 108 |
| 59 | compile_material_asset | 86 | 1 | default | CompileMaterialAsset | simple-extract | idempotent | 41 |
| 60 | modify_widget_blueprint | 69 | 21 | default | ModifyWidgetBlueprintStructure / BuildWidgetTree / CompileWidgetBlueprint | polymorphic | destructive, idempotent | 364 |
| 61 | get_project_automation_context | 90 | 0 | default | (internal) | custom | readOnly, idempotent | 32 |
| 62 | compare_motion_capture_bundle | 143 | 4 | CompareMotionCaptureBundleResultSchema | CompareCaptureToReference | custom | readOnly | 132 |
| 63 | wait_for_editor | 93 | 1 | default | (none — polls connection) | custom | readOnly, idempotent | 47 |
| 64 | run_automation_tests | 119 | 7 | automationRunSchema | (automationController) | custom | -- | 178 |
| 65 | get_automation_test_run | 89 | 1 | automationRunSchema | (automationController) | custom | readOnly, idempotent | 45 |
| 66 | list_automation_test_runs | 60 | 1 | AutomationRunListSchema | (automationController) | custom | readOnly, idempotent | 38 |
| 67 | compile_project_code | 83 | 8 | default | (projectController) | custom | -- | 168 |
| 68 | trigger_live_coding | 103 | 2 | default | TriggerLiveCoding | custom | -- | 72 |
| 69 | restart_editor | 82 | 4 | default | RestartEditor | custom | -- | 100 |
| 70 | sync_project_code | 113 | 15 | default | TriggerLiveCoding / RestartEditor / CompileProjectCode / SaveAssets | custom | -- | 366 |
| 71 | apply_window_ui_changes | 153 | 12 | applyWindowUiChangesResultSchema | ModifyWidget / ModifyWidgetBlueprintStructure / ImportFonts / ApplyWidgetFonts / CompileWidgetBlueprint / SaveAssets | custom | -- | 405 |
| 72 | create_user_defined_struct | 348 | 3 | default | CreateUserDefinedStruct | crud | -- | 129 |
| 73 | modify_user_defined_struct | 460 | 4 | default | ModifyUserDefinedStruct | polymorphic | -- | 196 |
| 74 | create_user_defined_enum | 337 | 3 | default | CreateUserDefinedEnum | crud | -- | 124 |
| 75 | modify_user_defined_enum | 391 | 4 | default | ModifyUserDefinedEnum | polymorphic | -- | 161 |
| 76 | create_blackboard | 422 | 3 | default | CreateBlackboard | crud | -- | 149 |
| 77 | modify_blackboard | 441 | 4 | default | ModifyBlackboard | polymorphic | -- | 175 |
| 78 | create_behavior_tree | 418 | 3 | default | CreateBehaviorTree | crud | -- | 147 |
| 79 | modify_behavior_tree | 456 | 4 | default | ModifyBehaviorTree | polymorphic | destructive | 172 |
| 80 | create_state_tree | 418 | 3 | default | CreateStateTree | crud | -- | 148 |
| 81 | modify_state_tree | 545 | 4 | default | ModifyStateTree | polymorphic | destructive | 218 |
| 82 | create_anim_sequence | 407 | 3 | default | CreateAnimSequence | crud | -- | 152 |
| 83 | modify_anim_sequence | 462 | 4 | default | ModifyAnimSequence | polymorphic | -- | 193 |
| 84 | create_anim_montage | 432 | 3 | default | CreateAnimMontage | crud | -- | 159 |
| 85 | modify_anim_montage | 470 | 4 | default | ModifyAnimMontage | polymorphic | -- | 196 |
| 86 | create_blend_space | 424 | 3 | default | CreateBlendSpace | crud | -- | 154 |
| 87 | modify_blend_space | 400 | 4 | default | ModifyBlendSpace | polymorphic | -- | 164 |
| 88 | create_blueprint | 451 | 4 | default | CreateBlueprint | crud | -- | 171 |
| 89 | modify_blueprint_members | 621 | 4 | default | ModifyBlueprintMembers | polymorphic | -- | 251 |
| 90 | modify_blueprint_graphs | 497 | 4 | default | ModifyBlueprintGraphs | polymorphic | -- | 208 |
| 91 | save_assets | 296 | 1 | default | SaveAssets | simple-extract | idempotent | 94 |
| 92 | import_assets | 344 | 2 | ImportJobSchema | ImportAssets | crud | -- | 113 |
| 93 | reimport_assets | 362 | 2 | ImportJobSchema | ReimportAssets | crud | -- | 115 |
| 94 | get_import_job | 242 | 1 | ImportJobSchema | GetImportJob | simple-extract | readOnly, idempotent | 72 |
| 95 | list_import_jobs | 195 | 1 | ImportJobListSchema | ListImportJobs | simple-extract | readOnly, idempotent | 58 |
| 96 | import_textures | 356 | 2 | ImportJobSchema | ImportTextures | crud | -- | 123 |
| 97 | import_meshes | 348 | 2 | ImportJobSchema | ImportMeshes | crud | -- | 122 |

---

## Summary Statistics

### Total Tools: 97

### Total Estimated Tokens (all tool definitions): ~12,753

This represents the tool-definition overhead sent to the LLM on every request when all tools are listed.

### Pattern Breakdown

| Pattern | Count | % | Description |
|---------|-------|---|-------------|
| simple-extract | 26 | 26.8% | Call subsystem + JSON.parse, return data |
| crud | 38 | 39.2% | Create/modify with AssetPath + PayloadJson + bValidateOnly |
| polymorphic | 16 | 16.5% | Has operation/action enum dispatch |
| custom | 17 | 17.5% | Unique handler logic (multi-step flows, polling, controller delegation) |

### Tools by Pattern

**simple-extract (26):**
extract_blueprint, extract_statetree, extract_dataasset, extract_datatable, extract_behavior_tree, extract_blackboard, extract_user_defined_struct, extract_user_defined_enum, extract_curve, extract_curvetable, extract_material_instance, extract_material, extract_material_function, extract_anim_sequence, extract_anim_montage, extract_blend_space, extract_cascade, search_assets, list_assets, extract_widget_blueprint, extract_widget_animation, compile_widget_blueprint, extract_commonui_button_style, list_captures, cleanup_captures, compile_material_asset, save_assets, get_import_job, list_import_jobs

**crud (38):**
create_widget_blueprint, create_widget_animation, build_widget_tree, modify_widget, create_commonui_button_style, modify_commonui_button_style, apply_commonui_button_style, create_data_asset, modify_data_asset, create_input_action, modify_input_action, create_input_mapping_context, modify_input_mapping_context, create_data_table, modify_data_table, create_curve, modify_curve, create_curve_table, modify_curve_table, create_material_instance, modify_material_instance, create_material, set_material_settings, add_material_expression, connect_material_expressions, bind_material_property, create_material_function, create_user_defined_struct, create_user_defined_enum, create_blackboard, create_behavior_tree, create_state_tree, create_anim_sequence, create_anim_montage, create_blend_space, create_blueprint, import_assets, reimport_assets, import_textures, import_meshes

**polymorphic (16):**
modify_widget_animation, modify_material, modify_material_function, modify_widget_blueprint, modify_user_defined_struct, modify_user_defined_enum, modify_blackboard, modify_behavior_tree, modify_state_tree, modify_anim_sequence, modify_anim_montage, modify_blend_space, modify_blueprint_members, modify_blueprint_graphs

**custom (17):**
capture_widget_preview, capture_widget_motion_checkpoints, compare_capture_to_reference, compare_motion_capture_bundle, get_project_automation_context, wait_for_editor, run_automation_tests, get_automation_test_run, list_automation_test_runs, compile_project_code, trigger_live_coding, restart_editor, sync_project_code, apply_window_ui_changes

### OutputSchema Distribution

| Schema Type | Count | Tools |
|------------|-------|-------|
| default (v2ToolResultSchema) | 77 | Most tools |
| CascadeResultSchema | 1 | extract_cascade |
| ExtractWidgetAnimationResultSchema | 1 | extract_widget_animation |
| CreateModifyWidgetAnimationResultSchema | 2 | create_widget_animation, modify_widget_animation |
| CaptureResultSchema | 1 | capture_widget_preview |
| MotionCaptureBundleResultSchema | 1 | capture_widget_motion_checkpoints |
| CompareCaptureResultSchema | 1 | compare_capture_to_reference |
| ListCapturesResultSchema | 1 | list_captures |
| CleanupCapturesResultSchema | 1 | cleanup_captures |
| CompareMotionCaptureBundleResultSchema | 1 | compare_motion_capture_bundle |
| automationRunSchema | 2 | run_automation_tests, get_automation_test_run |
| AutomationRunListSchema | 1 | list_automation_test_runs |
| applyWindowUiChangesResultSchema | 1 | apply_window_ui_changes |
| ImportJobSchema | 5 | import_assets, reimport_assets, get_import_job, import_textures, import_meshes |
| ImportJobListSchema | 1 | list_import_jobs |

### Top 10 Most Expensive Tools by Token Count

| Rank | Tool | Est. Tokens | Params | Pattern |
|------|------|-------------|--------|---------|
| 1 | extract_blueprint | 487 | 5 | simple-extract |
| 2 | apply_window_ui_changes | 405 | 12 | custom |
| 3 | sync_project_code | 366 | 15 | custom |
| 4 | modify_widget_blueprint | 364 | 21 | polymorphic |
| 5 | extract_cascade | 272 | 4 | simple-extract |
| 6 | search_assets | 264 | 3 | simple-extract |
| 7 | capture_widget_motion_checkpoints | 253 | 12 | custom |
| 8 | modify_blueprint_members | 251 | 4 | polymorphic |
| 9 | modify_material_instance | 226 | 11 | crud |
| 10 | modify_state_tree | 218 | 4 | polymorphic |

These top 10 tools account for ~3,306 tokens (25.9% of total), while the remaining 87 tools account for ~9,447 tokens.

### Annotation Distribution

| Annotation | Count | Tools (summary) |
|-----------|-------|-----------------|
| readOnlyHint: true | 32 | All extract_*, search_*, list_*, capture_*, compare_*, wait_for_editor, get_project_automation_context, get_automation_test_run, list_automation_test_runs, save_assets, get_import_job, list_import_jobs |
| destructiveHint: true | 5 | build_widget_tree, modify_widget_blueprint, cleanup_captures, modify_behavior_tree, modify_state_tree |
| idempotentHint: true | 34 | All extract_*, search_*, list_*, compile_*, wait_for_editor, get_project_automation_context, some crud tools with replace semantics |

### Subsystem Function Coverage

Total unique subsystem functions called: **53**

| Subsystem Function | Tool(s) Using It |
|-------------------|------------------|
| ExtractBlueprint | extract_blueprint, extract_commonui_button_style |
| ExtractStateTree | extract_statetree |
| ExtractDataAsset | extract_dataasset |
| ExtractDataTable | extract_datatable |
| ExtractBehaviorTree | extract_behavior_tree |
| ExtractBlackboard | extract_blackboard |
| ExtractUserDefinedStruct | extract_user_defined_struct |
| ExtractUserDefinedEnum | extract_user_defined_enum |
| ExtractCurve | extract_curve |
| ExtractCurveTable | extract_curvetable |
| ExtractMaterialInstance | extract_material_instance |
| ExtractMaterial | extract_material |
| ExtractMaterialFunction | extract_material_function |
| ExtractAnimSequence | extract_anim_sequence |
| ExtractAnimMontage | extract_anim_montage |
| ExtractBlendSpace | extract_blend_space |
| ExtractCascade | extract_cascade |
| SearchAssets | search_assets |
| ListAssets | list_assets |
| CreateWidgetBlueprint | create_widget_blueprint |
| ExtractWidgetBlueprint | extract_widget_blueprint |
| ExtractWidgetAnimation | extract_widget_animation |
| CreateWidgetAnimation | create_widget_animation |
| ModifyWidgetAnimation | modify_widget_animation |
| BuildWidgetTree | build_widget_tree, modify_widget_blueprint |
| ModifyWidget | modify_widget, apply_window_ui_changes |
| CompileWidgetBlueprint | compile_widget_blueprint, modify_widget_blueprint, apply_window_ui_changes |
| ModifyWidgetBlueprintStructure | apply_commonui_button_style, modify_widget_blueprint, apply_window_ui_changes |
| CaptureWidgetPreview | capture_widget_preview |
| CaptureWidgetMotionCheckpoints | capture_widget_motion_checkpoints |
| CompareCaptureToReference | compare_capture_to_reference, compare_motion_capture_bundle |
| ListCaptures | list_captures |
| CleanupCaptures | cleanup_captures |
| CreateDataAsset | create_data_asset |
| ModifyDataAsset | modify_data_asset |
| CreateInputAction | create_input_action |
| ModifyInputAction | modify_input_action |
| CreateInputMappingContext | create_input_mapping_context |
| ModifyInputMappingContext | modify_input_mapping_context |
| CreateDataTable | create_data_table |
| ModifyDataTable | modify_data_table |
| CreateCurve | create_curve |
| ModifyCurve | modify_curve |
| CreateCurveTable | create_curve_table |
| ModifyCurveTable | modify_curve_table |
| CreateMaterialInstance | create_material_instance |
| ModifyMaterialInstance | modify_material_instance |
| CreateMaterial | create_material |
| ModifyMaterial | set_material_settings, add_material_expression, connect_material_expressions, bind_material_property, modify_material |
| CreateMaterialFunction | create_material_function |
| ModifyMaterialFunction | modify_material_function |
| CompileMaterialAsset | compile_material_asset |
| CreateBlueprint | create_commonui_button_style, create_blueprint |
| ModifyBlueprintMembers | modify_commonui_button_style, modify_blueprint_members |
| ModifyBlueprintGraphs | modify_blueprint_graphs |
| SaveAssets | save_assets, apply_window_ui_changes, sync_project_code |
| TriggerLiveCoding | trigger_live_coding, sync_project_code, apply_window_ui_changes |
| RestartEditor | restart_editor, sync_project_code, apply_window_ui_changes |
| CreateUserDefinedStruct | create_user_defined_struct |
| ModifyUserDefinedStruct | modify_user_defined_struct |
| CreateUserDefinedEnum | create_user_defined_enum |
| ModifyUserDefinedEnum | modify_user_defined_enum |
| CreateBlackboard | create_blackboard |
| ModifyBlackboard | modify_blackboard |
| CreateBehaviorTree | create_behavior_tree |
| ModifyBehaviorTree | modify_behavior_tree |
| CreateStateTree | create_state_tree |
| ModifyStateTree | modify_state_tree |
| CreateAnimSequence | create_anim_sequence |
| ModifyAnimSequence | modify_anim_sequence |
| CreateAnimMontage | create_anim_montage |
| ModifyAnimMontage | modify_anim_montage |
| CreateBlendSpace | create_blend_space |
| ModifyBlendSpace | modify_blend_space |
| ImportAssets | import_assets |
| ReimportAssets | reimport_assets |
| GetImportJob | get_import_job |
| ListImportJobs | list_import_jobs |
| ImportTextures | import_textures |
| ImportMeshes | import_meshes |
| ImportFonts | apply_window_ui_changes |
| ApplyWidgetFonts | apply_window_ui_changes |

### Non-subsystem Tools (delegate to controllers or use internal logic)

| Tool | Delegation Target |
|------|-------------------|
| get_project_automation_context | getProjectAutomationContext() |
| wait_for_editor | client.checkConnection() polling |
| run_automation_tests | automationController.runAutomationTests() |
| get_automation_test_run | automationController.getAutomationTestRun() |
| list_automation_test_runs | automationController.listAutomationTestRuns() |
| compile_project_code | projectController.compileProjectCode() |
| sync_project_code | projectController + multiple subsystem calls |
| apply_window_ui_changes | Multi-step orchestration (multiple subsystem calls) |

---

## Token Cost Notes

- **Estimation method:** (name chars + description chars + all param name chars + all param description chars + output schema field names) / 4
- The default `v2ToolResultSchema` adds a small constant overhead (~30 tokens) per tool, not counted individually above.
- Custom output schemas (CascadeResultSchema, ImportJobSchema, etc.) add additional overhead per schema field; these are shared across tools referencing the same schema.
- Actual token cost also includes annotations and Zod schema metadata (enum values, min/max constraints, default markers), which add ~10-30% more tokens beyond the text-based estimate.
- A realistic all-tools-enabled token budget is approximately **15,000-18,000 tokens** including schema overhead, annotations, and Zod type metadata.
