# Multimodal UI Design Workflow

Use this workflow when the goal is a high-fidelity `menu screen` instead of a generic text-only redesign.

## Input Priority

- `text+image` and `png/figma` are first-class visual references and should be treated the same way.
- `html/css` is a near-parity source when the caller extracts tokens and uses rendered reference frames instead of expecting direct DOM-to-UMG translation.
- `text-only` is still valid, but it should be treated as lower-confidence when no visual reference exists.

## Canonical Flow

1. Normalize the input into `design_spec_json` with `normalize_ui_design_input`.
2. Plan the Unreal-side implementation with `design_menu_from_design_spec`.
3. Inspect the current widget, HUD, transition widgets, and class defaults before replacing structure.
4. Author reusable foundation assets first:
   - `/Game/UI/Foundation/Materials`
   - `/Game/UI/Foundation/MaterialInstances`
   - `/Game/UI/Foundation/Styles`
   - `/Game/UI/Foundation/Widgets`
5. Assemble the final screen under `/Game/UI/Screens`.
6. If motion is part of the spec, author or patch timelines with `create_widget_animation` or `modify_widget_animation`.
7. Compile.
8. Capture required checkpoints with `capture_widget_preview` or `capture_widget_motion_checkpoints`.
9. If reference frames exist, run `compare_capture_to_reference` or `compare_motion_capture_bundle` before `save_assets`.
10. If no visual reference exists, still capture the result and report lower-confidence or partial verification explicitly.

## design_spec_json

The shared contract should include:

- `layout`
- `visual_tokens`
- `components`
- `motion` optional
- `verification` optional

Typical `layout` values should encode pattern, shell type, density, and safe-area assumptions.
Typical `visual_tokens` values should encode palette, typography, spacing, radius, stroke, glow/shadow, and texture refs.
Typical `components` values should describe recipes for buttons, panels, cards, list items, title bars, and modal shells.

## Motion Policy

Prefer:

- material-driven hover, pressed, focused, and disabled states
- style-state changes in CommonUI
- transform and opacity edits
- dedicated widget animations authored through the v2 motion tools when the design needs explicit timelines

When motion is important, verify it through static checkpoints instead of sequence capture:

- `closed`
- `opening_peak`
- `open`
- `focused`
- `pressed`

The supported initial v2 track subset is:

- `render_opacity`
- `render_transform_translation`
- `render_transform_scale`
- `render_transform_angle`
- `color_and_opacity`

If the requested motion depends on unsupported track families or broader arbitrary timeline synthesis, mark only that portion `deferred_to_v2` or `partial implementation`.
