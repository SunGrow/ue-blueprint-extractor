# Safe UI Redesign Workflow

Use this flow before replacing or heavily restructuring a screen:

1. Inspect the current widget with `extract_widget_blueprint`.
2. Inspect the owning HUD, shell widget, or transition Blueprint with `extract_blueprint` at `Components` or `FunctionsShallow` scope.
3. Read the relevant widget pattern or prompt before editing:
   - `blueprint://widget-patterns/centered_overlay`
   - `blueprint://widget-patterns/common_menu_shell`
   - `design_menu_screen`
4. Prefer the smallest patch that can solve the problem:
   - `modify_widget` for property and variable changes
   - `modify_widget_blueprint` for local structural edits
   - `build_widget_tree` only when the full tree truly needs replacement
5. Compile immediately after any structural widget change.
6. If compile fails, inspect `compile.recoveryHints` and rerun `debug_widget_compile_errors`.
7. Save only after compile status is clean.

## Common Failure Checks

- `BindWidget` names and types still match the native parent class.
- `ListView` and related widgets have a concrete `entry_widget_class`.
- No abstract widget class slipped into the tree.
- HUD or class-default references still point to the intended screen after the redesign.
