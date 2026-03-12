# Testing

`ue-blueprint-extractor` now has three test layers:

1. UE editor automation inside the plugin under `BlueprintExtractor/Source/BlueprintExtractor/Private/Tests`.
2. MCP contract and transport tests under `MCP/tests` with `vitest`.
3. A gated live UE-to-MCP smoke path that targets a real editor with Remote Control enabled.

## MCP Tests

From the repository root:

```powershell
pwsh ./scripts/test-mcp.ps1
```

Optional flags:

- `-Install`: run `npm install` in `MCP/` before the test pass.
- `-Live`: run the gated live MCP smoke suite (`npm run test:live`) instead of the default unit + stdio pass.
- `-PackSmoke`: run `npm run test:pack-smoke` after the main MCP suite.
- `-PublishDryRun`: run `npm publish --dry-run` after the main MCP suite.
- Optional fixture extraction smoke paths for `-Live`:
  `BLUEPRINT_EXTRACTOR_TEST_BLUEPRINT`, `BLUEPRINT_EXTRACTOR_TEST_WIDGET_BLUEPRINT`, `BLUEPRINT_EXTRACTOR_TEST_STATE_TREE`, `BLUEPRINT_EXTRACTOR_TEST_BEHAVIOR_TREE`, `BLUEPRINT_EXTRACTOR_TEST_BLACKBOARD`, `BLUEPRINT_EXTRACTOR_TEST_DATA_ASSET`, `BLUEPRINT_EXTRACTOR_TEST_DATA_TABLE`, `BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_STRUCT`, `BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_ENUM`, `BLUEPRINT_EXTRACTOR_TEST_CURVE`, `BLUEPRINT_EXTRACTOR_TEST_CURVE_TABLE`, `BLUEPRINT_EXTRACTOR_TEST_MATERIAL`, `BLUEPRINT_EXTRACTOR_TEST_MATERIAL_FUNCTION`, `BLUEPRINT_EXTRACTOR_TEST_MATERIAL_INSTANCE`, `BLUEPRINT_EXTRACTOR_TEST_ANIM_SEQUENCE`, `BLUEPRINT_EXTRACTOR_TEST_ANIM_MONTAGE`, `BLUEPRINT_EXTRACTOR_TEST_BLEND_SPACE`.

The default MCP run executes:

- `tests/server-contract.test.ts`: in-memory contract checks against the exported `createBlueprintExtractorServer(...)`.
  Covers static resources, resource templates, compact widget/material extraction, widget-path mutation routing, host-side project-control tools, and structured error behavior.
- `tests/ue-client.test.ts`: HTTP-layer `UEClient` coverage with a local mock Remote Control server.
- `tests/project-controller.test.ts`: host-side build command selection, changed-path classification, and restart/reconnect polling.
- `tests/stdio.integration.test.ts`: real stdio server smoke test against the built `dist/index.js`, including the material graph guidance resource plus compact material read/write transport coverage.
- `tests/pack-smoke.mjs`: `npm pack` plus `npx blueprint-extractor-mcp` startup smoke from the produced tarball.
- `tests/live.e2e.test.ts`: gated end-to-end import and extraction smoke against a real editor. It imports a texture through a local HTTP fixture server, verifies header forwarding, imports a local mesh fixture, creates scratch material-family assets, polls job status, and explicitly saves the imported and authored assets.

Live MCP smoke requires a running editor with the plugin loaded. Set:

- `BLUEPRINT_EXTRACTOR_LIVE_E2E=1`
- `UE_REMOTE_CONTROL_HOST`
- `UE_REMOTE_CONTROL_PORT`
- optionally `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH` for a deterministic subsystem path override
- optionally `UE_ENGINE_ROOT`, `UE_PROJECT_PATH`, and `UE_PROJECT_TARGET` / `UE_EDITOR_TARGET` for host-side `compile_project_code` and `sync_project_code`

