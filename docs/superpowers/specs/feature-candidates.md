# Pipeline Studio — Feature Candidate List

**Generated:** 2026-03-27
**Author:** Synthesis Agent (pipeline-studio team)
**Sources:** research-existing-tools.md, research-ue-blueprints.md, research-execution-models.md, research-llm-orchestration.md

---

## Summary

**72 feature candidates across 9 subsystems**

| Subsystem | Count |
|---|---|
| protocol | 10 |
| engine | 14 |
| node-types | 9 |
| data-flow | 8 |
| ui | 10 |
| safety | 6 |
| llm-adapters | 6 |
| project-system | 5 |
| mcp-server | 4 |
| **Total** | **72** |

---

## Protocol

### P-01: JSON-RPC 2.0 Base Protocol with Capability Negotiation
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§3 Protocol Design Patterns — LSP, MCP, JSON-RPC)
- **Description**: Base all engine↔UI and engine↔node communication on JSON-RPC 2.0. On connect, client sends `initialize` with a `ClientCapabilities` object; server responds with `ServerCapabilities`. Unknown capabilities are silently ignored for forward compatibility.
- **Architectural Impact**: HIGH (fundamental to architecture — every subsystem speaks through this layer)
- **Precedent**: LSP 3.17 (identical pattern), MCP 2025-11-25 (identical pattern)

---

### P-02: Dual Transport — stdio for Local, Streamable HTTP for Remote
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§3.2 MCP, §8.1 Foundation), research-llm-orchestration.md (§3.1 Transport Options)
- **Description**: Protocol operates over an abstract transport layer with two concrete implementations: stdio (JSON-RPC newline-delimited, for embedded/local use) and Streamable HTTP (HTTP POST for requests, SSE stream for server-push events, for remote/web use). The engine selects transport at startup.
- **Architectural Impact**: MEDIUM (transport is isolated to a protocol adapter layer)
- **Precedent**: LSP (stdio + TCP), MCP (stdio + Streamable HTTP), Claude Code CLI (`--output-format stream-json` over stdio)

---

### P-03: Typed Execution Event Stream
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§8.3 Execution Events), research-existing-tools.md (§ComfyUI async support), research-llm-orchestration.md (§5.2 Unified Node Interface Design)
- **Description**: Graph execution emits a multiplexed stream of typed events rather than a single response: `node/started`, `node/progress`, `node/output/partial` (streaming tokens), `node/output/final`, `node/error`, `node/skipped`, `node/completed`, `execution/completed`, `execution/error`. The UI reconstructs state from this event stream.
- **Architectural Impact**: HIGH (defines the runtime communication contract between engine and UI)
- **Precedent**: ComfyUI WebSocket execution events, n8n execution history, LangGraph streaming, Codex CLI `--json` JSONL events

---

### P-04: Explicit Protocol Lifecycle — Init / Ready / Shutdown / Exit
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§3.1 LSP, §8.2 Lifecycle)
- **Description**: Formal four-phase lifecycle: `initialize` request (engine initializes, returns capabilities) → `initialized` notification (client signals ready) → normal operation → `shutdown` request (engine prepares graceful stop) → `exit` notification (process exits). Prevents orphaned child processes.
- **Architectural Impact**: MEDIUM (protocol framing concern, affects process management)
- **Precedent**: LSP lifecycle (identical), MCP lifecycle (identical)

---

### P-05: First-Class Cancellation by Request ID
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§3.5 What Makes a Good Protocol), research-existing-tools.md (§ComfyUI /interrupt endpoint)
- **Description**: Any in-flight execution request or node operation can be cancelled by sending a `cancel` notification referencing the original request ID. The engine propagates cancellation to all running child processes and actor tasks for that execution via `CancellationToken`.
- **Architectural Impact**: MEDIUM (touches engine task lifecycle, protocol layer, and CLI adapters)
- **Precedent**: ComfyUI `/interrupt` REST endpoint, LSP `$/cancelRequest`, MCP cancellation notifications

---

### P-06: Structured Error Objects with Typed Codes
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§3.4 JSON-RPC, §8.5 Error Handling)
- **Description**: All errors are structured objects `{ code: int, message: string, nodeId?: string, portId?: string, data?: any }` flowing through the event stream — never bare exceptions. Reserve code ranges: -32xxx for protocol errors, -33xxx for graph validation errors, -34xxx for node execution errors.
- **Architectural Impact**: LOW (error schema definition, isolated to protocol layer)
- **Precedent**: JSON-RPC 2.0 error object spec, LSP diagnostic objects

---

### P-07: Graph Load / Validate Phase Separate from Execute Phase
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§8.2 Lifecycle, §8.6 Safety), research-existing-tools.md (§ComfyUI validation.py)
- **Description**: `graph/load` is a distinct protocol request that parses, validates types, checks cycles, and resolves wildcard pins before any execution begins. Returns a validation report with hyperlinked error locations. `execution/start` only succeeds after a successful `graph/load`. This decouples authoring feedback from execution.
- **Architectural Impact**: MEDIUM (adds a validation subsystem as a first-class phase)
- **Precedent**: ComfyUI `validate_inputs()` before execution, Blueprint compiler two-phase (connection-time + compile-time checks)

---

### P-08: Progress Notifications for Long-Running Operations
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§3.5 What Makes a Good Protocol, §8.3 Execution Events)
- **Description**: Long-running node executions emit `node/progress` notifications with a `percent` field and optional `message`. The UI can render per-node progress bars. Progress is optional — nodes that cannot report progress simply omit it.
- **Architectural Impact**: LOW (additive to event stream)
- **Precedent**: LSP `$/progress` notification, MCP progress tracking, n8n execution logs

---

### P-09: Batched Graph Update Operations (JSON-RPC Batching)
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§3.4 JSON-RPC Batching)
- **Description**: The protocol supports batched requests (JSON-RPC array of request objects → array of response objects) for bulk graph manipulation. Enables the MCP server to atomically add multiple nodes and connections in a single round trip.
- **Architectural Impact**: LOW (JSON-RPC spec feature, protocol layer concern)
- **Precedent**: JSON-RPC 2.0 batch specification, used in LSP for bulk document edits

---

### P-10: OpenRPC Machine-Readable API Schema
- **Subsystem**: protocol
- **Source**: research-execution-models.md (§3.4 Discoverability)
- **Description**: The engine publishes its full JSON-RPC API as an OpenRPC document, queryable via `rpc.discover`. This enables auto-generated client stubs, documentation, and LLM-assisted graph manipulation (the LLM can read the schema to know what operations are available).
- **Architectural Impact**: LOW (documentation artifact, generated from type definitions)
- **Precedent**: OpenRPC specification, used by some Ethereum JSON-RPC APIs

---

## Engine

