# Widget Motion Authoring

Widget motion is a first-class v2 authoring surface. Use the dedicated widget animation tools instead of trying to hide timeline work inside generic widget-tree patches.

## Primary Tools

1. `extract_widget_animation`
2. `create_widget_animation`
3. `modify_widget_animation`
4. `capture_widget_motion_checkpoints`
5. `compare_motion_capture_bundle`

`extract_widget_blueprint.animations` remains the shallow inventory surface. Use `extract_widget_animation` when you need binding targets, checkpoints, playback metadata, or authored keys.

## Supported Track Subset

The initial v2 release supports only these widget-property tracks:

- `render_opacity`
- `render_transform_translation`
- `render_transform_scale`
- `render_transform_angle`
- `color_and_opacity`

Anything outside that subset should return a structured `deferred_to_v2` or partial-implementation boundary instead of a silent partial write.

## Authoring Rules

- Use `widget_path` as the canonical selector for animation bindings and track targets.
- Use `widget_name` only as a compatibility fallback when the target widget is unique.
- Prefer `replace_timeline` as the default mutation path.
- Use `patch_metadata` only for display labels, checkpoints, playback metadata, and similar non-track updates.
- Persist checkpoints as named frames so verification can reuse them directly.
- Keep motion data in `design_spec_json.motion` when the work starts from multimodal design intake.

## Recommended Flow

1. Inspect the current screen with `extract_widget_blueprint`.
2. Inspect or create the target animation with `extract_widget_animation` / `create_widget_animation`.
3. Apply timeline changes with `modify_widget_animation`.
4. Compile.
5. Capture checkpoints with `capture_widget_motion_checkpoints`.
6. Compare checkpoints with `compare_motion_capture_bundle` or `compare_capture_to_reference`.
7. Save only after verification or an explicit partial-verification statement.
