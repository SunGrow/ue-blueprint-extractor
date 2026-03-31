# UE Blueprint Implementation Patterns — Research Document

**Purpose:** Deep technical reference for building a standalone node-based graph execution engine inspired by Unreal Engine Blueprints, targeting a visual LLM workflow orchestrator.

---

## 1. Graph Execution Model

### How the Blueprint VM Executes a Node Graph

Blueprints compile to **bytecode** that runs on a **stack-based virtual machine** — not a register-based one. The compiler is `FKismetCompilerContext`, which transforms the visual node graph into `TArray<uint8>` bytecode stored in `UFunction::Script`. The bytecode enum is `EExprToken`.

**Compilation pipeline:**
1. All Event Graph pages are consolidated into a single **UberGraph** (one `UFunction`).
2. The compiler topologically sorts the spaghetti graph into a linear instruction sequence.
3. Each `UK2Node` generates **Kismet Compiler Statements** (intermediate representation).
4. Statements are lowered into bytecode.
5. Function graphs each compile to their own `UFunction` with their own `Script` array.

The core execution cycle: fetch one byte → look up a native C++ function in `GNatives[]` or `GCasts[]` → call it → repeat.

### Execution Order and Dependency Resolution

Execution flows along **white (exec) wires**, left-to-right, starting from a red Event node. The compiler pre-sorts the graph so execution is purely sequential at runtime — no graph traversal happens at runtime, only bytecode interpretation.

**Data dependency**: Before an impure node fires, the VM evaluates all pure-node inputs by traversing data wires backward (pull model). Pure nodes re-evaluate for every connection (no caching).

**State management**: `FFrame` structs track execution state — current function pointer, code offset, local variable space, and a reference to the previous frame for nested calls.

### Execution Pins vs. Data Pins

| Feature | Execution Pins (white, wedge-shaped) | Data Pins (colored) |
|---|---|---|
| Purpose | Control sequencing of node activation | Pass typed values between nodes |
| Direction | Input exec + output exec (Then) | Input data + output data |
| Constants | `PC_Exec`, `PN_Execute`, `PN_Then` | `PC_Boolean`, `PC_Int`, etc. |
| Required | Nodes without exec pin connections don't fire | Always evaluated when pulled by exec node |
| Wire color | White | Type-coded (e.g., green=bool, blue=float) |

A node with **no exec pins** is a **pure node** — it is evaluated on-demand when its output is consumed.

### Parallel Execution Paths

Blueprint execution is fundamentally **single-threaded and sequential** within a frame. There is no true native parallelism in a single Blueprint graph. Apparent parallelism is achieved via:

- **Sequence node**: Fires all outputs in order, synchronously, before the next frame.
- **Latent nodes** (async/delayed): Suspend the current execution path and resume it in a future frame via the **Latent Action Manager**. The ubergraph frame keeps all pin values alive on the heap so they are available on resumption.
- **Fork/Join nodes** (experimental): A Fork fires all output branches — even if some contain latent actions — before the Blueprint suspends. Join waits for all branches to complete.
- **Delegate/Event dispatch**: Different event chains can be in-flight in different frames, but each chain executes sequentially.

### The UberGraph and Latent Actions

The **ubergraph frame** is a heap-allocated pseudo-struct generated when the owning object is spawned. It contains all output pin values for every node in the Event Graph. Because it lives on the heap (not the stack), latent nodes can suspend mid-execution, and when the Latent Action Manager resumes them in a later frame the pin values are still valid. This means:

- Event Graph pins have object-lifetime scope (not call-scoped).
- The more nodes in an Event Graph, the larger the ubergraph frame in memory.
- Function graphs use stack frames (`FFrame`) — pins exist only during the call.

**Transferable pattern:** Any async-capable node-graph engine needs a persistent execution context (the "ubergraph frame" concept) that survives across async await points.

---

## 2. Type System

### Pin Types — Complete List

Defined in `UEdGraphSchema_K2` (`EdGraphSchema_K2.h`):