### E-01: Reactive Actor Model — One Tokio Task per Node
- **Subsystem**: engine
- **Source**: research-execution-models.md (§1.3 Tokio, §7 Engine Language Recommendation), research-llm-orchestration.md (§7.1 Process Model)
- **Description**: Each node in the graph runs as a `tokio::spawn`-ed task (an actor). Nodes communicate exclusively via bounded `mpsc` channels — no shared mutable state. The engine's main loop `select!`s across all node output channels to route data to downstream nodes. This is the Alice Ryhl `Actor` + `ActorHandle` pattern.
- **Architectural Impact**: HIGH (defines the entire concurrency model)
- **Precedent**: Tokio actor pattern (Alice Ryhl), Erlang/OTP process-per-actor, Akka actors, Claude Agent SDK agent-per-teammate model

---

### E-02: Topological Sort + Dependency-Ready Scheduling
- **Subsystem**: engine
- **Source**: research-existing-tools.md (§ComfyUI topological sort), research-execution-models.md (§4.1 Airflow task dependencies, §4.2 Prefect)
- **Description**: On `execution/start`, the engine topologically sorts the DAG using `petgraph`. Nodes become "ready" when all required input ports have received values. The scheduler spawns actors for ready nodes immediately (no fixed level-by-level step). This enables maximum parallelism within dependency constraints.
- **Architectural Impact**: HIGH (core execution scheduling)
- **Precedent**: ComfyUI post-2024 topological sort model, Rivet `GraphProcessor` (queue-based, nodes fire when inputs satisfied), Airflow `set_downstream` dependency model

---

