# Blueprint Extractor

UE5 editor plugin that extracts Blueprint, AnimBlueprint, WidgetBlueprint, StateTree, BehaviorTree, Blackboard, DataAsset, DataTable, UserDefinedStruct, UserDefinedEnum, Curve, CurveTable, MaterialInstance, AnimSequence, AnimMontage, and BlendSpace data to structured JSON, and supports explicit-save authoring for all currently feasible editor-side families: WidgetBlueprints, MaterialInstances, DataAssets, DataTables, Curves, CurveTables, UserDefinedStructs, UserDefinedEnums, Blackboards, BehaviorTrees, StateTrees, AnimSequences, AnimMontages, BlendSpaces, and Blueprint members.

> Recommended companion plugin for [ClaudeRules](https://github.com/SunGrow/ClaudeRules). Optional but highly recommended for Unreal Engine projects using Claude Code.

## Repository Structure

```
ue-blueprint-extractor/
├── BlueprintExtractor/              # UE5 plugin — copy this into your project's Plugins/
│   ├── BlueprintExtractor.uplugin
│   └── Source/BlueprintExtractor/
│       ├── BlueprintExtractor.Build.cs
│       ├── Public/                  # Headers (Library, Subsystem, Types, Settings, Schema)
│       └── Private/                 # Implementation
│           ├── Extractors/          # Blueprint, WidgetTree, StateTree, BehaviorTree, Blackboard, DataAsset, DataTable, UserDefinedStruct/Enum, Curve, Material, Anim, Timeline, Bytecode
│           ├── Builders/            # WidgetTreeBuilder (create, build, modify, compile WidgetBlueprints)
│           └── NodeExtractors/      # Visitor pattern: CallFunction, Event, Variable, FlowControl, Macro, Timeline
├── MCP/                             # MCP server for Claude Code (published to npm as blueprint-extractor-mcp)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # MCP tool definitions (51 tools + 2 resources)
│       ├── compactor.ts             # JSON compaction for LLM consumption (strip noise fields, minify)
│       ├── ue-client.ts             # UE Remote Control HTTP client
│       └── types.ts                 # Shared TypeScript types
├── install-mcp.ps1                  # Register MCP server with Claude Code (Windows)
├── install-mcp.sh                   # Register MCP server with Claude Code (macOS/Linux)
└── README.md
```

## Installation

Copy the `BlueprintExtractor/` folder into any UE5 project's `Plugins/` directory and rebuild.

**Plugin dependencies** (must be enabled in your project): `StateTree`, `StructUtils`.

The module also depends on UE's built-in `AIModule` for BehaviorTree and Blackboard extraction; no extra plugin enable step is required.

## Usage

### Content Browser

Right-click any Blueprint, AnimBlueprint, StateTree, DataAsset, or DataTable asset in the Content Browser and select **Extract to JSON**.

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

// Single DataAsset
UBlueprintExtractorLibrary::ExtractDataAssetToJson(DataAsset, OutputPath);

// Single DataTable
UBlueprintExtractorLibrary::ExtractDataTableToJson(DataTable, OutputPath);

// Single BehaviorTree / Blackboard
UBlueprintExtractorLibrary::ExtractBehaviorTreeToJson(BehaviorTree, OutputPath);
UBlueprintExtractorLibrary::ExtractBlackboardToJson(BlackboardData, OutputPath);

// Single MaterialInstance / animation asset
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
| Default Scope | Extraction depth (ClassLevel, Variables, Components, FunctionsShallow, Full, FullWithBytecode) | `Full` |
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

All scopes that include graph data (`FunctionsShallow`, `Full`, `FullWithBytecode`) support an optional **graph filter** — a list of graph names to extract. When provided, only matching graphs are included; when empty, all graphs are extracted (backwards compatible).

Use `FunctionsShallow` first to discover graph names, then request specific graphs with the filter to reduce output size from 300KB+ to 10-30KB per function.

### Compact Output Mode (`extract_blueprint` only)

The MCP server supports a `compact` mode on `extract_blueprint` that strips low-value fields and minifies JSON, reducing size by **~50-70%** for LLM consumption:

- Removes: `pinId`, `posX`/`posY`, `graphGuid`, `autogeneratedDefaultValue`, empty `nodeComment`, empty `connections`, empty `defaultValue`, empty `sub_category`
- Replaces `nodeGuid` UUIDs with sequential short IDs (`n0`, `n1`, ...)
- Rewrites connection references to use short IDs
- Replaces exec pin type objects with the string `"exec"`
- For widget trees: strips redundant `displayLabel`, default `Visible` visibility, empty `properties`
- Outputs minified JSON (no indentation)

## What Gets Extracted

### Blueprints

- **Class level** — parent class, implemented interfaces, class flags, category, description
- **Variables** — name, pin type, default value, property flags, replication, category
- **Components** — SCS tree with recursive children, property overrides (CDO diff)
- **Widget tree** (WidgetBlueprints only) — recursive widget hierarchy, slot config, property overrides, bindings
- **Graphs** — function graphs, event graphs, macro graphs, construction script
- **Nodes** — typed extraction via visitor pattern (function calls, events, variables, flow control, macros, timelines)
- **Pins** — name, direction, full pin type (containers, sub-categories, maps), default values, connections
- **Timelines** — float/vector/event/color tracks with curve keyframes
- **Delegates** — multicast/single-cast with signature parameters
- **Bytecode** — raw hex dump per function (optional)

### DataAssets

- **Schema class** — the UDataAsset / UPrimaryDataAsset subclass name
- **User-defined properties** — all UPROPERTY fields (skips UDataAsset/UObject base), with typed JSON values and reference paths for object properties

### DataTables

- **Row struct schema** — property names and C++ types from the row struct
- **All rows** — keyed by row name, with typed property values per row

### StateTrees

- **Schema** and metadata
- **State hierarchy** — recursive tree of states with type, selection behavior
- **Tasks** — FInstancedStruct properties via UScriptStruct reflection
- **Conditions** — enter conditions, transition conditions, considerations
- **Transitions** — trigger, priority, target state, delay, required events
- **Global** — evaluators, global tasks
- **Linked assets** — references to other StateTrees

### BehaviorTrees and Blackboards

- **BehaviorTree hierarchy** — root node, composite/task nodes, root decorators, child decorators, decorator logic, and services
- **Node properties** — typed CDO-diff extraction for tasks, decorators, and services
- **Blackboard references** — linked blackboard asset for each BehaviorTree
- **Blackboard keys** — effective key list including inherited parent keys and local overrides
- **Key-type details** — base class, enum binding, instance sync, and key-type-specific properties

### UserDefinedStructs and UserDefinedEnums

- **UserDefinedStructs** — struct GUID, status, field metadata, pin types, typed default values, and editor-authored metadata
- **UserDefinedEnums** — entry names, display names, and numeric values (excluding the auto-generated MAX sentinel)

### Curves and CurveTables

- **Curve assets** — float/vector/linear-color channels, key times/values/tangents, interpolation, default values, and extrapolation modes
- **CurveTables** — simple or rich curve rows with row names and per-row curve data

### MaterialInstances

- **Material chain** — parent material path and resolved base material
- **Parameters** — scalar, vector, texture, runtime virtual texture, font, and static switch values
- **Effective values** — uses material query APIs, so the JSON reflects the effective parameter state seen by the instance

### Animation Assets

- **AnimSequences** — length, sampling rate, additive settings, notifies, authored sync markers, and runtime float curves
- **AnimMontages** — slot tracks, animation segments, sections, branching-point notifies, and standard notifies
- **BlendSpaces** — axis definitions, 1D/2D shape, sample coordinates, and referenced animations

### Cascade Extraction

When enabled, after extracting an asset the plugin scans for references to other extractable assets and extracts those too:

- **Parent Blueprint class** — if the parent is a Blueprint (not native C++)
- **Blueprint interfaces** — implemented Blueprint-defined interfaces
- **Variable types** — variables typed to Blueprint-generated classes
- **Node pin references** — SpawnActor class pins, function call targets, etc.
- **Component classes** — Blueprint-based components in the SCS tree
- **BehaviorTree links** — blackboard assets plus Blueprint-authored task/decorator/service classes
- **Blackboard inheritance** — parent blackboards
- **StateTree linked assets** — other StateTrees referenced by linked states
- **StateTree instance objects** — Blueprint-based task/condition classes
- **Material instance parents** — parent material instances in the override chain
- **Animation references** — montage segment animations and blend-space sample animations

Cascade writes collision-proof filenames derived from asset package paths and returns a manifest with `assetPath`, `assetType`, `outputFile`, `depth`, `status`, and optional `error`.

Cycle protection prevents infinite loops. Depth limit controls how far references are followed.

## Architecture

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
  +-- MaterialInstanceExtractor    (effective parameter query APIs)
  +-- AnimAssetExtractor           (AnimSequence, AnimMontage, BlendSpace)
  +-- WidgetTreeExtractor          (widget hierarchy, slots, properties, bindings)
  +-- BlueprintJsonSchema          (pin type serialization, flag bitmasks)
  +-- WidgetTreeBuilder            (create, build, modify, compile WidgetBlueprints)
  +-- Authoring/*                  (shared mutation session, explicit-save writes for feasible asset families)

MCP Server (Node.js/TypeScript)    (stdio transport, bridges Claude Code <-> UE Remote Control)
  +-- UEClient                     (HTTP client for PUT /remote/object/call)
```

## MCP Server (Claude Code and Codex)

The plugin includes an MCP (Model Context Protocol) server that lets Claude Code or Codex extract UE assets and perform explicit-save authoring across the currently supported families from a running UE5 editor.

### Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- Codex CLI
- **Web Remote Control** plugin enabled in UE5 (Edit > Plugins > search "Remote Control")

### Setup

**Option A: npx (recommended)**

Run the install script for your client. Each script registers the npm package via `npx`:

```bash
# Claude Code: Windows (PowerShell)
.\install-mcp.ps1

# Claude Code: macOS / Linux
./install-mcp.sh

# Codex: Windows (PowerShell)
.\install-codex-mcp.ps1

# Codex: macOS / Linux
./install-codex-mcp.sh
```

Or register manually:

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

**Option B: Local build**

Build the MCP server from source (useful for development):

```bash
# Claude Code: Windows (PowerShell)
.\install-mcp.ps1 -Local

# Claude Code: macOS / Linux
./install-mcp.sh --local

# Codex: Windows (PowerShell)
.\install-codex-mcp.ps1 -Local

# Codex: macOS / Linux
./install-codex-mcp.sh --local
```

Then open a new session or restart your client. The tools will appear automatically after the MCP is registered with that client.

### MCP Tools

| Tool | Description |
|------|-------------|
| `extract_blueprint` | Extract a Blueprint, AnimBlueprint, or WidgetBlueprint to JSON (asset path + scope + optional graph filter + compact mode). WidgetBlueprints include widget tree hierarchy at Components scope. |
| `extract_statetree` | Extract a StateTree to JSON |
| `extract_behavior_tree` | Extract a BehaviorTree to JSON |
| `extract_blackboard` | Extract a Blackboard to JSON |
| `extract_dataasset` | Extract a DataAsset to JSON (all UPROPERTY fields) |
| `extract_datatable` | Extract a DataTable to JSON (schema + all rows) |
| `extract_user_defined_struct` | Extract a UserDefinedStruct to JSON |
| `extract_user_defined_enum` | Extract a UserDefinedEnum to JSON |
| `extract_curve` | Extract a Curve asset to JSON |
| `extract_curvetable` | Extract a CurveTable to JSON |
| `extract_material_instance` | Extract a MaterialInstance to JSON |
| `extract_anim_sequence` | Extract an AnimSequence to JSON |
| `extract_anim_montage` | Extract an AnimMontage to JSON |
| `extract_blend_space` | Extract a BlendSpace to JSON |
| `extract_cascade` | Extract multiple assets with reference following and manifest output |
| `search_assets` | Search assets by name and class filter |
| `list_assets` | List assets under a package path |
| `create_widget_blueprint` | Create a new WidgetBlueprint asset with a specified parent class |
| `build_widget_tree` | Build/replace the entire widget hierarchy of a WidgetBlueprint from a JSON tree |
| `modify_widget` | Patch properties and/or slot config on an existing widget by name |
| `modify_widget_blueprint` | High-level widget alias for replace-tree, patch-widget, and validate/compile workflows |
| `compile_widget_blueprint` | Compile a WidgetBlueprint and return errors/warnings plus counts |
| `create_data_asset` | Create a concrete DataAsset asset and optionally initialize editable properties |
| `modify_data_asset` | Apply a reflected property patch to an existing DataAsset |
| `create_data_table` | Create a DataTable with a concrete row struct and optional initial rows |
| `modify_data_table` | Upsert, delete, or replace rows in an existing DataTable |
| `create_curve` | Create a CurveFloat, CurveVector, or CurveLinearColor asset with optional channel payloads |
| `modify_curve` | Patch curve channels and upsert or delete individual keys |
| `create_curve_table` | Create a CurveTable in rich or simple mode with optional initial rows |
| `modify_curve_table` | Upsert, delete, or replace rows in an existing CurveTable |
| `create_material_instance` | Create a MaterialInstanceConstant from a parent material/interface |
| `modify_material_instance` | Reparent a MaterialInstanceConstant or apply scalar/vector/texture/static-switch overrides |
| `create_user_defined_struct` | Create a UserDefinedStruct from extractor-shaped field payloads |
| `modify_user_defined_struct` | Replace, patch, rename, remove, or reorder UserDefinedStruct fields |
| `create_user_defined_enum` | Create a UserDefinedEnum from extractor-shaped entry payloads |
| `modify_user_defined_enum` | Replace, rename, remove, or reorder UserDefinedEnum entries |
| `create_blackboard` | Create a BlackboardData asset from extractor-shaped key payloads |
| `modify_blackboard` | Replace, patch, remove, or reparent Blackboard keys |
| `create_behavior_tree` | Create a BehaviorTree from extractor-shaped tree payloads |
| `modify_behavior_tree` | Replace a BehaviorTree, patch nodes/attachments by `nodePath`, or set the blackboard |
| `create_state_tree` | Create a StateTree from extractor-shaped editor data payloads |
| `modify_state_tree` | Replace a StateTree, patch states/editor nodes/transitions, or change schema |
| `create_anim_sequence` | Create an AnimSequence from extractor-shaped notify, sync-marker, and curve metadata payloads |
| `modify_anim_sequence` | Replace or patch AnimSequence notifies, sync markers, and curve metadata |
| `create_anim_montage` | Create an AnimMontage from extractor-shaped notify, section, and slot payloads |
| `modify_anim_montage` | Replace or patch AnimMontage notifies, sections, and slots |
| `create_blend_space` | Create a BlendSpace or BlendSpace1D from extractor-shaped axis and sample payloads |
| `modify_blend_space` | Replace or patch BlendSpace samples and axes |
| `create_blueprint` | Create a Blueprint with optional variables, component templates, function stubs, and class defaults |
| `modify_blueprint_members` | Replace or patch Blueprint variables, components, function stubs, class defaults, and compile |
| `save_assets` | Explicitly save dirty asset packages after successful write operations |

### Architecture

```
Claude Code  <-stdio->  MCP Server (Node.js)  <-HTTP->  UE5 Editor (Remote Control API)
                                                         |
                                                  BlueprintExtractorSubsystem
                                                         |
                                                  BlueprintExtractorLibrary (existing)
```

The `BlueprintExtractorSubsystem` (`UEditorSubsystem`) wraps the existing library methods with string-based parameters callable via `PUT /remote/object/call`.

### Design Principles

The MCP server follows current best practices for tool design:

- **Right primitive** — All 51 endpoints are **tools** (model-controlled, on-demand computation), not resources, because each requires parameters and queries a live UE editor. `blueprint://scopes` and `blueprint://write-capabilities` provide static capability references.
- **Small, distinct surface** — 51 tools with non-overlapping purposes. Extraction tools are read-only; authoring tools are explicit write operations with separate save semantics.
- **Description quality** — Each tool includes usage guidelines, scope size estimates, and workflow hints (e.g., "use `search_assets` first") to maximize selection accuracy.
- **Annotations** — All tools declare `readOnlyHint`, `destructiveHint`, `idempotentHint` for safe auto-approval. Read-only extraction tools are auto-approvable; all write tools and `save_assets` require confirmation.
- **Explicit save** — Write operations mutate assets and mark packages dirty, but they do not save automatically. Call `save_assets` when you want to persist the dirty packages to disk.
- **Bounded authoring** — The write surface covers reflected properties, declarative trees, schema assets, animation metadata, and Blueprint members; arbitrary graph/controller/world synthesis is still intentionally deferred.
- **Security** — stdio transport, env-based credentials (`UE_REMOTE_CONTROL_PORT`), local-only by default. No auth tokens or remote access.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UE_REMOTE_CONTROL_HOST` | `127.0.0.1` | UE editor host |
| `UE_REMOTE_CONTROL_PORT` | `30010` | Remote Control HTTP port |
| `UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH` | auto-probe | Optional explicit subsystem object path override for deterministic live testing |

## Testing

Testing is split into three layers:

- UE editor automation for the plugin itself. These tests live under `BlueprintExtractor/Source/BlueprintExtractor/Private/Tests/` and call `UBlueprintExtractorSubsystem` directly.
- Fast MCP contract and HTTP tests under `MCP/tests/` using Vitest, the official MCP SDK client, in-memory transports, and a tiny mock Remote Control server.
- Live stdio-to-UE smoke tests that are disabled by default and only run when you opt in with environment variables.

### MCP tests

```bash
cd MCP
npm install
npm run test
```

Optional live MCP smoke:

```bash
cd MCP
BLUEPRINT_EXTRACTOR_LIVE_E2E=1 npm run test:live
```

`test:live` expects a UE editor to already be running with Remote Control enabled. It will create scratch assets under `/Game/__GeneratedTests__/Live` and can also smoke-test committed fixture assets when you provide any of these optional asset-path environment variables:

- `BLUEPRINT_EXTRACTOR_TEST_BLUEPRINT`
- `BLUEPRINT_EXTRACTOR_TEST_WIDGET_BLUEPRINT`
- `BLUEPRINT_EXTRACTOR_TEST_STATE_TREE`
- `BLUEPRINT_EXTRACTOR_TEST_BEHAVIOR_TREE`
- `BLUEPRINT_EXTRACTOR_TEST_BLACKBOARD`
- `BLUEPRINT_EXTRACTOR_TEST_DATA_ASSET`
- `BLUEPRINT_EXTRACTOR_TEST_DATA_TABLE`
- `BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_STRUCT`
- `BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_ENUM`
- `BLUEPRINT_EXTRACTOR_TEST_CURVE`
- `BLUEPRINT_EXTRACTOR_TEST_CURVE_TABLE`
- `BLUEPRINT_EXTRACTOR_TEST_MATERIAL_INSTANCE`
- `BLUEPRINT_EXTRACTOR_TEST_ANIM_SEQUENCE`
- `BLUEPRINT_EXTRACTOR_TEST_ANIM_MONTAGE`
- `BLUEPRINT_EXTRACTOR_TEST_BLEND_SPACE`

### UE automation tests

The repository includes a shell fixture project at `tests/fixtures/BlueprintExtractorFixture/`. The runner scripts sync the plugin source into that fixture project before building so the checked-in fixture stays lightweight.

Windows:

```powershell
.\scripts\test-ue.ps1 -EngineRoot "C:\Program Files\Epic Games\UE_5.6"
```

macOS / Linux:

```bash
./scripts/test-ue.sh --engine-root "/path/to/UE_5.6"
```

Both scripts:

- sync `BlueprintExtractor/` into `tests/fixtures/BlueprintExtractorFixture/Plugins/BlueprintExtractor`
- optionally run `BuildPlugin`
- build the `BlueprintExtractorFixtureEditor` target
- execute `Automation RunTests BlueprintExtractor` headlessly with `UnrealEditor-Cmd`

Mutable automation output is expected under `/Game/__GeneratedTests__`. The fixture project should remain read-only apart from generated build/cache folders and the synced plugin copy.

## Publishing (Maintainers)

To publish the MCP server to npm:

```bash
cd MCP
npm login
npm publish --access public
```

## Changelog

### Unreleased
- **18 new authoring tools** — added `create_user_defined_struct`, `modify_user_defined_struct`, `create_user_defined_enum`, `modify_user_defined_enum`, `create_blackboard`, `modify_blackboard`, `create_behavior_tree`, `modify_behavior_tree`, `create_state_tree`, `modify_state_tree`, `create_anim_sequence`, `modify_anim_sequence`, `create_anim_montage`, `modify_anim_montage`, `create_blend_space`, `modify_blend_space`, `create_blueprint`, and `modify_blueprint_members`.
- **Stable writer selectors** — BehaviorTree writes now target `nodePath`, StateTree writes support `stateId`/`statePath`, `editorNodeId`, and `transitionId`, animation writes expose stable notify identifiers plus `sampleIndex`, and Blueprint/member/schema surfaces use explicit selector fields.
- **Feasible-family write coverage** — explicit-save authoring now spans schema assets, AI assets, StateTrees, animation metadata assets, and Blueprint member authoring while still deferring arbitrary graph synthesis, controller editing, and live world mutation.

### 1.9.0
- **Shared write core** — added normalized mutation results, explicit `save_assets` persistence, validation-only write flows, and reusable reflected property patching for editor-side authoring.
- **Widget hardening** — widget tree replacement now preflights before destructive changes, widget/property writes use the shared mutation layer, and `modify_widget_blueprint` remains the higher-level alias for tree replacement, patching, and compile workflows.
- **New authoring families** — added `create_data_table`, `modify_data_table`, `create_curve`, `modify_curve`, `create_curve_table`, and `modify_curve_table`, alongside the already added `create_data_asset`, `modify_data_asset`, `create_material_instance`, and `modify_material_instance`.
- **Capability docs** — added `blueprint://write-capabilities` and updated MCP descriptions around explicit-save behavior and current write-capable asset families.

### 1.8.0
- **10 new extraction tools** — added `extract_behavior_tree`, `extract_blackboard`, `extract_user_defined_struct`, `extract_user_defined_enum`, `extract_curve`, `extract_curvetable`, `extract_material_instance`, `extract_anim_sequence`, `extract_anim_montage`, and `extract_blend_space`.
- **Schema 1.2.0** — final Phase 2 schema version for the expanded extractor surface.
- **Cascade hardening** — manifest-based cascade output with collision-proof filenames, per-asset status/error reporting, new supported asset types, and reference following for BehaviorTree, Blackboard, MaterialInstance, AnimMontage, and BlendSpace dependencies.
- **Search + compile upgrades** — `search_assets` now supports `max_results` with filtered AssetRegistry queries, and `compile_widget_blueprint` returns real compiler errors/warnings with counts.
- **Typed property serialization everywhere** — DataAssets, DataTables, component overrides, widget overrides, and new extractor families now emit typed JSON values instead of flattening everything to strings.

### 1.6.0
- **WidgetBlueprint support** — `extract_blueprint` now extracts the widget tree hierarchy for WidgetBlueprints at `Components` scope, including slot config, property overrides (CDO diff with typed JSON values), and property bindings.
- **Widget creation tools** — 4 new MCP tools: `create_widget_blueprint`, `build_widget_tree`, `modify_widget`, `compile_widget_blueprint`. Enables programmatic widget tree creation from Claude Code.
- **Compact mode for widget trees** — strips redundant `displayLabel`, default visibility, and empty properties.
- **Typed property extraction** — widget property overrides now serialize as proper JSON types (booleans, numbers, objects for structs/colors) instead of flat strings.

### 1.5.0
- WidgetTree extraction for WidgetBlueprints (widget hierarchy, slot info, properties).
- `list_assets` with folder browsing support.

### 1.4.1
- **Fix**: UHT compilation error — `UFUNCTION` declarations with `TArray<FName>` default parameters used brace-initialization (`= {}`), which UHT cannot parse. Replaced with non-UFUNCTION overloads that forward with an empty array.

### 1.4.0
- Graph filtering (`graph_filter`) and compact output mode (`compact`) for Blueprints and cascade extraction.

## Requirements

- Unreal Engine 5.x (tested on 5.6 and 5.7)
- Editor-only — not included in packaged builds
