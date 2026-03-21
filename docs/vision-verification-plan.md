# Verification Platform Plan

## Intent

The goal is not a widget-only vision feature. The goal is a verification platform that lets the MCP and the model determine whether an operation actually succeeded across three different failure modes:

- semantic failures: wrong Blueprint wiring, wrong graph layout, wrong widget tree, wrong class defaults, wrong DataAsset values;
- visual failures: the widget compiles but the rendered result is clipped, misaligned, or styled incorrectly;
- gameplay/runtime failures: a mechanic, interaction, or scenario does not behave correctly even if the authored data looks valid.

The implementation in this repository now follows that split.

Follow-up planning note:

- The current phase-1 implementation proved that widget capture works technically, but it did not fully solve model adoption of verification in widget workflows.
- The next implementation pass should use [General Visual Verification Platform Follow-Up](D:\Development\llm-tools\ue-blueprint-extractor\docs\plans\2026-03-22-general-visual-verification-platform.md) as the controlling plan for anti-skip guidance, helper-flow behavior, and verification-specific regression tests.

## Verification Lanes

### 1. Semantic verification

Semantic verification stays authoritative for:

- Blueprint graph connections and node layout;
- widget hierarchy, slot data, bindings, and class defaults;
- DataAsset, DataTable, Blackboard, BehaviorTree, StateTree, and input asset values.

Use the existing extractors and compile diagnostics first:

- `extract_blueprint`
- `extract_widget_blueprint`
- `extract_dataasset`
- `extract_datatable`
- `compile_widget_blueprint`
- `compile_material_asset`

The `blueprint://verification-workflows` resource now tells the model when semantic verification is the right answer and explicitly warns against inferring gameplay success from screenshots alone.

### 2. Visual verification

Visual verification now exists for widget previews through a file-backed capture lane:

- `capture_widget_preview`
- `compare_capture_to_reference`
- `list_captures`
- `cleanup_captures`

Implementation details:

- Unreal renders a compiled `WidgetBlueprint` offscreen through `FWidgetRenderer`.
- Captures are written under `<Project>/Saved/BlueprintExtractor/Captures/<capture_id>/`.
- Each capture directory contains:
  - `capture.png`
  - `metadata.json`
- Widget preview and diff captures now normalize to the shared `verification_artifact` shape with `surface`, `scenarioId`, `assetPaths`, `worldContext`, `cameraContext`, and optional `comparison` metadata.
- The subsystem returns JSON metadata only.
- The MCP host reads the PNG from disk and returns:
  - the normal text/structured v2 envelope;
  - a `resource_link` to `blueprint://captures/{capture_id}`;
  - an inline `image` block when the file is small enough.

The MCP wrapper was extended so non-text content blocks survive normalization instead of being discarded.

### 3. Gameplay/runtime verification

Gameplay verification is host-side and async:

- `run_automation_tests`
- `get_automation_test_run`
- `list_automation_test_runs`

This is intentionally separate from the live editor subsystem. The host launches `UnrealEditor-Cmd` automation runs, indexes reports, stdout, stderr, and exported artifacts, and exposes them through:

- `blueprint://test-runs/{run_id}/{artifact}`

The MCP runtime lane now also lifts image-based automation report outputs into `verificationArtifacts`, so the model receives typed visual artifacts in the shared verification shape instead of only generic report-file links.

This is the primary verification lane for:

- gameplay mechanics;
- interactions;
- runtime flows;
- scenario validation;
- project-owned Automation Specs and Functional Tests.

If no Automation Spec or Functional Test exists for a mechanic, the model should report verification as partial rather than pretending a screenshot proves behavior.

## Current Implementation

### MCP

Implemented:

- rich content preservation in the tool wrapper;
- `blueprint://verification-workflows`;
- `blueprint://captures/{capture_id}`;
- `blueprint://test-runs/{run_id}/{artifact}`;
- widget capture and comparison tools;
- async automation run tools;
- indexed automation artifacts with resource links;
- optional inline image previews for small captures.

### Unreal plugin

Implemented:

- editor-only widget preview capture;
- PNG persistence plus metadata persistence;
- pixel-diff comparison with RMSE, max delta, mismatch count, and mismatch percentage;
- capture listing and cleanup;
- a plugin automation spec that exercises capture, comparison, listing, and cleanup.

The capture implementation is deliberately narrow:

- `RenderCore`
- `RHI`
- `ImageCore`

No runtime automation modules were added to the plugin for phase 1.

### UE runners

The checked-in UE test runners now support rendered verification runs:

- PowerShell: `-NoNullRHI`
- Bash: `--no-null-rhi`

Default runs still use `-NullRHI` for fast logic-only coverage. Visual capture tests should be run without `-NullRHI`.

## Validation Status

Validated in-repo:

- MCP unit tests pass.
- MCP stdio integration passes.
- UE 5.7 targeted rendered automation pass succeeds for `BlueprintExtractor.Authoring.WidgetCaptureVerification`.
- UE 5.7 default headless automation pass succeeds with the broader `BlueprintExtractor` filter.

## Known Limits

- Offscreen widget capture validates authored UI state, not full in-game viewport composition.
- Widgets that depend on runtime-only services may still need PIE/runtime capture later.
- The current comparison lane uses custom image diffing, not Unreal’s automation screenshot comparison framework.
- Gameplay verification depends on project-owned Automation Specs or Functional Tests existing in the target project.

## Later Phases

Not implemented yet:

- `capture_runtime_screenshot`
- PIE/runtime scene capture tied to a named automation scenario
- Automation Driver-backed interaction steps before capture
- Gauntlet-based packaged or multi-process verification
- explicit Blueprint graph image capture

These remain later-phase work. The current system already covers the original intent better by combining:

- semantic verification for authored correctness;
- visual verification for rendered UI correctness;
- automation-driven verification for mechanic correctness.

## References

- [MCP tools spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP resources spec](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- [MCP schema](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-11-25/schema.ts)
- [Automation Spec](https://dev.epicgames.com/documentation/en-us/unreal-engine/automation-spec-in-unreal-engine)
- [Functional Testing in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/functional-testing-in-unreal-engine)
- [FWidgetRenderer](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/UMG/Slate/FWidgetRenderer/DrawWidget/3)
- [FWidgetBlueprintEditorUtils](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UMGEditor/FWidgetBlueprintEditorUtils/DrawSWidgetInRenderTarget)
