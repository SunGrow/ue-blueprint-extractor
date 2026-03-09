# `blueprint-extractor-mcp`

MCP server for the Unreal Engine `BlueprintExtractor` plugin.

This package exposes the `blueprint-extractor` server over stdio and talks to a running Unreal Editor through the Remote Control HTTP API.

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
```

For the gated live smoke test:

```bash
BLUEPRINT_EXTRACTOR_LIVE_E2E=1 npm run test:live
```

Repository and full documentation:

- <https://github.com/SunGrow/ue-blueprint-extractor>
