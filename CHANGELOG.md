# Changelog

## 7.0.2
### Features
- **`patch_state` inline bindings** — `patch_state` now accepts a `bindings` field in the payload, allowing callers to create states, tasks (with pre-assigned `id` fields), and wire their property bindings in a single operation. Previously, bindings required a separate `add_binding` call after task creation, which was impossible because task IDs weren't known until creation.

### Bug fixes
- **`patch_editor_node` selector resolution** — fixed selector lookup failing when `editorNodeId` was provided via the `selector` sub-object alongside an `editorNode` payload. The selector was being parsed from the `editorNode` content instead of the original payload.
- **`patch_transition` selector resolution** — same fix: selector is now parsed from the original payload (or its `selector` sub-object), not from the `transition` content.

## 7.0.0 — Code-Over-JSON
LLMs are better at generating code than constructing large JSON payloads. This release redesigns how the MCP server exposes capabilities to exploit that strength — DSL inputs, compressed outputs, composite workflows, and intent-level tools.

### DSL-based authoring
- **Widget Tree DSL** — `replace_widget_tree` and `build_widget_tree` accept an indentation-based `dsl` string as an alternative to nested JSON. Supports class aliases (`text`, `button`, `vbox`), slot presets (`[anchor=center]`), dotted property paths (`Font.Size: 24`), and `[var]` attribute shorthand. ~60-70% input token reduction for typical widget trees.
- **Widget Diff DSL** — new `apply_widget_diff` tool accepts unified-diff-style DSL patches, computes minimal structural operations (remove/insert/patch), and executes them as a batch. Replaces manual operation planning.
- **Blueprint Graph DSL** — `modify_blueprint_graphs` accepts pseudocode-style graph descriptions (`Event BeginPlay -> GetPlayerController -> CastTo(APlayerController) as PC`) and converts them to `upsert_function_graphs` payloads with auto-generated node IDs and connections.
- **Material Graph DSL** — `modify_material` accepts a declarative DSL for material settings, parameter declarations, and expression wiring (`BaseColor <- Lerp(Color, Multiply(Color, 1.3), HoverAlpha)`), converting to batch operations with correct expression classes and pin connections.

### Intent-level composite tools
- **`create_menu_screen`** — one call to create a widget blueprint, build its tree from DSL, patch class defaults, compile, and save.
- **`apply_widget_patch`** — extract current widget state, apply a DSL diff, compile, and re-extract to return final state.
- **`create_material_setup`** — create a material with settings, apply graph operations, compile, and save.
- **`scaffold_blueprint`** — create a blueprint with variables and function stubs in one call.

### Markdown widget recipes
- **`execute_widget_recipe`** — accepts a markdown document describing the desired widget end state (asset path, parent class, widget tree DSL, class defaults, after-steps) and executes the full create-build-patch-compile-save pipeline.
- **`extract_widget_blueprint format: 'recipe'`** — extraction can output in recipe format, enabling extract → edit markdown → re-execute round-trips.

### Response compression
- **Slimmed response envelopes** — `execution` metadata only on task-aware tools; removed `_hints` and `next_steps` from all envelopes (~300-500 tokens saved per response).
- **Schema token budget** — trimmed `.describe()` strings across all 22 tool files; average description now under 100 characters (enforced by test).
- **Extraction enhancements** — `extract_widget_blueprint` gains `depth` (limit tree levels) and `fields` (select specific top-level keys) parameters. Compactor now strips null values and default widget properties (`bIsVariable: false`, `Visibility: Visible`, `RenderOpacity: 1.0`, `IsEnabled: true`).

### Presets and aliases
- **Slot presets** — `center`, `fill`, `top-left`, `top-right`, `bottom-left`, `bottom-right`, `top-stretch`, `bottom-stretch`, `left-stretch`, `right-stretch` resolve to full anchor/alignment configs.
- **Widget class aliases** — 21 short names (`button` → `CommonButtonBase`, `text` → `TextBlock`, `vbox` → `VerticalBox`, etc.) accepted in all widget tree inputs.
- **Property path shorthand** — dotted keys like `Font.Size: 24` auto-expand to nested objects in widget properties.

## 6.3.0
- **AnimGraph K2Node_VariableGet support** — `add_animgraph_nodes` now accepts `K2Node_VariableGet` with a `variableName` field, resolving inherited native properties via `SetFromField` with a manual `CreatePin` fallback when the skeleton class is not yet compiled.
- **Struct property field-by-field fallback** — `PropertySerializer` now falls back to recursive per-field application when `FJsonObjectConverter::JsonObjectToUStruct` fails, enabling partial property updates on complex structs like `FAnimNode_ModifyBone` (e.g. setting `BoneToModify`, `RotationMode`, `RotationSpace` individually).
- **AnimBlueprint validate_only crash fix** — `DuplicateObject<UBlueprint>` in both `Modify` and `ModifyGraphs` validate-only paths now uses `MakeUniqueObjectName` to prevent CDO class-mismatch crashes during `PostDuplicateBlueprint` compilation.

