# Blueprint Extractor

UE5 editor plugin that extracts Blueprint and StateTree data to structured JSON for C++ conversion and analysis.

## Installation

Copy the `BlueprintExtractor/` folder into any UE5 project's `Plugins/` directory and rebuild.

**Plugin dependencies** (must be enabled in your project): `StateTree`, `StructUtils`.

## Usage

### Content Browser

Right-click any Blueprint or StateTree asset in the Content Browser and select **Extract to JSON**.

### C++ API

```cpp
#include "BlueprintExtractorLibrary.h"

// Single Blueprint
UBlueprintExtractorLibrary::ExtractBlueprintToJson(Blueprint, OutputPath, EBlueprintExtractionScope::Full);

// Single StateTree
UBlueprintExtractorLibrary::ExtractStateTreeToJson(StateTree, OutputPath);

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
| Components | + SCS component tree with property overrides vs CDO |
| FunctionsShallow | + Function/event graph names only |
| Full | + Complete graph/node/pin extraction with connections |
| FullWithBytecode | + Raw bytecode hex dump per function |

## What Gets Extracted

### Blueprints

- **Class level** — parent class, implemented interfaces, class flags, category, description
- **Variables** — name, pin type, default value, property flags, replication, category
- **Components** — SCS tree with recursive children, property overrides (CDO diff)
- **Graphs** — function graphs, event graphs, macro graphs, construction script
- **Nodes** — typed extraction via visitor pattern (function calls, events, variables, flow control, macros, timelines)
- **Pins** — name, direction, full pin type (containers, sub-categories, maps), default values, connections
- **Timelines** — float/vector/event/color tracks with curve keyframes
- **Delegates** — multicast/single-cast with signature parameters
- **Bytecode** — raw hex dump per function (optional)

### StateTrees

- **Schema** and metadata
- **State hierarchy** — recursive tree of states with type, selection behavior
- **Tasks** — FInstancedStruct properties via UScriptStruct reflection
- **Conditions** — enter conditions, transition conditions, considerations
- **Transitions** — trigger, priority, target state, delay, required events
- **Global** — evaluators, global tasks
- **Linked assets** — references to other StateTrees

### Cascade Extraction

When enabled, after extracting an asset the plugin scans for references to other extractable assets and extracts those too:

- **Parent Blueprint class** — if the parent is a Blueprint (not native C++)
- **Blueprint interfaces** — implemented Blueprint-defined interfaces
- **Variable types** — variables typed to Blueprint-generated classes
- **Node pin references** — SpawnActor class pins, function call targets, etc.
- **Component classes** — Blueprint-based components in the SCS tree
- **StateTree linked assets** — other StateTrees referenced by linked states
- **StateTree instance objects** — Blueprint-based task/condition classes

Cycle protection prevents infinite loops. Depth limit controls how far references are followed.

## Architecture

```
BlueprintExtractorSubsystem        (UEditorSubsystem, string-based API for Remote Control)
  |
BlueprintExtractorLibrary          (public API, cascade BFS loop)
  +-- ClassLevelExtractor          (parent, interfaces, flags)
  +-- VariableExtractor            (NewVariables array)
  +-- ComponentExtractor           (SCS tree, CDO property diff)
  +-- GraphExtractor               (graphs, nodes, pins)
  |     +-- NodeExtractorRegistry  (visitor pattern)
  |           +-- CallFunction, Event, Variable, FlowControl, Macro, Timeline
  +-- TimelineExtractor            (timeline tracks, keyframes)
  +-- BytecodeExtractor            (raw bytecode hex)
  +-- StateTreeExtractor           (editor data, state hierarchy)
  +-- BlueprintJsonSchema          (pin type serialization, flag bitmasks)

MCP Server (Node.js/TypeScript)    (stdio transport, bridges Claude Code ↔ UE Remote Control)
  +-- UEClient                     (HTTP client for PUT /remote/object/call)
```

## MCP Server (Claude Code Integration)

The plugin includes an MCP (Model Context Protocol) server that lets Claude Code extract Blueprint/StateTree data on demand from a running UE5 editor.

### Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- **Web Remote Control** plugin enabled in UE5 (Edit > Plugins > search "Remote Control")

### Setup

Run the install script from the plugin root. It builds the MCP server and registers it globally with Claude Code (user scope — available across all projects):

```bash
# Windows (PowerShell)
.\install-mcp.ps1

# macOS / Linux
./install-mcp.sh
```

Then restart Claude Code. The 5 tools will appear automatically.

### MCP Tools

| Tool | Description |
|------|-------------|
| `extract_blueprint` | Extract a Blueprint to JSON (asset path + scope) |
| `extract_statetree` | Extract a StateTree to JSON |
| `extract_cascade` | Extract multiple assets with reference following |
| `search_assets` | Search assets by name and class filter |
| `list_assets` | List assets under a package path |

### Architecture

```
Claude Code  ←stdio→  MCP Server (Node.js)  ←HTTP→  UE5 Editor (Remote Control API)
                                                         ↓
                                                  BlueprintExtractorSubsystem
                                                         ↓
                                                  BlueprintExtractorLibrary (existing)
```

The `BlueprintExtractorSubsystem` (`UEditorSubsystem`) wraps the existing library methods with string-based parameters callable via `PUT /remote/object/call`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UE_REMOTE_CONTROL_HOST` | `127.0.0.1` | UE editor host |
| `UE_REMOTE_CONTROL_PORT` | `30010` | Remote Control HTTP port |

## Requirements

- Unreal Engine 5.x (tested on 5.6)
- Editor-only — not included in packaged builds
