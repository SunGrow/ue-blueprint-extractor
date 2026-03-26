# Blueprint Extractor MCP

> MCP server for Unreal Engine projects that need real asset extraction, authoring, verification, and project automation through a running editor.

[![npm version](https://img.shields.io/npm/v/blueprint-extractor-mcp)](https://www.npmjs.com/package/blueprint-extractor-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.12-blue)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/github/license/SunGrow/ue-blueprint-extractor)](https://github.com/SunGrow/ue-blueprint-extractor/blob/master/LICENSE)

Blueprint Extractor MCP connects assistants such as Claude Code and Codex to a live Unreal Editor over the Remote Control API. It exposes a structured contract for:

- asset extraction
- widget, material, Blueprint, AI, data, and input authoring
- asset import with async job tracking
- visual capture and motion verification
- compile, live coding, editor restart, and automation execution

## At A Glance

| Surface | Count |
|---|---:|
| Tools | 90 |
| Resources | 16 |
| Resource templates | 4 |
| Prompts | 8 |

## Quick Start

### Requirements

| Requirement | Notes |
|---|---|
| Node.js | 18+ |
| Unreal Editor | Running with Remote Control enabled |
| BlueprintExtractor plugin | Installed in the target UE project |

### Run directly

```bash
npx blueprint-extractor-mcp
```

The server talks to the editor on `127.0.0.1:30010` by default.

### Register with an MCP client

```bash
# Claude Code
claude mcp add -s user -t stdio blueprint-extractor -e UE_REMOTE_CONTROL_PORT=30010 -- npx -y blueprint-extractor-mcp@latest

# Codex
codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 blueprint-extractor -- npx -y blueprint-extractor-mcp@latest
```

On Windows, wrap `npx` with `cmd /c`.

## Tool Surface

The server keeps a compact default tool surface and expands into specialized workflow families with `activate_workflow_scope`.

| Scope | Focus |
|---|---|
| Core | Search, extract, save, help, verification entry points |
| `widget_authoring` | Widget tree work, compile flows, CommonUI |
| `material_authoring` | Material graphs, settings, instances |
| `blueprint_authoring` | Blueprint creation and patching |
| `schema_ai_authoring` | StateTree, BehaviorTree, Blackboard, enums, structs |
| `animation_authoring` | Anim sequences, montages, blend spaces, widget motion |
| `data_tables` | Data assets, tables, curves, input assets |
| `import` | Import jobs and job inspection |
| `automation_testing` | Automation runs and artifacts |
| `verification` | Captures, comparisons, motion verification |

Representative tools:

```text
extract_asset
find_and_extract
search_assets
material_graph_operation
capture_widget_preview
compare_motion_capture_bundle
compile_project_code
sync_project_code
run_automation_tests
get_tool_help
```

## Contract Shape

The public contract is designed for model reliability:

- `snake_case` public inputs
- `outputSchema` on public tools
- structured success and error envelopes
- explicit-save semantics
- reusable resources and prompts for guidance-heavy workflows

Useful docs:

- [Repository README](../README.md)
- [MCP v2 Reference](../docs/mcp-v2-reference.md)
- [Prompt Catalog](../docs/prompt-catalog.md)
- [Widget Motion Authoring](../docs/widget-motion-authoring.md)
- [Motion Verification Workflow](../docs/motion-verification-workflow.md)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `UE_REMOTE_CONTROL_HOST` | `127.0.0.1` | Remote Control host |
| `UE_REMOTE_CONTROL_PORT` | `30010` | Remote Control port |
| `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH` | auto-probe | Explicit subsystem object path |
| `UE_ENGINE_ROOT` | unset | Engine root for build and automation tools |
| `UE_PROJECT_PATH` | unset | `.uproject` path |
| `UE_PROJECT_TARGET` / `UE_EDITOR_TARGET` | unset | Build target |

## Resources And Prompts

The package also exposes non-tool guidance surfaces.

Resource templates:

```text
blueprint://examples/{family}
blueprint://widget-patterns/{pattern}
blueprint://captures/{capture_id}
blueprint://test-runs/{run_id}/{artifact}
```

Prompt families cover design normalization, menu authoring, widget motion authoring, and motion verification planning.

## Local Development

```bash
cd MCP
npm install
npm run build
npm test
```

Additional suites:

| Command | Purpose |
|---|---|
| `npm run test:pack-smoke` | Validate the packaged tarball |
| `npm run test:publish-gate` | Publish readiness checks |
| `BLUEPRINT_EXTRACTOR_LIVE_E2E=1 npm run test:live` | Live end-to-end editor validation |

## Links

- [Repository](https://github.com/SunGrow/ue-blueprint-extractor)
- [Issues](https://github.com/SunGrow/ue-blueprint-extractor/issues)
- [npm package](https://www.npmjs.com/package/blueprint-extractor-mcp)
