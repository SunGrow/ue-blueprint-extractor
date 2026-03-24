# MCP Tool Consolidation Map

**Generated:** 2026-03-23
**Source:** `MCP/src/index.ts` (9340 lines, 97 tools)
**Status:** Historical research snapshot. The underlying recommendation is now implemented in-repo: Phase 2 hard-break consolidation shipped in `v3.0.0`, and the current public tool count is **83**.

---

## 1. Executive Summary

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Tool count | 97 | 82 | -15 |
| Estimated token cost | ~12,750 | ~11,310 | ~-1,440 (~11%) |

Four consolidation groups were evaluated against actual source code. Two are recommended (simple extracts, material composable). Two are rejected after code analysis (CRUD pairs, import tools) due to parameter heterogeneity that would make consolidated tools more expensive than the originals.

Implementation note: the live repository later added one more public tool during non-breaking work, so the shipped `v3.0.0` contract lands at **83 tools**, not 82, even though this baseline research used 97 as the starting point.

---

## 2. Consolidation Group A: Simple Extract Tools

### Status: RECOMMENDED

### Current Tools (13)

| Tool | Subsystem Function | Extra Params | Handler Pattern | Edge Cases |
|------|--------------------|-------------|-----------------|------------|
| `extract_statetree` | `ExtractStateTree` | none | old-style: `client.callSubsystem` + `JSON.parse` + error check | none |
| `extract_dataasset` | `ExtractDataAsset` | none | old-style | none |
| `extract_datatable` | `ExtractDataTable` | none | old-style | **truncation at 200KB** |
| `extract_behavior_tree` | `ExtractBehaviorTree` | none | old-style | none |
| `extract_blackboard` | `ExtractBlackboard` | none | old-style | none |
| `extract_user_defined_struct` | `ExtractUserDefinedStruct` | none | old-style | none |
| `extract_user_defined_enum` | `ExtractUserDefinedEnum` | none | old-style | none |
| `extract_curve` | `ExtractCurve` | none | old-style | none |
| `extract_curvetable` | `ExtractCurveTable` | none | old-style | none |
| `extract_material_instance` | `ExtractMaterialInstance` | none | **new-style**: `callSubsystemJson` + `jsonToolSuccess` | none |
| `extract_anim_sequence` | `ExtractAnimSequence` | none | old-style | none |
| `extract_anim_montage` | `ExtractAnimMontage` | none | old-style | none |
| `extract_blend_space` | `ExtractBlendSpace` | none | old-style | none |

### Analysis

All 13 tools share an identical contract:
- **Input:** `asset_path: string` (only parameter)
- **Handler logic:** Call `ExtractXxx(AssetPath)` -> `JSON.parse` -> error check -> return JSON
- **Annotations:** All `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`
- **Minor variance:** `extract_datatable` has 200KB truncation with warning message. `extract_material_instance` uses the newer `callSubsystemJson`/`jsonToolSuccess` helpers (functionally equivalent, just cleaner error handling).

### Consolidated Tool: `extract_asset`

```
Name: extract_asset
Parameters:
  - asset_type: enum (required)
      "statetree" | "data_asset" | "data_table" | "behavior_tree" |
      "blackboard" | "user_defined_struct" | "user_defined_enum" |
      "curve" | "curve_table" | "material_instance" |
      "anim_sequence" | "anim_montage" | "blend_space"
  - asset_path: string (required)
Annotations: readOnlyHint=true, destructiveHint=false, idempotentHint=true
```

### Routing Table

| `asset_type` value | Subsystem Function |
|---------------------|-------------------|
| `statetree` | `ExtractStateTree` |
| `data_asset` | `ExtractDataAsset` |
| `data_table` | `ExtractDataTable` |
| `behavior_tree` | `ExtractBehaviorTree` |
| `blackboard` | `ExtractBlackboard` |
| `user_defined_struct` | `ExtractUserDefinedStruct` |
| `user_defined_enum` | `ExtractUserDefinedEnum` |
| `curve` | `ExtractCurve` |
| `curve_table` | `ExtractCurveTable` |
| `material_instance` | `ExtractMaterialInstance` |
| `anim_sequence` | `ExtractAnimSequence` |
| `anim_montage` | `ExtractAnimMontage` |
| `blend_space` | `ExtractBlendSpace` |

