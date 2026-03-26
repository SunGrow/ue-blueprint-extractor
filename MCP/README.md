# Blueprint Extractor MCP

> **MCP server that gives AI assistants full read/write access to Unreal Engine projects through the Remote Control API.**

[![npm version](https://img.shields.io/npm/v/blueprint-extractor-mcp)](https://www.npmjs.com/package/blueprint-extractor-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.12-blue)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/github/license/SunGrow/ue-blueprint-extractor)](https://github.com/SunGrow/ue-blueprint-extractor/blob/master/LICENSE)

---

## What It Does

Blueprint Extractor MCP connects AI coding assistants (Claude Code, Codex, etc.) to a running Unreal Editor, enabling them to:

- **Extract** Blueprints, widgets, materials, animations, data assets, and more
- **Author** widgets, materials, Blueprints, data tables, input actions, and AI assets
- **Build & test** compile code, trigger Live Coding, run automation tests, restart the editor
- **Import** textures, meshes, and generic assets with async job tracking
- **Verify** capture widget screenshots, compare against references, inspect motion checkpoints

All communication happens over stdio (MCP protocol) on the AI side and HTTP (Remote Control API) on the Unreal side.

---

## Quick Start

### 1. Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js** | v18 or later |
| **Unreal Editor** | Running with the **Remote Control API** plugin enabled |
| **BlueprintExtractor plugin** | Loaded in the editor ([get it here](https://github.com/SunGrow/ue-blueprint-extractor)) |

### 2. Run

```bash
npx blueprint-extractor-mcp
```

The server connects to the editor on port `30010` by default.

### 3. Install in Your AI Client

**Claude Code:**

```bash
claude mcp add -s user -t stdio blueprint-extractor \
  -e UE_REMOTE_CONTROL_PORT=30010 \
  -- npx -y blueprint-extractor-mcp@latest
```

**Codex:**

```bash
codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 \
  blueprint-extractor -- npx -y blueprint-extractor-mcp@latest
```

---

## Tool Surface

107 tools organized into workflow-scoped families. Only ~19 core tools are visible by default &mdash; use `activate_workflow_scope` to load specialized families on demand.

| Scope | Tools | What You Can Do |
|-------|------:|-----------------|
| **Core** (always on) | ~19 | Extract, search, list, save assets; get tool help |
| `widget_authoring` | 16 | Create/patch/replace/move/wrap widgets, compile, CommonUI styles |
| `material_authoring` | 5 | Create/modify materials, graph operations, material functions |
| `blueprint_authoring` | 4 | Create/modify Blueprint members and graphs |
| `schema_ai_authoring` | 11 | Structs, enums, blackboards, behavior trees, state trees |
| `animation_authoring` | 7 | Anim sequences, montages, blend spaces, widget animations |
| `data_tables` | 7 | Data assets, input actions/mappings, tables, curves |
| `import` | 3 | Import assets with texture/mesh options, job tracking |
| `automation_testing` | 4 | Run, poll, and inspect automation test results |
| `verification` | 7 | Widget captures, motion checkpoints, reference comparisons |

### Key Tools at a Glance

```
extract_asset           Extract any asset by type (Blueprints, widgets, materials, ...)
find_and_extract        Search + extract in one call
search_assets           Locate assets by name, path, or class
material_graph_op       Single-step material graph edits (nodes, wires, settings)
compile_project_code    Trigger a full project build from the host
run_automation_tests    Launch UE automation tests and collect results
capture_widget_preview  Screenshot a widget for visual verification
get_tool_help           Schema summary, examples, and hints for any tool
```

---

## Architecture

```
                          stdio                    HTTP :30010
  AI Assistant  <-------->  MCP Server  <--------->  Unreal Editor
  (Claude, etc.)           (Node.js)                (Remote Control API)
                                |
                          Dual-Mode Executor
                           /            \
                     Editor Mode    Commandlet Mode
                     (live editor)  (headless, no UI)
```

**Dual-mode execution** (v6.0): each tool is annotated as `editor_only`, `read_only`, or `both`. The adaptive executor routes calls to the appropriate backend &mdash; live editor for interactive work, commandlet for headless operations.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UE_REMOTE_CONTROL_PORT` | `30010` | Editor's Remote Control HTTP port |
| `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH` | *(auto-probe)* | Force a specific subsystem object path |
| `UE_ENGINE_ROOT` | &mdash; | Path to the UE engine root (for builds & automation) |
| `UE_PROJECT_PATH` | &mdash; | Path to the `.uproject` file |
| `UE_PROJECT_TARGET` / `UE_EDITOR_TARGET` | &mdash; | Build target name |
| `UE_BUILD_PLATFORM` | &mdash; | Build platform (e.g., `Win64`) |
| `UE_BUILD_CONFIGURATION` | &mdash; | Build configuration (e.g., `Development`) |

---

## Resources & Prompts

The server also exposes **MCP resources** and **prompts** for guided workflows:

**Resources** &mdash; example payloads, widget patterns, capture artifacts, test-run results:

```
blueprint://examples/{family}
blueprint://widget-patterns/{pattern}
blueprint://captures/{capture_id}
blueprint://test-runs/{run_id}/{artifact}
```

**Prompts** &mdash; step-by-step guidance for common authoring tasks: UI design from specs, widget motion authoring, material button styles, HUD wiring, compile-error debugging, and more.

---

## Local Development

```bash
cd MCP
npm install
npm run build          # TypeScript compilation
npm test               # Unit tests + stdio integration test
```

### Additional Test Suites

| Command | What It Tests |
|---------|---------------|
| `npm run test:pack-smoke` | Packaged tarball contract and README inclusion |
| `npm run test:publish-gate` | Publish readiness for the current version |
| `BLUEPRINT_EXTRACTOR_LIVE_E2E=1 npm run test:live` | Full live E2E against a running editor |

The live suite exercises texture/mesh import over HTTP fixtures, material authoring workflows, Enhanced Input round-trips, and asset saving.

---

## Migration from v3/v4

| Before | Now |
|--------|-----|
| Individual `extract_<type>` tools | `extract_asset` with `asset_type` parameter |
| `set_material_settings`, `add_material_expression`, etc. | `material_graph_operation` with `operation` |
| Need parameter docs? | `get_tool_help` for any tool |

---

## Links

- **Repository:** [github.com/SunGrow/ue-blueprint-extractor](https://github.com/SunGrow/ue-blueprint-extractor)
- **Issues:** [github.com/SunGrow/ue-blueprint-extractor/issues](https://github.com/SunGrow/ue-blueprint-extractor/issues)
- **npm:** [npmjs.com/package/blueprint-extractor-mcp](https://www.npmjs.com/package/blueprint-extractor-mcp)
