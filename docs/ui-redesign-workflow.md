# Safe UI Redesign Workflow

Use this flow before replacing or heavily restructuring a screen:

1. Normalize raw text, image, PNG/Figma, or HTML/CSS input into `design_spec_json` when the redesign is fidelity-sensitive.
2. Inspect the current widget with `extract_widget_blueprint`.
3. Inspect the owning HUD, shell widget, or transition Blueprint with `extract_blueprint` at `Components` or `FunctionsShallow` scope.
4. Read the relevant widget pattern or prompt before editing:
   - `blueprint://widget-patterns/centered_overlay`
   - `blueprint://widget-patterns/common_menu_shell`
   - `normalize_ui_design_input`
   - `design_menu_from_design_spec`
   - `design_menu_screen`
5. Prefer the smallest patch that can solve the problem:
   - `patch_widget` for property and variable changes
   - `patch_widget`, `insert_widget_child`, `remove_widget`, `move_widget`, `wrap_widget`, `replace_widget_class`, or `batch_widget_operations` for local structural edits
   - `replace_widget_tree` only when the full tree truly needs replacement
6. Compile immediately after any structural widget change with `compile_widget`.
7. If compile fails, inspect `compile.recoveryHints` and rerun `debug_widget_compile_errors`.
8. If the redesign includes authored motion on the supported v2 track subset, use `create_widget_animation` or `modify_widget_animation` instead of trying to encode that work through generic widget patches.
9. Run `capture_widget_preview` or `capture_widget_motion_checkpoints` after compile is clean so the rendered result is visually confirmed.
10. If reference images or checkpoint frames exist, run `compare_capture_to_reference` or `compare_motion_capture_bundle` for key states such as `open`, `focused`, or `pressed`.
11. Save only after capture or compare succeeds, or report `partial verification` / lower-confidence verification explicitly when the visual checkpoint is blocked.

## Common Failure Checks

- `BindWidget` names and types still match the native parent class.
- `ListView` and related widgets have a concrete `entry_widget_class`.
- No abstract widget class slipped into the tree.
- HUD or class-default references still point to the intended screen after the redesign.
- Motion on the supported v2 track subset should use the dedicated widget animation tools. Only unsupported track families or broader arbitrary timeline synthesis should be marked `deferred_to_v2`.
