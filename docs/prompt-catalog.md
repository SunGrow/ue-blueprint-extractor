# Prompt Catalog

Blueprint Extractor v2 ships prompt entries for repeatable MCP workflows. Prompts do not mutate assets by themselves; they give the model a safer plan before tool calls.

| Prompt | Inputs | Use When |
|---|---|---|
| `normalize_ui_design_input` | `design_goal`, `design_notes_text`, `reference_image_paths`, `html_reference_paths`, `design_spec_json` | Normalizing text, text+image, PNG/Figma, or HTML/CSS references into a shared `design_spec_json` before Unreal authoring |
| `design_menu_from_design_spec` | `widget_asset_path`, `design_spec_json`, `parent_class_path`, `existing_hud_asset_path`, `existing_transition_asset_path`, `compare_reference_paths` | Planning a high-fidelity menu build from a normalized design spec using only the existing MCP tools |
| `author_widget_motion_from_design_spec` | `widget_asset_path`, `animation_name`, `design_spec_json`, `compare_reference_paths` | Turning motion requirements from `design_spec_json` into concrete widget animation authoring steps on the supported v2 track subset |
| `plan_widget_motion_verification` | `widget_asset_path`, `animation_name`, `design_spec_json`, `automation_filter`, `compare_reference_paths` | Planning editor-preview or automation-backed motion verification as a checkpoint bundle |
| `design_menu_screen` | `widget_asset_path`, `design_goal` | Designing or refactoring a menu screen without blindly replacing the entire widget tree |
| `author_material_button_style` | `asset_path`, `visual_goal`, `design_spec_json` | Planning a button material pass with the composable v2 material tools and optional design tokens |
| `wire_hud_widget_classes` | `hud_asset_path`, `widget_class_path`, `class_default_property` | Wiring widget classes into HUD or controller class defaults |
| `debug_widget_compile_errors` | `widget_asset_path`, `compile_summary_json` | Turning widget compile output into a focused recovery plan |

## Prompt Intent

### `normalize_ui_design_input`

- Produces a compact `design_spec_json` that becomes the shared contract for menu authoring.
- Treats `text+image` and `png/figma` as first-class high-fidelity inputs.
- Treats `html/css` as a near-parity source when the caller extracts tokens and uses rendered reference frames instead of expecting direct DOM-to-UMG translation.
- Marks `text-only` outcomes as lower-confidence when no visual reference exists.
- Treats motion as optional but supports both `state_motion` and `cinematic_motion` in the spec.
- Pushes supported motion work toward `create_widget_animation`, `modify_widget_animation`, `capture_widget_motion_checkpoints`, and `compare_motion_capture_bundle`.
- Requires only unsupported track families or broader arbitrary timeline synthesis to be marked `deferred_to_v2`.

### `design_menu_from_design_spec`

- Starts from a normalized `design_spec_json` instead of raw prose-only design instructions.
- Keeps the workflow on existing tools: foundation assets, styles, material instances, widget patches, compile, capture, compare, save.
- Escalates motion work to `create_widget_animation` and `modify_widget_animation` when the design spec requires authored timelines.
- Pushes the model toward reusable assets under `/Game/UI/Foundation/*` and screen assembly under `/Game/UI/Screens`.
- Requires motion verification to use checkpoint bundles such as `open`, `focused`, and `pressed`.
- Requires `compare_capture_to_reference` or `compare_motion_capture_bundle` when reference frames exist, otherwise requires `capture_widget_preview` or `capture_widget_motion_checkpoints` plus lower-confidence or partial verification language.
- Requires only unsupported `WidgetAnimation` track families or broader arbitrary key synthesis to be reported as `partial implementation / deferred_to_v2`.

### `author_widget_motion_from_design_spec`

- Focuses on the dedicated widget animation authoring surface instead of overloading generic widget tree tools.
- Requires the caller to stay inside the supported v2 track subset: `render_opacity`, `render_transform_translation`, `render_transform_scale`, `render_transform_angle`, and `color_and_opacity`.
- Prefers `widget_path` selectors and `replace_timeline` payloads so motion authoring stays deterministic and diffable.
- Requires the flow to end with `capture_widget_motion_checkpoints` and checkpoint comparison when reference frames exist.

### `plan_widget_motion_verification`

- Separates menu/shell verification from HUD/runtime verification instead of treating them as one interchangeable lane.
- Prefers `editor_preview` for authored WidgetBlueprint playback and `automation_scenario` for runtime/HUD playback driven by `run_automation_tests`.
- Requires verification output to be a keyframe bundle, not a video capture.
- Uses `closed`, `opening_peak`, `open`, `focused`, and `pressed` as the default checkpoint vocabulary unless the design spec narrows or extends it.

### `design_menu_screen`

- Starts with extraction of the current widget and any owning HUD or transition assets.
- Acts as a compatibility prompt for smaller or less reference-driven redesigns.
- Points high-fidelity multimodal work toward `normalize_ui_design_input` first.
- Prefers pattern-driven, minimal edits over full rewrites.
- Reminds the model to compile after each structural pass.
- Requires the plan to end with `capture_widget_preview` or an explicit `partial verification` fallback when rendering is blocked.

### `author_material_button_style`

- Pushes the model toward `set_material_settings`, `add_material_expression`, `connect_material_expressions`, and `bind_material_property`.
- Accepts an optional `design_spec_json` so material states can inherit palette, spacing, and motion cues from the shared menu contract.
- Prefers material parameters and instances for hover, pressed, focused, and disabled states before escalating to authored widget timelines.
- Treats `modify_material` as a fallback, not the default.

### `wire_hud_widget_classes`

- Focuses on class-default wiring instead of editing large widget trees unnecessarily.
- Useful when menus fail because the HUD, controller, or shell widget still points at stale classes.

### `debug_widget_compile_errors`

- Turns compile output into a short triage sequence.
- Highlights likely `BindWidget`, abstract-class, and `ListView` entry-class issues before suggesting another patch.
- Treats `rootWidget=null` plus `widgetTreeStatus` / `widgetTreeError` as a degraded recovery signal instead of assuming extraction completely failed.
- Redirects CommonUI button-style failures away from raw `UButton` background/style fields and toward `extract_commonui_button_style`, `create_commonui_button_style`, `modify_commonui_button_style`, and `apply_commonui_button_style`.
- Reminds the caller to verify paired `bOverride_*` flags when override-coupled widget properties appear to ignore a patch.
- Keeps the flow open until a successful compile is followed by `capture_widget_preview` or explicit `partial verification`.
