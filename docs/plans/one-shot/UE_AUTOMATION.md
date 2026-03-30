# UE Automation Track

## Scope

- `BlueprintExtractorSubsystem` behavior changes
- property serialization and DataAsset authoring
- fixture types and config
- automation spec fixes
- `scripts/test-ue.ps1` and `scripts/test-ue.sh` hardening

## Completed Outcomes

- Default `-NullRHI` automation is green on UE 5.6 and UE 5.7.
- Render-dependent assertions are isolated behind explicit rendered filters.
- `WidgetCompileFailureExtraction` now uses a deterministic compile-error fixture instead of a permissive `BindWidget` mismatch state.
- Widget diagnostics are stable for unsupported CommonUI wrapper surfaces and invalid property/class-default targets.
- DataAsset create/modify/extract flows round-trip inline instanced `UObject` graphs.
- `scripts/test-ue.ps1` now supports:
  - staged-project reuse
  - more aggressive orphan cleanup for UE/UBT/Uba processes
  - `-AllowSoftwareRendering` for rendered validation on this machine
  - `-FailOnWarnings` for strict release-lane gating on automation summaries

## Important Fixes

- `DoesAssetExist(...)` now verifies a real asset object instead of accepting permissive package-only resolution during create-time checks.
- The inline-instanced DataAsset fixture uses nested `classPath` + `properties` payloads and validates modify-only nested `properties` patches.
- The CommonUI rendered fixture config disables the `CommonUI.Debug.CheckGameViewportClientValid` blocker so the rendered verification lane can run without a project-specific `CommonGameViewportClient`.

## Validation

- UE 5.6 headless: passed
- UE 5.7 headless: passed
- UE 5.6 rendered targeted filters: passed
- UE 5.7 rendered targeted filters: passed

## Notes

- The validated default automation filter is `BlueprintExtractor`, not `BlueprintExtractor.*`.
- On this machine, rendered verification is reliable with `-NoNullRHI -AllowSoftwareRendering`.
