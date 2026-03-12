# `blueprint-extractor-mcp`

MCP server for the Unreal Engine `BlueprintExtractor` plugin.

This package exposes the `blueprint-extractor` server over stdio and talks to a running Unreal Editor through the Remote Control HTTP API.

Current surface area includes:

- read-only extraction tools for Blueprints, AI assets, data assets, curves, materials, and animation metadata
- explicit-save authoring tools for the supported editor-side asset families, including compact widget extraction, incremental widget-structure ops, widget class-default routing, and classic material graph authoring for materials and MaterialFunction-family assets
- async import and reimport tools with polling for generic assets plus typed texture and mesh helpers
- host-side project automation tools for external builds, Live Coding requests, restart/reconnect orchestration, and a thin window-polish helper
- static guidance resources and resource templates for authoring conventions, selector rules, font roles, project automation, example payloads, widget patterns, and classic material graph guidance

## Requirements

- Node.js 18+
- Unreal Editor with the `Remote Control API` plugin enabled
- The `BlueprintExtractor` UE plugin loaded in the editor

## Run

```bash
npx blueprint-extractor-mcp
```

The server reads `UE_REMOTE_CONTROL_PORT` and defaults to `30010`.

You can also set `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH` to force a specific subsystem object path instead of using the built-in probe list.

For host-side code automation, these optional env vars are supported:

- `UE_ENGINE_ROOT`
- `UE_PROJECT_PATH`
- `UE_PROJECT_TARGET` or `UE_EDITOR_TARGET`
- `UE_BUILD_PLATFORM`
- `UE_BUILD_CONFIGURATION`

## Install In MCP Clients

Claude Code:

```bash
claude mcp add -s user -t stdio blueprint-extractor -e UE_REMOTE_CONTROL_PORT=30010 -- npx -y blueprint-extractor-mcp@latest
```

Codex:

```bash
codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 blueprint-extractor -- npx -y blueprint-extractor-mcp@latest
```

## Local Development

```bash
npm install
npm run build
npm test
npm run test:pack-smoke
npm publish --dry-run
```

For the gated live smoke test:

```bash
BLUEPRINT_EXTRACTOR_LIVE_E2E=1 npm run test:live
```

The live suite imports a texture over a local HTTP fixture server, verifies request-header forwarding, imports a local mesh fixture, polls both jobs to completion, and also smoke-tests scratch material, material function, and material instance authoring before saving the returned asset paths.

The default unit/stdio suites also cover resource-template registration, the narrowed widget surfaces (`extract_widget_blueprint`, `modify_widget`, `modify_widget_blueprint`), the host-side project-control tools (`compile_project_code`, `trigger_live_coding`, `restart_editor`, `sync_project_code`, `apply_window_ui_changes`), and the compact material graph surfaces (`extract_material`, `modify_material`).

Repository and full documentation:

- <https://github.com/SunGrow/ue-blueprint-extractor>