### Edge Cases

1. **DataTable truncation:** The `data_table` path must retain the 200KB truncation warning. The consolidated handler includes a post-call branch: `if (asset_type === 'data_table' && text.length > 200_000)`.
2. **Handler style normalization:** All paths should use `callSubsystemJson` + `jsonToolSuccess` (the new-style pattern) for consistency. The old-style tools differ only in error-handling shape (manual JSON.parse + if-parsed.error vs thrown Error), and the new style is strictly better.
3. **Description text:** Each asset type has a unique description with class_filter hints and return-value notes. The consolidated tool needs a single description that references the `asset_type` enum values and a brief note per type. This is a net token reduction because the per-tool boilerplate (annotations block, inputSchema framework, handler preamble) is eliminated 12 times.

### Token Impact

- **Removed:** 12 tools x ~100 tokens/tool (description + schema + annotations) = ~1,200 tokens saved
- **Added:** ~80 tokens for the enum parameter + expanded description
- **Net:** ~-1,120 tokens

### Tools Removed: 12

`extract_statetree`, `extract_dataasset`, `extract_datatable`, `extract_behavior_tree`, `extract_blackboard`, `extract_user_defined_struct`, `extract_user_defined_enum`, `extract_curve`, `extract_curvetable`, `extract_material_instance`, `extract_anim_sequence`, `extract_anim_montage`, `extract_blend_space`

### NOT Consolidated (excluded from this group)

- `extract_blueprint` -- has 5 unique parameters (scope, compact, graph_filter, include_class_defaults, asset_path) and unique truncation logic
- `extract_widget_blueprint` -- has include_class_defaults parameter, uses callSubsystemJson
- `extract_widget_animation` -- has animation_name parameter
- `extract_material` -- has verbose parameter
- `extract_material_function` -- has verbose parameter
- `extract_cascade` -- multi-asset, has scope/max_depth/graph_filter
- `extract_commonui_button_style` -- post-processing via extractCommonUIButtonStyle

---

## 3. Consolidation Group B: Material Composable Tools

### Status: RECOMMENDED

### Current Tools (4)

| Tool | Subsystem Function | Operation in payload | Unique params |
|------|-------------------|---------------------|--------------|
| `set_material_settings` | `ModifyMaterial` | `set_material_settings` | `settings` |
| `add_material_expression` | `ModifyMaterial` | `add_expression` | `expression_class`, `expression_name`, `expression_properties`, `node_position` |
| `connect_material_expressions` | `ModifyMaterial` | `connect_expressions` | `MaterialConnectionSelectorFieldsSchema` fields |
| `bind_material_property` | `ModifyMaterial` | `connect_material_property` | `from_expression_guid`, `from_temp_id`, `from_output_name`, `from_output_index`, `material_property` |

### Analysis

All four tools call the **same** subsystem function (`ModifyMaterial`) with the same wire format: `{ AssetPath, PayloadJson: { operations: [{ operation: <op>, ...fields }] }, bValidateOnly }`. Each tool differs only in:
1. The `operation` string it injects
2. The type-specific fields it maps into the operation object

The `add_material_expression` handler has modest field-remapping logic (expression_name -> temp_id, node_position.x -> node_pos_x).

### Consolidated Tool: `material_graph_operation`

```
Name: material_graph_operation
Parameters:
  - asset_path: string (required)
  - operation: enum (required)
      "set_material_settings" | "add_expression" | "connect_expressions" | "connect_material_property"
  - settings: object (optional, for set_material_settings)
  - expression_class: string (optional, for add_expression)
  - expression_name: string (optional, for add_expression)
  - expression_properties: object (optional, for add_expression)
  - node_position: { x: number, y: number } (optional, for add_expression)
  - from_expression_guid: string (optional, for connect/bind)
  - from_temp_id: string (optional, for connect/bind)
  - from_output_name: string (optional, for connect/bind)
  - from_output_index: number (optional, for connect/bind)
  - to_expression_guid: string (optional, for connect)
  - to_temp_id: string (optional, for connect)
  - to_input_name: string (optional, for connect)
  - to_input_index: number (optional, for connect)
  - material_property: string (optional, for connect_material_property)
  - validate_only: boolean (default false)
Annotations: readOnlyHint=false, destructiveHint=false, idempotentHint=false
```

