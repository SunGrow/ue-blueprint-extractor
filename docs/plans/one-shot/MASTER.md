# One-Shot Stabilization Ledger

Last updated: 2026-03-28T23:30:00+07:00

## Goal

Bring the MCP + UE plugin contract back to a trustworthy green baseline on UE 5.6 and UE 5.7, then extend the missing PIE, screenshot, and inline-instanced DataAsset surfaces without restoring removed aliases.

## Team Topology Used

- orchestrator: main Codex thread
- MCP lead: contract, scope, and registry hardening
- UE lead: subsystem, fixture, and automation stabilization
- senior engineers: disjoint MCP, UE, runner, and docs ownership
- technical writer / lawyer: contract doc audit
- prosecutor / judge: adversarial mismatch review and final gate pass

## Tracks

- `MCP.md`
- `UE_AUTOMATION.md`
- `VERIFICATION.md`
- `DOCS.md`
- `BLUEPRINT_EXTRACTOR_ZERO_WARNING.md`

## Final Status

- [x] MCP contract hardening
- [x] UE subsystem and automation stabilization
- [x] Verification / PIE / screenshot expansion
- [x] Inline instanced DataAsset support
- [x] Docs and current-status refresh
- [x] Full validation pass

## Delivered

- MCP version is single-sourced from `MCP/package.json`.
- Public contract is 106 tools, 38 resources, 4 resource templates, and 12 prompts.
- UE 5.7 participates in engine-root fallback heuristics.
- `get_project_automation_context` exposes `isPlayingInEditor`.
- Added public tools:
  - `start_pie`
  - `stop_pie`
  - `relaunch_pie`
  - `capture_editor_screenshot`
  - `capture_runtime_screenshot`
- Verification artifacts are normalized around:
  - `editor_tool_viewport`
  - `pie_runtime`
- Generic DataAsset reflection now supports inline instanced `UObject` graphs for `UPROPERTY(Instanced)` / `EditInlineNew` values.
- Default UE automation remains `-NullRHI` safe, with rendered verification isolated behind `-NoNullRHI`.

## Validation Summary

- MCP:
  - `npm test` passed
  - `npm run test:pack-smoke` passed
  - `npm run test:publish-gate` passed
- UE 5.6 headless:
  - `BlueprintExtractor` passed with `failed=0`
- UE 5.7 headless:
  - `BlueprintExtractor` passed with `failed=0`
- UE 5.6 rendered targeted:
  - `BlueprintExtractor.ProjectControl.PIEAndScreenshots` passed
  - `BlueprintExtractor.Authoring.WidgetCaptureVerification` passed
  - `BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip` passed
- UE 5.7 rendered targeted:
  - `BlueprintExtractor.ProjectControl.PIEAndScreenshots` passed
  - `BlueprintExtractor.Authoring.WidgetCaptureVerification` passed
  - `BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip` passed

## Residual Notes

- Historical roadmap docs remain in the repo for context but are not the current contract. Use `docs/CURRENT_STATUS.md` before reading older plans.
