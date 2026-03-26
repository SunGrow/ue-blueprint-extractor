# Changelog

All notable changes to the Blueprint Extractor MCP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