### Routing Logic

All operations route to `ModifyMaterial` with `PayloadJson.operations[0].operation` set by the enum. The handler maps the flat tool params into the operation object, then calls `callSubsystemJson('ModifyMaterial', ...)`.

### Edge Cases

1. **`add_material_expression` field remapping:** `expression_name` -> `temp_id`, `node_position.x` -> `node_pos_x`, `node_position.y` -> `node_pos_y`, `expression_properties` -> `properties`. This remapping must be preserved in the handler switch.
2. **`set_material_settings` double-nests settings:** The current handler puts `settings` both at `payload.settings` and inside `operations[0].settings`. This quirk must be preserved.
3. **`connect_material_expressions` uses spread of MaterialConnectionSelectorFieldsSchema:** The current tool spreads the schema fields into the top-level inputSchema. The consolidated tool lists them as individual optional params.
4. **`modify_material` stays separate:** It is the "advanced escape hatch" with full batch-operations array + settings + compile_after + layout_after. It should NOT be folded in.

### Token Impact

- **Removed:** 3 tools x ~150 tokens/tool = ~450 tokens
- **Added:** ~130 tokens for operation enum + union params description
- **Net:** ~-320 tokens

### Tools Removed: 3

`set_material_settings`, `add_material_expression`, `connect_material_expressions`, `bind_material_property` -> consolidated into `material_graph_operation`

(The first three are removed; `bind_material_property` is the fourth. Total removals = 3 since the consolidated tool replaces all 4.)

---

## 4. Consolidation Group C: Create/Modify CRUD Pairs (PayloadJson pattern)

### Status: REJECTED

### Analysis

The original proposal suggested consolidating 8 create/modify pairs (user_defined_struct, user_defined_enum, blackboard, behavior_tree, state_tree, anim_sequence, anim_montage, blend_space) into a single `author_asset` tool with `action` + `asset_type` routing.

After code review, this is **not viable** because:

1. **Schema heterogeneity:** Each pair has deeply different `payload` and `operation` schemas:
   - `modify_user_defined_struct` uses `UserDefinedStructMutationOperationSchema` with field-level operations (replace_fields, patch_field, rename_field, remove_field, reorder_fields)
   - `modify_behavior_tree` uses `BehaviorTreeMutationOperationSchema` with subtree operations (replace_tree, patch_node, patch_attachment, set_blackboard)
   - `modify_state_tree` uses `StateTreeMutationOperationSchema` with state/editor-node/transition selectors (replace_tree, patch_state, patch_editor_node, patch_transition, set_schema)
   - `modify_anim_sequence` uses `AnimSequenceMutationOperationSchema` with notify/sync-marker operations (replace_notifies, patch_notify, replace_sync_markers, replace_curve_metadata)
   - `modify_blend_space` uses `BlendSpaceMutationOperationSchema` with sample operations (replace_samples, patch_sample, set_axes)

2. **Each modify tool has a different operation enum** with completely different values. A consolidated `operation` enum would need to be the union of all per-type enums, making the tool description larger than the sum of the parts.

3. **Create tools also differ:** `create_anim_montage` has `sourceAnimation/skeleton` fields, `create_blend_space` has `is1D/axisX/axisY/samples`, `create_state_tree` has `schema/states/evaluators/globalTasks`. A single `payload` type erases all this type safety.

4. **Token math is negative:** The consolidated tool's description + superset schema would be more tokens than the individual tools, because each individual tool has tightly scoped param descriptions that LLMs can match quickly.

### Also excluded from this group

