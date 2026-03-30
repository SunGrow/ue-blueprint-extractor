# Current Status

Last updated: 2026-03-30

## Validation Snapshot

Validated on this branch:

- Contract:
  - `106 tools`
  - `38 resources`
  - `4 resource templates`
  - `12 prompts`
- MCP:
  - `pwsh ./scripts/test-mcp.ps1 -PackSmoke -PublishDryRun`
  - passed
- UE 5.6 headless:
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6" -AutomationFilter "BlueprintExtractor" -FailOnWarnings`
  - passed
- UE 5.7 headless:
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.7" -AutomationFilter "BlueprintExtractor" -FailOnWarnings`
  - passed
- UE 5.6 rendered targeted:
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6" -AutomationFilter "BlueprintExtractor.ProjectControl.PIEAndScreenshots" -NoNullRHI -AllowSoftwareRendering -FailOnWarnings`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6" -AutomationFilter "BlueprintExtractor.Authoring.WidgetCaptureVerification" -NoNullRHI -AllowSoftwareRendering -FailOnWarnings`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6" -AutomationFilter "BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip" -NoNullRHI -AllowSoftwareRendering -FailOnWarnings`
  - passed
- UE 5.7 rendered targeted:
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.7" -AutomationFilter "BlueprintExtractor.ProjectControl.PIEAndScreenshots" -NoNullRHI -AllowSoftwareRendering -FailOnWarnings`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.7" -AutomationFilter "BlueprintExtractor.Authoring.WidgetCaptureVerification" -NoNullRHI -AllowSoftwareRendering -FailOnWarnings`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.7" -AutomationFilter "BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip" -NoNullRHI -AllowSoftwareRendering -FailOnWarnings`
  - passed
- Live MCP:
  - `$env:UE_REMOTE_CONTROL_HOST='127.0.0.1'; $env:UE_REMOTE_CONTROL_PORT='30110'; pwsh ./scripts/test-mcp.ps1 -Live -PackSmoke -PublishDryRun`
  - passed against a staged `BPXFixture` editor with the local plugin copy loaded

Current release gate:

- Release and nightly UE lanes fail on any warning summary when `scripts/test-ue.ps1 -FailOnWarnings` is used.
- Live MCP smoke is the release-candidate gate for a real editor/session.

## Normative Docs

Use these as the current public contract and workflow guidance:

- `README.md`
- `MCP/README.md`
- `docs/mcp-v2-reference.md`
- `docs/prompt-catalog.md`
- `docs/testing.md`
- `docs/unsupported-surfaces.md`
- `docs/ui-redesign-workflow.md`
- `docs/multimodal-ui-design-workflow.md`
- `docs/widget-motion-authoring.md`
- `docs/motion-verification-workflow.md`
- `docs/vision-verification-plan.md`

## Working Runbooks

Use these for the validated stabilization baseline, the next roadmap slice, and context-compression reload:

- `docs/plans/one-shot/MASTER.md`
- `docs/plans/one-shot/MCP.md`
- `docs/plans/one-shot/UE_AUTOMATION.md`
- `docs/plans/one-shot/VERIFICATION.md`
- `docs/plans/one-shot/DOCS.md`
- `docs/plans/one-shot/BLUEPRINT_EXTRACTOR_ZERO_WARNING.md`
- `docs/plans/2026-03-30-post-stabilization-improvement-plan.md`

## Historical Or Research Docs

These are useful background material, but they are not the current contract:

- `docs/VISION_AND_REQUIREMENTS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/FEATURE_FIT_RESEARCH_AND_DESIGN.md`
- `docs/TDD.md`
- `docs/EXECUTION_PROMPT.md`
- `docs/plans/*.md` outside `docs/plans/one-shot/`, except `docs/plans/2026-03-30-post-stabilization-improvement-plan.md`
- `docs/superpowers/**` (parallel Pipeline Studio material; not the Blueprint Extractor contract)

## Reading Order

1. Start with `README.md` or `MCP/README.md`.
2. Use `docs/mcp-v2-reference.md` for canonical tool names, result shapes, PIE/screenshot flows, and verification surfaces.
3. Use `docs/testing.md` for validated command lines and the headless-vs-rendered lane split.
4. Use `docs/plans/one-shot/` for the implementation ledger and validation notes that should survive context compression.
5. Use `docs/plans/2026-03-30-post-stabilization-improvement-plan.md` for the next post-stabilization roadmap slice.
