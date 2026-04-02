# Changelog

All notable changes to the Blueprint Extractor MCP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.0.5] - 2026-04-01

### Fixed

- Fixed FGameplayTagContainer (and other struct types) not being applied when passed as UE export-text strings in `nodeProperties`. The string value was silently treated as an empty JSON object due to UE's `FJsonValueString::AsObject()` returning a non-null empty object, causing `FJsonObjectConverter::JsonObjectToUStruct` to reset the struct to default.
- Fixed `patch_state` not recognizing flat `propertyBindings` arrays in the payload. Bindings provided at the payload root (matching `set_bindings`/`add_binding` format) were silently ignored because `PatchState` only checked the nested `bindings.propertyBindings` path. Both formats are now accepted.
- Added string binding path normalization for the flat `propertyBindings` format, consistent with the nested `bindings.propertyBindings` normalization.

## [7.0.6] - 2026-04-02

### Added

- Added OpenCode install scripts for both shell and PowerShell environments to simplify MCP registration from the repository checkout.

### Changed

- Updated the repository and package READMEs to document OpenCode setup alongside Claude Code and Codex, and switched manual registration examples to `@latest`.
- Added explicit git line-ending attributes so mixed Windows/Linux workflows stop producing repository-wide newline churn.
- Tightened the shared property-path input schema to reject undeclared keys and keep the schema-budget contract green.

## [6.0.6] - 2026-03-30

### Added

- Added `reparent` support to `modify_blueprint_members`, including `parentClassPath` as the documented payload field and `parent_class_path` as a supported alias.

### Fixed

- Validated Blueprint reparent targets against UE editor rules before mutation and compiled reparented Blueprints with the required reinstancing flags.
- Hardened `validate_only` reparenting to avoid duplicate-preview crashes during skeleton/CDO recreation while keeping the asset unchanged.
- Extended MCP docs, tool-help output, and regression coverage for the new Blueprint member reparent flow.

## [6.0.3] - 2026-03-26

### Fixed

- Updated the packaged MCP README to document the current structured-result contract without reintroducing legacy migration guidance.
- Aligned the tarball smoke test with the new README shape and restored the explicit `structuredContent` contract wording it validates.
- Hardened the stdio and live integration tests to parse normalized MCP results from `structuredContent` before falling back to text JSON.

## [6.0.2] - 2026-03-26

### Fixed

- Treated Windows drive-letter paths such as `C:/Proj/Source/MyActor.h` as already-absolute in `sync_project_code`, preventing Linux/CI runners from re-resolving them under the repository workspace.

## [6.0.1] - 2026-03-26

### Fixed

- Restored stdio contract validation for `search_assets`, `list_assets`, and `check_asset_exists` by publishing explicit output schemas for the asset-discovery results.
- Made the default MCP output schema accept tool-specific payload fields while preserving the shared result envelope, preventing stdio-only validation failures on generic tool outputs.
- Updated import-job result schemas to inherit the shared execution and hint envelope returned by the normalizer.
- Normalized verification comparison aliases such as `normalizedRmse`, `mismatchPixels`, `capture`, and `reference` onto the public contract fields so motion-bundle comparisons validate cleanly.
- Hardened stdio regression coverage to assert the current `search_assets.results` payload and compare `ModifyMaterial` payload JSON structurally instead of by serializer key order.

## [4.0.0] - 2026-03-26

### Breaking

- **Compact extraction default**: `extract_blueprint`, `extract_asset`, `extract_material`, `extract_cascade`, `extract_widget_blueprint`, `extract_widget_animation` now default to `compact: true`. Pass `compact: false` to restore verbose output.
- **Widget tool flattening**: `modify_widget_blueprint` (18+ params, 10 ops) replaced by 10 operation-specific tools: `replace_widget_tree`, `patch_widget`, `patch_widget_class_defaults`, `insert_widget_child`, `remove_widget`, `move_widget`, `wrap_widget`, `replace_widget_class`, `batch_widget_operations`, `compile_widget`.
- **Workflow-scoped surfaces**: Only ~19 core tools are visible by default. Specialized tools require activating a workflow scope via `activate_workflow_scope`. Use `mode: "flat"` to restore v3 behavior.

### Added

- **`find_and_extract` composite tool**: Search + extract in one call, reducing round-trips for common workflows.
- **`activate_workflow_scope` tool**: Manually activate tool families (widget_authoring, material_authoring, blueprint_authoring, schema_ai_authoring, animation_authoring, data_tables, import, automation_testing, verification).
- **ToolSurfaceManager**: Controls tool visibility per workflow scope with ~60-70% reduction in default tool surface.
- **Inline examples**: 9 complex tools now embed input examples directly in their descriptions.
- **`asset_kind` parameter**: `extract_material`, `create_material`, `modify_material` accept `asset_kind: "function"` to operate on MaterialFunctions.

### Changed

- **Material function tools consolidated**: `extract_material_function` / `create_material_function` / `modify_material_function` merged into `extract_material` / `create_material` / `modify_material` with `asset_kind: "function"`.
- **Import tools consolidated**: `import_textures` / `import_meshes` / `reimport_assets` merged into `import_assets` with per-item `texture_options`, `mesh_options`, or `reimport: true`.
- **Server instructions**: Updated for v4 workflow scopes, `find_and_extract` guidance, and deferred tool directory.

### Deprecated

- `modify_widget` — use `patch_widget`
- `build_widget_tree` — use `replace_widget_tree`
- `compile_widget_blueprint` — use `compile_widget`
- `import_textures` — use `import_assets` with `texture_options`
- `import_meshes` — use `import_assets` with `mesh_options`
- `reimport_assets` — use `import_assets` with `reimport: true`
- `extract_material_function` — use `extract_material` with `asset_kind: "function"`
- `create_material_function` — use `create_material` with `asset_kind: "function"`
- `modify_material_function` — use `modify_material` with `asset_kind: "function"`

All deprecated aliases will be removed in v4.x+1.

## [3.4.0] - 2026-03-26

### Added

- Alias registration helper for backward-compatible tool renames.
- Inline example embedding infrastructure for tool descriptions.
- Composite tool pattern utilities (`safeCall`, `compositeSuccess`, etc.).

## [3.3.0] - 2026-03-25

### Added

- Property-path bindings for widget and blueprint authoring.
- Safe step orchestrator for composite operations.
- `force_kill` option for `restart_editor`.
- `compilationSucceeded` field to distinguish DLL lock from compilation errors.
- Improved `create_state_tree` diagnostics for complex payloads.
