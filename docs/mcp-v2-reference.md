# MCP v2 Reference

Blueprint Extractor v2 is a breaking MCP contract focused on model reliability rather than backward compatibility.

## Contract Rules

- Public tool arguments use `snake_case`.
- Public tool docs describe one canonical shape. Legacy aliases such as `bIsVariable` and `isVariable` are not part of the v2 contract.
- Tool schemas are explicit and validated before the UE subsystem call.
- Every public tool exposes an `outputSchema`.
- Successful tool calls mirror the same JSON in `structuredContent` and text output.
- Recoverable execution failures return `isError: true` with structured `code`, `message`, `recoverable`, `next_steps`, and `diagnostics`.

## Standard Result Envelope

Successful responses use this shape:

```json
{
  "success": true,
  "operation": "create_widget_blueprint",
  "execution": {
    "mode": "immediate",
    "task_support": "forbidden",
    "status": "completed"
  }
}
```

Recoverable failures use this shape:

```json
{
  "success": false,
  "operation": "create_data_asset",
  "code": "unsupported_asset_class",
  "message": "Generic DataAsset authoring does not support Enhanced Input assets. Use the dedicated InputAction/InputMappingContext tools.",
  "recoverable": true,
  "next_steps": [
    "Inspect diagnostics and validation details, then retry the same operation.",
    "Use validate_only=true first if the tool supports it and you need more actionable failures."
  ],
  "diagnostics": [
    {
      "severity": "error",
      "code": "unsupported_asset_class",
      "message": "Generic DataAsset authoring does not support Enhanced Input assets. Use the dedicated InputAction/InputMappingContext tools."
    }
  ],
  "execution": {
    "mode": "immediate",
    "task_support": "forbidden",
    "status": "completed"
  }
}
```

## Task-Aware Execution Metadata

Long-running tool families expose `execution` metadata in the same result envelope.

- `mode`: `immediate` or `task_aware`
- `task_support`: `forbidden` or `optional`
- `status`: normalized execution state such as `completed`, `running`, `Success`, or `Failure`
- `progress_message`: optional summary derived from the subsystem result

Task-aware families currently include:

- `import_assets`
- `get_import_job`
- `list_import_jobs`
- `compile_project_code`
- `restart_editor`
- `sync_project_code`
- `trigger_live_coding`
- `capture_runtime_screenshot`
- `get_automation_test_run`
- `list_automation_test_runs`

## Project-Code Notes

- `get_project_automation_context` surfaces the editor-derived `engineRoot`, `projectFilePath`, `editorTarget`, and `isPlayingInEditor` state used by project-control fallbacks and PIE guards.
- `start_pie`, `stop_pie`, and `relaunch_pie` are the explicit PIE lifecycle controls. Use them for live editor state, not as a replacement for automation-backed runtime verification.
- `wait_for_editor` polls Remote Control once per second and returns `connected`, `elapsedMs`, `timeoutMs`, and `attempts`, with `editor_unavailable` when the timeout elapses.
- `trigger_live_coding` returns `fallbackRecommended` and a normalized `reason` when editor-side Live Coding cannot apply the requested change. If a recent external build exists, it is surfaced as `lastExternalBuild`.
- `sync_project_code.restart_first=true` now means shutdown-first orchestration: the editor is asked to close without relaunching, the host builds with unlocked DLLs, then the host launches the editor and waits for Remote Control to reconnect.
- `run_automation_tests` and `get_automation_test_run` now surface `verificationArtifacts` for image-based automation report outputs, normalized to the same verification-artifact contract used by widget captures.
- `capture_editor_screenshot` returns a shared verification artifact for the active editor viewport with surface `editor_tool_viewport`.
- `capture_runtime_screenshot` runs an automation scenario, then returns the first normalized runtime artifact with surface `pie_runtime`.

## CommonUI Button Style Workflow

Use the dedicated CommonUI family instead of raw `UButton` wrapper fields:

1. `create_commonui_button_style`
2. `modify_commonui_button_style`
3. `extract_commonui_button_style`
4. `apply_commonui_button_style`

