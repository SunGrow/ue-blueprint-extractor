# General Visual Verification Platform Follow-Up

> Historical plan. Use `docs/CURRENT_STATUS.md`, `docs/testing.md`, and `docs/vision-verification-plan.md` for the current contract and validation state.

## Purpose

This plan updates the visual verification roadmap before broader implementation work starts.
The immediate goal is to prevent the same failure mode that already happened with widget verification: the tool existed, but the model still skipped it in real UI flows.

## Status update (2026-03-22)

- P0A, P0B, and P0C are now closed in the MCP layer: widget guidance, prompts, examples, helper-flow verification state, and regression tests all require or explicitly defer visual verification instead of ending on compile/save.
- `apply_window_ui_changes` now defaults `save_after` to `false`, so the helper no longer persists user-facing widget changes before the visual checkpoint unless a caller opts in.
- P1 has started: widget preview and diff captures are now the first producer of the shared `verification_artifact` contract, including `surface`, `scenarioId`, `assetPaths`, `worldContext`, `cameraContext`, and optional `comparison` metadata.
- P2 has started on the chosen runtime path: `run_automation_tests` and `get_automation_test_run` now derive `verificationArtifacts` from image-based automation report outputs, so runtime visuals reuse the same contract instead of remaining generic report files.
- The next implementation slice remains unchanged: deepen the same typed runtime lane before adding editor-tool adapters.

## UE 5.7 validated findings

The following findings were re-checked against Unreal Engine 5.7 documentation and local 5.7 engine source before updating this plan.

### 1. Screenshot capture and screenshot comparison are split across different execution models

Verified:

- `UAutomationBlueprintFunctionLibrary::TakeHighResScreenshot` is an editor-side primitive for high-resolution editor screenshots.
- `UAutomationBlueprintFunctionLibrary::SetEditorViewportViewMode`, `SetEditorActiveViewportViewMode`, `GetEditorActiveViewportViewMode`, and `SetEditorViewportVisualizeBuffer` provide supported viewport normalization hooks.
- `UAutomationBlueprintFunctionLibrary::CompareImageAgainstReference` exists as a supported API for image comparison.

Verified in code:

- `TakeHighResScreenshot` depends on a loaded `LevelEditor` module and the first active level viewport.
- `CompareImageAgainstReference` is guarded by `WITH_AUTOMATION_TESTS` and `GIsAutomationTesting`.
- `TakeAutomationScreenshot` logs that screenshots are only taken during automation tests when automation is not active.

Implication:

- screenshot capture can exist outside the narrow widget lane, but reliable comparison/report integration is still automation-centric;
- phase-1 runtime and later editor verification should prefer automation scenarios over ad-hoc live editor tool calls when they need comparison semantics.

### 2. Editor-mode work depends on a real level editor context

Verified:

- `ULevelEditorSubsystem` exposes `PilotLevelActor`, `EjectPilotLevelActor`, `EditorRequestBeginPlay`, `EditorRequestEndPlay`, `GetActiveViewportConfigKey`, and cinematic-control helpers.
- `ULevelEditorSubsystem::GetLevelEditorModeManager` explicitly documents that the mode manager is not created in commandlet environments.

Verified in code:

- `GetLevelEditorModeManager()` returns `nullptr` when `IsRunningCommandlet()` or when no `ILevelEditor` is available.
- viewport-oriented helpers in `ULevelEditorSubsystem` resolve `SLevelViewport` and `FLevelEditorViewportClient`, not a generic headless render path.

Implication:

- editor-tool verification cannot be planned as a pure commandlet/headless lane;
- stage 2 must validate that the chosen launch mode actually has a live level editor viewport before it promises mode-driven verification.

### 3. Automation Driver is powerful but invasive

Verified:

- `IAutomationDriverModule::Enable()` disables most traditional platform input and routes interaction through simulated automation-driver input.
- the driver creates element locators, sequences, and async/sync drivers intended for UI interaction automation.

Implication:

- Automation Driver is a fallback for adapter-specific UI driving, not the default verification mechanism;
- if used, it should run in a dedicated session and be explicitly enabled/disabled, never as a background capability for normal editor tool use.

### 4. Landscape has a usable public data plane, but tool-mode control is largely private

Verified:

- public `LandscapeEditorUtils` exposes `SetHeightmapData`, `SetWeightmapData`, and save helpers for landscape proxies;
- public `ILandscapeEditorModule` exposes module-level integration points;
- `LandscapeEditor` is a full editor module with substantial editor-only dependencies.

Verified in code:

