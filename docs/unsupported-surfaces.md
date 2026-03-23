# Unsupported Surfaces

Blueprint Extractor v2 intentionally narrows a few public surfaces that caused drift or low-quality generations.

| Surface | v2 Status | Use Instead | Why |
|---|---|---|---|
| Generic `create_data_asset` / `modify_data_asset` for Enhanced Input asset classes | Rejected | `create_input_action`, `modify_input_action`, `create_input_mapping_context`, `modify_input_mapping_context` | Generic reflection was too ambiguous for `DefaultKeyMappings` and related Enhanced Input authoring |
| Legacy widget boolean aliases such as `bIsVariable` and `isVariable` | Not part of the public contract | `is_variable` | v2 exposes one canonical snake_case shape |
| `modify_material` as the default public material workflow | Supported, but secondary | `set_material_settings`, `add_material_expression`, `connect_material_expressions`, `bind_material_property` | Large batch payloads were harder for models to author and debug |
| Raw `UButton` background/style properties on `CommonButtonBase`-family widgets | Unsupported surface | `extract_commonui_button_style`, `create_commonui_button_style`, `modify_commonui_button_style`, `apply_commonui_button_style` | `UCommonButtonBase` is a wrapper surface, not a direct `UButton` authoring target |
| Arbitrary new widget-animation MovieScene track families | Intentionally bounded | `create_widget_animation`, `modify_widget_animation` on the supported track subset | The initial v2 motion contract is limited to stable widget-property tracks and structured checkpoint verification |
| Blind full-screen widget rewrites without inspecting owners | Discouraged | Follow the safe UI redesign workflow | The Nords failure case came from replacing screens without validating HUD, transition, and class-default wiring first |

## Notes

- `extract_dataasset` still works for Enhanced Input assets because extraction is reflection-safe.
- `modify_material` remains useful for advanced or less common graph edits that are not yet covered by the smaller v2 tools.
- Widget property errors now include the resolved class and nearby editable-property suggestions, but that does not change the unsupported status of internal CommonUI wrapper fields.
- `apply_commonui_button_style` writes the wrapper-managed `Style` class default on `CommonButtonBase` instead of tunneling into internal `UButton` state.
- Widget motion is no longer generic metadata-only in v2, but unsupported track families should still return a structured partial-implementation boundary instead of a silent partial write.
