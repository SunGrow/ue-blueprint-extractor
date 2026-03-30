# Blueprint Extractor Zero-Warning Program

## Scope

This program applies to **Blueprint Extractor only**.

- `docs/superpowers/**` is parallel Pipeline Studio material.
- It is not authoritative for Blueprint Extractor contract, CI, or release gating.

## Team Topology

Program office:

- `Program Director`
- `MCP Engineering Manager`
- `UE Engineering Manager`
- `Quality / Release Manager`

Track leads:

- `Architecture Lead`
- `MCP Lead`
- `UE Lead`
- `Verification Lead`
- `Docs / DX Lead`
- `CI / CD Lead`

Execution bench:

- analysts
- researchers
- invited UE / domain experts
- senior system architect
- senior MCP engineer
- senior UE / plugin engineer
- verification / test engineers
- CI / CD engineer
- senior UX / doc designer
- technical writer
- release operator

Court roles:

- `Prosecutor`: challenges scope drift and weak heuristics
- `Lawyer`: audits contract wording and public promises
- `Judge`: signs off only when release gates are warning-free and normative docs contain no caveat notes

## Operating Rules

1. Every work item has one owner, one reviewer, one acceptance fixture, and one release gate.
2. Managers can add temporary specialists when a slice needs more depth.
3. Managers can stop and relaunch stuck workers.
4. Stuck means two failed review cycles, no verifiable progress in one workday, or repeated scope drift.
5. Release lanes fail on warning summaries; do not ship warning-tolerant automation.

## Release Gates

- PR gate:
  - `pwsh ./scripts/test-mcp.ps1 -PackSmoke -PublishDryRun`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot <UE_5_6_ROOT> -FailOnWarnings`
- Nightly / release gate:
  - UE 5.6 headless `BlueprintExtractor`
  - UE 5.7 headless `BlueprintExtractor`
  - rendered `PIEAndScreenshots`
  - rendered `WidgetCaptureVerification`
  - rendered `CommonUIButtonStyleRoundTrip`
  - gated live MCP smoke

## Change Control

- Keep the default MCP surface compact.
- Add new scopes only when the contract and fixtures are ready.
- Keep the release bar explicit in docs and workflows.
- Move historical or parallel-product material out of normative docs when it is not part of the current Blueprint Extractor contract.