## 2.1.0
- **Material selector precision** — material graph writes now resolve source outputs and destination inputs by index or name, preserve explicit output-index wiring on expression and property connections, and validate conflicting selectors before mutating assets.
- **Widget class-default parity** — widget class-default patch flows now accept the canonical `classDefaults` payload shape while preserving `class_defaults` compatibility, and extraction hardens inherited generated-class default serialization.
- **Regression coverage** — added material output or input selector coverage, an Overlay slot round-trip canary, and refreshed MCP contract and live tests for the updated release surface.

## 2.0.0
- **Strict MCP v2 contract** — added server-level instructions, prompt catalog support, `outputSchema` on every public tool, schema-backed examples, and structured success/error envelopes with execution metadata.
- **Composable material workflow** — added `set_material_settings`, `add_material_expression`, `connect_material_expressions`, and `bind_material_property` so common material authoring no longer depends on one large batch payload.
- **Dedicated Enhanced Input authoring** — added `create_input_action`, `modify_input_action`, `create_input_mapping_context`, and `modify_input_mapping_context`, while generic DataAsset mutation now rejects Enhanced Input asset classes explicitly.
- **UI recovery guidance** — added unsupported-surface and UI-redesign resources, stronger widget compile recovery hints for `BindWidget`, abstract-class, and `ListView` entry-class failures, and safer prompt-led redesign flows.
- **Build and regression hardening** — fixed failed-create cleanup for DataAssets, declared the EnhancedInput plugin dependency, added contract validation for generated examples/prompts, and refreshed live MCP coverage for the new material and Enhanced Input flows.

## 1.14.1
- **Project-control hardening** — `compile_project_code` and `sync_project_code` now fall back to editor-derived project automation context before environment variables, and Windows batch builds are launched in a `cmd.exe`-safe way.
- **Contract alignment** — `trigger_live_coding` and `restart_editor` now match the current subsystem signatures while keeping the older MCP inputs as compatibility aliases with explicit diagnostics.
- **Widget path ergonomics** — widget create and extract responses now include additive `packagePath` and `objectPath`, and widget tools accept both path styles consistently.
- **Widget class resolution** — widget creation and structure edits now resolve project-defined widget parents by short loaded name, accept Blueprint widget asset paths, and normalize CanvasPanel slot aliases such as top-level `Anchors` and `Offsets`.
- **Blueprint graph authoring** — added `modify_blueprint_graphs` for rollback-safe targeted graph operations such as named function-graph upserts and appending calls into existing sequence-style initializer graphs.

## 1.13.0
- **Widget metadata parity** — `modify_widget` and `modify_widget_blueprint.patch_widget` now accept `is_variable` aliases for existing widgets, and `extract_widget_blueprint` can include Blueprint class defaults alongside widget and slot data.
- **Explicit widget defaults and fonts** — added widget-scoped `patch_class_defaults`, `import_fonts`, and `apply_widget_fonts` so UI polish flows can set class-default materials and runtime `UFont` assets without oversized reflected payloads.
- **Project code automation** — added project-control support for `compile_project_code`, `trigger_live_coding`, `restart_editor`, `sync_project_code`, and the thin `apply_window_ui_changes` helper workflow.
- **Automation coverage** — added UE automation for widget variable toggles, class-default patching, runtime font creation or application, plus MCP contract and project-controller coverage for the new code-sync surface.

## 1.12.0
- **Classic material graph support** — added `extract_material`, `create_material`, `modify_material`, `extract_material_function`, `create_material_function`, `modify_material_function`, and `compile_material_asset` for compact UMaterial and MaterialFunction-family authoring.
- **Shared material graph DSL** — material writes now use stable `expression_guid` selectors, batch-local `temp_id` references, material-property connections such as `MP_BaseColor`, and explicit compile/layout controls.
- **MaterialInstance parity** — expanded material-instance extraction and authoring with runtime virtual texture, sparse volume texture, font, parameter-metadata, and classic layer-stack support.
- **Cross-version hardening** — material automation now passes on UE 5.6 and 5.7, including the fixture-target BuildSettings update needed for 5.7 compatibility.

## 1.11.0
- **Widget authoring polish** — added `extract_widget_blueprint`, expanded `modify_widget_blueprint` with `insert_child`, `remove_widget`, `move_widget`, `wrap_widget`, `replace_widget_class`, and `batch`, and added `widget_path` support plus `validate_only` to the widget mutation flow.
- **MCP guidance split** — moved reusable authoring guidance into `blueprint://authoring-conventions`, `blueprint://selector-conventions`, `blueprint://widget-best-practices`, plus the `blueprint://examples/{family}` and `blueprint://widget-patterns/{pattern}` templates.
- **Compact success responses** — widget/save/import authoring responses now default to compact JSON text with full parsed data in `structuredContent`.
- **Broader canary coverage** — automation and MCP tests now cover compact widget extraction, structural widget mutations, resource templates, and a CommonUI parent canary.