- `create_data_asset` / `modify_data_asset` -- different params (asset_class_path, properties) than the PayloadJson pattern
- `create_data_table` / `modify_data_table` -- different params (row_struct_path, rows, delete_rows, replace_rows)
- `create_curve` / `modify_curve` -- different params (curve_type, channels, delete_keys, upsert_keys)
- `create_curve_table` / `modify_curve_table` -- different params (curve_table_mode, rows, delete_rows, replace_rows)

These use heterogeneous subsystem parameters and would be even worse to consolidate.

---

## 5. Consolidation Group D: Import Tools

### Status: REJECTED

### Current Tools (4)

| Tool | Subsystem Function | Unique Schema |
|------|--------------------|--------------|
| `import_assets` | `ImportAssets` | `ImportPayloadSchema` |
| `reimport_assets` | `ReimportAssets` | `ImportPayloadSchema` |
| `import_textures` | `ImportTextures` | `TextureImportPayloadSchema` |
| `import_meshes` | `ImportMeshes` | `MeshImportPayloadSchema` |

### Analysis

- `import_assets` and `reimport_assets` share `ImportPayloadSchema` but call different subsystem functions. They could be merged with a `mode: "import" | "reimport"` enum.
- `import_textures` and `import_meshes` use **different** payload schemas (`TextureImportPayloadSchema` vs `MeshImportPayloadSchema`) with type-specific options.
- Merging all 4 into one tool requires a union payload schema and the description must explain all 4 modes. Net token impact is near-zero or negative.
- All 4 are task-aware tools (in `taskAwareTools` set). Each needs its own task-awareness behavior preserved.

**Partial merge (import_assets + reimport_assets only):**
- Viable but saves only ~120 tokens (1 tool removed, minor enum overhead added).
- Low priority, modest risk.

---

## 6. Consolidation Group E: CommonUI Button Style Tools

### Status: REJECTED

### Current Tools (4)

| Tool | Logic |
|------|-------|
| `create_commonui_button_style` | `normalizeCommonUIButtonStyleInput` + calls `CreateBlueprint` + `extractCommonUIButtonStyle` post-processing |
| `extract_commonui_button_style` | Custom extraction with `extractCommonUIButtonStyle` post-processing |
| `modify_commonui_button_style` | `normalizeCommonUIButtonStyleInput` + calls `ModifyBlueprintMembers` + enrichment |
| `apply_commonui_button_style` | `buildGeneratedBlueprintClassPath` + class-defaults patching |

All 4 tools have unique handler logic beyond simple dispatch. The normalize/extract functions for CommonUI button styles are non-trivial (7 brush fields, 5 text style fields, 6 padding fields, single-material mapping). Consolidation would make the single tool's handler logic complex with no real token savings.

---

## 7. Additional Viable Micro-Consolidation

### Group F: import_assets + reimport_assets

**Status: OPTIONAL (low priority)**

Could merge into a single tool with `mode: "import" | "reimport"` parameter. Both share identical schema and handler shape, differing only in subsystem function name.

- **Saves:** ~120 tokens (1 tool removed)
- **Risk:** Very low

---

## 8. Final Consolidation Map

| Group | Current Tools | Consolidated Name | Tools Removed | Net Token Savings |
|-------|--------------|-------------------|---------------|-------------------|
| A: Simple Extracts | 13 extract_* | `extract_asset` | 12 | ~1,120 |
| B: Material Composable | 4 material tools | `material_graph_operation` | 3 | ~320 |
| C: CRUD Pairs | (rejected) | -- | 0 | 0 |
| D: Import Tools | (rejected) | -- | 0 | 0 |
| E: CommonUI | (rejected) | -- | 0 | 0 |
| **Totals** | | **2 new tools** | **15** | **~1,440** |

With optional Group F (import+reimport merge): 16 tools removed, ~1,560 tokens saved.

**Final tool count:** 97 - 15 + 2 = **84** (or 83 with Group F)

---

## 9. Detailed Parameter Merging Strategy

### extract_asset

