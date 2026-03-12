# Blueprint Extractor

UE5 editor plugin that extracts Blueprint, AnimBlueprint, WidgetBlueprint, StateTree, BehaviorTree, Blackboard, DataAsset, DataTable, UserDefinedStruct, UserDefinedEnum, Curve, CurveTable, Material, MaterialFunction-family assets, MaterialInstance, AnimSequence, AnimMontage, and BlendSpace data to structured JSON. It also supports explicit-save authoring for the current feasible editor-side families and async import or reimport jobs for textures and meshes through the MCP bridge.

> Recommended companion plugin for [ClaudeRules](https://github.com/SunGrow/ClaudeRules). Optional but highly recommended for Unreal Engine projects using Claude Code.

## Quick Start

1. Copy `BlueprintExtractor/` into your UE project's `Plugins/` directory.
2. Enable plugin dependencies in the project: `StateTree` and `PropertyBindingUtils`.
3. If you want MCP access from Claude Code or Codex, also enable UE's `Web Remote Control` plugin.
4. Rebuild the project.
5. Register the MCP server with your client:

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

BehaviorTree and Blackboard support also relies on UE's built-in `AIModule`; no extra plugin enable step is required.

## Repository Structure

```
ue-blueprint-extractor/
├── BlueprintExtractor/              # UE5 plugin — copy this into your project's Plugins/
│   ├── BlueprintExtractor.uplugin
│   └── Source/BlueprintExtractor/
│       ├── BlueprintExtractor.Build.cs
│       ├── Public/                  # Headers (Library, Subsystem, Types, Settings, Schema)
│       └── Private/                 # Implementation
│           ├── Authoring/           # Explicit-save write surfaces for feasible editor-side asset families
│           ├── Builders/            # WidgetTreeBuilder and related editor-side builders
│           ├── Extractors/          # Blueprint, WidgetTree, StateTree, BehaviorTree, Blackboard, DataAsset, DataTable, UserDefinedStruct/Enum, Curve, Material, Anim, Timeline, Bytecode
│           ├── Tests/               # UE editor automation specs
│           └── NodeExtractors/      # Visitor pattern: CallFunction, Event, Variable, FlowControl, Macro, Timeline
├── MCP/                             # MCP server for Claude Code and Codex (published to npm as blueprint-extractor-mcp)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                 # MCP tool definitions (70 tools + 9 resources + 2 resource templates)
│   │   ├── compactor.ts             # JSON compaction for LLM consumption (strip noise fields, minify)
│   │   ├── ue-client.ts             # UE Remote Control HTTP client
│   │   └── types.ts                 # Shared TypeScript types
│   └── tests/                       # Vitest contract, stdio, and live-gated MCP tests
├── docs/
│   └── testing.md                   # Test strategy and runner usage
├── scripts/                         # Cross-platform test runners
├── tests/
│   └── fixtures/                    # Lightweight UE fixture project for automation coverage
├── install-mcp.ps1                  # Register MCP server with Claude Code (Windows)
├── install-mcp.sh                   # Register MCP server with Claude Code (macOS/Linux)
├── install-codex-mcp.ps1            # Register MCP server with Codex (Windows)
├── install-codex-mcp.sh             # Register MCP server with Codex (macOS/Linux)
└── README.md
```

## Usage

### Content Browser

Right-click any Blueprint-class asset (including AnimBlueprints and WidgetBlueprints), StateTree, DataAsset, or DataTable asset in the Content Browser and select **Extract to JSON**.

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

// Single Material / MaterialFunction / MaterialInstance / animation asset
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

### Materials and MaterialInstances

- **Materials** — compact classic graph extraction for root property connections, expressions, comments, parameter groups, layer stacks, and authored material settings
- **MaterialFunctions / Layers / LayerBlends** — compact graph extraction with FunctionInput/FunctionOutput coverage plus family kind metadata
- **MaterialInstances** — parent material path and resolved base material plus scalar, vector, texture, runtime virtual texture, sparse volume texture, font, static switch, and classic layer-stack overrides
- **Effective values** — instance extraction uses material query APIs, so the JSON reflects the effective parameter state seen by the instance

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
  +-- MaterialGraphExtractor       (classic material and material-function graph extraction)
  +-- MaterialInstanceExtractor    (effective parameter query APIs + layer stack / font / RVT / sparse volume texture)
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

If you only need the normal install flow, use the quick-start scripts above. The options below are the full manual and local-build equivalents.

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
| `extract_material` | Extract a compact classic Material graph to JSON |
| `extract_material_function` | Extract a compact MaterialFunction / MaterialLayer / MaterialLayerBlend graph to JSON |
| `extract_material_instance` | Extract a MaterialInstance to JSON |
| `extract_anim_sequence` | Extract an AnimSequence to JSON |
| `extract_anim_montage` | Extract an AnimMontage to JSON |
| `extract_blend_space` | Extract a BlendSpace to JSON |
| `extract_cascade` | Extract multiple assets with reference following and manifest output |
| `search_assets` | Search assets by name and class filter |
| `list_assets` | List assets under a package path |
| `create_widget_blueprint` | Create a new WidgetBlueprint asset with a specified parent class |
| `extract_widget_blueprint` | Extract a compact widget-authoring snapshot with widget tree, bindings, animations, compile status, and optional class defaults |
| `build_widget_tree` | Build/replace the entire widget hierarchy of a WidgetBlueprint from a JSON tree |
| `modify_widget` | Patch properties, slot config, rename fields, and widget variable flags on one widget by `widget_name` or `widget_path` |
| `modify_widget_blueprint` | Primary widget authoring tool for structural ops such as replace-tree, patch-widget, patch-class-defaults, insert-child, move, wrap, replace-class, batch, and compile workflows |
| `compile_widget_blueprint` | Compile a WidgetBlueprint and return errors/warnings plus counts |
| `compile_project_code` | Run an external UBT build from the MCP host for the current project/editor target |
| `trigger_live_coding` | Request an editor-side Live Coding compile on Windows-supported setups |
| `restart_editor` | Request an editor restart and wait for Remote Control to disconnect and reconnect |
| `sync_project_code` | Use explicit `changed_paths` to choose Live Coding vs build-and-restart without guessing from source control |
| `apply_window_ui_changes` | Thin helper that sequences widget variable flags, widget class defaults, optional font work, compile/save, and optional code sync |
| `create_data_asset` | Create a concrete DataAsset asset and optionally initialize editable properties |
| `modify_data_asset` | Apply a reflected property patch to an existing DataAsset |
| `create_data_table` | Create a DataTable with a concrete row struct and optional initial rows |
| `modify_data_table` | Upsert, delete, or replace rows in an existing DataTable |
| `create_curve` | Create a CurveFloat, CurveVector, or CurveLinearColor asset with optional channel payloads |
| `modify_curve` | Patch curve channels and upsert or delete individual keys |
| `create_curve_table` | Create a CurveTable in rich or simple mode with optional initial rows |
| `modify_curve_table` | Upsert, delete, or replace rows in an existing CurveTable |
| `create_material` | Create a classic Material asset with optional initial texture and settings |
| `modify_material` | Apply compact graph and settings operations to a classic Material asset |
| `create_material_function` | Create a MaterialFunction, MaterialLayer, or MaterialLayerBlend asset |
| `modify_material_function` | Apply compact graph and settings operations to a MaterialFunction-family asset |
| `compile_material_asset` | Recompile or refresh a material-family asset without saving it |
| `create_material_instance` | Create a MaterialInstanceConstant from a parent material/interface |
| `modify_material_instance` | Reparent a MaterialInstanceConstant or apply scalar/vector/texture/static-switch/font/RVT/SVT/layer-stack overrides |
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
| `import_assets` | Enqueue a generic async asset import job for local files or HTTP/HTTPS URLs |
| `reimport_assets` | Enqueue an async reimport job against existing imported assets |
| `get_import_job` | Poll the current state of one async import or reimport job |
| `list_import_jobs` | List active or completed async import jobs tracked in the current editor session |
| `import_textures` | Enqueue a texture-focused async import job with typed texture option passthrough |
| `import_meshes` | Enqueue a mesh-focused async import job with typed static or skeletal mesh option passthrough |
| `save_assets` | Explicitly save dirty asset packages after successful write operations |

`modify_widget` notes:
- Use `widget_path` when practical; it is safer than `widget_name` after structural edits.
- Use `properties.name`, `properties.newName`, or `properties.new_name` to rename the widget itself.
- For box slots, `slot.Size.sizeRule` accepts `Automatic` or the shorthand `Auto`.

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

- **Right primitive** — The live editor actions are exposed as 70 MCP **tools**. Static guidance lives in 9 resources plus 2 resource templates: `blueprint://scopes`, `blueprint://write-capabilities`, `blueprint://import-capabilities`, `blueprint://authoring-conventions`, `blueprint://selector-conventions`, `blueprint://widget-best-practices`, `blueprint://material-graph-guidance`, `blueprint://font-roles`, `blueprint://project-automation`, and the `blueprint://examples/{family}` / `blueprint://widget-patterns/{pattern}` templates.
- **Small, distinct surface** — 70 tools with non-overlapping purposes. Extraction tools are read-only; authoring, import, and project-automation tools are explicit write or orchestration operations with separate save semantics.
- **Description quality** — Tool descriptions stay selection-focused, while reusable workflows and examples live in resources/templates to save context.
- **Annotations** — All tools declare `readOnlyHint`, `destructiveHint`, `idempotentHint` for safe auto-approval. Read-only extraction tools are auto-approvable; all write tools and `save_assets` require confirmation.
- **Explicit save** — Write and import operations mutate assets and mark packages dirty, but they do not save automatically. Call `save_assets` when you want to persist the dirty packages to disk.
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

`test:live` expects a UE editor to already be running with Remote Control enabled. It creates scratch assets under `/Game/__GeneratedTests__/McpLive_*`, imports a texture over a local HTTP fixture server to verify header forwarding, imports a local mesh fixture, creates scratch material-family assets, saves the imported and authored assets explicitly, and can also smoke-test committed fixture assets when you provide any of these optional asset-path environment variables:

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
- `BLUEPRINT_EXTRACTOR_TEST_MATERIAL`
- `BLUEPRINT_EXTRACTOR_TEST_MATERIAL_FUNCTION`
- `BLUEPRINT_EXTRACTOR_TEST_MATERIAL_INSTANCE`
- `BLUEPRINT_EXTRACTOR_TEST_ANIM_SEQUENCE`
- `BLUEPRINT_EXTRACTOR_TEST_ANIM_MONTAGE`
- `BLUEPRINT_EXTRACTOR_TEST_BLEND_SPACE`

### UE automation tests

The repository includes a shell fixture project at `tests/fixtures/BlueprintExtractorFixture/` with the short project file `BPXFixture.uproject`. The runner scripts sync the plugin source into that fixture project before building so the checked-in fixture stays lightweight.

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
- build the `BPXFixtureEditor` target
- execute `Automation RunTests BlueprintExtractor` headlessly with `UnrealEditor-Cmd`

The repository also includes `.github/workflows/ci.yml` and `.github/workflows/nightly.yml`. The UE lanes assume self-hosted Windows runners labeled `ue-5.6`, `ue-5.7`, and `ue-live`, plus repository variables for engine roots and live Remote Control endpoints.

Mutable automation output is expected under `/Game/__GeneratedTests__`. The fixture project should remain read-only apart from generated build/cache folders and the synced plugin copy.

## Publishing (Maintainers)

To publish the MCP server to npm:

```bash
cd MCP
npm login
npm publish --access public
```

## Changelog

### 1.13.0
- **Widget metadata parity** — `modify_widget` and `modify_widget_blueprint.patch_widget` now accept `is_variable` aliases for existing widgets, and `extract_widget_blueprint` can include Blueprint class defaults alongside widget and slot data.
- **Explicit widget defaults and fonts** — added widget-scoped `patch_class_defaults`, `import_fonts`, and `apply_widget_fonts` so UI polish flows can set class-default materials and runtime `UFont` assets without oversized reflected payloads.
- **Project code automation** — added project-control support for `compile_project_code`, `trigger_live_coding`, `restart_editor`, `sync_project_code`, and the thin `apply_window_ui_changes` helper workflow.
- **Automation coverage** — added UE automation for widget variable toggles, class-default patching, runtime font creation or application, plus MCP contract and project-controller coverage for the new code-sync surface.

### 1.12.0
- **Classic material graph support** — added `extract_material`, `create_material`, `modify_material`, `extract_material_function`, `create_material_function`, `modify_material_function`, and `compile_material_asset` for compact UMaterial and MaterialFunction-family authoring.
- **Shared material graph DSL** — material writes now use stable `expression_guid` selectors, batch-local `temp_id` references, material-property connections such as `MP_BaseColor`, and explicit compile/layout controls.
- **MaterialInstance parity** — expanded material-instance extraction and authoring with runtime virtual texture, sparse volume texture, font, parameter-metadata, and classic layer-stack support.
- **Cross-version hardening** — material automation now passes on UE 5.6 and 5.7, including the fixture-target BuildSettings update needed for 5.7 compatibility.

### 1.11.0
- **Widget authoring polish** — added `extract_widget_blueprint`, expanded `modify_widget_blueprint` with `insert_child`, `remove_widget`, `move_widget`, `wrap_widget`, `replace_widget_class`, and `batch`, and added `widget_path` support plus `validate_only` to the widget mutation flow.
- **MCP guidance split** — moved reusable authoring guidance into `blueprint://authoring-conventions`, `blueprint://selector-conventions`, `blueprint://widget-best-practices`, plus the `blueprint://examples/{family}` and `blueprint://widget-patterns/{pattern}` templates.
- **Compact success responses** — widget/save/import authoring responses now default to compact JSON text with full parsed data in `structuredContent`.
- **Broader canary coverage** — automation and MCP tests now cover compact widget extraction, structural widget mutations, resource templates, and a CommonUI parent canary.

### 1.10.0
- **Async import tools** — added `import_assets`, `reimport_assets`, `get_import_job`, `list_import_jobs`, `import_textures`, and `import_meshes`.
- **Editor-host import jobs** — imports and reimports now run as session-scoped async jobs inside the editor, with polling, per-item diagnostics, explicit-save semantics, local file support, and HTTP/HTTPS staging for remote sources.
- **Texture and mesh helpers** — texture imports expose typed overrides such as `srgb`, compression, LOD group, virtual texture streaming, and green-channel flip; mesh imports expose typed static or skeletal mesh options including skeleton selection, material or texture import, mesh combining, and collision generation.
- **Import capability docs and live coverage** — added `blueprint://import-capabilities`, expanded MCP contract and stdio tests for import polling, and added live-gated texture and mesh smoke coverage with local HTTP header-forwarding verification.

### 1.9.0
- **18 new authoring tools** — added `create_user_defined_struct`, `modify_user_defined_struct`, `create_user_defined_enum`, `modify_user_defined_enum`, `create_blackboard`, `modify_blackboard`, `create_behavior_tree`, `modify_behavior_tree`, `create_state_tree`, `modify_state_tree`, `create_anim_sequence`, `modify_anim_sequence`, `create_anim_montage`, `modify_anim_montage`, `create_blend_space`, `modify_blend_space`, `create_blueprint`, and `modify_blueprint_members`.
- **Stable writer selectors** — BehaviorTree writes now target `nodePath`, StateTree writes support `stateId`/`statePath`, `editorNodeId`, and `transitionId`, animation writes expose stable notify identifiers plus `sampleIndex`, and Blueprint/member/schema surfaces use explicit selector fields.
- **Feasible-family write coverage** — explicit-save authoring now spans schema assets, AI assets, StateTrees, animation metadata assets, and Blueprint member authoring while still deferring arbitrary graph synthesis, controller editing, and live world mutation.
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