## 1.10.0
- **Async import tools** — added `import_assets`, `reimport_assets`, `get_import_job`, `list_import_jobs`, `import_textures`, and `import_meshes`.
- **Editor-host import jobs** — imports and reimports now run as session-scoped async jobs inside the editor, with polling, per-item diagnostics, explicit-save semantics, local file support, and HTTP/HTTPS staging for remote sources.
- **Texture and mesh helpers** — texture imports expose typed overrides such as `srgb`, compression, LOD group, virtual texture streaming, and green-channel flip; mesh imports expose typed static or skeletal mesh options including skeleton selection, material or texture import, mesh combining, and collision generation.
- **Import capability docs and live coverage** — added `blueprint://import-capabilities`, expanded MCP contract and stdio tests for import polling, and added live-gated texture and mesh smoke coverage with local HTTP header-forwarding verification.

## 1.9.0
- **18 new authoring tools** — added `create_user_defined_struct`, `modify_user_defined_struct`, `create_user_defined_enum`, `modify_user_defined_enum`, `create_blackboard`, `modify_blackboard`, `create_behavior_tree`, `modify_behavior_tree`, `create_state_tree`, `modify_state_tree`, `create_anim_sequence`, `modify_anim_sequence`, `create_anim_montage`, `modify_anim_montage`, `create_blend_space`, `modify_blend_space`, `create_blueprint`, and `modify_blueprint_members`.
- **Stable writer selectors** — BehaviorTree writes now target `nodePath`, StateTree writes support `stateId`/`statePath`, `editorNodeId`, and `transitionId`, animation writes expose stable notify identifiers plus `sampleIndex`, and Blueprint/member/schema surfaces use explicit selector fields.
- **Feasible-family write coverage** — explicit-save authoring now spans schema assets, AI assets, StateTrees, animation metadata assets, Blueprint member authoring, and targeted Blueprint graph mutations while still deferring controller editing and live world mutation.
- **Shared write core** — added normalized mutation results, explicit `save_assets` persistence, validation-only write flows, and reusable reflected property patching for editor-side authoring.
- **Widget hardening** — widget tree replacement now preflights before destructive changes, widget/property writes use the shared mutation layer, and `modify_widget_blueprint` remains the higher-level alias for tree replacement, patching, and compile workflows.
- **New authoring families** — added `create_data_table`, `modify_data_table`, `create_curve`, `modify_curve`, `create_curve_table`, and `modify_curve_table`, alongside the already added `create_data_asset`, `modify_data_asset`, `create_material_instance`, and `modify_material_instance`.
- **Capability docs** — added `blueprint://write-capabilities` and updated MCP descriptions around explicit-save behavior and current write-capable asset families.

## 1.8.0
- **10 new extraction tools** — added `extract_behavior_tree`, `extract_blackboard`, `extract_user_defined_struct`, `extract_user_defined_enum`, `extract_curve`, `extract_curvetable`, `extract_material_instance`, `extract_anim_sequence`, `extract_anim_montage`, and `extract_blend_space`.
- **Schema 1.2.0** — final Phase 2 schema version for the expanded extractor surface.
- **Cascade hardening** — manifest-based cascade output with collision-proof filenames, per-asset status/error reporting, new supported asset types, and reference following for BehaviorTree, Blackboard, MaterialInstance, AnimMontage, and BlendSpace dependencies.
- **Search + compile upgrades** — `search_assets` now supports `max_results` with filtered AssetRegistry queries, and `compile_widget_blueprint` returns real compiler errors/warnings with counts.
- **Typed property serialization everywhere** — DataAssets, DataTables, component overrides, widget overrides, and new extractor families now emit typed JSON values instead of flattening everything to strings.

## 1.6.0
- **WidgetBlueprint support** — `extract_blueprint` now extracts the widget tree hierarchy for WidgetBlueprints at `Components` scope, including slot config, property overrides (CDO diff with typed JSON values), and property bindings.
- **Widget creation tools** — 4 new MCP tools: `create_widget_blueprint`, `build_widget_tree`, `modify_widget`, `compile_widget_blueprint`. Enables programmatic widget tree creation from Claude Code.
- **Compact mode for widget trees** — strips redundant `displayLabel`, default visibility, and empty properties.
- **Typed property extraction** — widget property overrides now serialize as proper JSON types (booleans, numbers, objects for structs/colors) instead of flat strings.

## 1.5.0
- WidgetTree extraction for WidgetBlueprints (widget hierarchy, slot info, properties).
- `list_assets` with folder browsing support.

## 1.4.1
- **Fix**: UHT compilation error — `UFUNCTION` declarations with `TArray<FName>` default parameters used brace-initialization (`= {}`), which UHT cannot parse. Replaced with non-UFUNCTION overloads that forward with an empty array.

## 1.4.0
- Graph filtering (`graph_filter`) and compact output mode (`compact`) for Blueprints and cascade extraction.