```typescript
const assetTypeEnum = z.enum([
  'statetree', 'data_asset', 'data_table', 'behavior_tree',
  'blackboard', 'user_defined_struct', 'user_defined_enum',
  'curve', 'curve_table', 'material_instance',
  'anim_sequence', 'anim_montage', 'blend_space',
]);

const extractMethodMap: Record<z.infer<typeof assetTypeEnum>, string> = {
  statetree: 'ExtractStateTree',
  data_asset: 'ExtractDataAsset',
  data_table: 'ExtractDataTable',
  behavior_tree: 'ExtractBehaviorTree',
  blackboard: 'ExtractBlackboard',
  user_defined_struct: 'ExtractUserDefinedStruct',
  user_defined_enum: 'ExtractUserDefinedEnum',
  curve: 'ExtractCurve',
  curve_table: 'ExtractCurveTable',
  material_instance: 'ExtractMaterialInstance',
  anim_sequence: 'ExtractAnimSequence',
  anim_montage: 'ExtractAnimMontage',
  blend_space: 'ExtractBlendSpace',
};
```

Handler pseudocode:
```typescript
async ({ asset_type, asset_path }) => {
  try {
    const method = extractMethodMap[asset_type];
    const parsed = await callSubsystemJson(method, { AssetPath: asset_path });

    // data_table truncation edge case
    if (asset_type === 'data_table') {
      const text = JSON.stringify(parsed, null, 2);
      if (text.length > 200_000) {
        return {
          content: [{
            type: 'text',
            text: `Warning: Response is ${(text.length / 1024).toFixed(0)}KB...\n\n`
                + `${text.substring(0, 200_000)}...\n[TRUNCATED]`
          }]
        };
      }
    }

    return jsonToolSuccess(parsed);
  } catch (e) {
    return jsonToolError(e);
  }
}
```

### material_graph_operation

Handler pseudocode:
```typescript
async ({ asset_path, operation, validate_only, ...params }) => {
  let op: Record<string, unknown>;

  switch (operation) {
    case 'set_material_settings':
      op = { operation: 'set_material_settings', settings: params.settings };
      break;
    case 'add_expression':
      op = {
        operation: 'add_expression',
        expression_class: params.expression_class
      };
      if (params.expression_name) op.temp_id = params.expression_name;
      if (params.expression_properties) op.properties = params.expression_properties;
      if (params.node_position) {
        op.node_pos_x = params.node_position.x;
        op.node_pos_y = params.node_position.y;
      }
      break;
    case 'connect_expressions':
      op = { operation: 'connect_expressions', ...connectionFields(params) };
      break;
    case 'connect_material_property':
      op = { operation: 'connect_material_property', ...bindingFields(params) };
      break;
  }

  const payloadJson: Record<string, unknown> = { operations: [op] };
  // preserve double-nesting quirk for set_settings
  if (operation === 'set_settings') {
    payloadJson.settings = params.settings;
  }

  const parsed = await callSubsystemJson('ModifyMaterial', {
    AssetPath: asset_path,
    PayloadJson: JSON.stringify(payloadJson),
    bValidateOnly: validate_only,
  });
  return jsonToolSuccess(parsed);
}
```

---

## 10. Risk Assessment

### Group A (extract_asset) -- LOW RISK

| Risk | Mitigation |
|------|-----------|
| LLM must now know `asset_type` values | The enum is self-documenting; search_assets already returns class names that map 1:1 |
| DataTable truncation edge case | Preserved in handler with explicit branch |
| Server instructions reference individual `extract_*` tool names | Update `serverInstructions` and `exampleCatalog` references |
| Existing prompt catalog references `extract_dataasset`, `extract_datatable` | Update prompts to `extract_asset` with asset_type |

### Group B (material_graph_operation) -- LOW-MEDIUM RISK

| Risk | Mitigation |
|------|-----------|
| `set_material_settings` double-nesting quirk | Must be preserved exactly; add regression test |
| `add_material_expression` field remapping | Explicit mapping in switch case |
| LLM must discover operation values | Enum description + example catalog provide discoverability |
| `exampleCatalog.material` references individual tool names | Update 3 examples to use consolidated tool |
| Server instructions mention "composable material tools" by individual name | Update the instruction sentence |