| Pin Type | Category | SubCategory | SubCategoryObject |
|---|---|---|---|
| Execution | `PC_Exec` | — | — |
| Boolean | `PC_Boolean` | — | — |
| Byte / Enum | `PC_Byte` | `PSC_Bitmask` | — |
| Integer | `PC_Int` | `PSC_Bitmask` | — |
| Integer64 | `PC_Int64` | — | — |
| Float | `PC_Real` | `PC_Float` | — |
| Double | `PC_Real` | `PC_Double` | — |
| Name | `PC_Name` | — | — |
| String | `PC_String` | — | — |
| Text (localized) | `PC_Text` | — | — |
| Class Reference | `PC_Class` | `PSC_Self` | `UClass*` |
| Soft Class | `PC_SoftClass` | — | `UClass*` |
| Object Reference | `PC_Object` | `PSC_Self` | `UClass*` |
| Soft Object | `PC_SoftObject` | — | `UClass*` |
| Struct | `PC_Struct` | — | `UScriptStruct*` |
| Enum | `PC_Byte` (typed) | — | `UEnum*` |
| Delegate | `PC_Delegate` | — | `UFunction*` |
| Interface | `PC_Interface` | — | `UClass*` |
| Wildcard | `PC_Wildcard` | `PSC_Index` | — |

**Reserved pin name constants:** `PN_Execute` (input exec), `PN_Then` (output exec), `PN_ReturnValue` (return object).

### Type Coercion and Auto-Conversion

UE Blueprints do **not** auto-coerce between incompatible types. The schema enforces strict type matching at connection time. However:

- **Compatible casts**: Connecting an `int` output to a `float` input can trigger an implicit conversion node to be inserted automatically by the editor.
- **Explicit conversion nodes**: e.g., `ToString (Integer)`, `ToFloat (Integer)` — must be explicitly placed or auto-inserted.
- **Object hierarchy**: A derived class pin can connect to a base class pin (covariant assignment).
- **Interface compatibility**: Object pins implementing an interface can connect to interface pins.

### Wildcard Pins — Type Resolution at Connection Time

Wildcard pins (`PC_Wildcard`) accept any type and resolve dynamically. The resolution uses a three-step protocol implemented in `NotifyPinConnectionListChanged` on the owning `UK2Node`:

1. **Reset**: When all connections to a wildcard pin are removed, revert to `PC_Wildcard`.
2. **Adopt**: When connected to a non-wildcard pin, copy that pin's full type descriptor.
3. **Propagate**: After adopting, push the resolved type to all other wildcard pins on the same node, then call `UEdGraphSchema_K2::ValidateExistingConnections()` to ensure no existing connections became invalid.

This means wildcard resolution is **editor-time only** — at compile time, all types are fully resolved.

**Transferable pattern:** A graph engine can implement wildcard as a type variable that resolves greedily on first connection and resets when disconnected.

### Container Types

All container types are wrappers around a single element type (homogeneous):

| Container | Ordered | Duplicates | Access | Use Case |
|---|---|---|---|---|
| **Array** | Yes | Yes | Index | Ordered lists, iteration |
| **Set** | No | No (unique) | Key=value | Membership testing, dedup |
| **Map** | No (key→value) | Keys unique | Key lookup | Dictionary/associative access |

Container pins have a **container type** flag in addition to element `PinCategory`. The Blueprint editor renders them with a distinct visual indicator (e.g., an array brackets icon on the pin).

Looping over containers uses dedicated nodes: `ForEachLoop` (Array), `ForEachLoop` with break, `Keys`/`Values` utility nodes (Map/Set).

**Transferable pattern:** Node pin schemas should distinguish `elementType + containerType` as two orthogonal axes rather than encoding `ArrayOfString` as a distinct type.

---

## 3. Function Graphs

### Functions vs. Event Graph

| Feature | Event Graph | Function Graph |
|---|---|---|
| Entry point | Event nodes (red) | Single Entry node |
| Return values | None | Multiple output params |
| Local variables | No (only class variables) | Yes — stack-scoped |
| Latent/async nodes | Allowed | **Prohibited** |
| Recursive calls | No | Yes |
| Reusable across BPs | No | Yes (via Function Library) |
| Compiled to | Part of UberGraph UFunction | Separate UFunction |
| Memory scope | UberGraph frame (heap) | FFrame (stack) |

Functions are **synchronous and pure-stack-frame** — they must complete within a single call, which is why latent nodes (which need to persist state across frames) are prohibited.

### Input/Output Parameters

Functions have explicitly declared **input pins** and **output pins** (return values). In the graph, the Entry node exposes input values as data nodes; the Return node collects outputs. Both appear as named, typed pins on the function node when called from elsewhere.

- Input pins can have **default values** (used when pin is unconnected).
- Pins can be **pass-by-reference** (diamond-shaped pin, modifications reflected back to caller).
- A function can have **zero or more** inputs and **zero or more** outputs.

