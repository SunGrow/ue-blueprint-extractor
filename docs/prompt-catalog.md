# Prompt Catalog

Blueprint Extractor v2 ships prompt entries for repeatable MCP workflows. Prompts do not mutate assets by themselves; they give the model a safer plan before tool calls.

| Prompt | Inputs | Use When |
|---|---|---|
| `design_menu_screen` | `widget_asset_path`, `design_goal` | Designing or refactoring a menu screen without blindly replacing the entire widget tree |
| `author_material_button_style` | `asset_path`, `visual_goal` | Planning a button material pass with the composable v2 material tools |
| `wire_hud_widget_classes` | `hud_asset_path`, `widget_class_path`, `class_default_property` | Wiring widget classes into HUD or controller class defaults |
| `debug_widget_compile_errors` | `widget_asset_path`, `compile_summary_json` | Turning widget compile output into a focused recovery plan |

## Prompt Intent

### `design_menu_screen`

- Starts with extraction of the current widget and any owning HUD or transition assets.
- Prefers pattern-driven, minimal edits over full rewrites.
- Reminds the model to compile after each structural pass.

### `author_material_button_style`

- Pushes the model toward `set_material_settings`, `add_material_expression`, `connect_material_expressions`, and `bind_material_property`.
- Treats `modify_material` as a fallback, not the default.

### `wire_hud_widget_classes`

- Focuses on class-default wiring instead of editing large widget trees unnecessarily.
- Useful when menus fail because the HUD, controller, or shell widget still points at stale classes.

### `debug_widget_compile_errors`

- Turns compile output into a short triage sequence.
- Highlights likely `BindWidget`, abstract-class, and `ListView` entry-class issues before suggesting another patch.