- the actual tool/mode control surface such as `FEdModeLandscape::SetCurrentTool`, `SetCurrentBrush`, selected edit-layer control, and current tool state lives in `Private/LandscapeEdMode.h`;
- `ULandscapeEditorObject` is public and contains many settings, but active tool orchestration is still centered on `FEdModeLandscape`.

Implication:

- the first Landscape canary should split into two tracks:
  - public-API/data-plane verification using `LandscapeEditorUtils` plus viewport capture;
  - separate feasibility research for true tool-mode/brush verification that may require private-header coupling or brittle UI driving.

### 5. Current host automation shape needs an explicit viewport feasibility check

Verified in the repository:

- `run_automation_tests` currently launches `UnrealEditor-Cmd` with `-unattended`, optional `-NullRHI`, and `Automation RunTests ...`.

Verified in UE 5.7 code:

- editor viewport APIs used by `TakeHighResScreenshot` and `SetEditorViewportViewMode` depend on `LevelEditor` and an active level viewport.

Implication:

- stage 2 cannot assume the existing host launcher is already sufficient for editor viewport scenarios;
- add an explicit spike that proves `GetEditorActiveViewportViewMode` and `TakeHighResScreenshot` work under the chosen automation launch mode before committing the public editor-verification contract.

## Root Cause Analysis: why the LLM skipped widget verification

### 1. Verification lived in side guidance, not in the primary widget workflow

The repository already tells the model that visual verification exists:

- `MCP/src/index.ts` server instructions say: `After widget or UI-heavy mutations, use capture_widget_preview for visual confirmation in addition to extract_widget_blueprint.`
- `blueprint://verification-workflows` explains when to use `capture_widget_preview`.

But the widget-first workflow surfaces still stop at compile/save:

- [`docs/ui-redesign-workflow.md`](D:\Development\llm-tools\ue-blueprint-extractor\docs\ui-redesign-workflow.md) ends with `Compile immediately after structural changes, then save only after the compile result is clean.`
- `design_menu_screen` in [`MCP/src/index.ts`](D:\Development\llm-tools\ue-blueprint-extractor\MCP\src\index.ts) asks for a widget-tree plan and compile/save steps, but not for a visual confirmation step.
- `window_ui_polish` in [`MCP/src/index.ts`](D:\Development\llm-tools\ue-blueprint-extractor\MCP\src\index.ts) recommends `extract_widget_blueprint -> apply_window_ui_changes -> extract_widget_blueprint`, again with no capture step.

Result: the model sees verification as optional background advice rather than part of the canonical UI mutation loop.

### 2. The documented success condition was “compiles and saves”, not “verified”

Several guidance surfaces teach a happy path that finishes too early:

- `blueprint://authoring-conventions` says `extract_widget_blueprint -> modify_widget_blueprint -> compile_widget_blueprint -> save_assets`.
- `blueprint://ui-redesign-workflow` ends at compile/save.
- `apply_window_ui_changes` is explicitly described as a thin helper for mutation, compile, save, and optional code sync, but not for verification.

That makes `capture_widget_preview` look like an optional bonus instead of a post-mutation checkpoint.

### 3. Example and prompt coverage reinforced the omission

The model is shaped more by examples and prompt scaffolding than by one-line tool descriptions.

- [`docs/prompt-catalog.md`](D:\Development\llm-tools\ue-blueprint-extractor\docs\prompt-catalog.md) describes `design_menu_screen` as compile-oriented, not verification-oriented.
- The prompt builders in [`MCP/src/index.ts`](D:\Development\llm-tools\ue-blueprint-extractor\MCP\src\index.ts) never tell the model to capture the final widget result after a user-facing change.
- The example catalog for `window_ui_polish` does not include `capture_widget_preview` or `compare_capture_to_reference`.

This means the model repeatedly learns the wrong terminal state from the most reusable workflow surfaces.

### 4. Tests locked transport, but not behavior guidance

Current tests are good at proving the widget capture lane exists:

- contract tests assert the presence of `capture_widget_preview`;
- contract and stdio tests assert `resource_link` and inline image preservation;
- UE automation validates widget capture and diffing end-to-end.

But the tests do not currently lock the more important product behavior:

- no contract test requires `ui-redesign-workflow` to mention capture;
- no prompt-catalog test requires `design_menu_screen` to ask for visual verification;
- no example-catalog test requires widget examples to include a verification checkpoint;
- no end-to-end UI authoring flow asserts that a user-facing widget mutation is followed by capture.

So the repo can regress back to “compile/save is enough” while all current verification tests still pass.

### 5. Transport was fixed, orchestration was not

The system already preserves `resource_link` and inline image content for captures.
That fixed delivery of visual artifacts, but it did not change the decision policy that tells the model when capture is mandatory.