`apply_commonui_button_style` patches the wrapper-managed `Style` class default on `CommonButtonBase`-derived WidgetBlueprints. Raw `BackgroundColor` and `WidgetStyle` writes on CommonUI wrappers remain unsupported.

## Primary v2 Workflows

### Multimodal Menu Design

Use a shared `design_spec_json` before authoring a high-fidelity menu:

1. `normalize_ui_design_input`
2. `design_menu_from_design_spec`
3. `extract_widget_blueprint`
4. `import_assets` when the design needs project-owned textures or rendered references
5. `create_material_instance`, `modify_material_instance`, `create_commonui_button_style`, `modify_commonui_button_style`, or `apply_commonui_button_style`
6. `patch_widget`, `insert_widget_child`, `batch_widget_operations`, or `replace_widget_tree` depending on the smallest required structural change
7. `compile_widget`
8. `capture_widget_preview`
9. `compare_capture_to_reference` when reference frames exist
10. `save_assets`

`text+image` and `png/figma` are the primary high-fidelity inputs. `html/css` remains near-parity when the caller extracts tokens and provides rendered reference frames instead of assuming direct DOM-to-UMG translation. `text-only` remains supported, but it should end with a lower-confidence or partial-verification statement when no visual reference exists.

The shared `design_spec_json` should cover:

- `layout`
- `visual_tokens`
- `components`
- `motion` optional
- `verification` optional

Motion support in v2 now includes dedicated widget animation authoring plus checkpoint-bundle verification. Prefer material-driven states or style-state changes for simple interactions, and use the dedicated widget animation tools when the design needs authored timelines on the supported track subset.

### Widget Motion Authoring

Use the dedicated widget animation tools instead of trying to encode authored motion through generic widget patches:

1. `extract_widget_animation`
2. `create_widget_animation`
3. `modify_widget_animation`
4. `capture_widget_motion_checkpoints`
5. `compare_motion_capture_bundle`
6. `save_assets`

`extract_widget_blueprint.animations` remains the shallow inventory surface. Deep timeline inspection, binding targets, playback metadata, and checkpoints now live in `extract_widget_animation`.

The initial supported timeline subset is explicit:

- `render_opacity`
- `render_transform_translation`
- `render_transform_scale`
- `render_transform_angle`
- `color_and_opacity`

Use `widget_path` as the canonical selector for animation bindings and track targets. `replace_timeline` is the primary write path in the initial v2 release because it is easier to validate, diff, and test than arbitrary key patching. Unsupported track families remain outside the public contract and should return a structured `deferred_to_v2` / partial-implementation boundary.

### Motion Verification

Verification output for motion is a keyframe bundle, not a video or GIF.

- `capture_widget_motion_checkpoints` in `editor_preview` mode is the primary lane for menu/shell widget motion.
- `capture_widget_motion_checkpoints` in `automation_scenario` mode builds on `run_automation_tests` for HUD/runtime playback.
- `compare_motion_capture_bundle` compares named checkpoints against reference frames or another bundle.

Canonical checkpoints:

- `closed`
- `opening_peak`
- `open`
- `focused`
- `pressed`

Compile/save alone is never accepted as motion verification. When a runtime scenario cannot export checkpoint artifacts yet, verification must stay partial.

### PIE And Screenshot Verification

Use the explicit screenshot tools when you need rendered editor or runtime evidence outside the offscreen widget-preview lane:

1. `get_project_automation_context`
2. `start_pie` / `stop_pie` / `relaunch_pie` when the live editor state matters
3. `capture_editor_screenshot` for the active editor viewport
4. `capture_runtime_screenshot` for automation-backed runtime frames
5. `compare_capture_to_reference` when reference images exist

Both screenshot tools reuse the shared verification-artifact contract. Screenshots support verification, but they do not replace semantic checks for authored data or gameplay assertions for runtime behavior.

### Material Authoring

Use `material_graph_operation` with the composable operation names first:

