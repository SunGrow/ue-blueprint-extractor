# Verification Track

## Scope

- PIE lifecycle control
- runtime and editor screenshot capture
- verification artifact normalization
- rendered-vs-headless lane contract

## Completed Outcomes

- PIE lifecycle has explicit tool coverage:
  - `start_pie`
  - `stop_pie`
  - `relaunch_pie`
- Runtime and editor screenshot capture share the same verification-artifact contract as widget preview and compare flows.
- Automation-backed runtime artifacts normalize to `pie_runtime`.
- Editor viewport captures normalize to `editor_tool_viewport`.
- Public guidance now makes the lane split explicit:
  - headless/default for logic and authoring proof
  - rendered for screenshot-backed verification

## Validation

- MCP contract tests for the new tools and result shapes passed.
- UE 5.6 and UE 5.7 rendered targeted automation passed for:
  - `BlueprintExtractor.ProjectControl.PIEAndScreenshots`
  - `BlueprintExtractor.Authoring.WidgetCaptureVerification`
  - `BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip`

## Notes

- `capture_runtime_screenshot` is automation-backed. It returns the first normalized `pie_runtime` artifact exported by the target scenario.
- Screenshots support verification, but they do not replace semantic extraction or gameplay assertions.