### Both Groups -- GENERAL RISKS

| Risk | Mitigation |
|------|-----------|
| Breaking change for callers referencing old tool names | Semantic versioning bump (2.5.0 -> 3.0.0); keep old names as thin aliases during transition |
| Tool-level annotations consistency | All consolidated extract tools are readOnly; material ops are non-readOnly. Uniform within each group |
| Test suite expects individual tool names | Update test fixtures |

---

## 11. Migration Notes

### Renamed Tools

| Old Name | New Tool | New Parameters |
|----------|----------|---------------|
| `extract_statetree` | `extract_asset` | `asset_type: "statetree"` |
| `extract_dataasset` | `extract_asset` | `asset_type: "data_asset"` |
| `extract_datatable` | `extract_asset` | `asset_type: "data_table"` |
| `extract_behavior_tree` | `extract_asset` | `asset_type: "behavior_tree"` |
| `extract_blackboard` | `extract_asset` | `asset_type: "blackboard"` |
| `extract_user_defined_struct` | `extract_asset` | `asset_type: "user_defined_struct"` |
| `extract_user_defined_enum` | `extract_asset` | `asset_type: "user_defined_enum"` |
| `extract_curve` | `extract_asset` | `asset_type: "curve"` |
| `extract_curvetable` | `extract_asset` | `asset_type: "curve_table"` |
| `extract_material_instance` | `extract_asset` | `asset_type: "material_instance"` |
| `extract_anim_sequence` | `extract_asset` | `asset_type: "anim_sequence"` |
| `extract_anim_montage` | `extract_asset` | `asset_type: "anim_montage"` |
| `extract_blend_space` | `extract_asset` | `asset_type: "blend_space"` |
| `set_material_settings` | `material_graph_operation` | `operation: "set_material_settings"` |
| `add_material_expression` | `material_graph_operation` | `operation: "add_expression"` |
| `connect_material_expressions` | `material_graph_operation` | `operation: "connect_expressions"` |
| `bind_material_property` | `material_graph_operation` | `operation: "connect_material_property"` |

### Unchanged Tools (80)

All other tools remain as-is. Key tools that were evaluated but explicitly excluded:

- `extract_blueprint` -- unique 5-param signature with scope/compact/graph_filter
- `extract_widget_blueprint` -- has include_class_defaults
- `extract_material` / `extract_material_function` -- have verbose param
- `extract_cascade` -- multi-asset cascading extraction
- `extract_commonui_button_style` -- custom post-processing
- `modify_material` -- advanced escape hatch, stays separate
- All create/modify CRUD pairs -- schema heterogeneity prevents useful consolidation
- All import tools -- payload schema differences prevent useful consolidation
- All capture/verification tools -- unique output schemas and logic
- All project-control tools -- unique orchestration logic
- `apply_window_ui_changes` -- multi-step orchestration
- `modify_widget_blueprint` -- already polymorphic with 21 params
- `modify_blueprint_members` / `modify_blueprint_graphs` -- complex polymorphic

### Server Instructions Updates Required

1. Line containing `extract_dataasset, extract_datatable` (line ~2342 in serverInstructions) -- update to mention `extract_asset`
2. Line containing "composable material tools for settings, node creation, node connection, and root-property binding" (line ~32) -- update to mention `material_graph_operation`
3. Example catalog `material` section (lines 745-794) -- update tool references from `set_material_settings` / `add_material_expression` / `bind_material_property` to `material_graph_operation`

### Transition Strategy

This shipped as a direct hard break in `v3.0.0`:
1. Register the 2 new consolidated tools
2. Remove the 17 legacy tool names from the public contract
3. Update first-party prompts, resources, examples, and tests in the same change
4. Do not retain deprecated aliases

---

## 12. Token Savings Calculation

### Methodology

Each tool costs approximately:
- Tool name + title + annotations block: ~25 tokens
- Description text: ~40-80 tokens (varies by verbosity)
- inputSchema (parameter definitions): ~30-60 tokens
- **Average per simple-extract tool:** ~100 tokens
- **Average per material-composable tool:** ~150 tokens

