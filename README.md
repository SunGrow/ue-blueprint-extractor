# Blueprint Extractor

> Unreal Engine plugin + MCP server for assistants that need to read, build, modify, verify, and save real UE assets instead of guessing.

[![npm version](https://img.shields.io/npm/v/blueprint-extractor-mcp)](https://www.npmjs.com/package/blueprint-extractor-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/SunGrow/ue-blueprint-extractor/ci.yml?branch=master&label=CI)](https://github.com/SunGrow/ue-blueprint-extractor/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![UE 5.x](https://img.shields.io/badge/Unreal_Engine-5.6%20%7C%205.7-blue)](https://www.unrealengine.com/)

Blueprint Extractor connects a running Unreal Editor to MCP clients such as [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://openai.com/index/codex/). It exposes a strict machine-friendly contract for extraction, authoring, visual verification, imports, project automation, and code sync.

**Current surface**

| Capability | Current contract |
|---|---|
| Tools | 90 |
| Resources | 16 |
| Resource templates | 4 |
| Prompts | 8 |
| Transport | MCP over stdio + Unreal Remote Control over HTTP |
| Save model | Explicit save via `save_assets` |

## Why This Exists

Most assistants can describe Unreal work. Blueprint Extractor lets them do it.

- Extract assets into structured JSON that models can inspect safely.
- Create and patch UE assets without relying on brittle editor-click instructions.
- Run project automation flows like compile, live coding, restart, and sync.
- Capture widget previews, compare references, and verify motion checkpoints.
- Keep writes explicit: mutate first, save when you decide.

Supported families include Blueprint, WidgetBlueprint, StateTree, BehaviorTree, Blackboard, DataAsset, DataTable, Curve, CurveTable, Material, Material Function-family assets, MaterialInstance, AnimSequence, AnimMontage, BlendSpace, InputAction, and InputMappingContext.

## What You Can Do

| Workflow | Typical tools |
|---|---|
| Find and inspect assets | `search_assets`, `find_and_extract`, `extract_asset`, `extract_blueprint`, `extract_material` |
| Build gameplay or UI assets | `create_*`, `modify_*`, `patch_widget`, `batch_widget_operations`, `modify_blueprint_members` |
| Work on materials | `create_material`, `modify_material`, `material_graph_operation`, `modify_material_instance` |
| Author data and AI assets | `create_data_table`, `modify_curve`, `create_state_tree`, `modify_behavior_tree`, `modify_blackboard` |
| Import external content | `import_assets`, `get_import_job`, `list_import_jobs` |
| Verify visuals and motion | `capture_widget_preview`, `compare_capture_to_reference`, `capture_widget_motion_checkpoints`, `compare_motion_capture_bundle` |
| Drive the project lifecycle | `compile_project_code`, `trigger_live_coding`, `restart_editor`, `sync_project_code`, `run_automation_tests` |

## Quick Start

### 1. Install the Unreal plugin

Copy `BlueprintExtractor/` into your project's `Plugins/` directory, rebuild, then enable:

- `EnhancedInput`
- `PropertyBindingUtils`
- `StateTree`
- `Web Remote Control`

### 2. Register the MCP server

Use the included install scripts:

```bash
# Claude Code
./install-mcp.sh
.\install-mcp.ps1

# Codex
./install-codex-mcp.sh
.\install-codex-mcp.ps1
```

Manual registration is also supported:

```bash
# Claude Code
claude mcp add -s user -t stdio blueprint-extractor -e UE_REMOTE_CONTROL_PORT=30010 -- npx -y blueprint-extractor-mcp@latest
claude mcp add -s user -t stdio blueprint-extractor -e UE_REMOTE_CONTROL_PORT=30010 -- cmd /c npx -y blueprint-extractor-mcp@latest

# Codex
codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 blueprint-extractor -- npx -y blueprint-extractor-mcp@latest
codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 blueprint-extractor -- cmd /c npx -y blueprint-extractor-mcp@latest
```

### 3. Verify the connection

Open a new MCP-enabled assistant session and ask for:

- `search_assets` on a known Blueprint
- `get_tool_help` for a tool you plan to use
- `capture_widget_preview` on a fixture widget if you want to confirm verification works end-to-end

## What The Contract Feels Like

Blueprint Extractor is built around a few durable rules:

- Public inputs use `snake_case`.
- Tool results publish `outputSchema`.
- Success and failure responses come back as structured envelopes.
- Write tools mutate assets but do not silently save them.
- Static guidance lives in MCP resources and prompts, not buried in prose.

Key references:

- [MCP v2 Reference](docs/mcp-v2-reference.md)
- [Prompt Catalog](docs/prompt-catalog.md)
- [Multimodal UI Design Workflow](docs/multimodal-ui-design-workflow.md)
- [Widget Motion Authoring](docs/widget-motion-authoring.md)
- [Motion Verification Workflow](docs/motion-verification-workflow.md)
- [Unsupported Surfaces](docs/unsupported-surfaces.md)
- [Safe UI Redesign Workflow](docs/ui-redesign-workflow.md)

## Workflow-Scoped Tool Surface

The server exposes a compact default surface and expands into specialized families when needed through `activate_workflow_scope`.

| Scope | Focus |
|---|---|
| Core | Search, extract, list, save, help, verification entry points |
| `widget_authoring` | Widget tree edits, widget class defaults, CommonUI, compile flows |
| `material_authoring` | Material creation, graph operations, instances, refresh |
| `blueprint_authoring` | Blueprint creation, member edits, graph edits |
| `schema_ai_authoring` | Structs, enums, blackboards, behavior trees, state trees |
| `animation_authoring` | Anim sequences, montages, blend spaces, widget motion |
| `data_tables` | Data assets, tables, curves, input actions, mapping contexts |
| `import` | Import jobs and import status |
| `automation_testing` | Host-side automation runs and inspection |
| `verification` | Capture, compare, list, cleanup, and motion verification |

## Resources And Prompts

The server is more than a tool list. It also publishes reusable guidance and structured examples.

**Resources**

- `blueprint://scopes`
- `blueprint://verification-workflows`
- `blueprint://project-automation`
- `blueprint://material-graph-guidance`
- `blueprint://font-roles`

**Resource templates**

- `blueprint://examples/{family}`
- `blueprint://widget-patterns/{pattern}`
- `blueprint://captures/{capture_id}`
- `blueprint://test-runs/{run_id}/{artifact}`

**Prompts**

- `normalize_ui_design_input`
- `design_menu_from_design_spec`
- `author_widget_motion_from_design_spec`
- `plan_widget_motion_verification`

## Requirements

| Requirement | Notes |
|---|---|
| Unreal Engine | Tested on 5.6 and 5.7 |
| Node.js | 18+ |
| Unreal plugins | `EnhancedInput`, `PropertyBindingUtils`, `StateTree`, `Web Remote Control` |
| Runtime | Editor-only; not intended for packaged builds |

Environment variables used most often:

| Variable | Default | Purpose |
|---|---|---|
| `UE_REMOTE_CONTROL_HOST` | `127.0.0.1` | Editor host |
| `UE_REMOTE_CONTROL_PORT` | `30010` | Remote Control HTTP port |
| `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH` | auto-probe | Explicit subsystem object path override |
| `UE_ENGINE_ROOT` | unset | Engine root for builds and automation |
| `UE_PROJECT_PATH` | unset | `.uproject` path |
| `UE_PROJECT_TARGET` / `UE_EDITOR_TARGET` | unset | Build target |

## Development

### MCP server

```bash
cd MCP
npm install
npm run build
npm test
```

### Unreal automation tests

The repository includes a fixture project at `tests/fixtures/BlueprintExtractorFixture/BPXFixture.uproject`.

```bash
.\scripts\test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6"
./scripts/test-ue.sh --engine-root "/path/to/UE_5.6"
```

### Live MCP smoke tests

```bash
cd MCP
BLUEPRINT_EXTRACTOR_LIVE_E2E=1 npm run test:live
```

## Repository Layout

```text
BlueprintExtractor/   Unreal plugin source
MCP/                  MCP server package published as blueprint-extractor-mcp
docs/                 Contract and workflow documentation
scripts/              Cross-platform helper scripts
tests/                Fixture UE project and automation helpers
```

## Contributing

Before opening a PR:

- run `npm test` in `MCP/`
- run the Unreal automation test script if you changed plugin behavior
- keep tool contracts, docs, and tests aligned in the same change

## Package README

If you only need the npm package view, see [MCP/README.md](MCP/README.md).

