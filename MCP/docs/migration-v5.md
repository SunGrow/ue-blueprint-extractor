# Migration Guide: Blueprint Extractor MCP v4.x to v5.0.0

## Breaking Changes Summary

v5.0.0 removes all `.passthrough()` from tool schemas. This means:
1. **Unknown fields are stripped** — only documented fields are accepted/returned
2. **StateTree property paths use string notation** — nested path objects are replaced with flat strings
3. **MaterialGraphOperation fields are typed** — each operation's fields are explicitly defined

## Schema Changes

### tool-inputs.ts (31 `.passthrough()` removed)

All input schemas now reject unknown fields. If you were passing undocumented fields, remove them.

#### StateTree Property Path Flattening

**Before (v4.x):**
```json
{
  "sourcePath": {
    "structId": "abc-123",
    "segments": [
      { "name": "Speed" },
      { "name": "Value" }
    ]
  },
  "targetPath": {
    "structId": "def-456",
    "segments": [
      { "name": "MaxSpeed" }
    ]
  }
}
```

**After (v5.0):**
```json
{
  "sourcePath": "abc-123:Speed.Value",
  "targetPath": "def-456:MaxSpeed"
}
```

**String format:** `"structGuid:PropertyName.SubProperty[ArrayIndex]"`

Array indices use bracket notation: `"abc-123:Items[2].Name"`

#### MaterialGraphOperationSchema

All 14 operation variants now have typed fields. The schema accepts optional fields for all operations:

| Field | Used by |
|-------|---------|
| `expression_class` | add_expression |
| `temp_id` | add_expression, connections |
| `expression_guid` | expression targeting |
| `properties` | set_expression_properties |
| `node_pos_x`, `node_pos_y` | move_expression, add_expression |
| `from_*`, `to_*` | connect/disconnect operations |
| `material_property` | connect/disconnect_material_property |
| `settings` | set_material_settings |
| `layer_stack` | set_layer_stack |

#### Import Schemas

`ImportItemCommonSchema`, `TextureImportOptionsSchema`, `MeshImportOptionsSchema`, and related schemas no longer accept extra fields. Use only documented fields.

#### Selector Schemas

All selector schemas (MaterialParameterSelector, StateTreeStateSelector, StateTreeEditorNodeSelector, StateTreeTransitionSelector, AnimationNotifySelector, BehaviorTreeNodeSelector, BlendParameter, BlendSpaceSample) are now strict.

### tool-results.ts (24 `.passthrough()` removed)

All result schemas now have fixed shapes. Response fields not defined in the schema are stripped.

Affected result schemas:
- `toolResultSchema` (base)
- `CascadeResultSchema`
- `ImportJobSchema`, `ImportJobListSchema`
- `ExtractWidgetAnimationResultSchema`
- `CreateModifyWidgetAnimationResultSchema`
- All verification/capture result schemas
- Automation run schemas
- Material/blueprint compilation result schemas

## Upgrade Steps

1. **Remove undocumented fields** from tool call payloads
2. **Convert nested property paths** to string notation for StateTree bindings
3. **Verify MaterialGraphOperation payloads** include only typed fields
4. **Update result parsing** if you relied on passthrough fields in responses

## Compatibility

- All existing tool names remain unchanged
- All documented fields remain unchanged
- Only undocumented/passthrough fields are affected
