# Blueprint Extractor

**Let AI assistants read, create, and modify Unreal Engine assets through natural language.**

[![npm version](https://img.shields.io/npm/v/blueprint-extractor-mcp)](https://www.npmjs.com/package/blueprint-extractor-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/SunGrow/ue-blueprint-extractor/ci.yml?branch=master&label=CI)](https://github.com/SunGrow/ue-blueprint-extractor/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![UE 5.x](https://img.shields.io/badge/Unreal_Engine-5.6%20%7C%205.7-blue)](https://www.unrealengine.com/)

A UE5 editor plugin + MCP server that gives [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://openai.com/index/codex/) full read/write access to Unreal Engine assets. Extract Blueprints, materials, data tables, AI trees, animations, widgets, and Enhanced Input assets to structured JSON, then create and modify them back through an explicit v2 MCP contract.

> Recommended companion plugin for [ClaudeRules](https://github.com/SunGrow/ClaudeRules). Optional but highly recommended for Unreal Engine projects using Claude Code.

## Features at a Glance

- **97 MCP tools**, **16 resources**, **4 resource templates**, and **8 prompts**
- **Full round-trip** -- extract assets to JSON, then create and modify them back
- **Strict v2 contract** -- snake_case inputs, `outputSchema` on every tool, and structured success/error envelopes
- **Generated examples + prompts** -- schema-backed examples and reusable workflow prompts for UI, widget motion, materials, HUD wiring, and compile debugging
- **Explicit-save semantics** -- write operations mark packages dirty; you choose when to save
- **Async imports** -- import textures and meshes from local files or HTTP/HTTPS URLs
- **Composable material tools** -- use small focused tools before the advanced batch DSL
- **Dedicated Enhanced Input authoring** -- InputAction and InputMappingContext have first-class tools instead of generic DataAsset reflection
- **Compact output** -- LLM-optimized JSON reduces token usage by 50-70%
- **Cascade extraction** -- follow asset references automatically with depth control
- **Project automation** -- compile, live coding, editor restart, and code sync
- **Verification platform** -- semantic extraction, widget preview capture/diffing, widget motion checkpoint bundles, and host-side automation test runs
- **Multimodal UI planning** -- normalize text, image, PNG/Figma, or HTML/CSS inputs into `design_spec_json` before menu authoring
- **Widget motion authoring** -- create, modify, extract, capture, and compare WidgetBlueprint animations on the supported v2 track subset
- **Editor-only** -- not included in packaged builds

<details>
<summary><strong>Supported asset families (20)</strong></summary>

Blueprint, AnimBlueprint, WidgetBlueprint, StateTree, BehaviorTree, Blackboard, DataAsset, DataTable, UserDefinedStruct, UserDefinedEnum, Curve, CurveTable, Material, MaterialFunction (incl. Layer/LayerBlend), MaterialInstance, AnimSequence, AnimMontage, BlendSpace, InputAction, InputMappingContext

</details>

## Table of Contents

<details>
<summary>Click to expand</summary>

- [Quick Start](#quick-start)
- [Requirements](#requirements)
- [V2 Contract](#v2-contract)
- [MCP Tools](#mcp-tools)
- [Usage](#usage)
- [Settings](#settings)
- [Extraction Scopes](#extraction-scopes)
- [What Gets Extracted](#what-gets-extracted)
- [Architecture](#architecture)
- [MCP Server Details](#mcp-server-details)
- [Testing](#testing)
- [Repository Structure](#repository-structure)
- [Contributing](#contributing)
- [Publishing (Maintainers)](#publishing-maintainers)
- [Changelog](#changelog)

</details>

## Quick Start

### 1. Install the UE plugin

Copy `BlueprintExtractor/` into your project's `Plugins/` directory, then enable these plugin dependencies and rebuild:

- **StateTree**, **PropertyBindingUtils**, and **EnhancedInput** (required)
- **Web Remote Control** (required for MCP access -- Edit > Plugins > search "Remote Control")

### 2. Register the MCP server

Run the install script for your client:

```bash
# Claude Code
./install-mcp.sh            # macOS / Linux
.\install-mcp.ps1           # Windows (PowerShell)

# Codex
./install-codex-mcp.sh      # macOS / Linux
.\install-codex-mcp.ps1     # Windows (PowerShell)
```

### 3. Verify

Open a new Claude Code or Codex session. The Blueprint Extractor tools and 8 workflow prompts will appear automatically.

<details>
<summary><strong>Manual registration and local builds</strong></summary>

**Manual registration (npx):**

```bash
# Claude Code: macOS / Linux
claude mcp add -s user -t stdio blueprint-extractor -e UE_REMOTE_CONTROL_PORT=30010 -- npx -y blueprint-extractor-mcp@latest

# Claude Code: Windows (npx requires cmd /c wrapper)
claude mcp add -s user -t stdio blueprint-extractor -e UE_REMOTE_CONTROL_PORT=30010 -- cmd /c npx -y blueprint-extractor-mcp@latest

# Codex: macOS / Linux
codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 blueprint-extractor -- npx -y blueprint-extractor-mcp@latest

# Codex: Windows (npx requires cmd /c wrapper)
codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 blueprint-extractor -- cmd /c npx -y blueprint-extractor-mcp@latest
```

**Local build (development):**

```bash
# Claude Code
./install-mcp.sh --local        # macOS / Linux
.\install-mcp.ps1 -Local        # Windows (PowerShell)

# Codex
./install-codex-mcp.sh --local  # macOS / Linux
.\install-codex-mcp.ps1 -Local  # Windows (PowerShell)
```

</details>

## Requirements

- **Unreal Engine 5.x** (tested on 5.6 and 5.7)
- **Node.js 18+** (for the MCP server)
- **Claude Code CLI** or **Codex CLI**
- **EnhancedInput**, **StateTree**, **PropertyBindingUtils**, and **Remote Control** UE plugins enabled
- Editor-only -- not included in packaged builds

## V2 Contract

Blueprint Extractor v2 is a breaking MCP contract aimed at model reliability.

- Canonical public arguments use `snake_case`.
- Every public tool exposes `outputSchema`.
- Tool results are standardized into structured success/error envelopes.
- Durable guidance moved into resources and generated examples.
- Repeatable planning flows moved into prompts instead of prose-only docs.

Reference docs:

- [MCP v2 Reference](docs/mcp-v2-reference.md)
- [Prompt Catalog](docs/prompt-catalog.md)
- [Multimodal UI Design Workflow](docs/multimodal-ui-design-workflow.md)
- [Widget Motion Authoring](docs/widget-motion-authoring.md)
- [Motion Verification Workflow](docs/motion-verification-workflow.md)
- [Unsupported Surfaces](docs/unsupported-surfaces.md)
- [Safe UI Redesign Workflow](docs/ui-redesign-workflow.md)

## MCP Tools

Tools are organized by category. All tools declare `readOnlyHint`, `destructiveHint`, and `idempotentHint` annotations for safe auto-approval, and every public tool exposes `outputSchema`.

<details>
<summary><strong>Extraction Tools</strong> (18 tools) -- read-only, extract asset data to JSON</summary>

| Tool | Description |
|------|-------------|
| `extract_blueprint` | Extract a Blueprint, AnimBlueprint, or WidgetBlueprint (scope + graph filter + compact mode) |
| `extract_widget_blueprint` | Extract a compact widget-authoring snapshot with tree, bindings, animations, and class defaults |
| `extract_widget_animation` | Extract one authored widget animation timeline, bindings, checkpoints, and playback metadata |
| `extract_statetree` | Extract a StateTree to JSON |
| `extract_behavior_tree` | Extract a BehaviorTree to JSON |
| `extract_blackboard` | Extract a Blackboard to JSON |
| `extract_dataasset` | Extract a DataAsset to JSON (all UPROPERTY fields) |
| `extract_datatable` | Extract a DataTable to JSON (schema + all rows) |
| `extract_user_defined_struct` | Extract a UserDefinedStruct to JSON |
| `extract_user_defined_enum` | Extract a UserDefinedEnum to JSON |
| `extract_curve` | Extract a Curve asset to JSON |
| `extract_curvetable` | Extract a CurveTable to JSON |
| `extract_material` | Extract a compact classic Material graph to JSON |
| `extract_material_function` | Extract a MaterialFunction / Layer / LayerBlend graph to JSON |
| `extract_material_instance` | Extract a MaterialInstance to JSON |
| `extract_anim_sequence` | Extract an AnimSequence to JSON |
| `extract_anim_montage` | Extract an AnimMontage to JSON |
| `extract_blend_space` | Extract a BlendSpace to JSON |

</details>

<details>
<summary><strong>Cascade Extraction</strong> (1 tool) -- follow asset references with depth control</summary>

| Tool | Description |
|------|-------------|
| `extract_cascade` | Extract multiple assets with automatic reference following and manifest output |

</details>

<details>
<summary><strong>Blueprint Authoring</strong> (3 tools) -- create and modify Blueprints</summary>

| Tool | Description |
|------|-------------|
| `create_blueprint` | Create a Blueprint with optional variables, components, function stubs, and class defaults |
| `modify_blueprint_members` | Replace or patch variables, components, function stubs, class defaults, and compile |
| `modify_blueprint_graphs` | Add or replace function graphs, append calls into sequence-style graphs with rollback safety |

</details>

<details>
<summary><strong>Widget Authoring</strong> (5 tools) -- widget blueprint creation and modification</summary>

| Tool | Description |
|------|-------------|
| `create_widget_blueprint` | Create a new WidgetBlueprint with a specified parent class |
| `build_widget_tree` | Build/replace the entire widget hierarchy from a JSON tree |
| `modify_widget` | Patch properties, slot config, rename, and variable flags on a single widget |
| `modify_widget_blueprint` | Structural ops: replace-tree, patch-widget, insert-child, move, wrap, replace-class, batch |
| `compile_widget_blueprint` | Compile a WidgetBlueprint and return errors/warnings |

</details>

<details>
<summary><strong>Widget Motion Authoring</strong> (2 tools) -- create and modify widget timelines</summary>

| Tool | Description |
|------|-------------|
| `create_widget_animation` | Create a named widget animation on an existing WidgetBlueprint with an optional initial payload |
| `modify_widget_animation` | Replace a timeline, patch metadata, rename, remove, or compile a widget animation |

</details>

<details>
<summary><strong>Material Authoring</strong> (11 tools) -- composable v2 material graph and instance operations</summary>

| Tool | Description |
|------|-------------|
| `create_material` | Create a classic Material with optional initial texture and settings |
| `set_material_settings` | Apply top-level material settings with the primary v2 material workflow |
| `add_material_expression` | Add one expression node to a Material graph |
| `connect_material_expressions` | Wire one expression output into another expression input |
| `bind_material_property` | Bind one expression output to a root material property |
| `modify_material` | Advanced escape hatch for compact graph and settings operations |
| `create_material_function` | Create a MaterialFunction, MaterialLayer, or MaterialLayerBlend |
| `modify_material_function` | Apply graph and settings operations to a MaterialFunction-family asset |
| `compile_material_asset` | Recompile or refresh a material-family asset without saving |
| `create_material_instance` | Create a MaterialInstanceConstant from a parent material |
| `modify_material_instance` | Apply scalar/vector/texture/static-switch/font/layer-stack overrides |

</details>

<details>
<summary><strong>Data Asset Authoring</strong> (8 tools) -- generic data tables, data assets, and curves</summary>

| Tool | Description |
|------|-------------|
| `create_data_asset` | Create a generic property-safe DataAsset and optionally initialize editable properties |
| `modify_data_asset` | Apply a reflected property patch to an existing generic property-safe DataAsset |
| `create_data_table` | Create a DataTable with a concrete row struct and optional initial rows |
| `modify_data_table` | Upsert, delete, or replace rows in a DataTable |
| `create_curve` | Create a CurveFloat, CurveVector, or CurveLinearColor with optional channel data |
| `modify_curve` | Patch curve channels and upsert or delete individual keys |
| `create_curve_table` | Create a CurveTable in rich or simple mode with optional initial rows |
| `modify_curve_table` | Upsert, delete, or replace rows in a CurveTable |

</details>

<details>
<summary><strong>Enhanced Input Authoring</strong> (4 tools) -- dedicated InputAction and InputMappingContext workflows</summary>

| Tool | Description |
|------|-------------|
| `create_input_action` | Create a dedicated Enhanced InputAction asset with a human-friendly `value_type` |
| `modify_input_action` | Modify a dedicated Enhanced InputAction without using generic DataAsset reflection |
| `create_input_mapping_context` | Create an InputMappingContext with explicit action/key mappings |
| `modify_input_mapping_context` | Replace or append explicit mappings on an InputMappingContext |

</details>

<details>
<summary><strong>Schema Asset Authoring</strong> (4 tools) -- structs and enums</summary>

| Tool | Description |
|------|-------------|
| `create_user_defined_struct` | Create a UserDefinedStruct from extractor-shaped field payloads |
| `modify_user_defined_struct` | Replace, patch, rename, remove, or reorder struct fields |
| `create_user_defined_enum` | Create a UserDefinedEnum from extractor-shaped entry payloads |
| `modify_user_defined_enum` | Replace, rename, remove, or reorder enum entries |

</details>

<details>
<summary><strong>AI Asset Authoring</strong> (4 tools) -- behavior trees, blackboards, state trees</summary>

| Tool | Description |
|------|-------------|
| `create_blackboard` | Create a BlackboardData from extractor-shaped key payloads |
| `modify_blackboard` | Replace, patch, remove, or reparent Blackboard keys |
| `create_behavior_tree` | Create a BehaviorTree from extractor-shaped tree payloads |
| `modify_behavior_tree` | Replace, patch nodes/attachments by `nodePath`, or set the blackboard |

</details>

<details>
<summary><strong>State Tree Authoring</strong> (2 tools)</summary>

| Tool | Description |
|------|-------------|
| `create_state_tree` | Create a StateTree from extractor-shaped editor data payloads |
| `modify_state_tree` | Replace, patch states/editor nodes/transitions, or change schema |

</details>

<details>
<summary><strong>Animation Authoring</strong> (6 tools) -- sequences, montages, blend spaces</summary>

| Tool | Description |
|------|-------------|
| `create_anim_sequence` | Create an AnimSequence from notify, sync-marker, and curve metadata payloads |
| `modify_anim_sequence` | Replace or patch notifies, sync markers, and curve metadata |
| `create_anim_montage` | Create an AnimMontage from notify, section, and slot payloads |
| `modify_anim_montage` | Replace or patch notifies, sections, and slots |
| `create_blend_space` | Create a BlendSpace or BlendSpace1D from axis and sample payloads |
| `modify_blend_space` | Replace or patch samples and axes |

</details>

<details>
<summary><strong>Import Tools</strong> (6 tools) -- async texture and mesh import</summary>

| Tool | Description |
|------|-------------|
| `import_assets` | Enqueue a generic async import for local files or HTTP/HTTPS URLs |
| `reimport_assets` | Enqueue an async reimport against existing imported assets |
| `get_import_job` | Poll the current state of an async import or reimport job |
| `list_import_jobs` | List active or completed import jobs in the current editor session |
| `import_textures` | Texture-focused import with typed texture option passthrough |
| `import_meshes` | Mesh-focused import with typed static or skeletal mesh options |

</details>

<details>
<summary><strong>Project Automation</strong> (5 tools) -- compile, live coding, restart</summary>

| Tool | Description |
|------|-------------|
| `get_project_automation_context` | Return editor-derived engine root, project path, and editor target |
| `compile_project_code` | Run an external UBT build for the current project/editor target |
| `trigger_live_coding` | Request an editor-side Live Coding compile (Windows) |
| `restart_editor` | Request an editor restart and wait for Remote Control reconnect |
| `sync_project_code` | Use explicit `changed_paths` to choose Live Coding vs build-and-restart |

</details>

<details>
<summary><strong>Verification</strong> (9 tools) -- visual capture, motion checkpoints, and runtime automation</summary>

| Tool | Description |
|------|-------------|
| `capture_widget_preview` | Render a WidgetBlueprint offscreen and return capture metadata plus a linked preview artifact |
| `capture_widget_motion_checkpoints` | Play a widget animation or automation-driven scenario and return a keyframe bundle of named checkpoint captures |
| `compare_capture_to_reference` | Compare two captures or PNGs and record a diff image with RMSE and mismatch details |
| `compare_motion_capture_bundle` | Compare a captured checkpoint bundle against reference frames or another bundle |
| `list_captures` | List saved widget preview and diff captures from the current project |
| `cleanup_captures` | Delete old capture artifacts from `Saved/BlueprintExtractor/Captures` |
| `run_automation_tests` | Launch an async host-side Unreal automation run for gameplay, runtime, or mechanic verification |
| `get_automation_test_run` | Poll one automation run and inspect logs, reports, and indexed artifacts |
| `list_automation_test_runs` | List active or completed host-side automation runs |

</details>

<details>
<summary><strong>Asset Management</strong> (4 tools) -- search, list, save, UI helper</summary>

| Tool | Description |
|------|-------------|
| `search_assets` | Search assets by name and class filter |
| `list_assets` | List assets under a package path |
| `save_assets` | Explicitly save dirty asset packages after write operations |
| `apply_window_ui_changes` | Helper that sequences widget flags, class defaults, compile/save, and code sync |

</details>

## Usage

### Content Browser

Right-click any Blueprint-class asset, StateTree, DataAsset, or DataTable in the Content Browser and select **Extract to JSON**.

### C++ API

```cpp
#include "BlueprintExtractorLibrary.h"

// Single Blueprint (all graphs)
UBlueprintExtractorLibrary::ExtractBlueprintToJson(Blueprint, OutputPath, EBlueprintExtractionScope::Full);

// Single Blueprint (specific graphs only)
TArray<FName> Filter = { FName("EventGraph"), FName("CalculateDamage") };
UBlueprintExtractorLibrary::ExtractBlueprintToJson(Blueprint, OutputPath, EBlueprintExtractionScope::Full, Filter);

// Single StateTree
UBlueprintExtractorLibrary::ExtractStateTreeToJson(StateTree, OutputPath);

// Single DataAsset / DataTable
UBlueprintExtractorLibrary::ExtractDataAssetToJson(DataAsset, OutputPath);
UBlueprintExtractorLibrary::ExtractDataTableToJson(DataTable, OutputPath);

// BehaviorTree / Blackboard
UBlueprintExtractorLibrary::ExtractBehaviorTreeToJson(BehaviorTree, OutputPath);
UBlueprintExtractorLibrary::ExtractBlackboardToJson(BlackboardData, OutputPath);

// Material family
UBlueprintExtractorLibrary::ExtractMaterialToJson(Material, OutputPath);
UBlueprintExtractorLibrary::ExtractMaterialFunctionToJson(MaterialFunction, OutputPath);
UBlueprintExtractorLibrary::ExtractMaterialInstanceToJson(MaterialInstance, OutputPath);
UBlueprintExtractorLibrary::ExtractAnimSequenceToJson(AnimSequence, OutputPath);

// Cascade extraction (follows references up to MaxDepth)
TArray<UObject*> Assets = { Blueprint };
UBlueprintExtractorLibrary::ExtractWithCascade(Assets, OutputDir, EBlueprintExtractionScope::Full, /*MaxDepth=*/ 3);
```

## Settings

Configure in **Project Settings > Plugins > Blueprint Extractor**:

| Setting | Description | Default |
|---------|-------------|---------|
| Output Directory | Where JSON files are saved (relative to Content/) | `BlueprintExtractor` |
| Default Scope | Extraction depth (ClassLevel through FullWithBytecode) | `Full` |
| Pretty Print | Format JSON with indentation | `true` |
| Include Bytecode | Include raw bytecode hex dump | `false` |
| Enable Cascade Extraction | Follow references to other extractable assets | `false` |
| Max Cascade Depth | How many levels deep to follow references (1-10) | `3` |

## Extraction Scopes

| Scope | Includes |
|-------|----------|
| ClassLevel | Parent class, interfaces, class flags, metadata |
| Variables | + Variables with types, defaults, flags |
| Components | + SCS component tree with property overrides vs CDO. For WidgetBlueprints, includes widget tree hierarchy with slot info, properties, and bindings |
| FunctionsShallow | + Function/event graph names only |
| Full | + Complete graph/node/pin extraction with connections |
| FullWithBytecode | + Raw bytecode hex dump per function |

### Graph Filtering

All scopes that include graph data support an optional **graph filter** -- a list of graph names to extract. When provided, only matching graphs are included; when empty, all graphs are extracted.

Use `FunctionsShallow` first to discover graph names, then request specific graphs with the filter to reduce output size from 300KB+ to 10-30KB per function.

### Compact Output Mode

The MCP server supports a `compact` mode on `extract_blueprint` that strips low-value fields and minifies JSON, reducing size by **~50-70%** for LLM consumption:

- Removes: `pinId`, `posX`/`posY`, `graphGuid`, `autogeneratedDefaultValue`, empty fields
- Replaces `nodeGuid` UUIDs with sequential short IDs (`n0`, `n1`, ...)
- Rewrites connection references to use short IDs
- Replaces exec pin type objects with the string `"exec"`
- For widget trees: strips redundant `displayLabel`, default `Visible` visibility, empty `properties`
- Outputs minified JSON (no indentation)

## What Gets Extracted

<details>
<summary><strong>Blueprints</strong></summary>

- **Class level** -- parent class, implemented interfaces, class flags, category, description
- **Variables** -- name, pin type, default value, property flags, replication, category
- **Components** -- SCS tree with recursive children, property overrides (CDO diff)
- **Widget tree** (WidgetBlueprints only) -- recursive widget hierarchy, slot config, property overrides, bindings
- **Graphs** -- function graphs, event graphs, macro graphs, construction script
- **Nodes** -- typed extraction via visitor pattern (function calls, events, variables, flow control, macros, timelines)
- **Pins** -- name, direction, full pin type (containers, sub-categories, maps), default values, connections
- **Timelines** -- float/vector/event/color tracks with curve keyframes
- **Delegates** -- multicast/single-cast with signature parameters
- **Bytecode** -- raw hex dump per function (optional)

</details>

<details>
<summary><strong>DataAssets</strong></summary>

- **Schema class** -- the UDataAsset / UPrimaryDataAsset subclass name
- **User-defined properties** -- all UPROPERTY fields (skips UDataAsset/UObject base), with typed JSON values and reference paths for object properties

</details>

<details>
<summary><strong>DataTables</strong></summary>

- **Row struct schema** -- property names and C++ types from the row struct
- **All rows** -- keyed by row name, with typed property values per row

</details>

<details>
<summary><strong>StateTrees</strong></summary>

- **Schema** and metadata
- **State hierarchy** -- recursive tree of states with type, selection behavior
- **Tasks** -- FInstancedStruct properties via UScriptStruct reflection
- **Conditions** -- enter conditions, transition conditions, considerations
- **Transitions** -- trigger, priority, target state, delay, required events
- **Global** -- evaluators, global tasks
- **Linked assets** -- references to other StateTrees

</details>

<details>
<summary><strong>BehaviorTrees and Blackboards</strong></summary>

- **BehaviorTree hierarchy** -- root node, composite/task nodes, root decorators, child decorators, decorator logic, and services
- **Node properties** -- typed CDO-diff extraction for tasks, decorators, and services
- **Blackboard references** -- linked blackboard asset for each BehaviorTree
- **Blackboard keys** -- effective key list including inherited parent keys and local overrides
- **Key-type details** -- base class, enum binding, instance sync, and key-type-specific properties

</details>

<details>
<summary><strong>UserDefinedStructs and UserDefinedEnums</strong></summary>

- **UserDefinedStructs** -- struct GUID, status, field metadata, pin types, typed default values, and editor-authored metadata
- **UserDefinedEnums** -- entry names, display names, and numeric values (excluding the auto-generated MAX sentinel)

</details>

<details>
<summary><strong>Curves and CurveTables</strong></summary>

- **Curve assets** -- float/vector/linear-color channels, key times/values/tangents, interpolation, default values, and extrapolation modes
- **CurveTables** -- simple or rich curve rows with row names and per-row curve data

</details>

<details>
<summary><strong>Materials and MaterialInstances</strong></summary>

- **Materials** -- compact classic graph extraction for root property connections, expressions, comments, parameter groups, layer stacks, and authored material settings
- **MaterialFunctions / Layers / LayerBlends** -- compact graph extraction with FunctionInput/FunctionOutput coverage plus family kind metadata
- **MaterialInstances** -- parent material path and resolved base material plus scalar, vector, texture, runtime virtual texture, sparse volume texture, font, static switch, and classic layer-stack overrides
- **Effective values** -- instance extraction uses material query APIs, so the JSON reflects the effective parameter state seen by the instance

</details>

<details>
<summary><strong>Animation Assets</strong></summary>

- **AnimSequences** -- length, sampling rate, additive settings, notifies, authored sync markers, and runtime float curves
- **AnimMontages** -- slot tracks, animation segments, sections, branching-point notifies, and standard notifies
- **BlendSpaces** -- axis definitions, 1D/2D shape, sample coordinates, and referenced animations

</details>

<details>
<summary><strong>Cascade Extraction</strong></summary>

When enabled, after extracting an asset the plugin scans for references to other extractable assets and extracts those too:

- **Parent Blueprint class** -- if the parent is a Blueprint (not native C++)
- **Blueprint interfaces** -- implemented Blueprint-defined interfaces
- **Variable types** -- variables typed to Blueprint-generated classes
- **Node pin references** -- SpawnActor class pins, function call targets, etc.
- **Component classes** -- Blueprint-based components in the SCS tree
- **BehaviorTree links** -- blackboard assets plus Blueprint-authored task/decorator/service classes
- **Blackboard inheritance** -- parent blackboards
- **StateTree linked assets** -- other StateTrees referenced by linked states
- **StateTree instance objects** -- Blueprint-based task/condition classes
- **Material instance parents** -- parent material instances in the override chain
- **Animation references** -- montage segment animations and blend-space sample animations

Cascade writes collision-proof filenames derived from asset package paths and returns a manifest with `assetPath`, `assetType`, `outputFile`, `depth`, `status`, and optional `error`. Cycle protection prevents infinite loops. Depth limit controls how far references are followed.

</details>

## Architecture

```
Claude Code / Codex  <-stdio->  MCP Server (Node.js)  <-HTTP->  UE5 Editor (Remote Control API)
                                                                  |
                                                           BlueprintExtractorSubsystem
                                                                  |
                                                           BlueprintExtractorLibrary
```

The `BlueprintExtractorSubsystem` (`UEditorSubsystem`) wraps the library methods with string-based parameters callable via `PUT /remote/object/call`.

<details>
<summary><strong>Plugin internals</strong></summary>

```
BlueprintExtractorSubsystem        (UEditorSubsystem, string-based API for Remote Control)
  |
BlueprintExtractorLibrary          (public API, cascade BFS loop)
  +-- PropertySerializer           (shared typed JSON serializer for UObject/struct properties)
  +-- ClassLevelExtractor          (parent, interfaces, flags)
  +-- VariableExtractor            (NewVariables array)
  +-- ComponentExtractor           (SCS tree, CDO property diff)
  +-- GraphExtractor               (graphs, nodes, pins)
  |     +-- NodeExtractorRegistry  (visitor pattern)
  |           +-- CallFunction, Event, Variable, FlowControl, Macro, Timeline
  +-- TimelineExtractor            (timeline tracks, keyframes)
  +-- BytecodeExtractor            (raw bytecode hex)
  +-- StateTreeExtractor           (editor data, state hierarchy)
  +-- BehaviorTreeExtractor        (node hierarchy, decorators, services, blackboard link)
  +-- BlackboardExtractor          (effective keys, inheritance, key-type details)
  +-- DataAssetExtractor           (UPROPERTY reflection, skip base class)
  +-- DataTableExtractor           (row struct schema, all rows)
  +-- UserDefinedStructExtractor   (field metadata, defaults, pin types)
  +-- UserDefinedEnumExtractor     (entries, display names, values)
  +-- CurveExtractor               (curve channels, keys, extrapolation)
  +-- CurveTableExtractor          (curve table rows)
  +-- MaterialGraphExtractor       (classic material and material-function graph extraction)
  +-- MaterialInstanceExtractor    (effective parameter query APIs + layer stack / font / RVT / SVT)
  +-- AnimAssetExtractor           (AnimSequence, AnimMontage, BlendSpace)
  +-- WidgetTreeExtractor          (widget hierarchy, slots, properties, bindings)
  +-- BlueprintJsonSchema          (pin type serialization, flag bitmasks)
  +-- WidgetTreeBuilder            (create, build, modify, compile WidgetBlueprints)
  +-- Authoring/*                  (shared mutation session, explicit-save writes for feasible asset families)
```

</details>

## MCP Server Details

### Design Principles

- **Right primitive** -- Live editor actions are exposed as MCP **tools**. Static guidance lives in 16 resources, 4 resource templates, and 8 prompts (`blueprint://scopes`, `blueprint://verification-workflows`, `blueprint://examples/{family}`, `normalize_ui_design_input`, etc.).
- **Small, distinct surface** -- extraction tools stay read-only, common material flows are decomposed into smaller tools, and Enhanced Input uses dedicated authoring tools instead of pretending generic DataAsset reflection is enough.
- **Annotations** -- All tools declare `readOnlyHint`, `destructiveHint`, `idempotentHint` for safe auto-approval.
- **Structured results** -- every public tool exposes `outputSchema`, mirrors JSON in `structuredContent`, and returns machine-usable error envelopes when execution fails recoverably.
- **Explicit save** -- Write and import operations mutate assets and mark packages dirty, but do not save automatically. Call `save_assets` to persist.
- **Security** -- stdio transport, env-based credentials (`UE_REMOTE_CONTROL_PORT`), local-only by default.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UE_REMOTE_CONTROL_HOST` | `127.0.0.1` | UE editor host |
| `UE_REMOTE_CONTROL_PORT` | `30010` | Remote Control HTTP port |
| `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH` | auto-probe | Optional explicit subsystem object path override |

<details>
<summary><strong>Usage notes for specific tool families</strong></summary>

**`modify_widget` notes:**
- Use `widget_path` when practical; it is safer than `widget_name` after structural edits.
- Use `properties.name`, `properties.newName`, or `properties.new_name` to rename the widget itself.
- For box slots, `slot.Size.sizeRule` accepts `Automatic` or the shorthand `Auto`.

**Widget authoring notes:**
- `create_widget_blueprint` accepts `parent_class_path` as the canonical explicit parent reference.
- Widget tools accept either package paths such as `/Game/UI/WBP_Window` or object paths such as `/Game/UI/WBP_Window.WBP_Window`.
- Widget create and extract responses include additive `packagePath` and `objectPath` fields so follow-up tool calls can reuse the returned path form directly.

**Project automation notes:**
- `compile_project_code` and `sync_project_code` resolve `engine_root`, `project_path`, and `target` in this order: explicit tool arguments, editor-derived `get_project_automation_context`, then environment variables.
- `trigger_live_coding.changed_paths` and `restart_editor.save_dirty_assets` remain accepted compatibility inputs, but explicit `save_assets` and `sync_project_code.changed_paths` are the reliable orchestration primitives.

</details>

## Testing

Testing is split into three layers:

1. **UE editor automation** -- tests under `BlueprintExtractor/Source/BlueprintExtractor/Private/Tests/` that call `UBlueprintExtractorSubsystem` directly.
2. **MCP contract + HTTP tests** -- `MCP/tests/` using Vitest, the official MCP SDK client, in-memory transports, and a mock Remote Control server.
3. **Live stdio-to-UE smoke tests** -- disabled by default, opt-in via environment variables.

### MCP tests

```bash
cd MCP
npm install
npm run test
```

<details>
<summary><strong>Live MCP smoke tests</strong></summary>

```bash
cd MCP
BLUEPRINT_EXTRACTOR_LIVE_E2E=1 npm run test:live
```

`test:live` expects a running UE editor with Remote Control enabled. It creates scratch assets under `/Game/__GeneratedTests__/McpLive_*` and can smoke-test committed fixture assets via optional environment variables:

`BLUEPRINT_EXTRACTOR_TEST_BLUEPRINT`, `BLUEPRINT_EXTRACTOR_TEST_WIDGET_BLUEPRINT`, `BLUEPRINT_EXTRACTOR_TEST_STATE_TREE`, `BLUEPRINT_EXTRACTOR_TEST_BEHAVIOR_TREE`, `BLUEPRINT_EXTRACTOR_TEST_BLACKBOARD`, `BLUEPRINT_EXTRACTOR_TEST_DATA_ASSET`, `BLUEPRINT_EXTRACTOR_TEST_DATA_TABLE`, `BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_STRUCT`, `BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_ENUM`, `BLUEPRINT_EXTRACTOR_TEST_CURVE`, `BLUEPRINT_EXTRACTOR_TEST_CURVE_TABLE`, `BLUEPRINT_EXTRACTOR_TEST_MATERIAL`, `BLUEPRINT_EXTRACTOR_TEST_MATERIAL_FUNCTION`, `BLUEPRINT_EXTRACTOR_TEST_MATERIAL_INSTANCE`, `BLUEPRINT_EXTRACTOR_TEST_ANIM_SEQUENCE`, `BLUEPRINT_EXTRACTOR_TEST_ANIM_MONTAGE`, `BLUEPRINT_EXTRACTOR_TEST_BLEND_SPACE`

</details>

### UE automation tests

<details>
<summary><strong>Running UE automation tests</strong></summary>

The repository includes a fixture project at `tests/fixtures/BlueprintExtractorFixture/` with the project file `BPXFixture.uproject`.

**Windows:**

```powershell
.\scripts\test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6"
```

**macOS / Linux:**

```bash
./scripts/test-ue.sh --engine-root "/path/to/UE_5.6"
```

Both scripts sync `BlueprintExtractor/` into the fixture project, optionally build, and execute `Automation RunTests BlueprintExtractor` headlessly.

CI workflows (`.github/workflows/ci.yml` and `nightly.yml`) assume self-hosted Windows runners labeled `ue-5.6`, `ue-5.7`, and `ue-live`.

</details>

## Repository Structure

<details>
<summary><strong>Full directory tree</strong></summary>

```
ue-blueprint-extractor/
├── BlueprintExtractor/              # UE5 plugin -- copy into your project's Plugins/
│   ├── BlueprintExtractor.uplugin
│   └── Source/BlueprintExtractor/
│       ├── BlueprintExtractor.Build.cs
│       ├── Public/                  # Headers (Library, Subsystem, Types, Settings, Schema)
│       └── Private/                 # Implementation
│           ├── Authoring/           # Explicit-save write surfaces
│           ├── Builders/            # WidgetTreeBuilder and related builders
│           ├── Extractors/          # All extraction implementations
│           ├── Tests/               # UE editor automation specs
│           └── NodeExtractors/      # Visitor pattern: CallFunction, Event, Variable, etc.
├── MCP/                             # MCP server (npm: blueprint-extractor-mcp)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/                         # index.ts, compactor.ts, ue-client.ts, types.ts
│   └── tests/                       # Vitest contract, stdio, and live-gated MCP tests
├── docs/
│   └── testing.md                   # Test strategy and runner usage
├── scripts/                         # Cross-platform test runners
├── tests/
│   └── fixtures/                    # Lightweight UE fixture project
├── install-mcp.ps1                  # Register MCP with Claude Code (Windows)
├── install-mcp.sh                   # Register MCP with Claude Code (macOS/Linux)
├── install-codex-mcp.ps1            # Register MCP with Codex (Windows)
├── install-codex-mcp.sh             # Register MCP with Codex (macOS/Linux)
├── CHANGELOG.md
└── README.md
```

</details>

## Contributing

Contributions are welcome! Please run `npm test` in the `MCP/` directory before submitting a pull request. For UE-side changes, run the automation tests against the fixture project.

## Publishing (Maintainers)

```bash
cd MCP
npm login
npm publish --access public
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

**Latest: v2.1.0** -- direct material connection resolver with output/input index selectors, hardened widget class-defaults extraction, Overlay slot round-trip coverage.
