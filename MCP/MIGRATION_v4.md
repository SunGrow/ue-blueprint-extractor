# Migration Guide: Blueprint Extractor MCP v3 to v4

This guide covers all breaking changes, new features, and migration paths for upgrading from v3 to v4.

---

## Breaking Changes Summary

1. **Compact extraction is now the default** — all extraction tools return compact output unless `compact: false` is passed.
2. **Material function tools removed** — use the material tools with `asset_kind: "function"`.
3. **Import tools consolidated** — `import_textures`, `import_meshes`, `reimport_assets` replaced by `import_assets`.
4. **`modify_widget_blueprint` replaced** — 10 operation-specific widget tools replace the monolithic tool.
5. **Workflow-scoped tool surfaces** — only ~19 core tools are visible by default; activate scopes to access specialized tools.

All removed tools have backward-compatible aliases that will be removed in v4.x+1.

---

## 1. Compact Extraction Default

Seven extraction tools now default to `compact: true`:

- `extract_blueprint`
- `extract_asset`
- `extract_material`
- `extract_material_function` (alias)
- `extract_cascade`
- `extract_widget_blueprint`
- `extract_widget_animation`

### Migration

No action required if compact output is acceptable. To restore v3 verbose output:

```json
// v3 (implicit)
{ "asset_path": "/Game/MyBlueprint" }

// v4 — restore verbose
{ "asset_path": "/Game/MyBlueprint", "compact": false }
```

---

## 2. Material Function Tool Consolidation

`extract_material_function`, `create_material_function`, and `modify_material_function` are merged into their material counterparts using the `asset_kind` parameter.

### Before (v3)

```json
// Extract
{ "tool": "extract_material_function", "asset_path": "/Game/MF_Noise" }

// Create
{ "tool": "create_material_function", "asset_path": "/Game/MF_Noise", "description": "Noise helper" }

// Modify
{ "tool": "modify_material_function", "asset_path": "/Game/MF_Noise", "operations": [...] }
```

### After (v4)

```json
// Extract
{ "tool": "extract_material", "asset_path": "/Game/MF_Noise", "asset_kind": "function" }

// Create
{ "tool": "create_material", "asset_path": "/Game/MF_Noise", "asset_kind": "function", "description": "Noise helper" }

// Modify
{ "tool": "modify_material", "asset_path": "/Game/MF_Noise", "asset_kind": "function", "operations": [...] }
```

### Aliases (deprecated)

The old tool names still work and automatically map `asset_kind: "function"`. They will be removed in v4.x+1.

---

## 3. Import Tool Consolidation

`import_textures`, `import_meshes`, and `reimport_assets` are replaced by a single `import_assets` tool.

### Before (v3)

```json
// Import textures
{ "tool": "import_textures", "items": [{ "source_path": "C:/art/icon.png", "destination_path": "/Game/UI/T_Icon" }] }

// Import meshes
{ "tool": "import_meshes", "items": [{ "source_path": "C:/models/chair.fbx", "destination_path": "/Game/Meshes/SM_Chair" }] }

// Reimport
{ "tool": "reimport_assets", "asset_paths": ["/Game/UI/T_Icon"] }
```

### After (v4)

```json
// Import textures — use texture_options on each item
{ "tool": "import_assets", "items": [{ "source_path": "C:/art/icon.png", "destination_path": "/Game/UI/T_Icon", "texture_options": { "compression": "UserInterface2D" } }] }

// Import meshes — use mesh_options on each item
{ "tool": "import_assets", "items": [{ "source_path": "C:/models/chair.fbx", "destination_path": "/Game/Meshes/SM_Chair", "mesh_options": { "generate_lightmap_uvs": true } }] }

// Reimport — use reimport flag
{ "tool": "import_assets", "items": [{ "asset_path": "/Game/UI/T_Icon", "reimport": true }] }
```

### Aliases (deprecated)

`import_textures`, `import_meshes`, and `reimport_assets` still work and automatically map to `import_assets`. They will be removed in v4.x+1.

---

## 4. Widget Tool Flattening

The monolithic `modify_widget_blueprint` (18+ parameters, 10 operations) is replaced by 10 operation-specific tools:

