# Testing

`ue-blueprint-extractor` uses three test layers:

1. MCP contract and transport tests under `MCP/tests`.
2. UE editor automation in `BlueprintExtractor/Source/BlueprintExtractor/Private/Tests`.
3. A gated live UE-to-MCP smoke path against a real editor with Remote Control enabled.

## MCP Tests

From the repository root:

```powershell
pwsh ./scripts/test-mcp.ps1
```

Useful flags:

- `-Install`: run `npm install` in `MCP/` first.
- `-Live`: run the gated live MCP smoke suite instead of the default unit + stdio pass.
- `-PackSmoke`: run `npm run test:pack-smoke` after the main MCP suite.
- `-PublishDryRun`: run `npm publish --dry-run` after the main MCP suite.

The default MCP path covers:

- contract registration, resource templates, prompts, and output schemas
- tool-profile switching, scope activation, and tool-surface management
- `project_control` tools including `get_project_automation_context`, `start_pie`, `stop_pie`, and `relaunch_pie`
- verification tools including `capture_widget_preview`, `capture_editor_screenshot`, `capture_runtime_screenshot`, and comparison flows
- version/count drift, static resources, example catalogs, and pack/publish gates

## UE Automation

The checked-in fixture shell lives under `tests/fixtures/BlueprintExtractorFixture/` with the project file `BPXFixture.uproject`.
The fixture intentionally does not commit a plugin copy; `scripts/test-ue.ps1` and `scripts/test-ue.sh` stage the fixture to a temp directory and sync the local `BlueprintExtractor/` plugin into `Plugins/BlueprintExtractor` there.
Each staged UE automation run allocates its own free Remote Control HTTP port and patches the staged `DefaultEngine.ini` before launch, so the fixture editor does not collide with a developer-owned editor already using `30010`.

Windows:

```powershell
pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6"
```

macOS/Linux:

```bash
./scripts/test-ue.sh --engine-root "/path/to/UE_5.6"
```

Useful options:

- `-BuildPlugin` / `--build-plugin`: run `RunUAT BuildPlugin` before the automation run.
- `-SkipBuildProject` / `--skip-build-project`: reuse an existing staged fixture build when the staged editor target already exists.
- `-AutomationFilter` / `--automation-filter`: override the default filter. The validated default is `BlueprintExtractor`.
- `-NoNullRHI` / `--no-null-rhi`: enable rendered verification lanes.
- `-AllowSoftwareRendering`: Windows-only helper for rendered lanes on machines where software rendering is needed.
- `-FailOnWarnings`: fail the automation lane when the report summary contains warnings.

The UE runner:

1. stages the fixture project into a temp directory,
2. syncs `BlueprintExtractor/` into the staged fixture,
3. assigns a unique staged Remote Control HTTP port,
4. optionally runs `BuildPlugin`,
5. builds `BPXFixtureEditor`,
6. runs automation through `UnrealEditor-Cmd`.

### Lane Split

Two automation lanes are part of the current contract:

- Headless/default lane:
  - uses `-NullRHI`
  - default filter is `BlueprintExtractor`
  - covers extraction, create/modify/save flows, blueprint graph authoring, state trees, montages, sequences, data assets/data tables, inline instanced DataAsset graphs, property diagnostics, compile-failure extraction, CommonUI logical round-trips, and project-control smoke
- Rendered verification lane:
  - uses `-NoNullRHI`
  - can add `-AllowSoftwareRendering` on Windows when needed
  - covers screenshot-backed or render-dependent flows such as `BlueprintExtractor.ProjectControl.PIEAndScreenshots`, `BlueprintExtractor.Authoring.WidgetCaptureVerification`, and `BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip`

Screenshot assertions and rendered comparison work belong in the rendered lane, not the default `-NullRHI` lane.

### Example Commands

Headless full pass:

```powershell
pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.7" -FailOnWarnings
```

