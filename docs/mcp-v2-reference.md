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
- `reimport_assets`
- `import_textures`
- `import_meshes`
- `get_import_job`
- `list_import_jobs`
- `compile_project_code`
- `restart_editor`
- `sync_project_code`
- `trigger_live_coding`

## Project-Code Notes

- `trigger_live_coding` returns `fallbackRecommended` and a normalized `reason` when editor-side Live Coding cannot apply the requested change. If a recent external build exists, it is surfaced as `lastExternalBuild`.
- `sync_project_code.restart_first=true` now means shutdown-first orchestration: the editor is asked to close without relaunching, the host builds with unlocked DLLs, then the host launches the editor and waits for Remote Control to reconnect.
- `run_automation_tests` and `get_automation_test_run` now surface `verificationArtifacts` for image-based automation report outputs, normalized to the same verification-artifact contract used by widget captures.

## Primary v2 Workflows

### Material Authoring

Use the smaller composable tools first:

1. `create_material`
2. `set_material_settings`
3. `add_material_expression`
4. `connect_material_expressions`
5. `bind_material_property`
6. `compile_material_asset`
7. `save_assets`

`modify_material` remains available as an advanced escape hatch when the composable tools are insufficient.

### Enhanced Input Authoring

Use the dedicated tools instead of generic DataAsset reflection:

1. `create_input_action`
2. `modify_input_action`
3. `create_input_mapping_context`
4. `modify_input_mapping_context`

Enhanced Input assets can still be inspected with `extract_dataasset`.

### Widget Redesign

- Inspect the current widget and any owning HUD/transition assets first.
- Prefer `modify_widget_blueprint` for small structural changes.
- Use `build_widget_tree` only when replacing the full tree is justified.
- `extract_widget_blueprint` now always returns `rootWidget` as an object or `null`. If extraction degrades, inspect `widgetTreeStatus`, `widgetTreeError`, and `compile.errors` before rebuilding the tree.
- Compile immediately after structural changes.
- Run `capture_widget_preview` after compile is clean; compile/save alone is not treated as visual proof for user-facing widget work.
- `capture_widget_preview`, `list_captures`, and diff captures now normalize to a shared verification-artifact shape with `surface`, `scenarioId`, `assetPaths`, `worldContext`, and `cameraContext`, so later runtime/editor lanes can reuse the same contract.
- Use `apply_window_ui_changes.checkpoint_after_mutation_steps=true` when a multi-step UI flow is likely to hit compile failures, debugger pauses, or editor `ensure()` breaks.
- `apply_window_ui_changes` now returns `verification.status` so callers can distinguish `compile_pending` from `unverified` visual confirmation and finish the flow explicitly.
- `apply_window_ui_changes.save_after` defaults to `false` so visual verification can stay ahead of final persistence unless the caller opts into saving.
- Save only after compile results are clean and the visual checkpoint is satisfied, or report `partial verification` with the blocking reason.

See [ui-redesign-workflow.md](./ui-redesign-workflow.md) for the full checklist.

## Generated Guidance Surfaces

The MCP server now exposes three guidance layers:

- Resources: durable reference material such as scopes, best practices, unsupported surfaces, and UI redesign workflow.
- Resource templates: generated, schema-backed examples and widget patterns.
- Prompts: reusable workflow starters for UI design, material styling, HUD wiring, and widget compile debugging.

Related docs:

- [prompt-catalog.md](./prompt-catalog.md)
- [unsupported-surfaces.md](./unsupported-surfaces.md)
- [ui-redesign-workflow.md](./ui-redesign-workflow.md)
