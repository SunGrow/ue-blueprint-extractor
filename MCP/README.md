# `blueprint-extractor-mcp`

MCP server for the Unreal Engine `BlueprintExtractor` plugin.

This package exposes the `blueprint-extractor` server over stdio and talks to a running Unreal Editor through the Remote Control HTTP API.

The current v3 contract exposes consolidated extraction, authoring, automation, import, verification, resource, and prompt surfaces for Blueprint Extractor workflows.
Public tools use canonical `snake_case` inputs. Structured success payloads are returned through `structuredContent`, and non-text artifacts such as capture links or inline images may be attached in `content`.

Current surface area includes:

- read-only extraction tools for Blueprints, widgets, materials, and consolidated asset-family extraction through `extract_asset`
- explicit-save authoring tools for the supported editor-side asset families, including dedicated widget animation authoring (`extract_widget_animation`, `create_widget_animation`, `modify_widget_animation`), incremental widget-structure ops, widget class-default routing, `material_graph_operation` for single-step classic material graph edits, and the advanced `modify_material` escape hatch
- dedicated Enhanced Input authoring tools for `InputAction` and `InputMappingContext` assets (`create_input_action`, `modify_input_action`, `create_input_mapping_context`, `modify_input_mapping_context`)
- dedicated CommonUI button-style tools (`create_commonui_button_style`, `extract_commonui_button_style`, `modify_commonui_button_style`, `apply_commonui_button_style`) for `CommonButtonBase` wrapper surfaces instead of raw `UButton` field mutation
- utility and discovery helpers such as `search_assets`, `save_assets`, and `get_tool_help` for schema summaries, related resources, and example families
- async import and reimport tools with polling for generic assets plus typed texture and mesh helpers
- host-side project automation tools for external builds, Live Coding requests, restart/reconnect orchestration, `wait_for_editor` recovery polling, a thin window-polish helper, and runtime automation artifacts that surface verification screenshots back to the caller
- a shared visual-verification artifact contract across widget captures, motion checkpoint bundles, capture diffs, and automation-run screenshots so the caller can inspect rendered results instead of relying on semantic success alone
- static guidance resources, resource templates, and prompts for authoring conventions, selector rules, font roles, project automation, example payloads, widget patterns, multimodal design specs, widget motion authoring, motion verification, unsupported surfaces, safe UI redesign, and classic material graph guidance

## Migration From Legacy Entrypoints

- Use `extract_asset` with `asset_type` for the removed asset-family extract tools, including StateTree, DataAsset, DataTable, BehaviorTree, Blackboard, user-defined struct/enum, curve, curve table, material instance, anim sequence, anim montage, and blend space extraction.
- Use `material_graph_operation` with `operation` for the removed single-step material graph tools: `set_material_settings`, `add_material_expression`, `connect_material_expressions`, and `bind_material_property`.
- Call `get_tool_help` when you need the current parameter shape, output summary, related resources, or example families for any registered tool.

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

For workflow-oriented guidance, the server also exposes prompts such as `normalize_ui_design_input`, `design_menu_from_design_spec`, `author_widget_motion_from_design_spec`, `plan_widget_motion_verification`, `design_menu_screen`, `author_material_button_style`, `wire_hud_widget_classes`, and `debug_widget_compile_errors`.

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
npm run test:publish-gate
```

`npm run test:pack-smoke` validates the packaged tarball contract and the packaged README. `npm run test:publish-gate` checks publish readiness for the current version.

For the gated live smoke test:

```bash
BLUEPRINT_EXTRACTOR_LIVE_E2E=1 npm run test:live
```

The live suite imports a texture over a local HTTP fixture server, verifies request-header forwarding, imports a local mesh fixture, polls both jobs to completion, smoke-tests the composable material workflow plus material function and material instance authoring, and round-trips the dedicated Enhanced Input authoring tools before saving the returned asset paths.

The default unit/stdio suites also cover prompt registration, resource-template registration, the narrowed widget surfaces (`extract_widget_blueprint`, `extract_widget_animation`, `modify_widget`, `modify_widget_blueprint`, `modify_widget_animation`), the host-side project-control tools (`compile_project_code`, `trigger_live_coding`, `restart_editor`, `sync_project_code`, `apply_window_ui_changes`), motion checkpoint capture/compare, the compact material graph surfaces (`extract_material`, `modify_material`), and output-schema exposure for the specialized import and cascade tools.

Repository and full documentation:

- <https://github.com/SunGrow/ue-blueprint-extractor>