This is why the bug persisted as a workflow problem instead of a transport problem.

## Updated Plan

### P0A. Guidance hardening before new capture surfaces

Before adding runtime or editor-tool capture, make widget visual verification a required checkpoint in all UI-heavy flows.

- Update `serverInstructions` in [`MCP/src/index.ts`](D:\Development\llm-tools\ue-blueprint-extractor\MCP\src\index.ts) so user-facing widget changes are explicitly incomplete until both semantic and visual verification run.
- Update `blueprint://ui-redesign-workflow` so the canonical sequence becomes `extract -> modify -> compile -> capture -> save` for user-facing widgets, with a documented escape hatch only when rendering is unavailable.
- Update `blueprint://authoring-conventions`, `blueprint://widget-best-practices`, and `blueprint://examples/window_ui_polish` so examples teach the same stopping rule.
- Update `design_menu_screen` and `debug_widget_compile_errors` prompt builders so they request a post-mutation capture plan, not only compile recovery.
- Define one explicit fallback sentence for render-unavailable cases: return `partial verification` instead of silently skipping the visual step.

### P0B. Make helper flows expose verification state

Any helper that looks like an end-to-end UI workflow must either perform verification or report that verification is still pending.

- Extend the implementation plan so `apply_window_ui_changes` gains an explicit post-mutation verification outcome.
- The preferred shape is either an optional `capture_after`/`verification_mode` input or an `unverified` result flag with actionable next steps.
- Do not leave helper flows in a state where they appear “complete” after compile/save when the screen changed visually.

### P0C. Lock the anti-skip behavior with tests

Add tests for the behavior that actually failed.

- Contract tests must require `blueprint://ui-redesign-workflow` to mention `capture_widget_preview`.
- Prompt tests must require `design_menu_screen` to instruct visual verification for user-facing widget edits.
- Example-catalog tests must require at least one widget/UI example family to include a capture step.
- Add one integration path that performs a widget mutation and then asserts capture guidance or capture execution is part of the workflow outcome.

### P1. Unify the artifact model

Only after the anti-skip fix is in place should the broader verification platform expand.

- Introduce a shared `verification_artifact` contract for widget captures, diff captures, runtime screenshots, and later editor-tool captures.
- Keep `capture_widget_preview` as the first producer of that contract.
- Require any higher-level verification helper to emit the same artifact metadata shape, so the model does not need tool-specific reasoning for every lane.

### P2. Add PIE/runtime verification

Phase 1 implementation should still be `PIE/runtime first`, but only after the widget workflow bug is structurally closed.

- Prefer Automation Specs / Functional Tests + screenshot artifacts over a generic live-editor runtime executor.
- Use UE's automation-oriented screenshot APIs as the baseline assumption for comparison and reporting, because `CompareImageAgainstReference` and large parts of screenshot comparison semantics are tied to automation-test execution.
- Choose one runtime entry path only: typed `run_automation_tests` extension or a dedicated runtime capture/scenario tool.
- Preserve the rule that screenshots do not replace gameplay assertions.

### P3. Add editor-tool adapters

Research editor-only surfaces after the common artifact model and runtime lane are stable.

- Use viewport capture plus adapter commands as the first candidate architecture.
- Use Landscape as the canary adapter.
- Mark unsupported or low-confidence editor surfaces as `partial verification` until a stable automation path exists.

### Stage 2. Editor verification

This stage turns editor-only actions into explicit verification scenarios instead of treating them as ad-hoc screenshots.

#### Why editor verification is a separate stage

Editor verification has different constraints from widget preview and runtime automation:

- current public guidance still says world editing is out of scope in `blueprint://unsupported-surfaces`;
- many editor-tool workflows depend on interactive editor state, selection, active viewport, and current mode;
- `ULevelEditorSubsystem::GetLevelEditorModeManager()` is documented as unavailable in commandlet environments, which means the mode-driven part of this stage cannot assume `UnrealEditor-Cmd` is enough;
- Unreal already exposes editor-side screenshot and comparison primitives through `UAutomationBlueprintFunctionLibrary`, viewport view-mode helpers, and screenshot-comparison tooling, so this stage should prefer those supported paths over another custom image lane.
- Landscape in particular has a split surface: public data utilities exist, but direct tool/brush orchestration is largely centered on private `FEdModeLandscape` internals.

#### Stage 2 objective

Let the model verify the visible result of editor-only operations in a controlled editor session, with enough structured context to know what was shown and whether the result is trustworthy.

The first supported outcome is not “generic world editing”.
The first supported outcome is “run a narrow editor verification scenario, capture before/after viewport artifacts, and report verified or partial”.

