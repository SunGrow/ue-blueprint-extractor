<p align="center">
  <h1 align="center">Blueprint Extractor MCP</h1>
  <p align="center">
    Give AI assistants full read/write access to Unreal Engine projects<br>
    through a live editor connection.
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/blueprint-extractor-mcp"><img src="https://img.shields.io/npm/v/blueprint-extractor-mcp?style=flat-square&color=cb3837" alt="npm"></a>&nbsp;
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"></a>&nbsp;
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP_SDK-1.12-5A67D8?style=flat-square" alt="MCP SDK"></a>&nbsp;
  <a href="https://github.com/SunGrow/ue-blueprint-extractor/blob/master/LICENSE"><img src="https://img.shields.io/github/license/SunGrow/ue-blueprint-extractor?style=flat-square" alt="License"></a>
</p>

<br>

## Overview

Blueprint Extractor MCP is a [Model Context Protocol](https://modelcontextprotocol.io) server that bridges AI coding assistants (Claude Code, Codex, etc.) to a running Unreal Editor instance via the Remote Control HTTP API.

```
 AI Assistant         stdio           MCP Server         HTTP :30010        Unreal Editor
 ─────────────  ◄────────────►  ─────────────────  ◄──────────────────►  ─────────────────
  Claude Code                     Node.js process                         Remote Control API
  Codex                           89 tools                                BlueprintExtractor
  ...                             4 resource templates                    plugin
                                  8 prompts
```

**What the assistant can do through this server:**

| Capability | Examples |
|:-----------|:---------|
| **Extract** | Read Blueprints, widgets, materials, animations, data assets, state trees, and more |
| **Author** | Create and modify widgets, materials, Blueprints, input actions, AI assets, data tables |
| **Build** | Compile project code, trigger Live Coding, restart the editor, sync changes |
| **Import** | Bring in textures, meshes, and generic assets with async job polling |
| **Test** | Run UE automation tests, collect results and artifacts |
| **Verify** | Capture widget screenshots, compare against references, inspect motion checkpoints |

<br>

## Quick Start

### Prerequisites

You need three things running:

1. **Node.js 18+**
2. **Unreal Editor** with the **Remote Control API** plugin enabled
3. **[BlueprintExtractor](https://github.com/SunGrow/ue-blueprint-extractor)** plugin installed in your project

### Run

```bash
npx blueprint-extractor-mcp
```

Connects to the editor at `127.0.0.1:30010` by default.

### Add to Your AI Client

<table>
<tr><td><b>Claude Code</b></td></tr>
<tr><td>

```bash
claude mcp add -s user -t stdio blueprint-extractor \
  -e UE_REMOTE_CONTROL_PORT=30010 \
  -- npx -y blueprint-extractor-mcp@6.0.5
```

</td></tr>
<tr><td><b>Codex</b></td></tr>
<tr><td>

```bash
codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 \
  blueprint-extractor -- npx -y blueprint-extractor-mcp@6.0.5
```

</td></tr>
</table>

> On Windows, wrap `npx` with `cmd /c` if your shell requires it.

<br>

## Tool Surface

Only **~13 core tools** are visible by default to keep the context window lean. Specialized families are loaded on demand via `activate_workflow_scope`.

| Scope | Tools | What It Unlocks |
|:------|------:|:----------------|
| **Core** *(always on)* | ~13 | `extract_asset` `search_assets` `save_assets` `get_tool_help` `find_and_extract` |
| `widget_authoring` | 25 | Widget tree ops, compile, CommonUI button styles, widget animations, visual captures |
| `material_authoring` | 5 | `create_material` `modify_material` `material_graph_operation` + instances |
| `blueprint_authoring` | 4 | Blueprint members, graphs, `trigger_live_coding` |
| `schema_ai_authoring` | 11 | Structs, enums, Blackboards, Behavior Trees, State Trees |
| `animation_authoring` | 7 | Anim sequences, montages, blend spaces, widget motion |
| `data_tables` | 7 | Data assets, data tables, curves, Enhanced Input actions & mappings |
| `import` | 3 | `import_assets` with texture/mesh options, job polling |
| `automation_testing` | 4 | `run_automation_tests` + run inspection and artifact retrieval |
| `verification` | 7 | Widget captures, motion checkpoint bundles, reference comparisons |

### Contract Design

The tool contract is optimized for model reliability:

- **`snake_case`** inputs on all public tools
- **`outputSchema`** on every tool for structured JSON responses
- **`structuredContent`** carries the canonical success and error payload for MCP clients that consume structured results directly
- **Structured error envelopes** with diagnostic codes and recovery hints
- **Explicit-save semantics** &mdash; nothing persists until `save_assets` is called
- **Next-step hints** guiding the assistant toward the logical follow-up action

<br>

## Configuration

| Variable | Default | Purpose |
|:---------|:--------|:--------|
| `UE_REMOTE_CONTROL_HOST` | `127.0.0.1` | Editor host address |
| `UE_REMOTE_CONTROL_PORT` | `30010` | Editor Remote Control port |
| `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH` | *auto-probe* | Force a specific subsystem object path |
| `UE_ENGINE_ROOT` | &mdash; | Engine root (needed for builds & automation) |
| `UE_PROJECT_PATH` | &mdash; | Path to your `.uproject` |
| `UE_PROJECT_TARGET` | &mdash; | Build target name (or `UE_EDITOR_TARGET`) |
| `UE_BUILD_PLATFORM` | &mdash; | e.g. `Win64` |
| `UE_BUILD_CONFIGURATION` | &mdash; | e.g. `Development` |

<br>

## Resources & Prompts

Beyond tools, the server exposes **MCP resources** for reference data and **prompts** for guided multi-step workflows.

### Resource Templates

```
blueprint://examples/{family}              Example payloads for each tool family
blueprint://widget-patterns/{pattern}      Reusable widget-tree patterns
blueprint://captures/{capture_id}          Captured widget screenshots
blueprint://test-runs/{run_id}/{artifact}  Automation test artifacts
```

### Prompts

| Prompt | Guides the assistant through... |
|:-------|:-------------------------------|
| `normalize_ui_design_input` | Converting text/image/Figma/HTML into a shared `design_spec_json` |
| `design_menu_from_design_spec` | Planning a full menu implementation from a normalized spec |
| `design_menu_screen` | Safe widget redesign with pre-flight inspection |
| `author_material_button_style` | Composable material authoring for button states |
| `author_widget_motion_from_design_spec` | Turning motion specs into animation authoring steps |
| `plan_widget_motion_verification` | Keyframe-bundle verification planning |
| `wire_hud_widget_classes` | Class-default wiring for HUD assets |
| `debug_widget_compile_errors` | Diagnosing and recovering from compile failures |

<br>

## Development

```bash
cd MCP
npm install
npm run build
npm test            # unit + stdio integration
```

| Command | What It Validates |
|:--------|:------------------|
| `npm run test:pack-smoke` | Packaged tarball contract and README inclusion |
| `npm run test:publish-gate` | Version consistency and publish readiness |
| `BLUEPRINT_EXTRACTOR_LIVE_E2E=1 npm run test:live` | Full end-to-end against a running editor |

The live suite exercises texture/mesh import via HTTP fixtures, material authoring workflows, Enhanced Input round-trips, and asset persistence.

<br>

## Further Reading

- [Repository & UE Plugin](https://github.com/SunGrow/ue-blueprint-extractor)
- [MCP v2 Reference](../docs/mcp-v2-reference.md)
- [Widget Motion Authoring](../docs/widget-motion-authoring.md)
- [Motion Verification Workflow](../docs/motion-verification-workflow.md)
- [Prompt Catalog](../docs/prompt-catalog.md)

<br>

---

<p align="center">
  <a href="https://www.npmjs.com/package/blueprint-extractor-mcp">npm</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="https://github.com/SunGrow/ue-blueprint-extractor/issues">Issues</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="https://github.com/SunGrow/ue-blueprint-extractor">GitHub</a>
</p>
