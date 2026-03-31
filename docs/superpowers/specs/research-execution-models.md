# Research: Execution Models, Protocols, and Graph Engines

**Date:** 2026-03-27
**Purpose:** Inform design of a protocol-first, headless node-based LLM workflow orchestrator written in a systems language (Rust, Go, or C++).

---

## Table of Contents

1. [Actor Model Implementations](#1-actor-model-implementations)
2. [Reactive Streams](#2-reactive-streams)
3. [Protocol Design Patterns](#3-protocol-design-patterns)
4. [DAG Execution Engines](#4-dag-execution-engines)
5. [Graph Serialization Formats](#5-graph-serialization-formats)
6. [Type Systems for Graph Languages](#6-type-systems-for-graph-languages)
7. [Engine Language Evaluation](#7-engine-language-evaluation)
8. [Protocol Design Recommendations](#8-protocol-design-recommendations)
9. [Engine Language Recommendation](#9-engine-language-recommendation)

---

## 1. Actor Model Implementations

### 1.1 Erlang/OTP

Erlang is the gold standard of actor-based fault-tolerant systems. Every Erlang process is a lightweight actor (~300 bytes heap minimum) with its own mailbox. Processes share no memory; all communication is via asynchronous message passing.

**Supervision Model:**
- Supervision trees: every process is owned by a supervisor parent
- Four strategies: `one_for_one` (restart only failed child), `one_for_all` (restart all siblings), `rest_for_one` (restart failed + all started after it), `simple_one_for_one` (dynamic pool of identical workers)
- "Let it crash" philosophy: don't try to recover in place; let the supervisor restart from clean state
- Supervisors configure max restart frequency (e.g., 5 restarts in 10 seconds before escalating)

**Key takeaways for our engine:**
- Per-node supervision trees are a proven pattern for isolating node failures
- Restart strategies map naturally to graph node failure policies
- "Let it crash" is better than defensive error handling within nodes

### 1.2 Akka (JVM Actor Model)

Akka implements parental supervision with typed actors. Every actor is created by a parent; the parent receives failure signals and decides: resume, restart, stop, or escalate.

**Akka Streams + Backpressure:**
- Akka Streams implements the Reactive Streams specification
- Backpressure: downstream signals demand upstream via `request(n)` — upstream can only send what was requested
- `ActorSink.actorRefWithBackpressure`: bridges stream processing into actor message passing with proper demand signaling
- `ask` pattern: send message to actor, await response via `mapAsync`, before sending more — natural rate limiting

**Key takeaways:**
- Separating the stream graph (Akka Streams) from the actor (stateful processing) is a clean architecture split
- Bridging streaming into actors requires an explicit backpressure protocol at the boundary

### 1.3 Tokio (Rust)

Tokio is the dominant async runtime for Rust. It uses `tokio::spawn` to create green tasks (not OS threads) scheduled by the Tokio executor.

**Channel Types:**
| Channel | Semantics | Use Case |
|---------|-----------|----------|
| `mpsc` (bounded) | Multi-producer, single-consumer; backpressure via capacity | Primary node mailbox |
| `mpsc` (unbounded) | Same but no backpressure | Internal control messages |
| `oneshot` | Single-use request/response | Request-response within actors |
| `broadcast` | Multi-producer, multi-consumer; each receiver gets every value | Fan-out to multiple watchers |
| `watch` | Single latest value; receivers get most recent | State/status broadcasting |

**Alice Ryhl's Actor Pattern (canonical reference):**
- Split into `Actor` struct (owns state + receiver) and `ActorHandle` struct (owns sender, is `Clone`)
- `ActorHandle::new()` calls `tokio::spawn(actor.run())` — actor is self-contained
- Shutdown: drop all handles → sender drops → `receiver.recv()` returns `None` → actor loop exits
- Request-response: embed `oneshot::Sender` inside enum variants; actor sends result back
- Deadlock prevention: avoid bounded channel cycles; never have two actors await each other's bounded send simultaneously

**Structured Concurrency:**
- `tokio::task::JoinSet` groups related tasks; cancellation propagates
- `select!` macro: race multiple async operations (e.g., receive message OR receive shutdown signal)
- `CancellationToken` (from `tokio-util`): structured cancellation propagation

**Key takeaways for our engine:**
- `mpsc` bounded channels for node mailboxes with backpressure
- `oneshot` for request-response (sync execution requests)
- Handle pattern = natural API surface for the graph executor to talk to nodes
- Tokio tasks are the natural "process" analog to Erlang actors
- Must prevent bounded-channel cycles in the graph to avoid deadlock

---

## 2. Reactive Streams

### 2.1 Reactive Streams Specification

Reactive Streams defines four interfaces: `Publisher<T>`, `Subscriber<T>`, `Subscription`, and `Processor<T,R>` (Publisher + Subscriber).

**Backpressure contract:**
1. Subscriber calls `subscription.request(n)` to signal it can receive `n` more elements
2. Publisher MUST NOT send more than `n` elements
3. Stop-and-wait: request(1) after each element = acknowledgement protocol
4. Batched demand: request(N) amortizes acknowledgement cost

**Core invariant:** Buffer sizes must be bounded and subscriber-controlled. Publisher cannot force unbounded buffering on the subscriber.

### 2.2 Combining Actors + Reactive Streams

The pattern from Akka (and applicable to Tokio):
- **Actors** = stateful, event-driven, message-processed units
- **Streams** = data pipelines with backpressure between processing stages
- **Bridge**: an actor's mailbox *is* a bounded buffer; the bounded `mpsc` channel implements demand-like backpressure via async send blocking

For our engine:
- Node inputs = bounded channels (backpressure at the wire level)
- Node execution = actor task (stateful, independent)
- Streaming outputs = `tokio_stream::ReceiverStream` or a custom stream over an `mpsc` sender
- A node that produces partial results sends multiple values to its output channel before marking itself done

### 2.3 Tokio Streams

- `tokio_stream::Stream` trait: async equivalent of `Iterator`
- `StreamExt` combinators: `map`, `filter`, `take_while`, `chunks`, `timeout`
- `ReceiverStream`: wraps `mpsc::Receiver` as a `Stream`
- Pattern for streaming node output: node sends `Result<PartialOutput, NodeError>` items to a bounded channel; consumer receives via `ReceiverStream`

---

## 3. Protocol Design Patterns

### 3.1 Language Server Protocol (LSP)

LSP standardizes editor-to-language-server communication. Key design decisions:

**Message Format:**
- JSON-RPC 2.0 over stdio or TCP
- HTTP-style framing: `Content-Length: N\r\n\r\n{json}`
- Three message types: Request (id + method + params), Response (id + result/error), Notification (method + params, no id, no response expected)

**Capabilities Negotiation:**
- Client sends `initialize` with `ClientCapabilities`
- Server responds with `ServerCapabilities`
- Neither side requires the other to support every feature; unknown capabilities are ignored
- Dynamic registration: server can register/unregister capabilities at runtime via `client/registerCapability`

**Lifecycle:**
1. `initialize` (request) → server initializes, returns capabilities
2. `initialized` (notification) → client signals ready
3. Normal operation
4. `shutdown` (request) → server prepares to shut down
5. `exit` (notification) → server process exits

**Versioning:**
- Features tagged with `@since 3.17.0`
- Backward compatibility via capability flags (not version numbers)
- Clients MUST ignore unknown server capabilities

**Lessons for our protocol:**
- Capability negotiation at connect time is essential for forward compatibility
- Separate "declare readiness" notification from the initialize handshake
- Use feature flags, not version-based feature switches
- Notifications for fire-and-forget events; requests for anything needing confirmation

### 3.2 Model Context Protocol (MCP)

MCP is Anthropic's protocol for connecting AI models to external context/tools. Explicitly inspired by LSP.

**Architecture:**
- Host (LLM application) → Client (connector) → Server (context/tool provider)
- JSON-RPC 2.0 messages over stdio (preferred) or Streamable HTTP (SSE replacement as of 2024-11-05)
- Stateful connections with capability negotiation

**Core primitives:**
- **Tools**: model-controlled; model discovers and invokes autonomously
- **Resources**: structured data/context
- **Prompts**: pre-defined interaction templates
- **Sampling**: server-initiated LLM calls (agentic loops)
- **Progress tracking, cancellation, logging**: utility channels

**Transport (current):**
- `stdio`: client spawns server as subprocess; JSON-RPC over stdin/stdout
- `Streamable HTTP`: HTTP POST for requests; SSE stream for server-push events

**Key lessons for our protocol:**
- Model the "host/client/server" split: our engine (host), protocol client (UI or CLI), node servers
- Streamable HTTP transport pattern directly applicable: POST for control, SSE stream for execution events
- Sampling/elicitation patterns: nodes that need to call back into the LLM need a defined protocol for it
- Progress tracking + cancellation must be first-class protocol features, not afterthoughts

### 3.3 gRPC Streaming

gRPC uses Protocol Buffers for service definitions, generates typed client/server stubs.

**Service definition syntax:**
```proto
rpc Execute(stream ExecutionRequest) returns (stream ExecutionEvent) {}
```

**Streaming modes:**
- Unary: request/response
- Server streaming: one request, stream of responses
- Client streaming: stream of requests, one response
- Bidirectional: independent read/write streams

**Best practices:**
- Don't use streaming for requests that are naturally unary
- `Channel<T>` (producer/consumer queue) for threading safety — only one writer per stream at a time
- Graceful completion: call `CompleteAsync()` on the request stream; both sides should send all messages and close cleanly
- Handle stream interruption with reconnect logic

**Relevance:**
- Bidirectional streaming matches the "node execution" model: send inputs, receive a stream of partial outputs
- Proto IDL as an alternative to JSON schema for typed protocol definition
- gRPC-Web enables browser-based UIs to connect to gRPC backends

### 3.4 JSON-RPC 2.0 Design Principles

**Error handling:**
- Error objects: `{code: integer, message: string, data?: any}`
- Standard codes: -32700 (Parse error), -32600 (Invalid Request), -32601 (Method not found), -32602 (Invalid params), -32603 (Internal error)
- Application errors: -32000 to -32099 reserved for server errors; use defined ranges for domain errors
- `data` field for structured error context (stack traces, validation details)

**Versioning:**
- Always include `"jsonrpc": "2.0"` in every message
- Application-level versioning via capability negotiation (LSP/MCP pattern), not URL versioning
- Clients query server version; semver 2.0 for compatibility checks

**Discoverability:**
- OpenRPC spec: machine-readable JSON-RPC API description
- Methods prefixed `rpc.` are reserved for protocol internals
- `x-` prefix for extension properties in OpenRPC

**Batching:**
- Array of request objects → array of response objects
- Useful for bulk graph update operations

### 3.5 What Makes a Good Protocol

Based on LSP, MCP, and JSON-RPC patterns:

| Property | Pattern |
|----------|---------|
| **Versioning** | Semantic versioning declared in initialize handshake; capability flags for feature negotiation |
| **Extensibility** | Unknown fields ignored (forward compat); `x-` extension namespace; capability registration |
| **Error handling** | Structured error objects with typed codes; error data for context; never swallow errors |
| **Discoverability** | Schema-driven (proto or JSON Schema); introspection methods; OpenRPC-style metadata |
| **Lifecycle** | Explicit init → ready → shutdown → exit sequence; heartbeat/ping for connection health |
| **Cancellation** | First-class: any in-flight request must be cancellable by ID |
| **Progress** | Streaming progress notifications for long-running operations |
| **Transport independence** | Protocol defined over abstract message layer; stdio and HTTP+SSE as concrete transports |

---

## 4. DAG Execution Engines

### 4.1 Apache Airflow

**Model:** Python-defined DAGs; tasks are atomic units of work; execution is time-triggered or event-triggered.

**Task dependencies:** `task_a >> task_b` syntax; underlying: `set_downstream`/`set_upstream`.

**XCom (inter-task data):** Key-value store; tasks push/pull small values. Designed for metadata, NOT large data. Large data should go to external storage (S3, etc.).

**Branching:** `@task.branch` decorator returns a task_id to follow; other branches are skipped.

**Loops:** Airflow is fundamentally acyclic. Loops are simulated by: (a) running a new DAG run, (b) using `@task.dynamic_task_mapping` for fan-out. True iteration within a single run is not native.

**Failure handling:** `on_failure_callback`, retries with exponential backoff, SLAs. Tasks can be marked failed/skipped programmatically.

**Relevance for our engine:**
- XCom pattern is useful: structured inter-node data passing with typed keys
- Airflow's acyclic constraint is a limitation we want to overcome (our engine needs loops)
- The callback-based failure handling maps to our error handler node concept
- Dynamic task mapping (fan-out) = a pattern we need for parallel branches

### 4.2 Prefect

**Model:** Python flows (= workflows) contain tasks. Flows are not constrained to DAGs — they can contain loops, conditionals, and arbitrary Python control flow.

**State machine:** Tasks transition through states: `Pending → Running → Completed/Failed/Crashed`. State transitions drive orchestration.

**Retries:** `@task(retries=3, retry_delay_seconds=5)` — built into task decorator.

**Result persistence:** `persist_result=True` → results cached to configured storage; enables exactly-once execution on retry.

**Dynamic workflows:** Tasks can be created at runtime; `map()` for parallel fan-out over iterables; conditional execution is just Python `if` statements.

**Key advantage over Airflow:** No need to pre-define the complete DAG shape; the graph emerges from execution.

**Relevance:**
- State machine per task/node is the right model; our nodes have explicit lifecycle states
- Result caching / persistence = node output caching; skip re-execution if inputs haven't changed
- Dynamic graph emergence is the pattern we want for loop nodes that generate iterations at runtime

### 4.3 Temporal

**Model:** Durable execution — workflow code runs "effectively once to completion" even across failures, crashes, and restarts.

**Core concepts:**
- **Workflow**: long-running function that orchestrates Activities; code is replayed from history on restart
- **Activity**: side-effectful function (API calls, DB writes, file I/O); retried independently with configurable policy
- **Signals**: external events delivered to a running workflow (modify execution path, inject data)
- **Task Queues**: separate queues for different activity types; worker pools per queue (bulkhead pattern)

**Durability mechanism:** Every state change is persisted to the event log before execution continues. On restart, the workflow replays the log to reconstruct state. Non-determinism in replay is a common footgun.

**Error handling:** Activities have typed errors; non-retryable errors propagate to workflow; workflow can catch and handle or let fail; compensating workflows (sagas) for distributed transactions.

**Relevance for our engine:**
- Durable execution is valuable for long-running LLM workflows
- Signal mechanism = the pattern for "director nodes" that steer execution based on LLM output
- Task Queue / Worker Pool = the deployment model for distributed node execution
- The replay-based durability mechanism is complex to implement; consider as a future phase

### 4.4 Dagster

**Model:** Software-defined assets — declare what data assets should exist and how to compute them, not just tasks.

**Type system:** Inputs and outputs are optionally typed via Dagster types; validated at runtime. IO Managers abstract storage: swap S3 for local disk by changing the IO Manager, not the asset code.

**Graph execution:** Op graphs (lower-level); assets are higher-level with automatic dependency inference. Graph-backed assets: use an op graph to compute an asset.

**Key insight:** Dagster inverts the task→asset relationship. Instead of "run task X which produces asset Y", you say "asset Y requires assets A and B" and Dagster figures out what to run.

**Relevance:**
- IO Manager pattern = our typed wire abstraction; the connection defines what type flows, not the node
- Asset-oriented thinking: nodes declare what they produce, not just what they do
- Runtime type validation on connections is a Dagster-validated pattern

### 4.5 LangGraph

**Model:** Nodes (Python functions), edges (routing functions), and a shared state object. Inspired by Google Pregel / BSP (Bulk Synchronous Parallel).

**Execution model:**
- State object passed to each active node
- Node returns updated state
- Edges are functions: `(state) → next_node_id`
- Conditional edges enable director/router pattern
- Super-steps: all nodes in a parallel step run as one super-step; sequential nodes are separate super-steps

**Streaming:** Native token-level streaming from LLM nodes; state updates streamed as they occur.

**Loops:** Explicit cycle support — a node can route back to an earlier node. `END` is the terminal.

**Durable execution:** State checkpointing to persistent storage; resume from checkpoint on failure.

**Relevance — most directly applicable to our engine:**
- State-passing model with conditional edge routing = the director/router node pattern
- Super-step execution with parallel lanes
- Token streaming as first-class output type
- Explicit loop support in the graph model
- "State is shared via the graph, not direct actor communication" is an alternative to pure actor model

---

## 5. Graph Serialization Formats

### 5.1 JSON Graph Format (JGF)

Standard JSON format for graph data. Schema at `jsongraphformat.info/v2.0/json-graph-schema.json`.

**Structure:**
```json
{
  "graph": {
    "id": "graph-id",
    "type": "optional-type",
    "label": "optional-label",
    "nodes": { "node-id": { "label": "...", "metadata": {} } },
    "edges": [{ "source": "n1", "target": "n2", "metadata": {} }]
  }
}
```

**Strengths:** Minimal, standard, JSON Schema validated. Metadata objects extensible.
**Weaknesses:** No typed connections, no port semantics, no execution state, no streaming annotations.

### 5.2 ComfyUI Workflow Format

Flat JSON object where keys are node IDs (strings), values are node definitions.

**Node definition:**
```json
{
  "class_type": "KSampler",
  "inputs": {
    "model": ["1", 0],      // [source_node_id, output_socket_index]
    "positive": ["2", 0],
    "steps": 20,            // literal constant
    "cfg": 7.0
  }
}
```

**Connection format:** `[node_id, output_index]` — positional, index-based (not named ports).

**Type system:** Rich output types: `IMAGE`, `LATENT`, `CONDITIONING`, `MODEL`, `CLIP`, `VAE`, primitives, `COMBO` (enum), `*` (wildcard). Type checking before execution. Output caching by input hash.

**Ephemeral nodes:** Nodes can dynamically expand into sub-graphs at runtime via `expand` return key.

**Strengths:** Compact, human-readable, LLM-friendly, well-tested in production.
**Weaknesses:** Index-based port references are fragile (rename a port → all references break); no named ports; no execution metadata in base format.

### 5.3 Node-RED Flow Format

Flat array of node objects.

**Node structure:**
```json
{
  "id": "hexadecimal-id",
  "type": "function",
  "name": "Process Data",
  "x": 200, "y": 100, "z": "flow-id",
  "wires": [["target-id-1", "target-id-2"]]
}
```

**Connections:** `wires` is an array-per-output-port of arrays of target node IDs. Port index = position in outer array.

**Subflows:** Defined as node type `subflow` with `in`/`out` port arrays.

**Strengths:** Simple, flat, easy to parse. Widely deployed.
**Weaknesses:** No type information on connections; position-based ports; no execution metadata.

### 5.4 n8n Workflow Format

Richer than Node-RED: named connection objects with explicit port names.

**Key distinction:** Connections are named (`main`, custom port names) and directional. Nodes have `parameters` (strongly typed, schema-driven), `position`, `disabled`, `notes`.

**Strengths:** Named ports (more robust than indexed), per-node parameter schemas.
**Weaknesses:** Still JSON, no streaming annotations, no execution state.

### 5.5 Recommended Schema Design for Our Engine

Based on the above analysis, a well-designed schema should:

1. **Named ports** (not index-based): `source_port: "output_text"`, `target_port: "input_prompt"`
2. **Typed connections**: each connection has a declared type that both ports must satisfy
3. **Node metadata**: `node_type`, `version`, display position, notes, disabled flag
4. **Execution annotations** (separate from topology): status, last-run timestamps, cached output refs
5. **Subgraph / function support**: nodes that contain embedded graphs with input/output boundaries
6. **LLM-editability**: flat structure with stable IDs; avoid index-based references; human-readable field names

**Proposed top-level schema:**
```json
{
  "version": "1.0.0",
  "graph": {
    "id": "uuid",
    "nodes": {
      "node-uuid": {
        "type": "llm_call",
        "version": "1.0",
        "label": "Generate Text",
        "config": { "model": "claude-opus-4", "temperature": 0.7 },
        "position": { "x": 200, "y": 150 }
      }
    },
    "connections": [
      {
        "id": "conn-uuid",
        "source": { "node": "node-uuid-1", "port": "output_text" },
        "target": { "node": "node-uuid-2", "port": "input_prompt" },
        "type": "text"
      }
    ]
  }
}
```

---

## 6. Type Systems for Graph Languages

### 6.1 Visual Programming Type Systems

**LabVIEW:** Wires are colored by type (e.g., orange = double, blue = integer, green = boolean, pink = string). Type mismatches are caught at edit time; connecting incompatible ports shows a broken wire. Polymorphic VIs adapt their type based on connected wires.

**Max/MSP:**
- Gray patch cords: control signals (int, float, symbol, list, bang)
- Yellow segmented cords: audio signals (`~` suffix objects)
- Green segmented cords: matrix/Jitter data
- Visual distinction = type distinction; incompatible connections are prevented visually

**Key insight:** Color-coded connections encode type at the visual layer — the type system is visible, not hidden.

### 6.2 UE Blueprints

Blueprint pins have distinct types: bool, int, float, string, vector, object references, structs, enums, exec (execution flow). Wildcard pins turn blue when connected and take on the connected type. Type checking is enforced at connection time — the editor prevents invalid connections.

**Exec pins:** White arrow pins represent execution flow (not data flow). Two kinds of graph: data flow (pure, no side effects) and execution flow (imperative sequence).

**Relevance:** Our engine should separate data wires (typed values) from execution edges (control flow / routing signals). This matches the Blueprint exec pin / data pin separation.

### 6.3 Algebraic Type Systems in Graph Contexts

**Product types (structs):** `{text: string, tokens: int}` — pass multiple named values as one wire.

**Sum types (enums/unions):** `text | image | audio` — a wire that can carry different types; consumers must pattern-match.

**Generics/type parameters:** `List<T>` — typed collections; the element type propagates through the graph.

**Type inference in visual graphs:**
- When a wildcard port is connected to a concrete type, the wildcard resolves
- Constraint propagation: connecting two wildcards to the same node forces them to unify
- Incremental inference: only recompute affected constraints when graph changes
- Production use: 3ds Max MCG performs on-the-fly type inference; NiMo language allows only type-safe connections

**For our engine:**
- Primitive types: `text`, `number`, `boolean`, `json`, `binary`, `image`, `audio`
- Composite types: `struct` (named fields), `list<T>`, `optional<T>`
- Special types: `stream<T>` (partial/streaming output), `error`, `any` (wildcard)
- Type checking at graph-load time; runtime coercion for compatible types (e.g., `int` → `float`)
- Wildcard (`any`) ports for utility nodes (debug, log, passthrough)

---

## 7. Engine Language Evaluation

### 7.1 Rust

**Async concurrency:** Tokio provides a mature, high-performance async runtime. Actors via `mpsc` channels and `tokio::spawn` are well-documented (Alice Ryhl's pattern). `tokio_stream` for reactive streaming. `JoinSet` for structured concurrency.

**Type safety:** The borrow checker eliminates data races at compile time — critical for a concurrent execution engine. `enum`-based typed messages are zero-cost.

**Memory safety:** No garbage collector; predictable latency; no GC pauses interrupting streaming outputs.

**Tauri integration:** Tauri 2.0 (released Oct 2024) is built on Rust. The engine and UI can share a single Rust binary with Tauri as the IPC/webview bridge. Engine runs as a Tokio runtime; Tauri handles the webview. IPC via Tauri's command/event system (which wraps the same message-passing pattern).

**Ecosystem:**
- `tokio`: async runtime
- `serde` + `serde_json`: serialization (excellent)
- `actix` / `tiny-tokio-actor`: actor frameworks (available but not required)
- `tonic`: gRPC implementation (Tokio-native)
- `jsonrpsee`: JSON-RPC server/client (Tokio-native)
- `petgraph`: graph data structures (DAG traversal, cycle detection)

**LLM code generation:** Tier 2 support in GitHub Copilot; modern LLMs (Claude 4, GPT-4.1) generate correct Rust for well-scoped tasks. Borrow checker errors are common for LLM-generated code but are caught at compile time, not runtime. Requires more precise prompting than Go.

**Trade-offs:**
- PROS: maximum performance, memory safety, no GC, excellent Tauri integration, best correctness story
- CONS: steep learning curve, slow compilation, LLM code gen requires more review, borrow checker is an obstacle for rapid prototyping

### 7.2 Go

**Concurrency:** Goroutines are extremely cheap (2KB stack, grows dynamically). Channels are first-class language primitives. `select` for racing multiple channels. Go's scheduler is excellent for I/O-bound concurrent work.

**Simplicity:** Go compiles in seconds, simple syntax, excellent for team readability.

**Ecosystem:**
- `hashicorp/go-dag`: DAG execution (used in Terraform)
- `Azure/go-workflow`: workflow with dependencies
- `s8sg/goflow`: flow-based programming in Go
- Temporal SDK: Go is the primary Temporal SDK language
- gRPC: Go has excellent gRPC support

**LLM code generation:** Tier 1 support in GitHub Copilot. Go's simple syntax generates clean, readable code from LLMs. Less ambiguity in generated code than Rust.

**Trade-offs:**
- PROS: fast compilation, simple mental model, excellent concurrency primitives, great LLM code gen, Temporal SDK
- CONS: garbage collector (GC pauses can affect latency), no Tauri integration (UI must be separate process), generics only added in 1.18 (ecosystem still catching up), no borrow checker = runtime data race bugs possible

### 7.3 C++

**Async concurrency:** C++20 coroutines provide cooperative multitasking. Libraries: `concurrencpp`, `Taro` (task-graph + coroutines), `coop` (cooperative multitasking). Still more complex than Rust's Tokio or Go's goroutines.

**Performance:** Maximum raw performance; zero overhead; direct memory control.

**UE familiarity:** If the team works on Unreal Engine, C++ is familiar. UE's task graph system is a production C++ workflow engine.

**LLM code generation:** Tier 1 in Copilot for C++. Large training corpus. But generated C++ has memory safety issues (undefined behavior, use-after-free) that LLMs don't always catch.

**Trade-offs:**
- PROS: maximum performance, UE-familiar, large LLM training corpus
- CONS: memory unsafety (no borrow checker, GC), complex build systems (CMake, vcpkg), manual memory management burden, async ecosystem less mature than Rust/Go, no modern equivalent of Tauri

---

## 8. Protocol Design Recommendations

Based on the research across LSP, MCP, JSON-RPC, and the DAG engine survey:

### 8.1 Foundation

- **Base protocol:** JSON-RPC 2.0 over abstract transport (stdio for CLI/embedded, Streamable HTTP for UI)
- **Message framing:** Content-Length header (LSP-style) for stdio; HTTP POST + SSE stream for UI transport
- **Versioning:** Semantic versioning declared in `initialize` handshake; capability flags for individual features

### 8.2 Lifecycle

```
client → server: initialize { protocolVersion, capabilities }
server → client: initialized { capabilities, engineVersion }
client → server: graph/load { graphId, graphJson }
server → client: graph/loaded { graphId, nodeCount }
client → server: execution/start { graphId, inputs }
server → client: execution/event (stream) { type, nodeId, data }
client → server: execution/cancel { executionId }
server → client: execution/complete { executionId, outputs, error? }
client → server: shutdown
server → client: shutdown/ack
```

### 8.3 Execution Events (Streaming Protocol)

Execution produces a stream of typed events rather than a single response:

| Event Type | Description |
|-----------|-------------|
| `node/started` | Node began execution |
| `node/progress` | Partial output / progress % |
| `node/output/partial` | Streaming token/chunk from LLM node |
| `node/output/final` | Completed output for this port |
| `node/error` | Node errored with structured error |
| `node/skipped` | Node skipped by director routing |
| `node/completed` | Node finished all outputs |
| `execution/completed` | Entire graph execution finished |
| `execution/error` | Fatal execution error |

### 8.4 Type System in the Protocol

Connections declare types. Type checking occurs:
1. At graph-load time (static check)
2. At runtime when first value flows (dynamic validation for `any`-typed ports)

Types are versioned: `"type": "text/v1"`. Unknown types are rejected by default; `"strict": false` option for lenient mode.

### 8.5 Error Handling

- Every node error is structured: `{ code, message, nodeId, portId, data }`
- Errors are protocol-level values, not exceptions; they flow through the execution event stream
- Error handler nodes are graph-level constructs: a node can have a dedicated error output port
- Unhandled errors: bubble up to graph executor; returned in `execution/error` event

### 8.6 Safety Enforcement at Protocol Level

- Type mismatches: rejected at graph-load time with descriptive error
- Missing required error handlers: warning at graph-load time; configurable as hard error
- Cycle detection: DAG mode (cycles rejected) vs. Loop mode (cycles allowed with explicit loop annotations)
- Node versioning: if a loaded node type version is incompatible, load fails with structured error

---

## 9. Engine Language Recommendation

### Recommendation: Rust

**Primary reasons:**

1. **Correctness guarantees:** The borrow checker eliminates data races at compile time — critical for a concurrent node execution engine where multiple actor tasks exchange typed messages. Bugs that would be hard to reproduce in Go (race conditions) simply don't compile in Rust.

2. **Tauri integration:** The engine and UI share a single Rust codebase. Tauri 2.0 provides mature, production-ready IPC between a Rust backend (Tokio runtime) and a web-based frontend. This is the most architecturally clean option: no process boundary between engine and UI shell.

3. **Tokio actor model is a perfect fit:** The `mpsc` channel + `tokio::spawn` actor pattern maps directly to our node execution model. Each node = one Tokio task with a bounded mailbox. Backpressure is native. Structured concurrency with `JoinSet` handles node lifecycle.

4. **Zero-cost streaming:** Tokio streams with no GC pauses. Critical for low-latency LLM token streaming where pauses are user-visible.

5. **Serde + petgraph:** `serde_json` is the best JSON library in any language. `petgraph` provides cycle detection, topological sort, and graph traversal for the execution engine.

6. **`jsonrpsee`:** Native Tokio JSON-RPC library for the protocol layer.

### Secondary Option: Go (if team velocity is the priority)

If the team needs to prototype faster and is less familiar with Rust's ownership model:
- Go's goroutines + channels are an excellent model for node actors
- Temporal's Go SDK provides durable execution out of the box
- LLM code generation quality is higher for Go
- Sacrifice: separate UI process (not Tauri), GC latency, no compile-time race detection

### Against C++

C++ is not recommended for this project:
- No memory safety guarantees; LLM-generated C++ has UB risks
- No modern equivalent of Tauri for UI integration
- Async ecosystem is immature compared to Rust's Tokio
- The build system complexity (CMake, vcpkg) adds friction vs. Cargo

### Summary Table

| Criterion | Rust | Go | C++ |
|-----------|------|-----|-----|
| Memory safety | Compile-time | GC (runtime) | Manual (unsafe) |
| Async model | Tokio (excellent) | Goroutines (excellent) | Coroutines (emerging) |
| Backpressure | Native (bounded channels) | Native (buffered channels) | Manual |
| Tauri / UI integration | Native | Requires separate process | None |
| Graph libraries | petgraph | hashicorp/dag | Boost.Graph |
| JSON-RPC | jsonrpsee | gopkg jsonrpc | nlohmann/json |
| LLM code gen quality | Good (Tier 2) | Excellent (Tier 1) | Good (Tier 1) |
| Compile time | Slow | Fast | Slow |
| GC pauses | None | Yes | None |
| **Recommendation** | **First choice** | Second choice | Not recommended |

---

## Sources

- [Tokio channels tutorial](https://tokio.rs/tokio/tutorial/channels)
- [Actors with Tokio — Alice Ryhl](https://ryhl.io/blog/actors-with-tokio/)
- [Building Async Actor Model in Rust](https://medium.com/@p4524888/leveraging-rusts-tokio-library-for-asynchronous-actor-model-cf6d477afb19)
- [Akka Supervision](https://doc.akka.io/docs/akka/current/general/supervision.html)
- [ActorSink with Backpressure — Akka](https://doc.akka.io/docs/akka/current/stream/operators/ActorSink/actorRefWithBackpressure.html)
- [Reactive Streams JVM Specification](https://github.com/reactive-streams/reactive-streams-jvm)
- [LSP Specification 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [gRPC Core Concepts](https://grpc.io/docs/what-is-grpc/core-concepts/)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [JSON-RPC Best Practices](https://json-rpc.dev/learn/best-practices)
- [Apache Airflow Concepts](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html)
- [Temporal Workflow Execution](https://docs.temporal.io/workflow-execution)
- [Prefect States](https://docs.prefect.io/v3/concepts/states)
- [Dagster Software-Defined Assets](https://dagster.io/blog/software-defined-assets)
- [LangGraph Agent Framework](https://www.langchain.com/langgraph)
- [ComfyUI Workflow JSON Format](https://deepwiki.com/Comfy-Org/ComfyUI/7.3-workflow-json-format)
- [Node-RED Flow Format](https://github.com/node-red/node-red/wiki/Flow-Format)
- [JSON Graph Format Specification](https://jsongraphformat.info/)
- [Rust vs Go 2025 — JetBrains](https://blog.jetbrains.com/rust/2025/06/12/rust-vs-go/)
- [Tauri Architecture](https://v2.tauri.app/concept/architecture/)
- [CppCon 2023: Taro Task-Graph C++ Coroutines](https://isocpp.org/blog/2023/09/cppcon-2023-taro-task-graph-based-asynchronous-programming-using-cpp-corout)
- [Erlang OTP Design Principles](https://www.erlang.org/doc/system/design_principles.html)