### Local Variables

Declared in the "My Blueprint" panel, scoped to the function. Created when the function is called, destroyed when it returns. Not accessible from the Event Graph or other functions.

**Key difference from class variables**: class variables live in the object and persist; local variables are stack-temporaries.

### Function Libraries (BlueprintFunctionLibrary)

`UBlueprintFunctionLibrary` subclasses contain **static functions** callable from any Blueprint. These are the canonical reuse mechanism — analogous to utility modules or standard libraries.

Requirements:
- Functions must be declared `static`.
- Functions should be marked `BlueprintPure` or `BlueprintCallable`.
- No instance state — all data flows through parameters.

**Transferable pattern:** A standalone node-graph engine should support "node libraries" — packages of pure stateless nodes registered by name, callable from any graph.

### Pure vs. Impure Functions

| | Pure Node | Impure Node |
|---|---|---|
| Exec pins | None | Input + Output |
| Evaluation trigger | Pulled by connected consumer | White wire reaches node |
| Caching | None — re-evaluates per consumer | Evaluated once when exec fires |
| Side effects | Semantically forbidden | Allowed |
| Example | `GetActorLocation`, math ops | `SetActorLocation`, `Delay` |

**Critical pitfall**: A pure node connected to 2 impure nodes executes **twice** (once per consumer). A pure node used inside a `ForEachLoop` executes once per loop iteration.

**Transferable pattern:** Separate "query nodes" (pure, demand-driven) from "action nodes" (impure, sequentially scheduled). Cache pure-node results at the execution-context level when used in loops.

---

## 4. Macro Graphs

### Macros vs. Functions

| Feature | Macro | Function |
|---|---|---|
| Compile-time behavior | **Inlined** — expanded at each call site | Called as a subroutine |
| Multiple exec outputs | Yes | No (single Then) |
| Latent/async nodes | Allowed | Prohibited |
| Timeline nodes | Allowed | Prohibited |
| Local variables | No | Yes |
| Recursion | No | Yes |
| Cross-Blueprint reuse | Via Macro Library | Direct call |
| Compiled existence | Disappears — replaced by expanded nodes | Exists as UFunction |

Macros are **compile-time text-substitution** in graph form. Every instance is independently expanded into a unique set of nodes. No shared code, no stack frame.

**When to use macro vs. function:**
- Use **macros** when you need multiple output exec pins (e.g., a custom loop body + completed pin), or when you need latent nodes inside the reusable block.
- Use **functions** for everything else — they compile smaller, are debuggable, and can be called recursively.

### Tunnel Nodes

Every macro graph has an **Inputs tunnel** (entry) and **Outputs tunnel** (exit). Tunnel nodes are the bridge between the macro's internal graph and the caller's graph. Pins on the tunnel appear as pins on the macro node in the calling graph.