| v3 operation | v4 tool |
|---|---|
| `modify_widget_blueprint` op: replace_tree | `replace_widget_tree` |
| `modify_widget_blueprint` op: patch | `patch_widget` |
| `modify_widget_blueprint` op: patch_class_defaults | `patch_widget_class_defaults` |
| `modify_widget_blueprint` op: insert_child | `insert_widget_child` |
| `modify_widget_blueprint` op: remove | `remove_widget` |
| `modify_widget_blueprint` op: move | `move_widget` |
| `modify_widget_blueprint` op: wrap | `wrap_widget` |
| `modify_widget_blueprint` op: replace_class | `replace_widget_class` |
| `modify_widget_blueprint` op: batch | `batch_widget_operations` |
| compile | `compile_widget` |

### Before (v3)

```json
{
  "tool": "modify_widget_blueprint",
  "asset_path": "/Game/UI/WBP_Menu",
  "operation": "patch",
  "widget_name": "StartButton",
  "properties": { "ToolTipText": "Start the game" }
}
```

### After (v4)

```json
{
  "tool": "patch_widget",
  "asset_path": "/Game/UI/WBP_Menu",
  "widget_name": "StartButton",
  "properties": { "ToolTipText": "Start the game" }
}
```

### Aliases (deprecated)

| Old name | Maps to |
|---|---|
| `modify_widget` | `patch_widget` |
| `build_widget_tree` | `replace_widget_tree` |
| `compile_widget_blueprint` | `compile_widget` |

These aliases will be removed in v4.x+1.

---

## 5. Workflow-Scoped Tool Surfaces

v4 introduces workflow-scoped tool visibility to reduce context overhead. By default, only ~19 core tools are visible. Specialized tools are grouped into 9 workflow scopes:

| Scope | Tools included |
|---|---|
| `widget_authoring` | Widget structure, verification, CommonUI, widget animation |
| `material_authoring` | Material create/modify, graph ops, instances |
| `blueprint_authoring` | Blueprint create/modify members/graphs |
| `schema_ai_authoring` | Structs, enums, behavior trees, state trees, blackboards |
| `animation_authoring` | Anim sequences, montages, blend spaces, widget animation, verification |
| `data_tables` | Data assets, input actions, tables, curves |
| `import` | import_assets, job tracking |
| `automation_testing` | Test execution and results |
| `verification` | Widget captures, comparisons |

### Activating a scope

```json
{ "tool": "activate_workflow_scope", "scope": "widget_authoring" }
```

Scopes can be activated additively (merging with currently active tools) or exclusively.

### Auto-activation

Scopes auto-activate when you invoke `get_tool_help` for a tool in that scope, or when certain prompts are invoked.

### Flat mode (opt out)

To disable scoping and see all tools at once (v3 behavior):

```json
{ "tool": "activate_workflow_scope", "mode": "flat" }
```

### Core tools (always visible)

`search_assets`, `extract_blueprint`, `extract_asset`, `extract_material`, `extract_cascade`, `extract_widget_blueprint`, `extract_widget_animation`, `extract_commonui_button_style`, `list_assets`, `find_and_extract`, `save_assets`, `get_tool_help`, `wait_for_editor`, `activate_workflow_scope`, `get_project_automation_context`, `compile_project_code`, `trigger_live_coding`, `restart_editor`, `sync_project_code`

---

## 6. New Tools

### `find_and_extract`

Composite tool that combines `search_assets` + extraction in a single call. Reduces round-trips when you know the search criteria and extraction type.

```json
{
  "tool": "find_and_extract",
  "search_query": "MainMenu",
  "class_filter": "WidgetBlueprint",
  "extract_type": "widget_blueprint",
  "compact": true
}
```

### `activate_workflow_scope`

Manually activate a workflow scope to load tool families. See section 5.

---

## 7. Inline Examples

Nine complex tools now include embedded input examples directly in their descriptions. Call `get_tool_help` for full operation-specific guidance on any tool.

---

## Deprecation Timeline

All aliases listed above are available in v4.0.0 for backward compatibility. They will be **removed in the next minor version** (v4.x+1). Update your tool calls to use the new names before then.