#### Stage 2 architecture

Use an adapter-based model, not a generic “do arbitrary editor actions then screenshot” primitive.

- Add an `editor_tool_viewport` surface to the shared `verification_artifact` contract.
- Require editor artifacts to record `level_name`, `viewport_id` or viewport label, `editor_mode`, `tool_name`, `view_mode`, `camera_context`, and selection/context metadata.
- Run editor scenarios inside a full editor session with rendering enabled, not only through host-side commandlet automation.
- Add a launch-shape feasibility gate: prove that the chosen editor automation process exposes an active level viewport before publicizing viewport-based verification.
- Prefer Unreal’s supported screenshot pipeline for editor viewports and comparison:
  - `UAutomationBlueprintFunctionLibrary::TakeHighResScreenshot`
  - `UAutomationBlueprintFunctionLibrary::GetEditorActiveViewportViewMode`
  - `UAutomationBlueprintFunctionLibrary::SetEditorViewportViewMode`
  - `UAutomationBlueprintFunctionLibrary::CompareImageAgainstReference`
  - `IScreenShotManager::CompareScreenshotAsync`
- Keep the host responsible for artifact indexing and MCP resource exposure; keep the plugin/editor side responsible for scenario setup, viewport normalization, and capture production.
- Treat `AutomationDriver` as an adapter-specific escalation path only; if used, run it in a dedicated session because enabling it suppresses normal platform input.

#### Stage 2 execution model

Every editor verification run should have four explicit phases:

1. Normalize editor state.
2. Run one tool-specific adapter command.
3. Capture before/after artifacts from a deterministic viewport configuration.
4. Return structured verification status with either `verified` or `partial_verification`.

The normalization phase should explicitly control:

- target map or level;
- active editor mode;
- viewport view mode and visualize-buffer state;
- camera transform or named camera anchor;
- selection set;
- relevant show flags or quality settings.

Without this normalization, editor screenshots will be too nondeterministic to trust.

#### Stage 2 scope split

Stage 2 should be implemented in two slices, not as one giant editor feature.

##### Stage 2A. Level editor viewport scenarios

Target actions that can be validated from the main editor viewport with limited UI interaction.

- selection and transform-affecting operations;
- level-context operations via `ULevelEditorSubsystem`;
- actor-placement or world-state changes that have a clear visual outcome;
- simple mode-dependent operations where the mode can be set deterministically.
- first-pass viewport feasibility checks using `GetEditorActiveViewportViewMode`, `SetEditorViewportViewMode`, and `TakeHighResScreenshot`.

This is the best first slice because the viewport and screenshot pipeline are better defined than arbitrary asset editor tabs.

##### Stage 2B. Tool-specific adapters

Add adapters only for tools with a stable API and repeatable setup.

- `Landscape` is still the canary adapter because the `LandscapeEditor` module is explicitly available as an editor module, and the user already named it as a target scenario.
- Split Landscape into:
  - `Landscape public-data canary`: mutate landscape data through public `LandscapeEditorUtils` helpers, then verify the viewport result;
  - `Landscape tool-mode canary`: separately evaluate whether true brush/tool verification can be supported without unacceptable coupling to private `FEdModeLandscape` internals.
- Candidate later adapters: foliage, mesh paint, data-layer/editor-context workflows, or asset-editor-specific viewports.
- Do not promise support for arbitrary asset editors until there is a stable subsystem or automation path for each one.

#### Landscape canary design

Landscape should be the first go/no-go adapter, not because it is easy, but because it is a strong test of the architecture.

The Landscape canary should prove all of the following:

- the system can enter the required editor mode in a rendered editor session;
- the adapter can establish deterministic preconditions for the target landscape actor and edit layer;
- the scenario can capture a `before` artifact and an `after` artifact from the same camera and view mode;
- the verification result can distinguish `adapter_ran_but_visual_result_uncertain` from `adapter_failed` and `visual_change_verified`.
- the public version of the canary can ship without private-header dependencies if the tool-mode path proves too brittle.

If Landscape cannot meet that bar without brittle UI-driving hacks, Stage 2 should stay limited to level-editor viewport scenarios and mark Landscape as `partial verification only`.

#### Stage 2 public contract impact

This stage should not expose raw world-editing tools as generally supported authoring surfaces.

Instead:

- keep editor verification behind a scenario/adapter abstraction;
- extend the shared artifact schema rather than adding one-off screenshot result shapes;
- update `blueprint://unsupported-surfaces` only when at least one editor adapter is stable enough to document publicly;
- document editor verification as verification-only first, with mutation remaining narrow and adapter-scoped.