The narrowed project-code path is intentionally explicit:

- `sync_project_code` requires `changed_paths`
- generic Live Coding `Failure` is returned directly to the caller
- automatic fallback is only used for deterministic preconditions such as unsupported or unavailable Live Coding

## UE Automation

The checked-in fixture shell lives at `tests/fixtures/BlueprintExtractorFixture/`, with the short project file `BPXFixture.uproject`.
The fixture intentionally does not commit a plugin copy; `scripts/test-ue.*` stage the fixture to a temp directory and sync the local `BlueprintExtractor/` plugin into `Plugins/BlueprintExtractor` there.

Windows:

```powershell
pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6"
```

macOS/Linux:

```bash
./scripts/test-ue.sh --engine-root "/path/to/UE_5.6"
```

Useful options:

- `-BuildPlugin` or `--build-plugin`: run `RunUAT BuildPlugin` as a packaging gate before the automation run.
- `-SkipBuildProject` or `--skip-build-project`: reuse an existing staged fixture build when `Binaries/<platform>/<ProjectName>Editor.target` is already present. On a fresh stage, the runner falls back to building the fixture editor target.
- `-AutomationFilter` or `--automation-filter`: override the default `BlueprintExtractor` test filter.

The UE runner:

1. stages the fixture project into a temp directory,
2. syncs `BlueprintExtractor/` into the staged fixture's `Plugins/BlueprintExtractor`,
3. optionally runs `BuildPlugin`,
4. builds `BPXFixtureEditor`,
5. runs headless editor automation via `UnrealEditor-Cmd`.

The current automation spec focuses on subsystem-level create/modify/extract/save workflows under `/Game/__GeneratedTests__`, explicit-save semantics, native `BindWidget` reconciliation, compact widget extraction, structural widget mutations, classic material graph authoring, material-instance parity, and a CommonUI parent canary.

## CI Shape

Recommended CI split:

- PR gate:
  - `pwsh ./scripts/test-mcp.ps1 -PackSmoke -PublishDryRun`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot <UE_5_6_ROOT>`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot <UE_5_6_ROOT> -BuildPlugin -AutomationFilter "BlueprintExtractor.Authoring.CommonUIWidgetRoundTrip"`
- Nightly or release:
  - repeat the PR gate on UE 5.6 and 5.7
  - add the live MCP smoke pass with `BLUEPRINT_EXTRACTOR_LIVE_E2E=1`

The repository now includes:

- `.github/workflows/ci.yml` for PR and push gates
- `.github/workflows/nightly.yml` for scheduled or manual nightly runs

The UE workflow lanes are intentionally opt-in so public pushes do not queue forever when no self-hosted UE runner is online.

- `ci.yml`
  - MCP gates always run.
  - UE 5.6 runs on push/PR only when `UE_5_6_CI_ENABLED=true` and `UE_5_6_ROOT` is set.
  - UE 5.7 runs on push/PR only when `UE_5_7_CI_ENABLED=true` and `UE_5_7_ROOT` is set.
  - Manual dispatch can force either UE lane with the `run_ue_5_6` / `run_ue_5_7` inputs.
- `nightly.yml`
  - scheduled UE jobs are also opt-in through the same repo vars
  - live MCP runs only when `UE_LIVE_CI_ENABLED=true` and Remote Control vars are set
  - manual dispatch can force UE or live lanes with workflow inputs

When enabled, the UE lanes assume self-hosted Windows runners labeled `ue-5.6`, `ue-5.7`, and `ue-live`, plus repository variables such as `UE_5_6_ROOT`, `UE_5_7_ROOT`, `UE_REMOTE_CONTROL_HOST`, and `UE_REMOTE_CONTROL_PORT`.

Do not run `install-mcp.*`, `install-codex-mcp.*`, `claude mcp add`, or `codex mcp add` in shared CI. Those flows mutate user-global client configuration and should stay manual or isolated-config only.