A macro can have **multiple output exec pins** on its Outputs tunnel — enabling branching from a single macro node (e.g., ForEachLoop's `Loop Body` + `Completed`).

### Macro Libraries

`UBlueprintMacroLibrary` holds shareable macros. Scoping rules match function libraries.

**Transferable pattern:** "Compound nodes" with multiple output execution paths — useful for async workflow branches (e.g., `OnSuccess`, `OnFailure`, `OnTimeout`).

---

## 5. Loop and Control Flow Nodes

### Loop Nodes

| Node | Behavior | Pins |
|---|---|---|
| **ForLoop** | Iterates integer range [First, Last] | First Index, Last Index → Loop Body (exec), Index (int), Completed (exec) |
| **ForEachLoop** | Iterates array | Array → Loop Body (exec), Array Element, Array Index, Completed (exec) |
| **ForEachLoopWithBreak** | ForEachLoop with manual break | + Break (exec input) |
| **WhileLoop** | Repeats while condition is true | Condition (bool) → Loop Body (exec), Completed (exec) |

**Critical execution model detail**: All Blueprint loops execute **synchronously within a single frame** — they do not yield between iterations. A loop with 1 million iterations will stall the game thread for the entire duration. Loops cannot contain latent (async) nodes.

### Stateful Control Flow Nodes

| Node | Behavior |
|---|---|
| **FlipFlop** | Alternates exec output between A and B on each activation |
| **DoOnce** | Fires exec output only on first activation; Reset pin re-enables it |
| **Gate** | Open/Close/Toggle pins control whether Enter exec passes through to Exit |
| **MultiGate** | Routes sequential activations to successive output pins (cyclic or one-shot) |
| **Sequence** | Fires N outputs in order synchronously when input fires |
| **Branch** | Binary conditional (if/else) |
| **Switch** | Multi-case dispatch on int, string, name, or enum |

**Stateful nodes** (FlipFlop, DoOnce, Gate, MultiGate) maintain **internal state** in the ubergraph frame between activations. This is only possible because the ubergraph frame is heap-allocated and persists for the object's lifetime.

### Break Node

`Break` terminates the innermost enclosing loop (ForEachLoopWithBreak). There is no general-purpose "break from any node" — it is scope-limited.

### Interaction with Execution Model

Loops compile to bytecode **jumps** — the compiler generates backward jump instructions. The `WhileLoop` emits: evaluate condition → conditional jump to exit → execute body → unconditional jump to condition evaluation.

**Transferable pattern:**
- Sequence is the fundamental fan-out primitive: "execute A, then B, then C".
- Stateful nodes (Gate, FlipFlop) are useful for orchestration logic that needs persistent state without explicit variables.
- Loops in a workflow engine should be **async-aware** — unlike UE, a workflow loop should be able to `await` between iterations.

---

## 6. Collapsed Graphs and Subgraphs

### Collapse to Graph

Selecting nodes and choosing "Collapse Nodes" creates a **collapsed graph node** in the parent graph. The subgraph uses **Inputs** and **Outputs tunnel nodes** as its boundary. Externally wired exec and data pins become tunnel pins.

Key properties:
- The collapsed graph is **not a function** — it is not callable from elsewhere.
- It does not introduce a new scope — variables referenced inside are still class variables.
- Tunnels can carry any number of exec and data pins.
- Primarily a **visual organization** tool; the compiled output is identical to the uncollapsed version.

### Collapse to Function

Same selection mechanic, but creates a proper `UFunction` with a stack frame. Key differences from collapsed graph:
- Reusable from other call sites and other Blueprints.
- Introduces local variable scope.
- Imposes the function restrictions (no latent nodes, single exec output).

### Tunnel Nodes as an Abstraction Primitive

Tunnel nodes represent the pattern of **boundary crossing** — a named interface between an inner graph and its outer context. The Inputs tunnel holds all incoming connections; the Outputs tunnel holds all outgoing connections. This maps directly to a **subgraph node** with explicit input/output port declarations.

**Transferable pattern:** Subgraph nodes (collapsed graphs) are the fundamental composition primitive: any connected set of nodes can be wrapped into a single node with a declared port interface, enabling hierarchical graph decomposition.

---

## 7. Validation and Safety

### Blueprint Compilation Validation

The Blueprint compiler (`FKismetCompilerContext`) performs:

1. **Type checking at connection time**: `UEdGraphSchema_K2::TryCreateConnection()` validates pin compatibility before a wire is drawn. Incompatible types cannot be connected (the editor prevents it).
2. **Type checking at compile time**: All wildcard pins must be resolved; all required connections must be present.
3. **Function restriction enforcement**: Latent nodes inside functions are compile errors.
4. **Circular dependency detection**: Blueprints casting to each other creates dependency cycles, which can break builds.
5. **Pure node validation**: Pure functions must have no exec pins; violating this is a compile error.

### Compiler Results Panel

Provides error/warning messages with:
- Severity (error vs. warning).
- Human-readable description.
- **Hyperlink to the node** that caused the issue (graph view navigates to the offending node).

Common errors:
- Unconnected required pins.
- Type mismatch (after manual edits to node implementations).
- Missing function implementations for interface methods.
- Circular casts.

### Connection-Time vs. Compile-Time Checks

| Check type | When | Example |
|---|---|---|
| Pin type compatibility | On wire draw | Can't connect Bool output to Int input |
| Wildcard resolution | On compile | Wildcard must resolve to a concrete type |
| Exec connectivity | On compile | Warning if an action node has no input exec |
| Latent-in-function | On compile | Error |
| Missing override | On compile | Error if interface method not implemented |

**Transferable pattern:** A graph engine should validate connections eagerly (at wire-draw time) for type compatibility, and validate graph completeness lazily (at "build"/"run" time). Errors should navigate to the offending node.

---

## 8. Serialization

### UASSET Binary Format

Blueprint assets are saved as **binary UASSET files** — Unreal's proprietary package format. The format is not publicly documented. It consists of:
- A package header with dependency tables, export/import lists.
- Serialized `UObject` graph: each node is a `UEdGraphNode` with its pin array.
- Pin connections stored as arrays of `UEdGraphPin*` `LinkedTo` references.
- Node position data (for editor layout).
- Compiled bytecode (in `UFunction::Script`).

The format supports **both source data** (node graph) and **compiled output** (bytecode) in the same file.

### Text Format

There is no official human-readable serialization. Community tooling exists:
- **Blueprint Serializer plugin** (JSON export): Exports `blueprintPath`, `name`, `parentClass`, `variables`, `functions`, `components`, and `graphs`. Each graph contains nodes with their pin connections and execution flow.
- Engine has an internal **ExportToText** path used for copy-paste (clipboard format), which produces a tagged text representation of selected nodes.

### Node Graph Data Model (from UEdGraphNode/UEdGraphPin)

```
UEdGraphNode
  ├── NodePosX, NodePosY          // Editor layout
  ├── Pins: TArray<UEdGraphPin*>  // All pins on this node
  └── (subclass-specific data)

UEdGraphPin
  ├── PinName: FName
  ├── PinCategory: FName          // PC_Exec, PC_Boolean, etc.
  ├── PinSubCategory: FName
  ├── PinSubCategoryObject: UObject*   // UClass*, UScriptStruct*, UEnum*
  ├── Direction: EEdGraphPinDirection  // Input or Output
  ├── LinkedTo: TArray<UEdGraphPin*>   // Connected pins (across nodes)
  ├── DefaultValue: FString            // Literal default
  ├── SubPins: TArray<UEdGraphPin*>    // Struct split sub-pins
  └── ParentPin: UEdGraphPin*          // If this is a sub-pin
```

**Transferable pattern:** A graph node schema should store: node type, position, port list (each with name + type + direction + connected ports + default value). This maps directly to a JSON graph format.

---

## 9. Transferable Patterns Summary

### Core Execution Engine Patterns

| UE Pattern | Standalone Engine Equivalent |
|---|---|
| Exec pins + white wires | **Sequencing edges** — explicit ordering between action nodes |
| Data pins + colored wires | **Data edges** — typed value flow between nodes |
| Pure nodes (no exec) | **Expression nodes** — evaluated lazily, pulled by consumers |
| Impure nodes (with exec) | **Action nodes** — scheduled by the executor in sequence |
| UberGraph frame (heap) | **Execution context object** — persists async state across await points |
| FFrame (stack) | **Call frame** — for synchronous subgraph calls |
| Latent actions (Delay, async) | **Await nodes** — suspend and resume via callback/future |
| Fork/Join | **Parallel fan-out + barrier** — fire N paths, continue when all complete |

### Type System Patterns

| UE Pattern | Standalone Engine Equivalent |
|---|---|
| PC_Exec separation | Keep sequencing edges and data edges as distinct types |
| Wildcard + `NotifyPinConnectionListChanged` | Type variables on generic nodes — resolve greedily on first connection |
| Container type = element type × container kind | Orthogonal `{ elementType, containerKind }` pin schema |
| Pure node re-evaluation per consumer | Memoize pure-node outputs within a single execution frame |

### Composition Patterns

| UE Pattern | Standalone Engine Equivalent |
|---|---|
| Collapsed graph (tunnel nodes) | **Subgraph node** — hierarchical graph decomposition with port interface |
| Function graph | **Callable subgraph** — reusable, scoped, synchronous |
| Macro (inlined, multi-exec-out) | **Template node** — expanded at build time, supports multiple output paths |
| BlueprintFunctionLibrary | **Node library / plugin** — stateless registered node types |

### Control Flow Patterns

| UE Pattern | Standalone Engine Equivalent |
|---|---|
| Sequence node | **Sequential fan-out** — fundamental ordered composition |
| Branch / Switch | **Routing node** — conditional path selection |
| FlipFlop / Gate / DoOnce | **Stateful routing** — persistent node state between activations |
| ForEachLoop + Completed | **Iteration + continuation** — loop body pin + completion pin pattern |
| ForEachLoopWithBreak | **Interruptible iteration** — break signal terminates loop |

### Validation Patterns

| UE Pattern | Standalone Engine Equivalent |
|---|---|
| Connection-time type check | Validate edge on draw; block incompatible connections immediately |
| Compiler results with hyperlinks | Error panel with "jump to node" capability |
| Wildcard must resolve before run | Build-time validation pass: all type variables must be bound |
| Latent-in-function = error | Define node capability flags (e.g., `supportsAsync`) and enforce at build time |

### Serialization Patterns

| UE Pattern | Standalone Engine Equivalent |
|---|---|
| UEdGraphNode + UEdGraphPin data model | JSON: `{ id, type, position, ports: [{ name, type, direction, connections, default }] }` |
| UberGraph = collection of event chains | Top-level graph = collection of trigger → chain |
| Function graph = separate UFunction | Named graph definition with declared inputs/outputs |
| Bytecode = compiled output | Optional compiled representation (e.g., topologically sorted node list + resolved types) |

---

## Sources

- [Discovering Blueprint VM (Part 2) — Intax's Blog](https://intaxwashere.github.io/blueprint-part-two/)
- [Performance guideline for Blueprints and making sense of Blueprint VM — Intax's Blog](https://intaxwashere.github.io/blueprint-performance/)
- [Anatomy of the Unreal 4 Blueprint Virtual Machine — Gamedev Guide](https://ikrima.dev/ue4guide/engine-programming/blueprints/bp-virtualmachine-overview/)
- [Reference Guide to Custom Blueprint Nodes — Matt's Game Dev Notebook](https://unrealist.org/custom-blueprint-nodes/)
- [Blueprint Pure Functions: Yes? No? It's Complicated — raharuu.github.io](https://raharuu.github.io/unreal/blueprint-pure-functions-complicated/)
- [Pure & impure BP functions — Unreal Engine Technical Blog (Medium)](https://medium.com/unreal-engine-technical-blog/pure-impure-functions-516367cff14f)
- [Inside of Unreal Engine Blueprint — heapcleaner.wordpress.com](https://heapcleaner.wordpress.com/2016/06/12/inside-of-unreal-engine-blueprint/)
- [Blueprint Fundamentals — michaeljcole.github.io](https://michaeljcole.github.io/wiki.unrealengine.com/Blueprint_Fundamentals/)
- [Introduction to K2Node — OlssonDev's Blog](https://olssondev.github.io/2023-02-13-K2Nodes/)
- [UE Blueprints in depth part 1: Graphs, Functions, Macros — LinkedIn](https://www.linkedin.com/pulse/ue-blueprints-depth-part-1-graphs-functions-macros-macro-laaksonen)
- [Blueprint Functions: What you need to know — Unreal Directive](https://www.unrealdirective.com/articles/blueprint-functions-what-you-need-to-know/)
- [Flow Control — Unreal Engine 4.27 Documentation](https://docs.unrealengine.com/4.26/en-US/ProgrammingAndScripting/Blueprints/UserGuide/FlowControl)
- [Collapsing Graphs — Unreal Engine 4.27 Documentation](https://docs.unrealengine.com/4.26/en-US/ProgrammingAndScripting/Blueprints/BP_HowTo/CollapsingGraphs)
- [Blueprint Macro Library — Unreal Engine 4.27 Documentation](https://docs.unrealengine.com/4.26/en-US/ProgrammingAndScripting/Blueprints/UserGuide/Types/MacroLibrary)
- [Blueprint Function Libraries — Unreal Engine Documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/blueprint-function-libraries-in-unreal-engine)
- [Creating Latent and Async Blueprint Nodes — zomgmoz.tv](https://zomgmoz.tv/unreal/Creating-latent-and-async-Blueprint-nodes)
- [Description of UE4 Blueprint Internal Structure — GitHub Gist](https://gist.github.com/rbetik12/21201e3c40201e8f8aed16c4bcf0e75e)
- [Blueprint Serializer Plugin — GitHub](https://github.com/Jinphinity/BlueprintSerializer)
- [Compiler Results — Unreal Engine 5.7 Documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/compiler-results-in-the-blueprints-visual-scripting-editor-for-unreal-engine)
- [What is Uber Graph or Uber Graph Frame? — Epic Developer Community Forums](https://forums.unrealengine.com/t/what-is-uber-graph-or-uber-graph-frame/647463)
- [Generic or wildcard parameters — Gamedev Guide](https://ikrima.dev/ue4guide/editor-extensions/custom-blueprints/generic-or-wildcard-parameters/)
- [Blueprint Variables — Unreal Engine 4.27 Documentation](https://docs.unrealengine.com/4.26/en-US/ProgrammingAndScripting/Blueprints/UserGuide/Variables)
