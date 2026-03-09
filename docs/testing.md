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
- Optional fixture extraction smoke paths for `-Live`:
  `BLUEPRINT_EXTRACTOR_TEST_BLUEPRINT`, `BLUEPRINT_EXTRACTOR_TEST_WIDGET_BLUEPRINT`, `BLUEPRINT_EXTRACTOR_TEST_STATE_TREE`, `BLUEPRINT_EXTRACTOR_TEST_BEHAVIOR_TREE`, `BLUEPRINT_EXTRACTOR_TEST_BLACKBOARD`, `BLUEPRINT_EXTRACTOR_TEST_DATA_ASSET`, `BLUEPRINT_EXTRACTOR_TEST_DATA_TABLE`, `BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_STRUCT`, `BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_ENUM`, `BLUEPRINT_EXTRACTOR_TEST_CURVE`, `BLUEPRINT_EXTRACTOR_TEST_CURVE_TABLE`, `BLUEPRINT_EXTRACTOR_TEST_MATERIAL_INSTANCE`, `BLUEPRINT_EXTRACTOR_TEST_ANIM_SEQUENCE`, `BLUEPRINT_EXTRACTOR_TEST_ANIM_MONTAGE`, `BLUEPRINT_EXTRACTOR_TEST_BLEND_SPACE`.

The default MCP run executes:

- `tests/server-contract.test.ts`: in-memory contract checks against the exported `createBlueprintExtractorServer(...)`.
- `tests/ue-client.test.ts`: HTTP-layer `UEClient` coverage with a local mock Remote Control server.
- `tests/stdio.integration.test.ts`: real stdio server smoke test against the built `dist/index.js`.
- `tests/live.e2e.test.ts`: gated end-to-end import and extraction smoke against a real editor. It imports a texture through a local HTTP fixture server, verifies header forwarding, imports a local mesh fixture, polls job status, and explicitly saves the imported assets.

Live MCP smoke requires a running editor with the plugin loaded. Set:

- `BLUEPRINT_EXTRACTOR_LIVE_E2E=1`
- `UE_REMOTE_CONTROL_HOST`
- `UE_REMOTE_CONTROL_PORT`
- optionally `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH` for a deterministic subsystem path override

## UE Automation

The checked-in fixture shell lives at `tests/fixtures/BlueprintExtractorFixture/`.
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
- `-SkipBuildProject` or `--skip-build-project`: skip the fixture editor target build and only run the editor command.
- `-AutomationFilter` or `--automation-filter`: override the default `BlueprintExtractor` test filter.

The UE runner:

1. stages the fixture project into a temp directory,
2. syncs `BlueprintExtractor/` into the staged fixture's `Plugins/BlueprintExtractor`,
3. optionally runs `BuildPlugin`,
4. builds `BlueprintExtractorFixtureEditor`,
5. runs headless editor automation via `UnrealEditor-Cmd`.

The current automation spec focuses on subsystem-level create/modify/extract/save workflows under `/Game/__GeneratedTests__` and explicit-save semantics.

## CI Shape

Recommended CI split:

- PR gate:
  - `pwsh ./scripts/test-mcp.ps1`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot <UE_5_6_ROOT>`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot <UE_5_6_ROOT> -BuildPlugin -SkipBuildProject`
- Nightly or release:
  - repeat the PR gate on UE 5.6 and 5.7
  - add the live MCP smoke pass with `BLUEPRINT_EXTRACTOR_LIVE_E2E=1`

Do not run `install-mcp.*`, `install-codex-mcp.*`, `claude mcp add`, or `codex mcp add` in shared CI. Those flows mutate user-global client configuration and should stay manual or isolated-config only.
