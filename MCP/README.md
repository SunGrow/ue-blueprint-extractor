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

Blueprint Extractor MCP is a [Model Context Protocol](https://modelcontextprotocol.io) server that bridges AI coding assistants (Claude Code, Codex, OpenCode, etc.) to a running Unreal Editor instance via the Remote Control HTTP API.

```
 AI Assistant         stdio           MCP Server         HTTP :30010        Unreal Editor
 ─────────────  ◄────────────►  ─────────────────  ◄──────────────────►  ─────────────────
  Claude Code                     Node.js process                         Remote Control API
  Codex / OpenCode                106 tools                               BlueprintExtractor
  ...                             38 resources                            plugin
                                  4 resource templates
                                  12 prompts
```

**What the assistant can do through this server:**

| Capability | Examples |
|:-----------|:---------|
| **Extract** | Read Blueprints, widgets, materials, animations, data assets, state trees, and more |
| **Author** | Create and modify widgets, materials, Blueprints, input actions, AI assets, data tables |
| **Build** | Compile project code, trigger Live Coding, restart the editor, sync changes |
| **PIE** | Start, stop, and relaunch Play-In-Editor sessions from the active editor |
| **Import** | Bring in textures, meshes, and generic assets with async job polling |
| **Test** | Run UE automation tests, collect results and artifacts |
| **Verify** | Capture widget previews, editor screenshots, runtime screenshots, compare against references, inspect motion checkpoints |

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
  -- npx -y blueprint-extractor-mcp@latest
```

</td></tr>
<tr><td><b>Codex</b></td></tr>
<tr><td>

```bash
codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 \
  blueprint-extractor -- npx -y blueprint-extractor-mcp@latest
```

</td></tr>
<tr><td><b>OpenCode</b></td></tr>
<tr><td>

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "blueprint-extractor": {
      "type": "local",
      "command": ["npx", "-y", "blueprint-extractor-mcp@latest"],
      "enabled": true,
      "environment": {
        "UE_REMOTE_CONTROL_PORT": "30010"
      }
    }
  }
}
```

</td></tr>
</table>

> On Windows, wrap `npx` with `cmd /c` if your shell requires it.

<br>

## Tool Surface

Only the compact core surface is visible by default to keep the context window lean. Specialized families are loaded on demand via `activate_workflow_scope`.

| Scope | What It Unlocks |
|:------|:----------------|
| **Core** *(always on)* | Search, extraction, list/save/help, editor-session binding, and project-control entry points such as `extract_asset`, `search_assets`, `save_assets`, `get_tool_help`, and `activate_workflow_scope` |
| `widget_authoring` | Parent scope that loads `widget_authoring_structure`, `widget_authoring_visual`, and `widget_verification` together |
| `widget_authoring_structure` | Widget tree structure, hierarchy edits, wrapping, moving, replacement, and batch operations |
| `widget_authoring_visual` | Widget compile flows, CommonUI styles, widget animations, and widget preview capture |
| `widget_verification` | Widget capture, checkpoint bundles, capture listing, cleanup, and reference comparison |
| `material_authoring` | Material creation, `material_graph_operation`, compile, and material-instance edits |
| `blueprint_authoring` | Blueprint creation, member edits, graph edits, and Live Coding trigger |
| `schema_ai_authoring` | Structs, enums, Blackboards, Behavior Trees, and State Trees |
| `animation_authoring` | Anim sequences, montages, blend spaces, and widget motion authoring |
| `data_tables` | Data assets, data tables, curves, Input Actions, and Input Mapping Contexts |
| `import` | Async asset import and import-job polling |
| `automation_testing` | Host-side automation runs, coarse project automation context, and PIE lifecycle control |
| `analysis` | Deterministic Blueprint review and low-noise project asset audits |
| `project_intelligence` | Bounded editor context, project indexing, freshness status, and snippet-first context search |
| `verification` | Editor/runtime screenshots, capture comparison, motion verification, and artifact inspection |

### Contract Design

The tool contract is optimized for model reliability:

- **`snake_case`** inputs on all public tools
- **`outputSchema`** on every tool for structured JSON responses
- **`structuredContent`** carries the canonical success and error payload for MCP clients that consume structured results directly
- **Structured error envelopes** with diagnostic codes and recovery hints
- **Explicit-save semantics** &mdash; nothing persists until `save_assets` is called
- **Next-step hints** guiding the assistant toward the logical follow-up action

See [../docs/CURRENT_STATUS.md](../docs/CURRENT_STATUS.md) for the current validation snapshot, normative docs, and the one-shot stabilization ledger.

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

`get_project_automation_context` surfaces the coarse editor-derived `engineRoot`, `projectFilePath`, `editorTarget`, and `isPlayingInEditor` state that project-control and verification flows use for fallback or guard logic.

`get_editor_context` is the separate read-only editor-state snapshot for selection, open asset editors, active level, and PIE summary. It stays session-bound and intentionally does not open assets, change focus, or switch viewports.

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
| `understand_blueprint_project` | Building a project-understanding pass over indexed assets, docs, prompts, and resources |
| `review_blueprint_asset` | Running a deterministic read-only Blueprint review flow |
| `snapshot_editor_context` | Inspecting bounded editor state without changing editor focus |
| `audit_blueprint_project` | Running a low-noise project asset audit |

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

The live suite exercises texture/mesh import via HTTP fixtures, material authoring workflows, Enhanced Input round-trips, widget authoring, and project-control round-trips.

The UE runner keeps two explicit lanes:

- headless/default: `BlueprintExtractor` with `-NullRHI`
- rendered verification: targeted filters with `-NoNullRHI` and optional `-AllowSoftwareRendering`

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
