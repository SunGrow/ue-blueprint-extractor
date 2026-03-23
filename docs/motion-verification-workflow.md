# Motion Verification Workflow

Motion verification in v2 uses keyframe bundles, not video capture.

## Primary Lanes

- `editor_preview`: use for menu shells and authored WidgetBlueprint motion.
- `automation_scenario`: use for HUD/runtime playback driven by `run_automation_tests`.

Do not imply that editor-preview verification proves runtime HUD behavior.

## Primary Tools

1. `capture_widget_motion_checkpoints`
2. `compare_motion_capture_bundle`
3. `compare_capture_to_reference`
4. `run_automation_tests`

## Canonical Checkpoints

Unless the project defines a narrower or wider set, use:

- `closed`
- `opening_peak`
- `open`
- `focused`
- `pressed`

## Verification Rules

- Verification output is a checkpoint bundle with named `verificationArtifacts`.
- Use `compare_motion_capture_bundle` when comparing one checkpoint bundle to another bundle or to a set of checkpoint reference frames.
- Use `compare_capture_to_reference` when a single checkpoint capture is enough.
- If an automation scenario cannot export named checkpoint artifacts yet, report partial verification explicitly.
- Compile/save alone is never accepted as motion verification.

## Recommended Flow

1. Build or update the motion with the widget animation tools.
2. Capture the required checkpoints with `capture_widget_motion_checkpoints`.
3. Compare the bundle against reference frames or another bundle.
4. Treat missing checkpoint exports, missing references, or unsupported runtime scenarios as partial verification instead of implicit success.