Rendered PIE/editor/runtime screenshot lane:

```powershell
pwsh ./scripts/test-ue.ps1 `
  -EngineRoot "C:\Program Files\Epic Games\UE_5.7" `
  -AutomationFilter "BlueprintExtractor.ProjectControl.PIEAndScreenshots" `
  -NoNullRHI `
  -AllowSoftwareRendering `
  -FailOnWarnings
```

Rendered widget capture lane:

```powershell
pwsh ./scripts/test-ue.ps1 `
  -EngineRoot "C:\Program Files\Epic Games\UE_5.7" `
  -AutomationFilter "BlueprintExtractor.Authoring.WidgetCaptureVerification" `
  -NoNullRHI `
  -AllowSoftwareRendering `
  -FailOnWarnings
```

## Live MCP Smoke

From `MCP/`:

```powershell
cd MCP
$env:BLUEPRINT_EXTRACTOR_LIVE_E2E = "1"
npm run test:live
```

Live smoke requires a running editor with the plugin loaded. Set:

- `UE_REMOTE_CONTROL_HOST`
- `UE_REMOTE_CONTROL_PORT`
- optionally `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH`
- optionally `UE_ENGINE_ROOT`, `UE_PROJECT_PATH`, and `UE_PROJECT_TARGET` / `UE_EDITOR_TARGET`

Multi-editor note:

- every simultaneously running Unreal Editor must expose a distinct Remote Control port
- MCP sessions now bind to one active editor at a time; when the workspace project matches multiple editors, the session stays unbound until `select_editor`
- launching the MCP session inside a project directory only auto-binds when exactly one running editor matches that `.uproject`

The live suite covers real stdio startup, widget authoring, material authoring, import jobs, Enhanced Input round-trips, explicit save flows, and project-control round-trips.

## Validation Snapshot

Validated on `2026-03-30`:

- MCP:
  - `cd MCP && npm test`
  - `cd MCP && npm run test:pack-smoke`
  - `cd MCP && npm run test:publish-gate`
- UE 5.6 headless:
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6"`
  - result: `succeeded=9`, `failed=0`
- UE 5.7 headless:
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.7"`
  - result: `succeeded=9`, `failed=0`
- UE 5.6 rendered targeted:
  - `BlueprintExtractor.ProjectControl.PIEAndScreenshots`
  - `BlueprintExtractor.Authoring.WidgetCaptureVerification`
  - `BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip`
  - passed
- UE 5.7 rendered targeted:
  - `BlueprintExtractor.ProjectControl.PIEAndScreenshots`
  - `BlueprintExtractor.Authoring.WidgetCaptureVerification`
  - `BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip`
  - passed

## CI Shape

Recommended split:

- PR gate:
  - `pwsh ./scripts/test-mcp.ps1 -PackSmoke -PublishDryRun`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot <UE_5_6_ROOT> -FailOnWarnings`
- Rendered validation:
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot <UE_5_6_ROOT> -AutomationFilter "BlueprintExtractor.ProjectControl.PIEAndScreenshots" -NoNullRHI -AllowSoftwareRendering -FailOnWarnings`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot <UE_5_6_ROOT> -AutomationFilter "BlueprintExtractor.Authoring.WidgetCaptureVerification" -NoNullRHI -AllowSoftwareRendering -FailOnWarnings`
  - `pwsh ./scripts/test-ue.ps1 -EngineRoot <UE_5_6_ROOT> -AutomationFilter "BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip" -NoNullRHI -AllowSoftwareRendering -FailOnWarnings`
- Nightly or release:
  - repeat the headless and rendered split on UE 5.6 and UE 5.7
  - add the gated live MCP smoke path after the contract suite

Do not run `install-mcp.*`, `install-codex-mcp.*`, `install-opencode-mcp.*`, `claude mcp add`, `codex mcp add`, or `opencode mcp add` in shared CI. Those commands mutate user-global client configuration.
