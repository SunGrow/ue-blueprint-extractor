# Changelog

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