### E-03: Incremental Re-execution with Input-Signature Caching
- **Subsystem**: engine
- **Source**: research-existing-tools.md (§ComfyUI Dual cache, Cross-Cutting Lesson #2), research-execution-models.md (§4.2 Prefect result persistence)
- **Description**: Each node output is cached keyed by `(node_id, hash(all_inputs))`. On re-run, if a node's input hash matches the cached entry, the node is skipped and the cached output is used. Cache is in-memory by default (LRU eviction) with optional persistent-storage backend. This is the #1 UX accelerator for iterative workflows.
- **Architectural Impact**: MEDIUM (adds cache layer to node execution, touches data-flow and engine)
- **Precedent**: ComfyUI `HierarchicalCache` (CLASSIC/LRU/RAM_PRESSURE strategies), Prefect `persist_result=True`, Dagster memoization

---

### E-04: Persistent Execution Context (Ubergraph Frame Equivalent)
- **Subsystem**: engine
- **Source**: research-ue-blueprints.md (§1 UberGraph and Latent Actions), research-execution-models.md (§1.3 Tokio structured concurrency)
- **Description**: Each graph run creates an `ExecutionContext` heap-allocated object that persists across all async await points. This context holds: all node output values (so async/latent nodes can resume), execution ID, cancellation token, and run metadata. When a node suspends (e.g., waiting for LLM response), its output slots remain valid in the context.
- **Architectural Impact**: HIGH (fundamental to async node execution correctness)
- **Precedent**: UE Blueprint ubergraph frame (heap-allocated pseudo-struct per event graph), Temporal workflow history replay

---

### E-05: Cycle Detection and Explicit Loop Mode
- **Subsystem**: engine
- **Source**: research-execution-models.md (§4.5 LangGraph explicit cycle support), research-existing-tools.md (§Rivet Tarjan's SCC)
- **Description**: By default the engine rejects cycles (DAG mode). Nodes annotated with `"loop": true` create explicit loop boundaries — cycles through these nodes are permitted and the engine tracks iteration state. Uses Tarjan's SCC algorithm (via `petgraph`) to detect unintended cycles vs. declared loop boundaries.
- **Architectural Impact**: HIGH (fundamental to supporting loop nodes)
- **Precedent**: Rivet `GraphProcessor` (Tarjan's SCC + loop controller nodes), LangGraph explicit cycle support, ComfyUI node expansion for tail-recursion loops

---

### E-06: Structured Concurrency with JoinSet for Parallel Branches
- **Subsystem**: engine
- **Source**: research-execution-models.md (§1.3 Tokio JoinSet, structured concurrency)
- **Description**: When the graph has parallel branches (multiple independent nodes ready simultaneously), the engine spawns them into a `JoinSet`. Cancellation of the parent execution propagates via `CancellationToken` to all child tasks. This provides a "blast radius" boundary: one branch error can optionally cancel siblings.
- **Architectural Impact**: MEDIUM (engine concurrency management, touches error handling)
- **Precedent**: Tokio `JoinSet`, Rivet `AbortController` for race inputs, Blueprint Fork/Join experimental nodes

---

### E-07: Pure Node (Expression) vs. Action Node Distinction
- **Subsystem**: engine
- **Source**: research-ue-blueprints.md (§3 Pure vs. Impure Functions), research-execution-models.md (§6.2 UE Blueprints type system)
- **Description**: Nodes declare a `pure` flag. Pure nodes (no side effects) are evaluated on-demand when their output is consumed; their results are memoized within a single execution frame. Action nodes (impure) execute in scheduled order via sequencing edges. Pure node outputs consumed in a loop are cached per iteration, not re-evaluated per consumer.
- **Architectural Impact**: MEDIUM (affects scheduling and caching logic)
- **Precedent**: UE Blueprint pure/impure node distinction, Dagster pure assets, functional dataflow languages

---

### E-08: Race Inputs — Competing Branch Abort
- **Subsystem**: engine
- **Source**: research-existing-tools.md (§Rivet race inputs), research-execution-models.md (§1.3 Tokio select!)
- **Description**: A special "race" mode for nodes with multiple input branches: the first branch to deliver a value wins; all other in-flight branches are cancelled via `AbortController`/`CancellationToken`. This enables timeout patterns (race an LLM against a timer) and fallback patterns (race primary model against fallback model).
- **Architectural Impact**: MEDIUM (new scheduling mode, touches actor lifecycle)
- **Precedent**: Rivet race inputs, `tokio::select!` semantics, JavaScript `Promise.race`

---

### E-09: Durable Execution Checkpointing (Future Phase)
- **Subsystem**: engine
- **Source**: research-execution-models.md (§4.3 Temporal durability, §4.5 LangGraph state checkpointing), research-existing-tools.md (§Prefect/Temporal lesson)
- **Description**: Node output cache entries can be persisted to disk/database so that a crashed or interrupted execution can resume from the last checkpoint rather than restarting from scratch. Each node's completion writes a checkpoint; on resume, the engine replays from the highest complete checkpoint. Designed for long-running (multi-hour) pipelines.
- **Architectural Impact**: HIGH (requires persistent storage backend and replay logic)
- **Precedent**: Temporal event log replay, LangGraph state checkpointing, Prefect `persist_result=True`

---

### E-10: Node State Machine — Pending / Running / Completed / Failed / Skipped
- **Subsystem**: engine
- **Source**: research-execution-models.md (§4.2 Prefect state machine), research-existing-tools.md (§ComfyUI FAILURE state)
- **Description**: Each node has a lifecycle state machine: `Pending` → `Running` → `Completed | Failed | Skipped`. State transitions are protocol events. The `Skipped` state (Rivet's `control-flow-excluded`) propagates when a routing node chose a different branch — downstream nodes receive a typed "skipped" sentinel and can act accordingly.
- **Architectural Impact**: MEDIUM (state machine per node, feeds directly into UI rendering)
- **Precedent**: Prefect task states, Rivet `control-flow-excluded`, ComfyUI node execution states

---

### E-11: Dynamic Fan-Out — Runtime-Determined Parallel Branches
- **Subsystem**: engine
- **Source**: research-execution-models.md (§4.1 Airflow dynamic task mapping, §4.2 Prefect map()), research-existing-tools.md (§Prefect/Temporal dynamic DAGs lesson)
- **Description**: A node can emit a list of items as output; the engine automatically spawns one execution branch per item (map pattern). The fan-out count is determined at runtime, not at graph-load time. A corresponding Join node waits for all branches to complete and merges their outputs.
- **Architectural Impact**: HIGH (requires engine to spawn variable numbers of node instances at runtime)
- **Precedent**: Prefect `.map()`, Airflow `@task.dynamic_task_mapping`, LangGraph parallel super-steps

---

### E-12: Per-Node Supervision and Restart Policies
- **Subsystem**: engine
- **Source**: research-execution-models.md (§1.1 Erlang/OTP supervision trees, §1.2 Akka supervision)
- **Description**: Each node actor has a configurable restart policy (`none`, `on_error`, `always`) with max-restart frequency limits. The engine acts as a supervisor: on node failure, it applies the policy (skip, retry N times with backoff, escalate to graph error). Maps directly to Erlang's four supervision strategies.
- **Architectural Impact**: MEDIUM (adds supervisor layer above actor execution)
- **Precedent**: Erlang/OTP supervision trees, Akka parental supervision, n8n per-node retry configuration

---

### E-13: Backpressure via Bounded Channels
- **Subsystem**: engine
- **Source**: research-execution-models.md (§1.3 Tokio channels, §2.1 Reactive Streams backpressure), research-llm-orchestration.md (§5.2 Unified Node Interface)
- **Description**: All inter-node channels are bounded `mpsc` channels. A fast upstream node that produces faster than downstream can consume will async-block on `send()`, naturally applying backpressure without dropping data. Channel capacity is configurable per connection type. This prevents memory exhaustion from runaway upstream nodes.
- **Architectural Impact**: MEDIUM (channel sizing decisions affect throughput; deadlock prevention requires DAG cycle rules)
- **Precedent**: Reactive Streams specification backpressure contract, Akka Streams `request(n)`, Tokio bounded `mpsc`

---

### E-14: Async-Aware Loops (Yield Between Iterations)
- **Subsystem**: engine
- **Source**: research-ue-blueprints.md (§5 Loop Nodes transferable pattern), research-execution-models.md (§4.5 LangGraph)
- **Description**: Unlike UE Blueprints (synchronous within one frame), the engine's loop nodes yield between iterations via `.await` points. This allows other tasks (UI updates, cancellation checks, concurrent branches) to make progress during iteration. Loop nodes can contain async nodes (LLM calls, file watchers) as loop bodies.
- **Architectural Impact**: MEDIUM (requires loop node implementation to be async state machine, not a blocking loop)
- **Precedent**: LangGraph loop-back edges, Rivet Loop Controller node, Temporal workflow sleep-and-resume

---

## Node Types

### N-01: LLM Node with Unified CLI/API Backend
- **Subsystem**: node-types
- **Source**: research-llm-orchestration.md (§1 CLI Tool Architectures, §5.2 Unified Node Interface Design, §7.2 Process Spawn Strategy)
- **Description**: A single `LlmNode` type with a configurable backend: Claude Code CLI (headless JSONL), Gemini CLI (headless JSONL), Codex exec (headless JSONL), or API adapter (OpenRouter SSE). Internally maps all backends to the same `NodeEvent` enum. The backend choice is a node config field, transparent to the graph topology.
- **Architectural Impact**: MEDIUM (touches llm-adapters subsystem, protocol, and engine)
- **Precedent**: Claude Code `--bare -p --output-format stream-json`, Gemini `-p --output-format stream-json`, Codex `--json`, OpenRouter `/chat/completions` SSE

---

### N-02: Ralph Loop Node — Feedback Loop with Completion Predicate
- **Subsystem**: node-types
- **Source**: research-llm-orchestration.md (§6 The Ralph Loop Pattern)
- **Description**: A compound node encapsulating the Ralph Loop pattern: spawns an LLM process with a task prompt, evaluates a `completion_promise` predicate after each iteration, re-queues if false, exits when true. Uses a filesystem `state_backend` path as persistent state across iterations (Git history, written files). `max_iterations` is a safety cap.
- **Architectural Impact**: MEDIUM (requires iteration state machine, filesystem I/O, predicate evaluation)
- **Precedent**: Ralph Loop plugin for Claude Code (persistence via filesystem + git), Rivet `Loop Until` node

---

### N-03: Router / Director Node with Conditional Edge Routing
- **Subsystem**: node-types
- **Source**: research-execution-models.md (§4.5 LangGraph conditional edges), research-existing-tools.md (§n8n IF/Switch nodes), research-ue-blueprints.md (§5 Branch/Switch nodes)
- **Description**: A node that inspects its input data and selects one or more downstream edges to activate. Routing logic is either a declarative condition (field comparison, regex, type check) or an embedded LLM call ("ask the model which path"). Unactivated edges propagate the `Skipped` sentinel to downstream nodes.
- **Architectural Impact**: MEDIUM (routing decisions affect which nodes run — ties into E-10 state machine)
- **Precedent**: LangGraph conditional edges `(state) → next_node_id`, n8n IF + Switch nodes, Blueprint Branch/Switch nodes, Rivet `control-flow-excluded`

---

### N-04: Stateful Gate Nodes (FlipFlop, DoOnce, Gate, MultiGate)
- **Subsystem**: node-types
- **Source**: research-ue-blueprints.md (§5 Stateful Control Flow Nodes)
- **Description**: A family of stateful routing nodes that maintain persistent internal state between activations within an execution context: `FlipFlop` (alternates between two outputs), `DoOnce` (fires output only on first activation), `Gate` (open/close toggle), `MultiGate` (round-robin across N outputs). State lives in the `ExecutionContext`.
- **Architectural Impact**: LOW (isolated node implementations, requires ExecutionContext to carry node state)
- **Precedent**: UE Blueprint FlipFlop, DoOnce, Gate, MultiGate nodes

---

### N-05: Sequence (Sequential Fan-Out) Node
- **Subsystem**: node-types
- **Source**: research-ue-blueprints.md (§5 Sequence Node), research-existing-tools.md (§ComfyUI execution order)
- **Description**: A node with a single input execution edge and N ordered output execution edges. Fires output 0, waits for its subgraph to complete, fires output 1, waits, and so on. This is the fundamental ordered composition primitive — ensures A completes before B starts, even across async nodes.
- **Architectural Impact**: LOW (standard node type; requires engine to support sequential execution of fan-out branches)
- **Precedent**: UE Blueprint Sequence node, n8n sequential branch execution, Node-RED sequential wires

---

### N-06: Human-in-the-Loop Node
- **Subsystem**: node-types
- **Source**: research-llm-orchestration.md (§2.3 AutoGen human-in-the-loop), research-execution-models.md (§4.3 Temporal signals)
- **Description**: Pauses graph execution and sends a prompt/form to the UI for human input. The node actor suspends (but does not block other branches) and resumes when the human submits a response via the protocol `human/respond` message. Configurable timeout (continue with default, escalate error, or cancel execution).
- **Architectural Impact**: MEDIUM (requires UI-to-engine signaling path for async human responses)
- **Precedent**: AutoGen human-in-the-loop, Temporal workflow signals, n8n Wait node

---

### N-07: File Watcher Trigger Node
- **Subsystem**: node-types
- **Source**: research-existing-tools.md (§Node-RED event-driven model, MQTT/hardware events), research-llm-orchestration.md (§4.2 Process Lifecycle Management)
- **Description**: A trigger node that watches a filesystem path (file or directory) for changes using OS file-watching APIs (`notify` Rust crate). On change event, fires the output execution edge with a payload describing the changed file(s). Can be configured for debouncing (delay before firing to batch rapid changes).
- **Architectural Impact**: LOW (self-contained node, uses OS APIs)
- **Precedent**: Node-RED file watch nodes, Prefect event-triggered flows, n8n filesystem trigger

---

### N-08: Macro / Template Node (Multi-Output Expansion)
- **Subsystem**: node-types
- **Source**: research-ue-blueprints.md (§4 Macro Graph — multiple exec outputs, tunnel nodes)
- **Description**: A "macro" node type that is expanded at graph-build time (not runtime) into a set of inline nodes. Unlike a function subgraph (which is called as a subroutine), a macro is inlined at each call site. Enables patterns like `AsyncCall` with `OnSuccess` + `OnFailure` + `OnTimeout` output execution pins — which a function cannot have (single output exec pin restriction).
- **Architectural Impact**: MEDIUM (requires build-time graph expansion pass before execution)
- **Precedent**: UE Blueprint macros (inlined at compile time, multi-exec-out), ComfyUI node expansion

---

### N-09: Loop Nodes — For, ForEach, While, Break
- **Subsystem**: node-types
- **Source**: research-ue-blueprints.md (§5 Loop Nodes), research-existing-tools.md (§Rivet Loop Controller), research-execution-models.md (§4.5 LangGraph)
- **Description**: Four loop node types: `ForLoop` (integer range iteration, emits index), `ForEachLoop` (iterates list input, emits element + index), `WhileLoop` (boolean condition, re-evaluates each iteration), `BreakLoop` (signal node that terminates enclosing loop). All are async-aware (yield between iterations). Each emits a `Loop Body` exec pin (per iteration) and a `Completed` exec pin (after all iterations).
- **Architectural Impact**: HIGH (requires cycle-allowed graph mode, iteration state tracking, async loop body execution)
- **Precedent**: UE Blueprint ForLoop/ForEachLoop/WhileLoop, Rivet Loop Controller + Loop Until nodes, LangGraph cycle-back edges

---

## Data Flow

### D-01: Dual Wire Types — Data Wires and Execution Edges
- **Subsystem**: data-flow
- **Source**: research-ue-blueprints.md (§1 Execution Pins vs. Data Pins), research-execution-models.md (§6.2 UE Blueprints type system)
- **Description**: Two distinct connection categories: **data wires** (carry typed values between ports) and **execution edges** (carry sequencing signals between action nodes). They are visually distinct (different colors/shapes) and semantically orthogonal. Pure nodes have no execution edges; action nodes have both. This is the fundamental split that makes control flow explicit.
- **Architectural Impact**: HIGH (foundational to the graph model — all nodes, ports, and connections are defined in terms of these two categories)
- **Precedent**: UE Blueprint exec pins (white wedge) vs. data pins (colored), Rete.js dataflow + controlflow engines, Max/MSP gray vs. yellow patch cords

---

### D-02: Typed Ports with Color-Coded Visual Distinction
- **Subsystem**: data-flow
- **Source**: research-execution-models.md (§6.1 Visual Programming Type Systems — LabVIEW, Max/MSP), research-existing-tools.md (§ComfyUI io_type, §Rivet typed values)
- **Description**: Every port has a declared type. The UI renders connections with type-specific colors (e.g., green=bool, blue=number, purple=text, orange=json, red=error, gray=exec, yellow=stream). Type-incompatible connections are blocked at wire-draw time with a visual indicator. Color-coding makes the type system visible without hovering.
- **Architectural Impact**: MEDIUM (UI rendering + type system validation)
- **Precedent**: LabVIEW color-coded wires, Max/MSP patch cord colors, UE Blueprint pin colors, ComfyUI socket type colors

---

### D-03: Core Type Vocabulary
- **Subsystem**: data-flow
- **Source**: research-execution-models.md (§6.3 Algebraic Type Systems, §8.4 Type System), research-ue-blueprints.md (§2 Pin Types)
- **Description**: Primitive types: `text`, `number`, `boolean`, `json` (arbitrary JSON object), `binary` (bytes), `image`, `audio`. Composite types: `struct` (named fields), `list<T>`, `optional<T>`. Special types: `stream<T>` (partial/streaming output from LLM), `error` (structured error), `exec` (execution signal), `any` (wildcard). Type checking at graph-load; runtime coercion for compatible types (`number` → `text`).
- **Architectural Impact**: HIGH (defines the entire type system — all nodes, ports, and connections declared in terms of these)
- **Precedent**: UE Blueprint PC_String/PC_Boolean/PC_Int/PC_Struct/PC_Exec, Rivet typed values (`string`, `number`, `chat-message[]`, `control-flow-excluded`), ComfyUI `IMAGE`/`LATENT`/`MODEL` types

---

### D-04: Wildcard (Any) Ports with Greedy Type Resolution
- **Subsystem**: data-flow
- **Source**: research-ue-blueprints.md (§2 Wildcard Pins), research-execution-models.md (§6.3 Type inference)
- **Description**: Ports declared as `any` resolve their type on first connection (greedy adoption of the connected port's type). When all connections to a wildcard port are removed, it reverts to `any`. Resolution propagates to other wildcard ports on the same node. Wildcards must be fully resolved before execution (build-time validation error if unresolved).
- **Architectural Impact**: MEDIUM (adds type inference to the graph model)
- **Precedent**: UE Blueprint wildcard `PC_Wildcard` with `NotifyPinConnectionListChanged`, 3ds Max MCG on-the-fly type inference, Rivet type system

---

### D-05: Container Types as Orthogonal Dimension
- **Subsystem**: data-flow
- **Source**: research-ue-blueprints.md (§2 Container Types), research-execution-models.md (§6.3)
- **Description**: Container kinds (`single`, `list`, `set`, `map`) are declared separately from element types. A port schema is `{ elementType: "text", containerKind: "list" }` not a monolithic `list_of_text` type. The UI renders container ports with a visual indicator (e.g., bracket icon). This allows generic utility nodes (map, filter, reduce) to work with any element type.
- **Architectural Impact**: LOW (type system extension, orthogonal to element type handling)
- **Precedent**: UE Blueprint Array/Set/Map container types with `containerType` flag, TypeScript `Array<T>` vs. standalone `T`

---

### D-06: Struct Split / Merge Nodes (Field-Level Destructuring)
- **Subsystem**: data-flow
- **Source**: research-existing-tools.md (§design context — Splitter and Merger nodes), research-ue-blueprints.md (§8 UEdGraphPin SubPins — struct split sub-pins)
- **Description**: `SplitterNode` takes a `struct` input and emits each named field as a separate output port (auto-derived from the struct schema). `MergerNode` takes N named input ports and emits a `struct` output. The port list is dynamically generated from the struct type definition. Enables field-level routing without LLM overhead.
- **Architectural Impact**: LOW (standard node types; requires struct schema awareness in port generation)
- **Precedent**: UE Blueprint `SubPins` (struct split into component ports), n8n expression access to sub-fields, ComfyUI multi-output nodes

---

### D-07: Control-Flow-Excluded (Skipped) Sentinel Type
- **Subsystem**: data-flow
- **Source**: research-existing-tools.md (§Rivet control-flow-excluded type, Key Architectural Lesson)
- **Description**: When a routing/branch node selects one output, all other output edges carry a `Skipped` sentinel value (not null, not error — a distinct typed value meaning "this branch did not execute"). Downstream nodes receive `Skipped` and can either pass it through (propagation) or handle it (provide a default value). Eliminates null-checking bugs in conditional graphs.
- **Architectural Impact**: MEDIUM (requires all nodes to handle `Skipped` inputs; affects engine scheduling)
- **Precedent**: Rivet `control-flow-excluded` type — described as the key innovation eliminating null-handling bugs in conditional branches

---

### D-08: Named Ports (Not Index-Based) in Graph Format
- **Subsystem**: data-flow
- **Source**: research-execution-models.md (§5.5 Recommended Schema Design), research-existing-tools.md (§n8n named connection ports)
- **Description**: All port references in the serialized graph format use stable string names (`"source_port": "output_text"`, `"target_port": "input_prompt"`), not positional indices. This means renaming a node type's internal implementation does not break existing graphs, and graph diffs are human-readable.
- **Architectural Impact**: LOW (serialization format decision; isolated to graph file format)
- **Precedent**: n8n named connection objects, UE Blueprint `PinName: FName`, LangGraph named state fields (contrast: ComfyUI index-based `[node_id, output_index]` fragility)

---

## UI

### U-01: React Flow Canvas with Separate Execution Model
- **Subsystem**: ui
- **Source**: research-existing-tools.md (§React Flow key architectural lesson, §Rete.js key lesson), research-execution-models.md (§7 Rust for Tauri integration)
- **Description**: The canvas is built on React Flow (best-in-class pan/zoom/selection/snap UX). The execution model lives entirely in the Rust backend. The UI maintains a plain TypeScript graph model (nodes, edges, types) synced to React Flow state via Zustand or Jotai. The visual layer is a stateless view of the engine's event stream.
- **Architectural Impact**: HIGH (fundamental UI architecture decision)
- **Precedent**: React Flow + Zustand pattern (standard React Flow architecture), LangFlow (React Flow frontend + Python backend), Rivet (Electron + rivet-core)

---

### U-02: Per-Node Live Output Display After Execution
- **Subsystem**: ui
- **Source**: research-existing-tools.md (§Rivet live debugging, §Debugging Changes Everything lesson), research-execution-models.md (§8.3 execution events)
- **Description**: Each node card in the canvas displays its output inline after execution completes. Streaming nodes show tokens as they arrive (token-by-token). Node state (pending/running/completed/failed/skipped) is visually indicated. Clicking a completed node shows its full output in a detail panel. This is the core value proposition of a visual tool vs. code.
- **Architectural Impact**: MEDIUM (UI rendering of event stream, requires streaming text display component)
- **Precedent**: Rivet per-node output display (described as the primary reason teams chose it over LangChain), LangFlow Playground, n8n execution history

---

### U-03: Remote Live Debugging — Attach to Running Execution
- **Subsystem**: ui
- **Source**: research-existing-tools.md (§Rivet remote debugging — competitive differentiator)
- **Description**: The UI can attach to a running engine process (local or remote) and watch execution in real time: node states update as the execution progresses, streaming output renders live, loop iterations show per-iteration outputs. Implemented by subscribing to the engine's execution event stream for a specific `executionId`.
- **Architectural Impact**: MEDIUM (requires engine to support multiple concurrent event stream subscribers per execution)
- **Precedent**: Rivet remote debugging ("attach IDE to production application and watch graph execute live") — described as a unique competitive differentiator

---

### U-04: Loop Iteration History in UI
- **Subsystem**: ui
- **Source**: research-existing-tools.md (§Rivet Loop Controller — per-iteration output history)
- **Description**: Loop nodes display a history of all iterations in the UI: a numeric picker to navigate between iterations, each showing the per-iteration inputs/outputs. This makes iterative LLM refinement visible and debuggable — users can inspect what changed between iteration 3 and iteration 4.
- **Architectural Impact**: LOW (UI component; requires engine to emit per-iteration events)
- **Precedent**: Rivet loop controller with per-iteration numeric picker, described as making "iteration-level history visible in IDE"

---

### U-05: Error Panel with Jump-to-Node Navigation
- **Subsystem**: ui
- **Source**: research-ue-blueprints.md (§7 Compiler Results Panel — hyperlinks to nodes), research-existing-tools.md (§Debugging Changes Everything lesson)
- **Description**: A dedicated error/validation panel lists all graph validation errors and runtime node errors. Each error entry is clickable — the canvas navigates to and highlights the offending node. Errors include severity (error vs. warning), human-readable description, and node/port identifiers.
- **Architectural Impact**: LOW (UI component + protocol error format)
- **Precedent**: UE Blueprint Compiler Results panel with hyperlinks, n8n execution error logs, LangFlow execution error display

---

### U-06: Minimap and Virtualization for Large Graphs
- **Subsystem**: ui
- **Source**: research-existing-tools.md (§React Flow minimap, §The Spaghetti Problem lesson)
- **Description**: Built-in minimap (React Flow native) for navigation in large graphs. Virtualization (`onlyRenderVisibleElements`) for graphs with 50+ nodes. Auto-layout suggestion (left-to-right topological ordering) available via a one-click action. These are spaghetti-prevention features.
- **Architectural Impact**: LOW (React Flow features, configuration concern)
- **Precedent**: React Flow minimap + virtualization (built-in), n8n canvas management, Node-RED flow tabs

---

### U-07: Searchable Node Palette with Type-Aware Filtering
- **Subsystem**: ui
- **Source**: research-existing-tools.md (§The Spaghetti Problem — searchable palette as #1 UX feature), research-ue-blueprints.md (§2 wildcard type resolution)
- **Description**: The node palette (drag-to-add) is searchable by name, category, and input/output type. When a user has a wire dangling from a typed port, the palette filters to show only nodes compatible with that type. This is the most-cited UX feature by practitioners for large graphs.
- **Architectural Impact**: LOW (UI component; requires port type metadata from all node definitions)
- **Precedent**: UE Blueprint right-click context menu with type-aware filtering, ComfyUI node search, Rivet node palette

---

### U-08: Node Grouping and Semantic Folding
- **Subsystem**: ui
- **Source**: research-existing-tools.md (§Spaghetti problem lesson, §Node-RED lesson), research-ue-blueprints.md (§6 Collapsed Graphs)
- **Description**: Users can select nodes and group them into a collapsible visual group (not a Function subgraph — purely visual). The group has a label and color. Groups can be expanded/collapsed without affecting execution. This is the equivalent of UE Blueprint "collapse to graph" (visual organization only).
- **Architectural Impact**: LOW (UI-only feature; groups serialize as metadata in the graph format)
- **Precedent**: UE Blueprint collapsed graph (visual organization), Node-RED flow tabs, n8n sticky notes + node groups

---

### U-09: Subgraph Node — Click to Inspect Inner Graph
- **Subsystem**: ui
- **Source**: research-existing-tools.md (§Rivet subgraphs — click to inspect), research-ue-blueprints.md (§6 Collapse to Function)
- **Description**: Function nodes (collapsed subgraphs) display as a single node in the parent graph with declared input/output ports. Double-clicking navigates into the subgraph canvas. During execution, the function node shows a spinner and real-time streaming output from the subgraph's terminal nodes. Breadcrumb navigation for nested subgraphs.
- **Architectural Impact**: MEDIUM (UI navigation model + engine subgraph execution display)
- **Precedent**: Rivet subgraph nodes (clickable to inspect, spinner during execution), n8n Execute Workflow node, UE Blueprint function graph editor

---

### U-10: Workflow Playground — Run Partial Graphs from Any Node
- **Subsystem**: ui
- **Source**: research-existing-tools.md (§LangFlow Playground for rapid iteration)
- **Description**: Any node can be right-clicked and "Run from here" — the engine executes only the subgraph rooted at that node (using cached outputs from upstream nodes where available). Enables fast iteration on the tail of a long pipeline without re-running expensive upstream steps.
- **Architectural Impact**: MEDIUM (requires engine to support partial-graph execution with cache injection)
- **Precedent**: LangFlow Playground, ComfyUI incremental re-execution (run only changed nodes), Rivet "re-run from node"

---

## Safety

### S-01: Connection-Time Type Validation (Reject on Draw)
- **Subsystem**: safety
- **Source**: research-ue-blueprints.md (§7 Connection-Time vs. Compile-Time Checks), research-existing-tools.md (§ComfyUI validation.py)
- **Description**: When a user draws a wire between two ports, the engine validates type compatibility immediately. Incompatible connections are blocked at the UI level — the wire snaps back, and a tooltip explains the type mismatch. No invalid connections can exist in a saved graph. This is the "measure twice, cut once" principle applied to graph authoring.
- **Architectural Impact**: MEDIUM (requires UI to call engine validation synchronously on wire draw)
- **Precedent**: UE Blueprint `TryCreateConnection()` type validation on wire draw, ComfyUI type validation before execution, LabVIEW broken wire for type mismatches

---

### S-02: Build-Time Graph Validation Pass
- **Subsystem**: safety
- **Source**: research-ue-blueprints.md (§7 Validation), research-execution-models.md (§8.6 Safety Enforcement)
- **Description**: Before execution starts (`graph/load` phase), the engine performs a full validation pass: all wildcard ports resolved, all required input ports connected, no unresolved type variables, async nodes not inside sync-only subgraph contexts, cycle detection in DAG mode. Returns structured validation report with all errors before any node runs.
- **Architectural Impact**: MEDIUM (validation subsystem, runs at graph-load time)
- **Precedent**: UE Blueprint compiler validation (latent-in-function = error, unconnected required pins = warning), ComfyUI `validate_inputs()`

---

### S-03: Per-Node Error Output Port (Opt-In Error Routing)
- **Subsystem**: safety
- **Source**: research-existing-tools.md (§n8n error routing — first-class graph feature, Cross-Cutting Lesson #4)
- **Description**: Every node can optionally expose an `error` output port (type: `error`). When enabled, a node failure does not abort the graph — instead, the error value flows to whatever is connected to the error port. If no error port is connected, failure propagates upward (default). This makes error recovery paths visible in the graph topology.
- **Architectural Impact**: MEDIUM (affects node failure handling in the engine; error type flows through data-flow system)
- **Precedent**: n8n per-node error output port (described as the right UX vs. Node-RED's tab-level catch), Rivet error propagation

---

### S-04: Global Error Handler Node (Fallback Catch)
- **Subsystem**: safety
- **Source**: research-existing-tools.md (§n8n Error Trigger node, §Node-RED Catch node), research-execution-models.md (§8.5 Error Handling)
- **Description**: A special `ErrorHandler` node receives unhandled errors from any node in the graph (or a specified subset). Complements per-node error ports (S-03) by catching errors that weren't explicitly routed. Provides error metadata (originating node, error code, message) as output.
- **Architectural Impact**: LOW (additive node type; requires engine to route unhandled errors to registered handler)
- **Precedent**: n8n Error Trigger node (dedicated error workflow), Node-RED Catch node (tab-level error catch), Prefect `on_failure_callback`

---

### S-05: Process Sandboxing for CLI Nodes
- **Subsystem**: safety
- **Source**: research-llm-orchestration.md (§4.4 Resource Limits and Sandboxing), research-existing-tools.md (§anti-pattern: single env for engine + plugins)
- **Description**: CLI node processes are spawned with configurable sandboxing: `read-only` (filesystem read only), `workspace-write` (working directory write), `danger-full-access`. On Linux, uses `hakoniwa` (namespaces + cgroups + Landlock + seccomp-BPF). Codex CLI's built-in sandboxing is passed through. This prevents a rogue LLM node from damaging the host system.
- **Architectural Impact**: MEDIUM (process spawner must apply sandbox policy; platform-specific implementation)
- **Precedent**: Codex CLI `--sandbox read-only`, `hakoniwa` Rust crate, `nsjail` (Google), ComfyUI anti-pattern (no sandboxing → dependency hell)

---

### S-06: Cost Budget Enforcement per Node and per Execution
- **Subsystem**: safety
- **Source**: research-llm-orchestration.md (§5.3 Rate Limiting and Cost Tracking), research-existing-tools.md (§Claude Code --max-budget-usd)
- **Description**: Each LLM node has an optional `max_budget_usd` config field passed through to CLI adapters (`--max-budget-usd` for Claude Code). The engine tracks cumulative cost across all nodes in an execution (from JSONL `usage` fields) and can abort if a per-execution budget is exceeded. Cost events are streamed to the UI.
- **Architectural Impact**: LOW (additive to CLI adapter and engine event handling)
- **Precedent**: Claude Code `--max-budget-usd`, OpenRouter cost tracking via `usage` field, Gemini CLI `stats.tokenUsage`

---

## LLM Adapters

### L-01: Claude Code CLI Adapter — Headless JSONL
- **Subsystem**: llm-adapters
- **Source**: research-llm-orchestration.md (§1.1 Claude Code)
- **Description**: Adapter for Claude Code in headless mode: spawns `claude --bare -p --output-format stream-json --mcp-config --model --no-session-persistence --dangerously-skip-permissions` as a `tokio::process::Command`. Maps JSONL `ThreadEvent` lines to `NodeEvent` enum. Supports `--session-id` for resumable sessions and `--add-dir` for working directory context.
- **Architectural Impact**: LOW (isolated adapter, implements `NodeExecutor` trait)
- **Precedent**: Claude Code CLI reference, research-llm-orchestration §1.1

---

### L-02: Gemini CLI Adapter — Headless JSONL
- **Subsystem**: llm-adapters
- **Source**: research-llm-orchestration.md (§1.2 Gemini CLI)
- **Description**: Adapter for Gemini CLI in headless mode: spawns `gemini -p --output-format stream-json`. Maps JSONL events (`init`, `message`, `tool_use`, `tool_result`, `error`, `result`) to `NodeEvent`. Handles exit codes (42 = input validation, 53 = turn limit exceeded) as structured errors.
- **Architectural Impact**: LOW (isolated adapter)
- **Precedent**: Gemini CLI headless mode documentation

---

### L-03: Codex CLI Adapter — Headless JSONL with Sandboxing
- **Subsystem**: llm-adapters
- **Source**: research-llm-orchestration.md (§1.3 OpenAI Codex CLI)
- **Description**: Adapter for Codex exec: spawns `codex exec --json --sandbox <policy>`. Maps JSONL events (`ThreadStarted`, `TurnStarted`, `ItemCompleted`) to `NodeEvent`. Passes sandbox policy through from node config. Non-interactive constraint: any approval request causes immediate failure unless `--full-auto` is configured.
- **Architectural Impact**: LOW (isolated adapter)
- **Precedent**: Codex CLI headless mode

---

### L-04: OpenRouter API Adapter — SSE Streaming
- **Subsystem**: llm-adapters
- **Source**: research-llm-orchestration.md (§5.1 OpenRouter API, §5.2 Unified Node Interface)
- **Description**: Adapter for OpenRouter: posts to `/api/v1/chat/completions` with `stream: true`, parses SSE `data: {...}` lines. Maps SSE chunks (including mid-stream tool calls accumulated across chunks) to `NodeEvent`. Handles both pre-stream HTTP errors (4xx/5xx) and mid-stream errors (`finish_reason: "error"` on HTTP 200). Uses `openrouter_api` or `openrouter-rs` Rust crates.
- **Architectural Impact**: LOW (isolated adapter, implements `NodeExecutor` trait via HTTP instead of process)
- **Precedent**: OpenRouter streaming docs, research-llm-orchestration §5.1

---

### L-05: PTY Adapter for Interactive CLI Tools
- **Subsystem**: llm-adapters
- **Source**: research-llm-orchestration.md (§1.4 Arbitrary CLI Tools)
- **Description**: For CLI tools that hardcode terminal detection and refuse to run without a PTY, the engine provides a PTY-backed adapter using the `pty-process` Rust crate. The PTY master is wrapped as `AsyncRead + AsyncWrite`. Output parsing must handle ANSI escape codes (strip or parse). This is the fallback for tools that cannot be driven via stdin piping.
- **Architectural Impact**: MEDIUM (PTY management adds OS-level complexity; ANSI stripping required)
- **Precedent**: `pty-process` and `tokio-pty-process` Rust crates, research-llm-orchestration §1.4

---

### L-06: Per-Node MCP Configuration and Tool Authorization
- **Subsystem**: llm-adapters
- **Source**: research-llm-orchestration.md (§3.3 MCP Proxying, §7.3 MCP Embedding Strategy), research-llm-orchestration.md (§3.2 Exposing Graph Manipulation as MCP Tools)
- **Description**: Each LLM node has a `mcp_servers` config list specifying which MCP servers it has access to. The engine acts as an MCP proxy: when a node's LLM calls a tool, the engine routes the call to the appropriate stdio server, applies the node's `allowed_tools` allowlist, and returns the result. Each node can have a different MCP configuration (principle of least privilege).
- **Architectural Impact**: MEDIUM (requires engine to run MCP server instances and proxy tool calls per-node)
- **Precedent**: Claude Code `--mcp-config`, MCP stdio transport, `rust-mcp-sdk`, research-llm-orchestration §7.3

---

## Project System

### PS-01: Text-Diffable Graph Serialization Format (JSON)
- **Subsystem**: project-system
- **Source**: research-existing-tools.md (§Workflows as Code-Adjacent Artifacts lesson), research-execution-models.md (§5.5 Recommended Schema Design)
- **Description**: Graphs serialize to a human-readable, diff-friendly JSON format with stable named ports, UUID node IDs, semantic versioning, and separated topology from execution metadata. The format is designed to be committable to git, reviewable in PRs, and modifiable by LLMs. Node positions are stored as optional UI metadata, not required for execution.
- **Architectural Impact**: MEDIUM (defines the project file format; all subsystems interact with it)
- **Precedent**: Rivet YAML graph format (committed to repos, reviewed in PRs), ComfyUI JSON workflow, n8n JSON export, research-execution-models §5.5 proposed schema

---

### PS-02: Callable Function Subgraphs — Node Library System
- **Subsystem**: project-system
- **Source**: research-existing-tools.md (§Subgraphs Are Not Optional lesson), research-ue-blueprints.md (§3 Function Graphs, §3 BlueprintFunctionLibrary)
- **Description**: Any connected subgraph can be "collapsed to function" — creating a named, reusable node type with declared input/output ports. Functions are callable from any graph in the project. A "node library" is a collection of functions packaged together (equivalent to `BlueprintFunctionLibrary`) and importable across projects.
- **Architectural Impact**: HIGH (requires project-level registry of function definitions; function nodes reference library entries)
- **Precedent**: UE Blueprint function graphs + BlueprintFunctionLibrary, n8n Execute Workflow node, Rivet subgraph nodes, Node-RED subflows

---

### PS-03: Project Save / Load / Version Management
- **Subsystem**: project-system
- **Source**: research-existing-tools.md (§Workflows as Code-Adjacent Artifacts lesson), research-execution-models.md (§5 Graph Serialization Formats)
- **Description**: Projects are directories containing: main graph JSON file, function library definitions, execution cache metadata, and project config (MCP server configs, environment variables). Save/load via Tauri filesystem APIs. Project format includes a `schemaVersion` field; the engine validates and optionally migrates on load.
- **Architectural Impact**: MEDIUM (Tauri filesystem integration, schema migration logic)
- **Precedent**: Rivet (YAML files in repo), ComfyUI (JSON workflow files), n8n (JSON export/import)

---

### PS-04: Execution History and Run Logs
- **Subsystem**: project-system
- **Source**: research-existing-tools.md (§n8n execution history, §debugging lesson), research-execution-models.md (§4.3 Temporal event log)
- **Description**: Each graph execution is persisted to an execution log: timestamp, inputs, per-node outputs (or references to cached outputs), duration, cost, and final status. The UI can browse past runs, compare outputs between runs, and re-play a past execution's event stream. Logs are stored locally in the project directory.
- **Architectural Impact**: MEDIUM (requires execution event persistence layer)
- **Precedent**: n8n execution history, Temporal event log, Prefect state tracking

---

### PS-05: Node Versioning and Compatibility Checks
- **Subsystem**: project-system
- **Source**: research-existing-tools.md (§ComfyUI update fragility anti-pattern), research-execution-models.md (§8.6 Node versioning), research-ue-blueprints.md (§7 Validation)
- **Description**: Every node type has a semantic version (`"version": "1.2.0"`). When loading a graph, the engine checks each node type's declared version against the installed engine version. Incompatible versions produce a structured error with migration guidance. This prevents the ComfyUI "update breaks workflow" failure mode.
- **Architectural Impact**: MEDIUM (requires version registry and compatibility matrix in the engine)
- **Precedent**: ComfyUI custom node version fragility (anti-pattern to avoid), UE Blueprint compilation breaking changes, n8n node versioning

---

## MCP Server

### M-01: Embedded MCP Server — Graph Manipulation Tools
- **Subsystem**: mcp-server
- **Source**: research-llm-orchestration.md (§3.2 Exposing Graph Manipulation as MCP Tools), research-existing-tools.md (§LangFlow MCP support)
- **Description**: The engine exposes its graph manipulation API as an MCP server over stdio, making it available to any MCP-capable LLM (Claude Code, Gemini CLI, Codex). Core tools: `graph_add_node`, `graph_connect`, `graph_disconnect`, `graph_get_node`, `graph_run_subgraph`, `graph_get_output`, `graph_list_nodes`. This enables LLMs to build and modify their own workflows programmatically — "meta-orchestration."
- **Architectural Impact**: HIGH (engine must implement MCP server; enables self-editing capability)
- **Precedent**: LangFlow MCP support, research-llm-orchestration §3.2, MCP specification

---

### M-02: MCP Server over stdio with Process-Scoped Lifecycle
- **Subsystem**: mcp-server
- **Source**: research-llm-orchestration.md (§7.3 MCP Embedding Strategy, §8 MCP Embedding Strategy Summary)
- **Description**: The engine's embedded MCP server uses stdio transport (not HTTP) for desktop embedding. Each node's LLM session receives an `--mcp-config` pointing to the engine's stdio server. The engine owns the MCP server process lifecycle — it starts when the graph run begins and shuts down after. Uses `rust-mcp-sdk` or official `modelcontextprotocol/rust-sdk`.
- **Architectural Impact**: MEDIUM (process management for MCP subprocess, IPC design)
- **Precedent**: MCP stdio transport (preferred for desktop), Claude Code `--mcp-config`, research-llm-orchestration §8

---

### M-03: MCP Proxy — Route Tool Calls to External Servers
- **Subsystem**: mcp-server
- **Source**: research-llm-orchestration.md (§3.3 MCP Proxying / Bridging)
- **Description**: The engine acts as an MCP proxy for external servers (filesystem, web search, database, etc.). When a node's LLM calls a tool, the engine routes the call to the appropriate server (local stdio or remote Streamable HTTP), applies the node's `allowed_tools` authorization policy, and returns the result. Multiple external servers can be active simultaneously.
- **Architectural Impact**: MEDIUM (requires MCP client implementation in the engine for each external server)
- **Precedent**: `mcp-proxy` (sparfenyuk), FastMCP proxy provider, MCP Bridge (arxiv 2504.08999 risk-based execution model)

---

### M-04: MCP Sampling / Elicitation — Node-Initiated LLM Calls Back to Engine
- **Subsystem**: mcp-server
- **Source**: research-execution-models.md (§3.2 MCP core primitives — Sampling), research-llm-orchestration.md (§3.2 Exposing Graph Manipulation as MCP Tools)
- **Description**: MCP's `sampling` primitive allows an MCP server to initiate LLM calls on behalf of a connected client. The engine can use this to implement "meta-orchestration": a graph manipulation request from an LLM node triggers the engine to call back into a (possibly different) LLM to evaluate routing decisions, validate outputs, or generate new node configurations.
- **Architectural Impact**: MEDIUM (requires bidirectional MCP communication, creates async call cycles that must be managed carefully)
- **Precedent**: MCP sampling specification, research-execution-models §3.2 MCP sampling primitive

---

## Anti-Patterns Explicitly Avoided

The following anti-patterns identified in research are explicitly NOT included as feature candidates because they represent architectural mistakes to avoid:

| Anti-Pattern | Avoided By |
|---|---|
| Index-based port references (ComfyUI) | D-08: Named ports in graph format |
| Untyped connections (Node-RED) | D-02: Typed ports + D-03: Core type vocabulary |
| No subgraph/reuse (ComfyUI) | PS-02: Callable function subgraphs |
| Tight framework coupling (LangFlow/LangChain) | N-01: Unified CLI/API backend with pluggable adapters |
| Single env for engine + plugins | S-05: Process sandboxing + separate node processes |
| Level-by-level execution order (n8n pre-1.0) | E-02: Dependency-ready scheduling |
| Static DAG only (Airflow) | E-05: Cycle detection + explicit loop mode, E-11: Dynamic fan-out |
| No streaming in data transport | D-03: `stream<T>` as a core type |
| Error handling as afterthought | S-03: Per-node error port + S-04: Global error handler |
| No input-signature caching | E-03: Incremental re-execution with cache |