### Before (97 tools)

Estimated total listing cost: ~12,750 tokens (weighted average ~131 tokens/tool)

### After (82 tools, with 2 new consolidated tools)

- Remove 13 extract tools: -1,300 tokens
- Add 1 `extract_asset` tool: +180 tokens (enum + description covering 13 types)
- Remove 4 material tools: -600 tokens
- Add 1 `material_graph_operation` tool: +280 tokens (enum + union params)
- **Net change:** -1,440 tokens
- **New total:** ~11,310 tokens

### Per-conversation savings

In a typical conversation the tool listing is sent once at context initialization. The savings of ~1,440 tokens per conversation compound across all sessions. For material-heavy workflows the reduction in listing overhead also slightly improves LLM attention to the remaining tools.

---

## 13. Implementation Priority

| Priority | Group | Effort | Savings | Risk |
|----------|-------|--------|---------|------|
| **P0** | A: extract_asset | Low (mechanical routing table) | ~1,120 tokens, -12 tools | Low |
| **P1** | B: material_graph_operation | Medium (field remapping quirks) | ~320 tokens, -3 tools | Low-Medium |
| **P2** | F: import+reimport merge | Low | ~120 tokens, -1 tool | Very Low |

---

## 14. Complete Tool Inventory (97 tools, grouped by fate)

### Consolidated into extract_asset (13 -> 1)

1. extract_statetree
2. extract_dataasset
3. extract_datatable
4. extract_behavior_tree
5. extract_blackboard
6. extract_user_defined_struct
7. extract_user_defined_enum
8. extract_curve
9. extract_curvetable
10. extract_material_instance
11. extract_anim_sequence
12. extract_anim_montage
13. extract_blend_space

### Consolidated into material_graph_operation (4 -> 1)

14. set_material_settings
15. add_material_expression
16. connect_material_expressions
17. bind_material_property

### Unchanged (80 tools)

18. extract_blueprint
19. extract_cascade
20. extract_widget_blueprint
21. extract_widget_animation
22. extract_material
23. extract_material_function
24. extract_commonui_button_style
25. search_assets
26. list_assets
27. create_widget_blueprint
28. create_widget_animation
29. modify_widget_animation
30. build_widget_tree
31. modify_widget
32. compile_widget_blueprint
33. create_commonui_button_style
34. modify_commonui_button_style
35. apply_commonui_button_style
36. capture_widget_preview
37. capture_widget_motion_checkpoints
38. compare_capture_to_reference
39. compare_motion_capture_bundle
40. list_captures
41. cleanup_captures
42. create_data_asset
43. modify_data_asset
44. create_input_action
45. modify_input_action
46. create_input_mapping_context
47. modify_input_mapping_context
48. create_data_table
49. modify_data_table
50. create_curve
51. modify_curve
52. create_curve_table
53. modify_curve_table
54. create_material_instance
55. modify_material_instance
56. create_material
57. modify_material
58. create_material_function
59. modify_material_function
60. compile_material_asset
61. modify_widget_blueprint
62. get_project_automation_context
63. wait_for_editor
64. run_automation_tests
65. get_automation_test_run
66. list_automation_test_runs
67. compile_project_code
68. trigger_live_coding
69. restart_editor
70. sync_project_code
71. apply_window_ui_changes
72. create_user_defined_struct
73. modify_user_defined_struct
74. create_user_defined_enum
75. modify_user_defined_enum
76. create_blackboard
77. modify_blackboard
78. create_behavior_tree
79. modify_behavior_tree
80. create_state_tree
81. modify_state_tree
82. create_anim_sequence
83. modify_anim_sequence
84. create_anim_montage
85. modify_anim_montage
86. create_blend_space
87. modify_blend_space
88. create_blueprint
89. modify_blueprint_members
90. modify_blueprint_graphs
91. save_assets
92. import_assets
93. reimport_assets
94. get_import_job
95. list_import_jobs
96. import_textures
97. import_meshes
