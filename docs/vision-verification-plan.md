# Verification Platform Plan

## Intent

Verification in this repository is not a widget-only feature. It is a shared platform for answering three different questions:

- semantic correctness: did the authored Blueprint, widget tree, class defaults, or data values land correctly?
- rendered correctness: does the compiled result actually look right?
- runtime correctness: does the interaction or scenario behave correctly once Unreal is driving it?

The current implementation keeps those lanes separate so models do not treat screenshots as proof of authored data or gameplay behavior.

## Verification Lanes

### 1. Semantic Verification

Semantic verification remains authoritative for:

- Blueprint graph wiring and member state
- widget hierarchy, slot data, bindings, and class defaults
- DataAsset, DataTable, Blackboard, BehaviorTree, StateTree, montage, sequence, blend space, and input asset values

Primary tools:

- `extract_blueprint`
- `extract_widget_blueprint`
- `extract_asset`
- `compile_widget`
- `compile_material_asset`

### 2. Rendered Verification

Rendered verification now has three public surfaces:

- `capture_widget_preview` for offscreen WidgetBlueprint rendering
- `capture_editor_screenshot` for the active editor viewport
- `capture_runtime_screenshot` for automation-backed runtime frames

All capture outputs normalize to the shared `verification_artifact` shape, including the canonical surface values:

- `editor_tool_viewport`
- `pie_runtime`

`compare_capture_to_reference`, `list_captures`, and `cleanup_captures` operate on the same shared artifact model.

### 3. Runtime / Gameplay Verification

Runtime verification remains automation-backed:

- `run_automation_tests`
- `get_automation_test_run`
- `list_automation_test_runs`

Use runtime automation for:

- gameplay mechanics
- scripted interactions
- HUD/runtime flows
- scenario validation

Use `start_pie`, `stop_pie`, and `relaunch_pie` when a live editor PIE session itself is part of the workflow, but do not treat live PIE control as a substitute for automation-backed gameplay verification.

## Current Implementation

### MCP

Implemented:

- shared verification-artifact normalization for widget preview, editor screenshot, runtime screenshot, and automation-exported artifacts
- resource-backed capture access through `blueprint://captures/{capture_id}`
- automation artifact access through `blueprint://test-runs/{run_id}/{artifact}`
- explicit screenshot tools:
  - `capture_widget_preview`
  - `capture_editor_screenshot`
  - `capture_runtime_screenshot`
- motion checkpoint capture and comparison
- PIE lifecycle controls:
  - `start_pie`
  - `stop_pie`
  - `relaunch_pie`
- `get_project_automation_context.isPlayingInEditor`

### Unreal Plugin

Implemented:

- offscreen widget preview capture through `FWidgetRenderer`
- editor viewport screenshot capture
- PIE lifecycle control in the active editor
- runtime screenshot export through the automation-backed verification lane
- PNG + metadata persistence under `<Project>/Saved/BlueprintExtractor/Captures/<capture_id>/`
- shared capture metadata normalization for later MCP/resource consumption

### UE Runners

The UE test runners now expose an explicit lane split:

- default/headless: `-NullRHI`
- rendered verification: `-NoNullRHI`
- Windows rendered fallback: `-AllowSoftwareRendering`

Rendered verification is where screenshot and diff assertions belong. Headless coverage stays focused on logic, contract, and authoring correctness.

## Validation Status

Validated in-repo on `2026-03-28`:

- MCP unit, stdio, pack-smoke, and publish-gate paths passed.
- UE 5.6 headless `BlueprintExtractor` pass succeeded with `failed=0`.
- UE 5.7 headless `BlueprintExtractor` pass succeeded with `failed=0`.
- UE 5.6 rendered targeted filters succeeded for:
  - `BlueprintExtractor.ProjectControl.PIEAndScreenshots`
  - `BlueprintExtractor.Authoring.WidgetCaptureVerification`
  - `BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip`
- UE 5.7 rendered targeted filters succeeded for the same three filters.

Known rendered-lane noise:

- `WidgetCaptureVerification` and `CommonUIButtonStyleRoundTrip` can emit warning-only `LogUObjectGlobals` class lookup messages on this machine while the automation result still returns `Success`.

## Known Limits

- Offscreen widget preview validates authored UI state, not the entire in-game composition stack.
- `capture_runtime_screenshot` depends on an automation scenario exporting a screenshot-backed artifact. It is not a blind live-scene screenshot command.
- Screenshots support verification, but they do not replace semantic extraction or gameplay assertions.
- Gameplay/runtime verification still depends on project-owned Automation Specs or Functional Tests.

## Later Phases

Still out of scope:

- Gauntlet-based packaged verification
- broader Automation Driver interaction orchestration in the public MCP contract
- explicit Blueprint graph image capture as a first-class tool
- multi-process or packaged runtime verification beyond the current automation-report path

## References

- [Automation Spec](https://dev.epicgames.com/documentation/en-us/unreal-engine/automation-spec-in-unreal-engine)
- [Functional Testing in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/functional-testing-in-unreal-engine)
- [FWidgetRenderer](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/UMG/Slate/FWidgetRenderer/DrawWidget/3)