#### Stage 2 tests

Stage 2 should add dedicated tests beyond the current widget capture coverage.

- Contract tests for the new `editor_tool_viewport` artifact fields and resource handling.
- A dedicated feasibility test that validates the chosen automation launch mode exposes a usable level editor viewport.
- Integration tests that assert editor scenarios report `partial_verification` when deterministic viewport setup is unavailable.
- UE automation coverage for at least one canary scenario that records before/after captures and comparison results.
- Regression tests that lock viewport normalization, so later refactors do not silently change view mode or camera assumptions.

#### Stage 2 go/no-go criteria

Proceed with public editor verification only if all of these are true:

- a full editor-session path exists that does not rely on unsupported commandlet-only mode access;
- at least one adapter can produce stable before/after captures across repeated runs;
- the result model can distinguish verified, failed, and partial states without pretending a screenshot alone proves semantic success;
- at least one public adapter path avoids coupling the public contract to private engine headers such as `LandscapeEdMode.h`;
- the public docs can describe the supported editor adapters narrowly enough that users will not infer generic world editing support.

If any of those fail, keep editor verification as an internal research lane and do not widen the public contract yet.

## Acceptance Criteria For The Updated Plan

- A user-facing widget workflow cannot be documented as complete without semantic verification plus either visual verification or an explicit `partial verification` fallback.
- The canonical UI workflow resources, prompts, and examples all teach the same stopping rule.
- The test suite fails if a future refactor drops capture guidance from widget workflows while keeping the tool itself.
- The broader runtime/editor verification work starts only after this anti-skip guidance debt is paid down.
- The editor stage is documented as adapter-based verification in a rendered editor session, not as generic world-editing support.
- Landscape is treated as the first canary adapter with explicit go/no-go rules, not as an assumed baseline capability.

## Editor Stage References

- [UAutomationBlueprintFunctionLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Developer/FunctionalTesting/UAutomationBlueprintFunctionLibr-)
- [UAutomationBlueprintFunctionLibrary::TakeAutomationScreenshotAtCamera](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Developer/FunctionalTesting/UAutomationBlueprintFunctionLibr-/TakeAutomationSc-_2)
- [UAutomationBlueprintFunctionLibrary::TakeAutomationScreenshotOfUI](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Developer/FunctionalTesting/UAutomationBlueprintFunctionLibr-/TakeAutomationSc-_4)
- [UAutomationBlueprintFunctionLibrary::CompareImageAgainstReference](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Developer/FunctionalTesting/UAutomationBlueprintFunctionLibr-/CompareImageAgai-)
- [ULevelEditorSubsystem::GetLevelEditorModeManager](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/LevelEditor/ULevelEditorSubsystem/GetLevelEditorModeManager)
- [LandscapeEditor module](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/LandscapeEditor)
- [IAutomationDriver](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Developer/AutomationDriver/IAutomationDriver)
- [IAutomationDriverModule::Enable](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Developer/AutomationDriver/IAutomationDriverModule/Enable)
- [IScreenShotManager::CompareScreenshotAsync](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Developer/ScreenShotComparisonTools/Interfaces/IScreenShotManager/CompareScreensho-)

## Local UE 5.7 source references

- [AutomationBlueprintFunctionLibrary.h](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Developer\FunctionalTesting\Public\AutomationBlueprintFunctionLibrary.h)
- [AutomationBlueprintFunctionLibrary.cpp](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Developer\FunctionalTesting\Private\AutomationBlueprintFunctionLibrary.cpp)
- [LevelEditorSubsystem.h](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Editor\LevelEditor\Public\LevelEditorSubsystem.h)
- [LevelEditorSubsystem.cpp](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Editor\LevelEditor\Private\LevelEditorSubsystem.cpp)
- [IAutomationDriverModule.h](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Developer\AutomationDriver\Public\IAutomationDriverModule.h)
- [IAutomationDriver.h](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Developer\AutomationDriver\Public\IAutomationDriver.h)
- [IScreenShotManager.h](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Developer\ScreenShotComparisonTools\Public\Interfaces\IScreenShotManager.h)
- [LandscapeEditorModule.h](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Editor\LandscapeEditor\Public\LandscapeEditorModule.h)
- [LandscapeEditorUtils.h](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Editor\LandscapeEditor\Public\LandscapeEditorUtils.h)
- [LandscapeEditorObject.h](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Editor\LandscapeEditor\Public\LandscapeEditorObject.h)
- [LandscapeEdMode.h](C:\Program Files\Epic Games\UE_5.7\Engine\Source\Editor\LandscapeEditor\Private\LandscapeEdMode.h)