1. `create_material`
2. `material_graph_operation` with `operation: "set_material_settings"`
3. `material_graph_operation` with `operation: "add_expression"`
4. `material_graph_operation` with `operation: "connect_expressions"`
5. `material_graph_operation` with `operation: "connect_material_property"`
6. `compile_material_asset`
7. `save_assets`

`modify_material` remains available as an advanced escape hatch when the composable tools are insufficient.

### Enhanced Input Authoring

Use the dedicated tools instead of generic DataAsset reflection:

1. `create_input_action`
2. `modify_input_action`
3. `create_input_mapping_context`
4. `modify_input_mapping_context`

Enhanced Input assets can still be inspected with `extract_asset` using `asset_type: "data_asset"`.

### Inline Instanced DataAsset Graphs

Generic DataAsset reflection supports inline instanced `UObject` graphs for `UPROPERTY(Instanced)` / `EditInlineNew` fields:

- `create_data_asset` accepts nested `{ "classPath": "...", "properties": { ... } }` payloads for instanced object values.
- `modify_data_asset` can patch nested `properties` without restating the full object graph.
- `extract_asset` with `asset_type: "data_asset"` returns nested inline-object values instead of flattening them into asset-path strings.

### Widget Redesign

- Normalize multimodal design input into `design_spec_json` first when the redesign is fidelity-sensitive.
- Inspect the current widget and any owning HUD/transition assets first.
- Prefer operation-specific widget tools such as `patch_widget`, `insert_widget_child`, `remove_widget`, `move_widget`, `wrap_widget`, `replace_widget_class`, and `batch_widget_operations`.
- Use `replace_widget_tree` only when replacing the full tree is justified. `modify_widget_blueprint`, `build_widget_tree`, and `compile_widget_blueprint` remain deprecated compatibility surfaces.
- `extract_widget_blueprint` now always returns `rootWidget` as an object or `null`. If extraction degrades, inspect `widgetTreeStatus`, `widgetTreeError`, and `compile.errors` before rebuilding the tree.
- Compile immediately after structural changes with `compile_widget`.
- Run `capture_widget_preview` after compile is clean; compile/save alone is not treated as visual proof for user-facing widget work.
- Use `capture_editor_screenshot` when the active editor viewport is the relevant rendered reference rather than the offscreen widget preview.
- If reference frames or motion checkpoints exist, use `compare_capture_to_reference` before save.
- `capture_widget_preview`, `capture_editor_screenshot`, `capture_runtime_screenshot`, `list_captures`, and diff captures now normalize to a shared verification-artifact shape with `surface`, `scenarioId`, `assetPaths`, `worldContext`, and `cameraContext`.
- Use `apply_window_ui_changes.checkpoint_after_mutation_steps=true` when a multi-step UI flow is likely to hit compile failures, debugger pauses, or editor `ensure()` breaks.
- `apply_window_ui_changes` now returns `verification.status` so callers can distinguish `compile_pending` from `unverified` visual confirmation and finish the flow explicitly.
- `apply_window_ui_changes.save_after` defaults to `false` so visual verification can stay ahead of final persistence unless the caller opts into saving.
- Save only after compile results are clean and the visual checkpoint is satisfied, or report `partial verification` / lower-confidence verification with the blocking reason.

See [ui-redesign-workflow.md](./ui-redesign-workflow.md) for the full checklist.

## Generated Guidance Surfaces

The MCP server now exposes three guidance layers:

- Resources: durable reference material such as scopes, best practices, unsupported surfaces, and UI redesign workflow.
- Resource templates: generated, schema-backed examples and widget patterns.
- Prompts: reusable workflow starters for UI design, material styling, HUD wiring, and widget compile debugging.

Related docs:

- [prompt-catalog.md](./prompt-catalog.md)
- [multimodal-ui-design-workflow.md](./multimodal-ui-design-workflow.md)
- [widget-motion-authoring.md](./widget-motion-authoring.md)
- [motion-verification-workflow.md](./motion-verification-workflow.md)
- [unsupported-surfaces.md](./unsupported-surfaces.md)
- [ui-redesign-workflow.md](./ui-redesign-workflow.md)
