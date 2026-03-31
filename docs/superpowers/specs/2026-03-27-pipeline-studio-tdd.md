# Pipeline Studio -- Technical Design Document

**Date:** 2026-03-27
**Version:** 1.0

This document is normative for behavior, data contracts, and runtime rules. The vision document defines product intent and scope. The implementation plan defines sequencing, ownership, and phase gates.

---

## 1. Protocol Specification

### 1.1 Message Format

All communication uses JSON-RPC 2.0. Every message includes `"jsonrpc": "2.0"`.

**Request** (expects a response):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "graph/load",
  "params": { "graphId": "abc-123", "graph": { ... } }
}
```

**Response** (success):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "graphId": "abc-123", "nodeCount": 12, "valid": true }
}
```

**Response** (error):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": { "code": -33001, "message": "Type mismatch", "data": { "nodeId": "n4", "portId": "input_count", "expected": "number", "actual": "text" } }
}
```

**Notification** (no response expected, no `id` field):
```json
{
  "jsonrpc": "2.0",
  "method": "execution/event",
  "params": { "type": "node/started", "executionId": "exec-1", "nodeId": "n4" }
}
```

### 1.2 Transport

The request/response/event schemas in this document are transport-independent. v1 standardizes two concrete transport shapes:

| Transport Shape | Use Case | Framing |
|---|---|---|
| **Embedded desktop bridge** | Tauri desktop app with the engine linked in-process | Tauri commands/events carrying the same request/response/event payload shapes defined here |
| **stdio** | CLI runner, local headless clients, MCP host mode | Newline-delimited JSON (one message per line) |

The headless engine selects `stdio` in v1. Streamable HTTP is reserved by the transport-independent schema design but is explicitly deferred from the v1 implementation plan. The desktop app does not treat Tauri as a raw stdio transport.

### 1.2a Protocol Choice Rationale

We evaluated five protocol alternatives against Pipeline Studio's requirements. JSON-RPC 2.0 is the clear choice.

**Why not gRPC / Protocol Buffers:** gRPC requires HTTP/2, which Tauri's IPC bridge does not expose. Using gRPC would require running a localhost gRPC server inside the Tauri process (adding an attack surface and firewall issues), or abandoning Tauri IPC entirely. Additionally, gRPC's binary wire format is unreadable by LLMs, and MCP uses JSON-RPC 2.0, meaning gRPC would require a translation layer for the embedded MCP server.

**Why not binary formats (Cap'n Proto, FlatBuffers, MessagePack):** All binary formats lose LLM readability -- LLMs cannot inspect, generate, or modify binary graph schemas. Tauri's IPC is JSON-native; binary payloads require base64 encoding over the IPC bridge, negating size advantages. MessagePack additionally has no standard JSON-RPC mapping, putting the system off-spec for MCP compatibility.

**Why JSON-RPC 2.0 wins:**
- **MCP compatibility:** MCP IS JSON-RPC 2.0. The engine and embedded MCP server share a single protocol implementation with no translation layer.
- **Tauri schema reuse:** Tauri's `invoke`/`emit` bridge uses `serde_json` natively, so the same request/response/event payloads can be reused without inventing a second data model.
- **LLM readability:** Graph schemas, node configs, and execution events are all readable and writable by LLMs without a decode step.
- **Performance is sufficient:** At 100 concurrent nodes streaming at 10-50 tokens/second, the system processes 1,000-5,000 events/second. `serde_json` handles millions of small objects per second. The bottleneck is LLM API latency (50-200ms per token), not serialization (microseconds).
- **IPC optimization:** Event batching at the Rust/Tauri boundary (flush every 16ms, see Section 5.9) reduces IPC call frequency by 10-50x, addressing the only real performance concern (per-call IPC overhead).

### 1.3 Graph Schema

A graph is a JSON object with this structure:

```json
{
  "version": "0.1.0",
  "id": "graph-uuid",
  "revision": 1,
  "name": "UI Research Pipeline",
  "metadata": {
    "author": "user",
    "created": "2026-03-27T10:00:00Z",
    "description": "Research and generate CSS for a component library"
  },
  "nodes": {
    "node-uuid-1": {
      "type": "llm",
      "label": "Research Components",
      "config": {
        "backend": "claude-cli",
        "model": "claude-opus-4-6",
        "systemPrompt": "Research the shadcn/ui library...",
        "maxBudgetUsd": 2.00
      },
      "position": { "x": 100, "y": 200 },
      "ports": {
        "inputs": {
          "prompt": { "type": "text", "required": true },
          "exec_in": { "type": "exec" }
        },
        "outputs": {
          "response": { "type": "text" },
          "error": { "type": "error" },
          "exec_out": { "type": "exec" }
        }
      }
    }
  },
  "connections": [
    {
      "id": "conn-uuid-1",
      "source": { "node": "node-uuid-1", "port": "response" },
      "target": { "node": "node-uuid-2", "port": "context" },
      "wireType": "data"
    },
    {
      "id": "conn-uuid-2",
      "source": { "node": "node-uuid-1", "port": "exec_out" },
      "target": { "node": "node-uuid-2", "port": "exec_in" },
      "wireType": "exec"
    }
  ],
  "functions": {
    "func-uuid-1": {
      "name": "ResearchAndSummarize",
      "graph": { "...nested graph with same schema..." },
      "inputPorts": { "topic": { "type": "text" } },
      "outputPorts": { "summary": { "type": "text" } }
    }
  }
}
```

Key design decisions:
- **Named ports** (not index-based) -- `"port": "response"`, not `"port": 0`. Renaming a node's internal implementation doesn't break existing graphs.
- **UUIDs for nodes and connections** -- stable identifiers that survive copy-paste and graph merging.
- **Position is metadata** -- stored for the editor but not required for execution.
- **Functions are embedded** -- a function's inner graph uses the same schema recursively.

### 1.4 Type System

#### Core Types

| Type | Description | Wire Color | Example Values |
|---|---|---|---|
| `text` | UTF-8 string | Purple | `"Hello world"`, LLM responses |
| `number` | 64-bit float | Blue | `42`, `3.14`, `-1` |
| `boolean` | True/false | Green | `true`, `false` |
| `json` | Arbitrary JSON value (object, array, or primitive) | Orange | `{"key": "value"}`, `[1, 2, 3]` |
| `binary` | Raw bytes with optional MIME type | Dark gray | File contents, encoded data |
| `image` | Image data with format metadata (PNG, JPEG, SVG) | Pink | Rendered screenshots, generated images |
| `error` | Structured error: `{code, message, nodeId?, portId?, data?}` | Red | Timeout errors, parse failures |
| `exec` | Execution signal (control flow, carries no data value) | White/Gray | Sequencing between action nodes |
| `any` | Wildcard -- resolves to the type of the first connected port | Dashed outline | Generic utility nodes (log, format, passthrough) |

#### Composite Types

| Type | Syntax | Description |
|---|---|---|
| `list<T>` | `{ "type": "list", "element": "text" }` | Ordered collection of elements of type T |
| `optional<T>` | `{ "type": "optional", "inner": "number" }` | Value of type T or absent |
| `stream<T>` | `{ "type": "stream", "element": "text" }` | Incremental delivery of T values (LLM token streaming) |
| `struct` | `{ "type": "struct", "fields": {"name": "text", "count": "number"} }` | Named bundle of typed fields |

Struct fields can be composite types. For example, a struct with a list field:
```json
{
  "type": "struct",
  "fields": {
    "title": "text",
    "tags": { "type": "list", "element": "text" },
    "metadata": { "type": "optional", "inner": "json" }
  }
}
```
Primitive type fields use a string shorthand (`"text"`); composite type fields use the full object syntax.

#### Branch Not Taken

In v1, "branch not taken" is modeled as scheduler state, not as a typed data value. When a Router or Sequence does not activate a branch, nodes reachable only through that exec path enter `Skipped` state and emit `node/skipped`. Exec wires never carry data values.

#### Type Checking Rules

This section is a summary. Section 4.3 is the complete compatibility matrix and overrides any incomplete examples here.

1. **Exact match**: `text` output connects to `text` input. Always allowed.
2. **Allowed coercions are explicit, not inferred**: examples include `number -> text`, `boolean -> text`, and `stream<T> -> T`. The full list is in Section 4.3.
3. **Wildcard resolution**: When a port typed `any` connects to a concrete port, the wildcard resolves to that concrete type. When all connections are removed, it reverts to `any`. Resolution propagates to other co-resolving `any` ports on the same node.
4. **Container types do not element-coerce implicitly**: `list<text>` connects to `list<text>`, not to `list<number>`.
5. **Struct field access requires an explicit field selector on the connection.**
6. **Exec is separate**: `exec` ports only connect to `exec` ports. Data ports only connect to data ports. The two categories never mix.

### 1.5 Safety Rules (Protocol Level)

These rules are enforced before any node executes:

1. **No unresolved wildcards.** Every `any`-typed port must resolve to a concrete type before execution. Unresolved wildcards produce a validation error.
2. **No unconnected required ports.** Every required data port must have at least one incoming connection or a default value. Every action node must either have an incoming exec connection or qualify as a root action node (no incoming exec wire, therefore eligible for an implicit start signal).
3. **No unintended cycles.** Cycles are rejected by default. Cycles are only permitted through nodes explicitly marked as loop boundaries (`ForLoop`, `ForEachLoop`, `WhileLoop`). Unintended cycles produce a validation error identifying the cycle path.
4. **No implicit exec reconvergence.** v1 exec branches may only rejoin through designated control-boundary nodes (loop completion, function return, or graph terminal). Shared downstream exec targets after a split are rejected unless the boundary is explicit.
5. **Every LLM node must have an effective budget.** The node must resolve a budget either from its own config or from project defaults. Missing effective budget is a validation error in v1.
6. **Error ports are opt-in, but unhandled errors are visible.** If a node has no error port connected, a runtime failure in that node aborts the execution with a structured error surfaced in the error panel. There is no silent failure.

### 1.6 Lifecycle Messages

```
Client → Engine: initialize { protocolVersion: "0.1.0", capabilities: { ... } }
Engine → Client: initialize/result { protocolVersion: "0.1.0", capabilities: { ... }, engineVersion: "0.1.0" }
Client → Engine: initialized (notification -- client is ready)

--- Normal operation ---

Client → Engine: graph/get { graphId }
Engine → Client: graph/get/result { graphId, graph, graphRevision }

Client → Engine: graph/load { graphId, graph, baseRevision? }
Engine → Client: graph/load/result { graphId, graphRevision, valid, errors[] }

Client → Engine: graph/create_node { graphId, baseRevision, type, label, config, position }
Engine → Client: graph/create_node/result { graphRevision, nodeId }

Client → Engine: graph/delete_node { graphId, baseRevision, nodeId }
Engine → Client: graph/delete_node/result { graphRevision, success: true }

Client → Engine: graph/connect { graphId, baseRevision, sourceNode, sourcePort, targetNode, targetPort }
Engine → Client: graph/connect/result { graphRevision, connectionId }

Client → Engine: graph/disconnect { graphId, baseRevision, connectionId }
Engine → Client: graph/disconnect/result { graphRevision, success: true }

Client → Engine: graph/set_config { graphId, baseRevision, nodeId, config }
Engine → Client: graph/set_config/result { graphRevision, success: true }

Client → Engine: graph/copy_nodes { graphId, baseRevision, nodeIds[], offset }
Engine → Client: graph/copy_nodes/result { graphRevision, newNodeIds[] }

Client → Engine: graph/extract_function { graphId, baseRevision, name, nodeIds[] }
Engine → Client: graph/extract_function/result { graphRevision, functionId }

Engine → Client: graph/changed { graphId, graphRevision, source }

Client → Engine: graph/validate_connection { graphId, sourceNode, sourcePort, targetNode, targetPort }
Engine → Client: graph/validate_connection/result { valid, error? }

Client → Engine: execution/start { graphId, inputs }
Engine → Client: execution/start/result { executionId }
Engine → Client: execution/event (notification stream -- see §1.7)

Client → Engine: execution/cancel { executionId }
Engine → Client: execution/cancel/result { success: true }
Engine → Client: execution/event { type: "execution/cancelled" }

Client → Engine: human/respond { executionId, nodeId, response }

--- Shutdown ---

Client → Engine: shutdown
Engine → Client: shutdown/result {}
Client → Engine: exit (notification -- engine process exits)
```

### 1.6a Draft Graph Authority and Revision Rules

- Within a single engine process, the engine owns authoritative draft graph state for each `graphId`.
- The editor and MCP host both mutate that draft graph through the same canonical `graph/*` mutation methods. Undo/redo replays those mutations; it does not bypass them.
- Every mutating request carries `baseRevision`. On success, the engine increments `graphRevision`, returns the new value, and emits `graph/changed`.
- If `baseRevision` is stale, the engine rejects the mutation with a graph-conflict error. The caller must refresh via `graph/get` and retry intentionally.
- v1 does not support live multi-process co-editing of the same draft graph. The desktop app and the headless MCP host are separate deployment modes. Cross-process coordination happens through saved project files, not a shared in-memory draft.

### 1.7 Execution Event Stream

During execution, the engine emits a stream of typed notifications:

| Event Type | Fields | Description |
|---|---|---|
| `node/started` | `executionId`, `nodeId`, `timestamp` | Node began execution |
| `node/output/partial` | `executionId`, `nodeId`, `portId`, `chunk` | Streaming token/chunk from an LLM node |
| `node/output/final` | `executionId`, `nodeId`, `portId`, `value`, `cached` | Completed output for this port. `cached: true` if served from cache. |
| `node/error` | `executionId`, `nodeId`, `error` | Node produced an error (structured error object) |
| `node/skipped` | `executionId`, `nodeId`, `reason` | Node's actor did not run. `reason: "branch_not_taken"` means no outputs are routed. `reason: "cached"` means cached outputs are routed without actor execution. |
| `node/completed` | `executionId`, `nodeId`, `timestamp`, `durationMs` | Node finished all outputs |
| `loop/iteration` | `executionId`, `nodeId`, `iteration`, `inputs`, `outputs` | One loop iteration completed (for iteration history UI) |
| `human/prompt` | `executionId`, `nodeId`, `prompt`, `context`, `timeoutMs` | Engine requests human input (HITL node) |
| `execution/completed` | `executionId`, `outputs`, `totalCostUsd`, `durationMs` | Entire graph execution finished successfully |
| `execution/error` | `executionId`, `error` | Execution failed (unhandled node error or validation failure) |
| `execution/cancelled` | `executionId` | Execution was cancelled by client request |

### 1.8 Cancellation

Any in-flight execution can be cancelled by sending `execution/cancel { executionId }`. The engine:
1. Sets the execution's `CancellationToken`
2. All running node tasks check the token and exit gracefully
3. Running CLI processes receive SIGTERM (Unix) or are killed (Windows)
4. A `execution/cancelled` event is emitted
5. Cache entries produced by completed cache-eligible nodes may be preserved. Nodes with side effects or interrupted writes do not become cache candidates.

### 1.9 Structured Errors

Error codes are partitioned into ranges:

| Range | Category | Examples |
|---|---|---|
| -32700 to -32600 | JSON-RPC protocol errors | Parse error, invalid request, method not found |
| -33000 to -33099 | Graph validation errors | Type mismatch, unresolved wildcard, missing required port, unintended cycle |
| -34000 to -34099 | Node execution errors | LLM timeout, process crash, rate limit, cost budget exceeded |
| -35000 to -35099 | Engine errors | Internal scheduler failure, channel closed unexpectedly |

Every error object includes:
- `code` (integer): Machine-readable error category
- `message` (string): Human-readable description
- `nodeId` (string, optional): The node that caused the error
- `portId` (string, optional): The specific port involved
- `data` (any, optional): Additional structured context (e.g., expected type vs. actual type)

---

## 2. Engine Architecture

### 2.1 Technology Stack

- **Language:** Rust
- **Async runtime:** Tokio (multi-threaded)
- **Graph library:** petgraph (topological sort, cycle detection via Tarjan's SCC)
- **Serialization:** serde + serde_json
- **JSON-RPC:** jsonrpsee (Tokio-native)
- **MCP SDK:** rust-mcp-sdk or official modelcontextprotocol/rust-sdk
- **Process management:** tokio::process::Command

### 2.2 Actor Model

Each node in a running graph is an independent Tokio task (an "actor"). Nodes communicate exclusively through bounded `mpsc` channels -- there is no shared mutable state between nodes.

The pattern follows Alice Ryhl's canonical Tokio actor design:

- **Actor struct:** Owns the node's state and a `mpsc::Receiver` for incoming messages.
- **ActorHandle struct:** Owns a `mpsc::Sender`, is `Clone`, and provides the API for the scheduler to send inputs and commands to the node.
- **Lifecycle:** `ActorHandle::new()` calls `tokio::spawn(actor.run())`. The actor runs an event loop: receive message, process it, send outputs. When all handles are dropped, the sender drops, `receiver.recv()` returns `None`, and the actor exits cleanly.
- **Request-response:** For synchronous queries (e.g., "get current state"), embed a `oneshot::Sender` inside the message enum. The actor sends the response back through the oneshot.

**Channel types used:**

| Channel | Use |
|---|---|
| Bounded `mpsc` | Node mailbox (inputs from upstream). Capacity configurable per connection, default 32. Backpressure: a fast producer blocks on `send()` when the buffer is full. |
| Unbounded `mpsc` | Engine control messages (cancel, shutdown). These must never block. |
| `oneshot` | Request-response within actors (e.g., "report your current state"). |
| `broadcast` | Execution event fan-out to multiple subscribers (UI, logger, MCP server). |

**Deadlock prevention:** Bounded channels can deadlock if two actors await each other's `send()` simultaneously. This is prevented by the DAG constraint: data flows one direction. Loops are handled specially (see Section 7).

### 2.3 Scheduler

The scheduler is the engine's main loop. It manages the lifecycle of all node actors for a single graph execution.

**Execution snapshot rule:** `execution/start` always compiles a frozen execution snapshot from the current graph revision. That snapshot is immutable for the lifetime of the run. Editor and MCP edits may change the draft graph or a future run, but they do not mutate the active snapshot in v1.

**Control-flow boundary rule:** v1 uses exec-only control flow and explicit boundary nodes. Router and Sequence branches may not reconverge implicitly. A branch/body region ends only at one of these boundaries:
- the completion port of the owning loop node
- the designated return boundary of a function
- a terminal node with no outgoing exec wires

This constraint keeps branch completion, cancellation, and loop iteration ownership deterministic in v1.

**Algorithm:**

1. **Region compilation.** On `execution/start`, the engine compiles the frozen execution snapshot into a scheduler region DAG. Loop bodies and function bodies are represented as owned regions whose internal re-entry and return behavior is handled by the owning boundary node.

2. **Topological sort over the region DAG.** The scheduler runs `petgraph::algo::toposort()` over the region DAG, not over the raw graph with permitted loop cycles. Nodes or regions at the same topological level can run in parallel.

3. **Ready queue.** A node becomes "ready" when all its required data ports have received values and its exec precondition has been satisfied. For root action nodes, that exec precondition is the implicit start signal injected at run start. The scheduler maintains a ready queue and spawns actors for ready nodes immediately.

4. **Parallel execution.** Ready nodes are spawned into a `tokio::task::JoinSet`. The scheduler `select!`s between: (a) a node completing and producing outputs, (b) a cancellation signal, (c) a new node becoming ready. This enables maximum parallelism within dependency constraints.

5. **Output routing.** When a node completes, the scheduler reads its output values, identifies all downstream connections, and sends the values to the downstream nodes' mailbox channels. If a downstream node's inputs are now all satisfied, it moves to the ready queue.

6. **Owned-region completion.** Loop and function boundary nodes interpret their owned-region terminal signals according to their node contracts (`completed`, `break`, or designated function return) before routing a single outer completion signal.

7. **Completion.** When all nodes have completed, failed, or entered skipped state, the scheduler emits `execution/completed` with the final outputs from terminal nodes.

### 2.4 Node State Machine

Every node has a lifecycle state:

```
                     ┌─────────┐
                     │ Pending │  (initial state -- waiting for inputs)
                     └────┬────┘
                          │ all required inputs received
                          ▼
                     ┌─────────┐
                     │  Ready  │  (inputs satisfied, waiting for scheduler)
                     └────┬────┘
                          │ scheduler spawns actor
                          ▼
                     ┌─────────┐
                     │ Running │  (actor is executing)
                     └────┬────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        ┌───────────┐ ┌────────┐ ┌─────────┐
        │ Completed │ │ Failed │ │ Skipped │
        └───────────┘ └────────┘ └─────────┘
```

- **Pending:** The node is waiting for upstream nodes to provide its inputs.
- **Ready:** All required inputs are available. The node is in the scheduler's ready queue.
- **Running:** The node's actor task is executing. During this state, the node may emit `node/output/partial` events (streaming tokens).
- **Completed:** The node has produced all its output values. Outputs are stored in the execution context and routed to downstream nodes.
- **Failed:** The node produced an error. If the node has a connected error port, the error value flows downstream. If not, the execution fails.
- **Skipped:** The node's actor did not run. If `reason = "branch_not_taken"`, the node does not emit data outputs. If `reason = "cached"`, cached outputs are routed without actor execution.

State transitions are emitted as protocol events (`node/started` for Pending->Running, `node/completed` for Running->Completed, etc.).

### 2.5 Incremental Caching

Cross-run caching is intentionally narrow in v1. Only cache-eligible read-only nodes participate in the in-memory session cache.

**Cache eligibility defaults:**
- LLM nodes with `sandboxPolicy: "read-only"` are cache-eligible by default.
- LLM nodes with `workspace-write` or `full-access` are not cache-eligible.
- Human-in-the-Loop nodes are not cache-eligible.
- Router, Sequence, Function boundary, and loop coordinator nodes are inexpensive and are not persisted in the cross-run cache.

The cache key for an eligible node is `(node_id, hash(resolved_inputs, stable_node_config, backend_id, backend_version, model_id, declared_env_refs, workspace_root_digest, graph_mcp_config_digest))`. When an eligible node is about to execute:

1. Compute the cache key from the node's resolved inputs and configuration.
2. Look up the key in the cache (an in-memory LRU map, default capacity 1024 entries).
3. **Cache hit:** Skip execution. Emit `node/skipped` with `reason: "cached"`. Route cached outputs to downstream nodes. Emit `node/output/final` with `cached: true`.
4. **Cache miss:** Execute the node normally. On successful completion, store the output values in the cache under the computed key.

The cache uses an LRU eviction strategy. Entries are evicted oldest-first when the cache is full. The cache lives only in memory for the current engine session; engine restart starts with a cold cache.

**What invalidates cache:** Any change to a node's resolved inputs, stable config, backend version, declared environment-variable references, workspace root, graph-level MCP configuration, or cache policy. Changing a node's position on the canvas does NOT invalidate cache (position is metadata, not a functional input). Any interrupted or cancelled write-capable node marks the run dirty and does not create reusable cache entries.

### 2.6 Pure vs. Action Nodes

| Property | Pure Node | Action Node |
|---|---|---|
| Execution trigger | On-demand: evaluated when a downstream consumer reads the output | Scheduled: runs when its exec precondition is satisfied |
| Exec ports | None | Has input and output exec ports |
| Side effects | None (deterministic output from inputs) | May have side effects (LLM calls, file writes) |
| Caching | Memoized within a single execution frame (evaluated once even if consumed by multiple downstream nodes) | Cross-run caching only when the node is cache-eligible (Section 2.5) |
| Examples | Format text, parse JSON, math operations, string concatenation | LLM Node, Router, Human-in-the-Loop, file operations |

The scheduler treats pure nodes as lazy expressions. They are not placed in the ready queue; instead, when an action node needs a pure node's output, the scheduler evaluates the pure node on the spot and memoizes the result in the execution context. Action nodes always expose exec ports; if an action node has no incoming exec connection, it is treated as a root action node and receives the synthetic start signal defined above.

**v1 scope:** The engine implements the pure/action distinction in the scheduler (the capability), but v1 ships no built-in pure node types. All v1 built-in nodes (Section 3) are action nodes with exec ports. Built-in pure nodes (format text, parse JSON, math operations, string concatenation) are planned for v2 alongside the function library ecosystem. In v1, users achieve the same results by wiring data directly between action nodes or using LLM nodes for text transformation.

### 2.7 Performance Optimizations

These optimizations are included in v1. They are cross-platform, low-risk, and address the primary hot paths identified through analysis.

**Buffered child process I/O.** All CLI adapter `ChildStdout` streams are wrapped in `BufReader::with_capacity(256 * 1024, stdout)`. A single `read()` syscall fills the 256 KB buffer; subsequent JSONL line parsing reads from the buffer without further syscalls. This reduces read syscalls by 10-50x for streaming LLM output.

**Zero-copy streaming with bytes::Bytes.** Streaming event payloads (LLM token chunks) use `bytes::Bytes` instead of `String` when broadcasting to multiple consumers. `Bytes` is reference-counted (`Arc`-backed); cloning it to send to downstream nodes AND the UI event stream costs one atomic increment, not a heap allocation. The adapter reads into a `BytesMut` accumulator and calls `freeze()` before broadcast.

**jemalloc allocator (Linux/macOS).** The engine uses `jemalloc` as the global allocator on Linux and macOS (not Windows MSVC, where it is unavailable). 100+ concurrent Tokio tasks each allocating small messages creates allocator contention. jemalloc's per-thread arenas reduce lock contention, providing 10-30% allocation throughput improvement.

```rust
#[cfg(not(target_env = "msvc"))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;
```

**SIMD-accelerated JSON for large payloads.** Graph JSON files (potentially 1-5 MB for large graphs) are parsed with `simd-json` instead of `serde_json`. `simd-json` uses SSE4.2/AVX2 SIMD instructions for 2-3x faster parsing of large payloads. It has a `serde` compatibility layer. For small event payloads (< 200 bytes), standard `serde_json` is used (SIMD setup cost exceeds benefit for tiny messages).

**IPC event batching.** See Section 5.9. Partial streaming events are batched at the Tauri IPC boundary (16ms flush interval) to reduce IPC call frequency by 10-50x.

**Linux pipe buffer sizing.** On Linux, the default pipe buffer is 64 KB. For high-throughput CLI adapters, the engine increases the pipe buffer to 1 MB via `fcntl(F_SETPIPE_SZ)`. This prevents LLM CLI tools from stalling on write when the consumer is temporarily busy processing a batch. Applied behind `#[cfg(target_os = "linux")]`.

---

## 3. Node Type Specifications

### 3.1 LLM Node

The LLM Node calls a language model and returns its response.

**Inputs:**
| Port | Type | Required | Description |
|---|---|---|---|
| `exec_in` | exec | Yes | Execution trigger |
| `prompt` | text | Yes | The user prompt to send to the model |
| `systemPrompt` | text | No | Override the system prompt from node config |
| `context` | text | No | Additional context appended to the prompt |

**Outputs:**
| Port | Type | Description |
|---|---|---|
| `exec_out` | exec | Fires when the LLM call completes |
| `response` | text | The complete LLM response text |
| `stream` | stream\<text\> | Token-by-token streaming output (for UI display) |
| `usage` | json | Token counts and cost information |
| `error` | error | Error output (rate limit, timeout, budget exceeded) |

**Configuration:**
| Field | Type | Default | Description |
|---|---|---|---|
| `backend` | enum | `"claude-cli"` | `"claude-cli"`, `"gemini-cli"`, `"codex-cli"`, or `"openrouter"` |
| `model` | text | `"claude-sonnet-4-6"` | Model identifier |
| `temperature` | number | `0.7` | Sampling temperature |
| `maxTokens` | number | `4096` | Maximum response tokens |
| `maxBudgetUsd` | number | `inherit` | Cost cap for this node. Inherits the project default when omitted. |
| `timeoutSecs` | number | `300` | Maximum execution time before timeout error |
| `cachePolicy` | enum | `"default"` | `"default"` or `"disabled"`. `default` only enables cross-run caching for cache-eligible read-only nodes. |
| `bare` | boolean | `true` | Skip CLAUDE.md, hooks, plugins (CLI only) |
| `sandboxPolicy` | enum | `"read-only"` | `"read-only"`, `"workspace-write"`, `"full-access"` (generic studio policies translated to backend-native flags by the compatibility matrix) |

**Backend auto-detection:** At engine startup, the engine probes for installed CLI tools by running `claude --version`, `gemini --version`, and `codex --version`. It separately checks whether the OpenRouter credential reference resolves at runtime. The results are reported in the `initialize` response's capabilities. The UI uses this to show available backends in the node config panel. Unavailable backends are grayed out with install or credential guidance.

**Behavior:**
1. On `exec_in`, the node constructs the LLM request from `prompt`, `systemPrompt`, `context`, and config.
2. For `claude-cli` backend: spawns the version-pinned CLI invocation from the adapter compatibility matrix, reads JSONL from stdout, and maps assistant output to `Token`/`Done`.
3. For `gemini-cli` backend: spawns the version-pinned CLI invocation from the adapter compatibility matrix, reads JSONL from stdout, and maps streaming/result/error events to `Token`/`Done`/`Error`.
4. For `codex-cli` backend: spawns the version-pinned CLI invocation from the adapter compatibility matrix, reads JSONL from stdout, and maps assistant output to `Token`/`Done`/`Error`. Non-interactive approval requests fail fast.
5. For `openrouter` backend: sends HTTP POST to `/api/v1/chat/completions` with `stream: true`, parses SSE `data:` lines, and maps streaming chunks to `node/output/partial` events.
6. On completion: emits `response` (full text), `usage` (token counts), and fires `exec_out`.
7. On error: emits error to the `error` port. If error port is not connected, the error propagates to `execution/error`.
8. In v1, the engine treats LLM adapters as prompt-in/text-out sessions. Backend-native tool use may occur internally to a CLI/backend if the backend manages that loop itself, but the engine does not broker mid-run tool-result roundtrips.

### 3.2 Router Node

The Router Node inspects input data and selects which downstream branch to activate.

**Inputs:**
| Port | Type | Required | Description |
|---|---|---|---|
| `exec_in` | exec | Yes | Execution trigger |
| `value` | any | Yes | The value to evaluate for routing |

**Outputs:**
| Port | Type | Description |
|---|---|---|
| `branch_0` through `branch_N` | exec | One exec output per configured branch |
| `default` | exec | Fires if no condition matches |
| `selected` | text | The name of the selected branch (for debugging) |

**Configuration:**
| Field | Type | Description |
|---|---|---|
| `mode` | enum | `"condition"` (declarative rules). Expression mode deferred to v2. |
| `conditions` | list | Array of `{ branch: "branch_0", operator: "equals"|"contains"|"regex"|"greater_than"|"less_than"|"is_true"|"is_false"|"is_empty", operand: <value> }` |

**Supported condition operators:**
| Operator | Input Type | Description |
|---|---|---|
| `equals` | any | Exact value match (string comparison for text, numeric for number) |
| `contains` | text | Substring match |
| `regex` | text | Regular expression match |
| `greater_than` | number | Numeric comparison |
| `less_than` | number | Numeric comparison |
| `is_true` | boolean | Value is true |
| `is_false` | boolean | Value is false |
| `is_empty` | text, list | Empty string or empty list |

**v2 scope:** Expression mode (an embedded expression evaluator like Rhai or a custom DSL) is deferred to v2. Condition mode covers the common routing patterns. For complex routing logic that conditions cannot express, users can wire an LLM Node upstream to produce a branch name, then route on the LLM's text output using `equals`.

**Behavior:**
1. On `exec_in`, reads the `value` input.
2. Evaluates conditions in order (first match wins). If no condition matches, fires `default`.
3. Fires the selected branch's exec output. Non-selected branches are marked skipped at the scheduler level.
4. Emits `selected` with the branch name for debugging visibility.

### 3.3 Sequence Node

The Sequence Node fires multiple output branches in order, waiting for each to complete before starting the next.

**Inputs:**
| Port | Type | Required | Description |
|---|---|---|---|
| `exec_in` | exec | Yes | Execution trigger |

**Outputs:**
| Port | Type | Description |
|---|---|---|
| `then_0` through `then_N` | exec | Ordered output branches (configurable count, default 2) |

**Configuration:**
| Field | Type | Description |
|---|---|---|
| `branchCount` | number | Number of sequential output branches (default: 2) |

**Behavior:**
1. On `exec_in`, fires `then_0` and waits for the explicit control-flow region owned by `then_0` to complete.
2. Fires `then_1` and waits for its owned region to complete.
3. Repeats for all branches in order.

This is the fundamental "do A, then B, then C" primitive.

### 3.4 Human-in-the-Loop Node

The HITL Node pauses execution and requests human input.

**Inputs:**
| Port | Type | Required | Description |
|---|---|---|---|
| `exec_in` | exec | Yes | Execution trigger |
| `prompt` | text | Yes | The question or context shown to the human |
| `context` | any | No | Additional data displayed alongside the prompt |

**Outputs:**
| Port | Type | Description |
|---|---|---|
| `exec_out` | exec | Fires when human responds |
| `response` | text | The human's text response |
| `timed_out` | exec | Fires if the timeout expires without a response |
| `error` | error | Error output |

**Configuration:**
| Field | Type | Default | Description |
|---|---|---|---|
| `timeoutSecs` | number | `300` | Seconds to wait before timeout |
| `timeoutAction` | enum | `"error"` | `"error"` (fail), `"continue"` (fire `timed_out` exec), or `"cancel"` (cancel execution) |

**Behavior:**
1. On `exec_in`, emits a `human/prompt` protocol event with the prompt text and context.
2. The UI displays the prompt to the user with a text input field.
3. The node actor suspends (but does not block other concurrent branches).
4. When the user submits via `human/respond`, the node receives the response, emits it on the `response` port, and fires `exec_out`.
5. If timeout expires: applies the configured `timeoutAction`.

**v1 scope:** Text prompt and text response only. No form rendering, no multi-user approval.

### 3.5 ForLoop Node

Iterates over an integer range.

**Inputs:**
| Port | Type | Required | Description |
|---|---|---|---|
| `exec_in` | exec | Yes | Execution trigger |
| `first` | number | Yes | Start index (inclusive) |
| `last` | number | Yes | End index (inclusive) |

**Outputs:**
| Port | Type | Description |
|---|---|---|
| `body` | exec | Fires once per iteration |
| `index` | number | Current iteration index |
| `completed` | exec | Fires after all iterations complete |

**Behavior:**
1. For `i` from `first` to `last` (inclusive): set `index` to `i`, fire `body`, wait for the body subgraph to complete, yield to the Tokio runtime (allowing other tasks to progress).
2. After the last iteration, fire `completed`.
3. Each iteration's inputs and outputs are recorded for the iteration history UI (emitted as `loop/iteration` events).

### 3.6 ForEachLoop Node

Iterates over a list.

**Inputs:**
| Port | Type | Required | Description |
|---|---|---|---|
| `exec_in` | exec | Yes | Execution trigger |
| `list` | list\<any\> | Yes | The list to iterate over |

**Outputs:**
| Port | Type | Description |
|---|---|---|
| `body` | exec | Fires once per element |
| `element` | any | Current element (type resolves from list element type) |
| `index` | number | Current index |
| `completed` | exec | Fires after all elements processed |

**Behavior:** Same as ForLoop but iterates over list elements. The `element` port's type resolves to match the list's element type via wildcard resolution.

### 3.7 WhileLoop Node

Repeats while a condition is true.

**Inputs:**
| Port | Type | Required | Description |
|---|---|---|---|
| `exec_in` | exec | Yes | Execution trigger |
| `condition` | boolean | No | Re-evaluated before each iteration. If unconnected, the loop defaults to `true` and relies on `Break` or `maxIterations` to terminate. |

**Outputs:**
| Port | Type | Description |
|---|---|---|
| `body` | exec | Fires each iteration |
| `iteration` | number | Current iteration count (0-based) |
| `completed` | exec | Fires when condition becomes false |

**Configuration:**
| Field | Type | Default | Description |
|---|---|---|---|
| `maxIterations` | number | `100` | Safety cap to prevent infinite loops |

**Behavior:**
1. Resolve the first-iteration condition:
   - If `condition` is unconnected, treat it as `true`.
   - If `condition` is connected from outside the loop body, read that upstream value.
   - If `condition` is connected from inside the loop body, use the port default for iteration 0. Missing default in that case is a build-time validation error.
2. If the resolved condition is false, fire `completed` immediately.
3. If true: fire `body`, wait for the owned loop-body region to complete, increment iteration counter, yield to runtime, then re-evaluate `condition`.
4. If `maxIterations` is reached, fire `completed` (not an error -- the cap is a safety feature, not a failure).

**Condition re-evaluation mechanism:** The `condition` port participates in a permitted data cycle through the loop boundary. A typical pattern: a node inside the loop body (e.g., a quality checker) produces a boolean output that wires back to the WhileLoop's `condition` input. The scheduler handles this as follows:

1. Before the first iteration, the `condition` port reads from its upstream connection as normal (the initial value).
2. After each iteration, the loop node re-pulls the `condition` value. If the upstream node for that port is inside the loop body (a data cycle), the scheduler uses the value the body node produced during the just-completed iteration.
3. If the upstream node for `condition` is outside the loop body (no cycle), the condition value never changes and the loop either runs `maxIterations` times or zero times. This is valid but typically a user error -- build-time validation emits a warning: "WhileLoop condition is not connected to a node inside the loop body; the condition will never change."

This re-pull mechanism applies only to loop boundary nodes. Non-loop nodes never re-read their inputs after initial evaluation.

**Canonical retry-until-approved pattern:** In v1, the flagship approval loop uses a WhileLoop with the `condition` port left unconnected (implicit `true`). A Router inside the body sends `approved` to a Break node and `retry` to the end of the body region. This avoids inventing an undeclared boolean-conversion node in v1.

### 3.8 Break Node

Terminates the innermost enclosing loop.

**Inputs:**
| Port | Type | Required | Description |
|---|---|---|---|
| `exec_in` | exec | Yes | Execution trigger |

**Outputs:** None (the Break node terminates the loop; execution continues from the loop's `completed` output).

**Behavior:** Sends a break signal to the enclosing loop node's actor. The loop stops iterating and fires its `completed` output. If there is no enclosing loop, this is a validation error caught at build-time.

### 3.9 Function Node

Executes a function subgraph.

**Inputs/Outputs:** Defined by the function's declared input and output ports (variable per function).

**Behavior:**
1. Creates a child execution context (inherits the parent's cancellation token and cost tracking).
2. Maps the Function Node's input port values to the function definition's boundary metadata.
3. Runs the inner graph using the same scheduler algorithm.
4. Completes only when the function definition's designated return boundary fires.
5. Maps the function definition's output bindings to the Function Node's output port values.
6. The inner graph's execution events are emitted with the parent execution ID, enabling the UI to show activity inside the function (spinner on the function node, click-to-inspect navigation).

---

## 4. Data Flow System

### 4.1 Port Types

Every port on every node declares:
- **name** (string): Stable identifier used in connections. Example: `"response"`, `"exec_in"`.
- **type** (type descriptor): One of the core types from Section 1.4.
- **direction** (`input` | `output`): Whether data flows into or out of the node.
- **required** (boolean): Whether the port must be connected for the node to execute. Default: `false` for data ports, `true` for exec input ports on action nodes.
- **default** (value, optional): Default value used when the port is not connected.

### 4.2 Wire Types

| Wire Type | Visual | Purpose | Carries |
|---|---|---|---|
| **Data wire** | Color-coded by data type (purple=text, blue=number, etc.) | Passes typed values between nodes | A value of the declared type |
| **Execution wire** | Gray arrow | Controls execution order between action nodes | A signal (no data payload) |

A single node can have both data wires and execution wires. Pure nodes have only data ports (no execution wires). Action nodes have both.

### 4.3 Type Checking Rules (Complete)

Type checking happens at two times:

**Connection-time (when the user draws a wire):**
1. Data wire: source port type must be compatible with target port type (see compatibility table below).
2. Exec wire: source must be an exec output, target must be an exec input.
3. Direction: source must be an output port, target must be an input port.
4. Self-connection: a node cannot connect to itself (except through a loop boundary node).

**Build-time (when `graph/load` is called):**
1. All `any`-typed ports must have resolved to concrete types.
2. All `required: true` ports must be connected or have defaults.
3. No cycles except through designated loop nodes.
4. Break nodes must be inside a loop body.
5. Function nodes must reference defined functions.

**Type compatibility matrix:**

| Source Type | Target Type | Compatible? | Notes |
|---|---|---|---|
| `text` | `text` | Yes | Exact match |
| `number` | `text` | Yes | Auto-coercion via toString |
| `boolean` | `text` | Yes | Auto-coercion via toString |
| `number` | `number` | Yes | Exact match |
| `boolean` | `boolean` | Yes | Exact match |
| `json` | `json` | Yes | Exact match |
| `text` | `json` | Yes | Parsed as JSON string at runtime. If the text is not valid JSON, a runtime error is emitted on the receiving node's error port. |
| `any` | `<T>` | Yes | Wildcard resolves to T |
| `<T>` | `any` | Yes | Wildcard resolves to T |
| `list<T>` | `list<T>` | Yes | Element types must match |
| `stream<T>` | `T` | Yes | Stream collected to complete value |
| `stream<T>` | `stream<T>` | Yes | Stream forwarded |
| `struct` | `struct` | Yes | Field names and types must match |
| All others | Mismatched | No | Connection rejected |

### 4.4 Wildcard Resolution

When a wire connects to an `any`-typed port:

1. **Adopt:** The `any` port copies the connected port's full type descriptor.
2. **Propagate:** Other `any` ports on the same node that are linked (declared as co-resolving in the node definition) also adopt the same type.
3. **Validate:** Existing connections to the now-resolved port are re-validated. Any that became incompatible produce a validation error.
4. **Revert:** When all connections to a resolved wildcard port are removed, it reverts to `any`.

This happens in the editor (for immediate feedback) and is re-validated at build-time.

---

## 5. LLM Adapter Interface

v1 targets four initial backends: Claude Code CLI, Gemini CLI, Codex CLI, and OpenRouter API. Adapter behavior is implemented against a pinned compatibility matrix verified by fixture tests. Unsupported major versions fail fast rather than running with undefined parsing assumptions.

### 5.1 The NodeExecutor Trait

All LLM backends implement a common interface:

```rust
#[async_trait]
trait NodeExecutor: Send + Sync {
    /// Start execution, return a receiver for streaming events
    async fn execute(
        &self,
        input: NodeInput,
        cancel: CancellationToken,
    ) -> Result<mpsc::Receiver<NodeEvent>, NodeError>;

    /// Check if the executor's backing process/request is still alive
    async fn is_alive(&self) -> bool;

    /// Forcefully terminate the executor
    async fn kill(&self) -> Result<(), NodeError>;
}

enum NodeEvent {
    /// A streaming text chunk (Bytes for zero-copy broadcast to multiple consumers)
    Token(Bytes),
    /// Final complete output
    Done(NodeOutput),
    /// An error occurred
    Error(NodeError),
}
```

`Token` uses `bytes::Bytes` (not `String`) so that broadcasting a token to multiple consumers (downstream nodes + UI event stream) costs one atomic reference count increment per clone, not a heap allocation. Adapters parse JSONL/SSE lines into a `BytesMut` accumulator and call `freeze()` to produce the `Bytes` value. The `NodeOutput.response` field in `Done` is still `String` because it represents the final collected output (assembled once, not broadcast incrementally).

```rust
struct NodeOutput {
    response: String,
    usage: Usage,
}

struct Usage {
    input_tokens: u64,
    output_tokens: u64,
    cost_usd: Option<f64>,
}
```

### 5.2 Claude Code CLI Adapter

**Process spawn:**
```
claude --bare -p "<prompt>"
    --output-format stream-json
    --model <model>
    --no-session-persistence
    [--max-budget-usd <budget>]
    [--mcp-config <graph-level-config-path>]
    [--system-prompt "<system>"]
    [--add-dir <path>]
    [backend-specific approval/sandbox flags allowed by the compatibility matrix]
```

**JSONL parsing:** Each line of stdout is a JSON object. The adapter maps assistant streaming content to `NodeEvent::Token`, the terminal result to `NodeEvent::Done`, and failures to `NodeEvent::Error`.

**Process lifecycle:**
- Stdin is closed after writing the prompt (non-interactive mode).
- Stdout and stderr are read concurrently via `tokio::select!` to prevent deadlock.
- Cancellation: `child.kill().await` sends SIGTERM (Unix) or terminates the process (Windows).
- Timeout: `tokio::time::timeout(duration, execute_future)` wraps the entire execution.

### 5.3 OpenRouter API Adapter

**HTTP request:**
```
POST https://openrouter.ai/api/v1/chat/completions
Content-Type: application/json
Authorization: Bearer <api_key>

{
  "model": "<model>",
  "messages": [
    {"role": "system", "content": "<systemPrompt>"},
    {"role": "user", "content": "<prompt>"}
  ],
  "stream": true,
  "temperature": <temperature>,
  "max_tokens": <maxTokens>
}
```

**SSE parsing:** The response is a stream of `data: {...}` lines:
- Each chunk's `choices[0].delta.content` maps to `NodeEvent::Token`
- `data: [DONE]` signals completion
- Pre-stream errors (HTTP 4xx/5xx) map to `NodeEvent::Error`
- Mid-stream errors (`finish_reason: "error"` on HTTP 200) map to `NodeEvent::Error` with the error message from the chunk

**Rate limiting:** A `tokio::sync::Semaphore` limits concurrent API requests (default: 10 permits). Requests that exceed the limit wait for a permit.

### 5.4 Gemini CLI Adapter

**Process spawn:**
```
gemini -p "<prompt>"
    --output-format stream-json
```

**JSONL parsing:** The adapter maps the compatibility-matrix-verified `stream-json` event taxonomy for the pinned Gemini CLI version to `NodeEvent::Token`, `NodeEvent::Done`, and `NodeEvent::Error`. Backend-specific exit codes are also defined by that compatibility matrix and verified by fixture tests. Unsupported major versions fail fast rather than assuming a stable event taxonomy.

### 5.5 Codex CLI Adapter

**Process spawn:**
```
codex exec "<prompt>"
    --json
    --sandbox <backend-policy>
    [--model <model>]
```

`<backend-policy>` is derived from the studio sandbox policy through the compatibility matrix. Example: studio `full-access` maps to Codex-native `danger-full-access`. Network behavior is backend-specific and is tracked in the compatibility matrix rather than assumed by the generic studio policy name.

**JSONL parsing:** Maps event types to `NodeEvent`:
- `ThreadStarted` events are ignored (session metadata)
- `TurnStarted` events are ignored (turn metadata)
- `ItemCompleted` events with assistant content map to `NodeEvent::Token`
- Final completion maps to `NodeEvent::Done`
- Process exit code != 0 maps to `NodeEvent::Error`

**Non-interactive constraint:** Codex in non-interactive mode fails immediately on any approval request. Nodes using `codex-cli` must set `sandboxPolicy` to a level that allows the intended operations without prompting.

### 5.6 CLI Auto-Detection

At engine startup, the engine checks for installed CLI tools:

```rust
async fn detect_cli_backends() -> HashMap<String, CliStatus> {
    // Run in parallel: claude --version, gemini --version, codex --version
    // Return: { "claude-cli": Available("7.0.1"), "gemini-cli": NotFound, ... }
}

enum CliStatus {
    Available(String),              // version string
    NotFound,                       // binary not on PATH
    VersionIncompatible(String),    // found but version too old
}
```

The results are included in the `initialize` response:
```json
{
  "capabilities": {
    "backends": {
      "claude-cli": { "status": "available", "version": "7.0.1" },
      "gemini-cli": { "status": "not_found", "installHint": "Install: npm install -g @google/gemini-cli" },
      "codex-cli": { "status": "not_found", "installHint": "Install: npm install -g @openai/codex" },
      "openrouter": { "status": "missing_credentials", "credentialRef": "OPENROUTER_API_KEY" }
    }
  }
}
```

### 5.7 Shared CLI Adapter Infrastructure

All CLI adapters share common infrastructure:

- **Buffered reading:** All `ChildStdout` streams are wrapped in `BufReader::with_capacity(256 * 1024, stdout)` to reduce `read()` syscalls by 10-50x (one kernel read fills the buffer, then multiple JSONL lines are parsed from it without further syscalls).
- **Streaming payloads:** Large text chunks use `bytes::Bytes` (reference-counted, zero-copy clone) instead of `String` when broadcasting to multiple consumers (downstream nodes + UI event stream).
- **Process lifecycle:** Stdin closed after prompt (non-interactive). Stdout and stderr read concurrently via `tokio::select!`. Cancellation via `child.kill().await`. Timeout via `tokio::time::timeout`.
- **Linux pipe optimization:** On Linux, increase pipe buffer to 1 MB via `fcntl(F_SETPIPE_SZ)` to prevent CLI tool stalling when the consumer is temporarily slow.

### 5.8 Streaming Event Model

All four adapters produce the same `NodeEvent` stream. The engine processes events identically regardless of backend:

1. `Token` events are forwarded to the UI as `node/output/partial` protocol events.
2. `Done` events store the final output in the execution context, update the cache if the node is eligible, and trigger downstream routing.
3. `Error` events route to the node's error port (if connected) or escalate to the execution.

### 5.9 Event Batching at IPC Boundary

When streaming events to the UI via Tauri IPC, the engine batches `node/output/partial` events into a desktop-only wrapper event `execution/events_batch { events[] }` to reduce IPC call frequency. Each item in `events[]` is still a canonical execution event payload. The Tauri IPC bridge has a fixed per-call overhead (~0.1-0.5ms) regardless of payload size. At 100 concurrent nodes each streaming tokens, unbatched delivery would produce 2,000+ IPC calls per second.

**Batching strategy:** The engine accumulates partial events in a per-node buffer and flushes to Tauri every 16ms (matching the 60fps UI refresh rate) or when the buffer reaches 32 events, whichever comes first. Each flush is a single IPC `emit` call carrying one `execution/events_batch` payload. This reduces IPC call frequency by 10-50x with no visible latency impact.

---

## 6. Function System

### 6.1 Creating a Function

A function is created by selecting nodes on the canvas and choosing "Extract to Function." The system:

1. **Identifies boundary wires.** Any wire crossing the selection boundary becomes a function port. Incoming wires become input ports; outgoing wires become output ports.
2. **Creates editor/runtime boundary metadata.** The editor and runtime use Entry/Return concepts internally, but the serialized function definition stores `inputPorts`, `outputPorts`, one designated `returnBoundary`, and explicit `outputBindings` rather than serializing separate Entry/Exit nodes.
3. **Names ports.** Ports are named after the original port names from the boundary wires. The user can rename them.
4. **Registers the function.** The function definition (name, inner graph, input ports, output ports) is added to the project's function registry.
5. **Replaces the selection.** The selected nodes are replaced with a single Function Node that references the registered function.

**v1 extraction rule:** Extract-to-function requires one explicit terminal exec boundary for the selected region. If the selection has multiple terminal exec exits, extraction is rejected until the user normalizes it to one return path.

### 6.2 Function Input/Output

- **Input ports:** Defined by the function's serialized `inputPorts`. Each has a name, type, and optional default value.
- **Output ports:** Defined by the function's serialized `outputPorts`. Each has a name and type.
- **Exec ports:** Functions have `exec_in` and `exec_out` like any action node. Internally, execution starts at the function boundary and completes when the serialized `returnBoundary` fires.
- **Output bindings:** Each outer output port maps to one specific inner node/port source in `outputBindings`. Outputs become final when the designated return boundary fires.

### 6.3 Nesting

Functions can contain other function nodes (nesting). There is no depth limit. Recursive calls (a function calling itself) are detected at build-time and rejected -- functions are synchronous call frames, not re-entrant coroutines.

### 6.4 Library System

Functions can be packaged into libraries:

```json
{
  "libraryVersion": "1.0.0",
  "name": "LLM Utilities",
  "functions": {
    "research-and-summarize": { "...function definition..." },
    "retry-with-fallback": { "...function definition..." }
  }
}
```

Libraries are JSON files stored in the studio project or in a shared location. They can be imported into any studio project. A function from a library is referenced by `libraryName/functionName`.

### 6.5 Function Node in the Graph JSON

A Function Node in the `nodes` object references a function by `functionRef`. Two forms:

**Inline function** (defined in this graph's `functions` block):
```json
{
  "node-uuid-func": {
    "type": "function",
    "label": "Research and Summarize",
    "functionRef": { "source": "inline", "id": "func-uuid-1" },
    "position": { "x": 300, "y": 200 },
    "ports": {
      "inputs": {
        "topic": { "type": "text", "required": true },
        "exec_in": { "type": "exec" }
      },
      "outputs": {
        "summary": { "type": "text" },
        "exec_out": { "type": "exec" }
      }
    }
  }
}
```

**Library function** (defined in an external library file):
```json
{
  "node-uuid-lib-func": {
    "type": "function",
    "label": "Retry with Fallback",
    "functionRef": { "source": "library", "library": "llm-utilities", "name": "retry-with-fallback" },
    "position": { "x": 500, "y": 200 },
    "ports": {
      "inputs": {
        "prompt": { "type": "text", "required": true },
        "exec_in": { "type": "exec" }
      },
      "outputs": {
        "result": { "type": "text" },
        "exec_out": { "type": "exec" }
      }
    }
  }
}
```

The `functionRef.library` value must match a library name from the project's `config.json` libraries list.

### 6.6 Serialization

Functions serialize as part of the graph JSON by default (see Section 1.3, `functions` field). Exported libraries are separate JSON files under `functions/`. The inner graph uses the same schema as the top-level graph plus function boundary metadata (`returnBoundary`, `outputBindings`). This means functions are human-readable, diff-friendly, and editable by LLMs.

---

## 7. Loop System

### 7.1 How Loops Interact with the Execution Model

Loops create intentional cycles in the graph. The engine handles them as follows:

1. **Cycle detection.** At build-time, Tarjan's SCC algorithm (via `petgraph`) identifies all strongly connected components. Each SCC is checked: if every cycle in the SCC passes through a designated loop node (`ForLoop`, `ForEachLoop`, `WhileLoop`), the cycle is permitted. Otherwise, it is an error.

2. **Loop boundary.** The loop node itself is the boundary. Nodes inside the loop body are re-executed on each iteration. Nodes outside the loop body execute once.

3. **Iteration state.** The loop node's actor maintains an iteration counter. On each iteration, it:
   - Sets the iteration-specific outputs (`index`, `element`, `iteration`)
   - Fires the `body` exec output
   - Waits for the explicit loop-body region owned by that `body` output to complete
   - Emits a `loop/iteration` event with the iteration's inputs and outputs
   - Yields to the Tokio runtime (`tokio::task::yield_now().await`) so other tasks can progress
   - Re-evaluates the loop condition (or increments the index)

4. **Async loop bodies.** Unlike UE Blueprints (where loops are synchronous within one frame), our loop bodies can contain async operations (LLM calls, human-in-the-loop). The loop node awaits the entire explicit body region's completion before starting the next iteration.

### 7.2 Break Mechanism

The Break node sends a typed break signal through a dedicated channel to the enclosing loop node's actor. On receiving a break:
1. The loop node cancels any still-running nodes in the current iteration's body (via `CancellationToken`).
2. The loop fires its `completed` exec output immediately.
3. The iteration in which the break occurred is recorded in the iteration history.

### 7.3 Loop Caching

Loop iterations are NOT cached individually. The cache key for a loop node includes the loop's inputs (list, range, condition) and the entire body subgraph's configuration. If the loop's inputs change, the entire loop re-runs. If they haven't changed, the loop's final output is served from cache.

Individual nodes inside the loop body CAN be cached if their inputs (within the iteration) match a previous execution. This means: if a loop body contains an LLM call and the prompt varies per iteration, each iteration re-runs the LLM. But if the loop body contains a pure formatting node with static inputs, that node is cached after the first iteration.

---

## 8. Safety System

### 8.1 Connection-Time Validation

When the user draws a wire in the editor:

1. The editor sends a validation request to the engine with the proposed connection (source node/port, target node/port).
2. The engine checks type compatibility (Section 4.3), direction (output to input), and self-connection.
3. If invalid: returns an error with a human-readable explanation. The editor snaps the wire back and shows a tooltip.
4. If valid: the connection is created. If wildcard resolution occurred, the editor updates the affected port's visual type indicator.

This runs synchronously during wire drawing via Tauri `invoke` IPC (typically < 1ms).

### 8.2 Build-Time Validation

On `graph/load`, the engine runs a full validation pass and returns a structured report:

**Checks performed:**
1. All `any` ports resolved to concrete types
2. All `required: true` ports connected or have defaults
3. Root action-node eligibility is valid
4. No unintended cycles (cycles only through loop boundaries)
5. No implicit exec reconvergence
6. Break nodes inside loop bodies
7. Function references resolve to defined functions
8. No recursive function calls
9. Every LLM node resolves an effective budget from node config or project defaults
10. All node types are recognized by the engine

**Report format:**
```json
{
  "valid": false,
  "errors": [
    {
      "code": -33001,
      "severity": "error",
      "message": "Unresolved wildcard type on port 'input'",
      "nodeId": "node-uuid-5",
      "portId": "input"
    },
    {
      "code": -33010,
      "severity": "error",
      "message": "LLM node has no effective budget. Set maxBudgetUsd or project defaults.maxBudgetUsd.",
      "nodeId": "node-uuid-2"
    }
  ]
}
```

The editor renders each error in the error panel with a clickable link that navigates to and highlights the offending node.

### 8.3 Error Port System

In v1, `error` outputs are exposed only on node types that explicitly list them in their contract tables.

- **Connected error port:** When the node fails, the error value (structured: code, message, node context) is sent through the error port to whatever node is connected. The execution continues -- the error is now data flowing through the graph. This enables retry logic, fallback paths, and error logging as visible graph constructs.
- **Unconnected error port:** When the node fails, the error propagates upward. If the node is inside a function, the function node fails. If it's at the top level, the execution fails with `execution/error`.

This is an opt-in model: by default, errors abort. Connecting the error port is an explicit decision to handle the error.

### 8.4 Process Sandboxing

CLI adapter nodes spawn external processes. These processes are sandboxed:

| Sandbox Level | Filesystem | Network | Description |
|---|---|---|---|
| `read-only` (default) | Read only | Backend-specific default | Node can read the configured `workspace_root` but not write. This reduces filesystem risk for analysis tasks; it is not a complete containment guarantee. |
| `workspace-write` | Write within `workspace_root` only | Backend-specific default | Node can modify files within the configured `workspace_root`. Writes outside that root are blocked where the platform sandbox supports it. |
| `full-access` | Unrestricted | Unrestricted | Explicitly opted-in. For tasks that need full system access. |

On Linux, sandboxing uses OS-level isolation (namespaces, Landlock, seccomp-BPF via the `hakoniwa` crate). On macOS, Seatbelt profiles. On Windows, restricted process tokens. Linux is the release-blocking enforcement target in v1. Other platforms may expose reduced guarantees and must surface that degradation in the UI and run manifest.

The sandbox level is a per-node configuration field. Default is `read-only`. Upgrading to `workspace-write` or `full-access` requires explicit configuration.

**Fallback behavior on degraded platforms:**
- `read-only`: may run with an explicit degraded-sandbox warning and manifest flag.
- `workspace-write`: fails closed if the engine cannot enforce the workspace boundary for the current platform/backend combination.
- `full-access`: may run only because it is already explicit opt-in and intentionally unsandboxed.

### 8.5 Cost Budget Enforcement

Two levels of cost tracking:

1. **Per-node budget:** The `maxBudgetUsd` config field on LLM nodes. When omitted, the node inherits `defaults.maxBudgetUsd` from `config.json`. Passed directly to the CLI adapter (`--max-budget-usd` for Claude Code) when supported. The adapter or engine enforces the limit and exits with an error if exceeded.

2. **Per-execution budget:** The engine tracks cumulative cost across all nodes in an execution (summing `usage.cost_usd` from each node's output). If a graph-level budget is set and exceeded, the engine cancels remaining nodes and emits `execution/error` with budget details.

Cost events are streamed to the UI as part of `node/output/final` (per-node cost) and `execution/completed` (total cost).

---

## 9. MCP Server API

### 9.1 Overview

The engine library includes an MCP service surface that the headless host mode exposes as tools. Any MCP-capable LLM (Claude Code with `--mcp-config`, etc.) can call these tools to programmatically create, modify, validate, and run pipelines.

In v1, MCP tools mutate draft graph state only. Active executions always run against immutable snapshots.

### 9.2 Transport

stdio (the MCP host is a stdio mode of the headless binary that embeds the same engine library used by the desktop app). The host application or an external authoring client writes JSON-RPC requests to the server's stdin and reads responses from stdout. The desktop app does not expose raw stdio directly; desktop editing and headless MCP hosting are separate deployment modes in v1.

### 9.3 Tools

| Tool | Parameters | Returns | Description |
|---|---|---|---|
| `get_graph` | `graphId` | `graph`, `graphRevision` | Read the current draft graph |
| `create_node` | `graphId`, `baseRevision`, `type`, `label`, `config`, `position` | `nodeId`, `graphRevision` | Add a new node to the graph |
| `delete_node` | `graphId`, `baseRevision`, `nodeId` | `success`, `graphRevision` | Remove a node and its connections |
| `connect` | `graphId`, `baseRevision`, `sourceNode`, `sourcePort`, `targetNode`, `targetPort` | `connectionId`, `graphRevision` | Create a wire between two ports |
| `disconnect` | `graphId`, `baseRevision`, `connectionId` | `success`, `graphRevision` | Remove a wire |
| `set_config` | `graphId`, `baseRevision`, `nodeId`, `config` | `success`, `graphRevision` | Update a node's configuration |
| `get_node` | `graphId`, `nodeId` | `node` (full definition) | Read a node's definition |
| `list_nodes` | `graphId` | `nodes[]` | List all nodes in the graph |
| `copy_nodes` | `graphId`, `baseRevision`, `nodeIds[]`, `offset` | `newNodeIds[]`, `graphRevision` | Duplicate nodes and their internal wires; boundary wires are not copied |
| `extract_function` | `graphId`, `baseRevision`, `name`, `nodeIds[]` | `functionId`, `graphRevision` | Replace selected nodes with a function node; boundary wires become function ports |
| `validate` | `graphId` | `report` (validation result) | Run build-time validation |
| `execute` | `graphId`, `inputs` (optional) | `executionId` | Start graph execution |
| `cancel_execution` | `executionId` | `success` | Cancel a running execution |
| `get_output` | `graphId`, `nodeId`, `portId` | `value` | Read a node's last output value |
| `list_node_types` | | `types[]` | List available node types with their port schemas |
| `get_backends` | | `backends` | List available LLM backends with install status |

### 9.4 Security Model

- The MCP server uses local stdio transport in v1. It does not open a remote network listener, but local process access is still a trust boundary.
- MCP configuration is graph-level in v1. Per-node MCP authorization is deferred.
- Graph manipulation tools respect the same validation rules as manual editing (type checking, cycle detection).
- Execution tools respect cost budgets and sandboxing.
- The MCP server cannot modify engine internals -- it operates through the same graph API as the editor.

---

## 10. Project Persistence

### 10.1 File Format

A project is a directory containing:

```
my-pipeline/
  pipeline.json          # The main graph (Section 1.3 schema)
  functions/
    research-and-summarize.json   # Function library files
    retry-with-fallback.json
  config.json            # Project configuration (MCP servers, env vars)
  runs/
    exec-2026-03-27-001/
      manifest.json      # Run provenance and outcome metadata
```

### 10.2 Graph File (pipeline.json)

Uses the schema from Section 1.3. Key properties for git-friendliness:
- **Deterministic key ordering.** Nodes and connections are serialized in a stable order (sorted by ID) so that git diffs are minimal and meaningful.
- **One node per logical block.** The JSON is formatted with each node as a distinct block, so adding or modifying one node produces a localized diff.
- **No execution state.** Cache data, runtime state, and execution history are NOT stored in the graph file. The graph file is purely declarative -- what nodes exist, how they're connected, and how they're configured.

### 10.3 Config File (config.json)

```json
{
  "workspaceRoot": "../target-repo",
  "mcpServers": {
    "filesystem": { "command": "mcp-fs", "args": ["--root", "/project"] },
    "web-search": { "command": "mcp-search" }
  },
  "env": {
    "OPENROUTER_API_KEY": "${OPENROUTER_API_KEY}",
    "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
  },
  "defaults": {
    "llmModel": "claude-sonnet-4-6",
    "maxBudgetUsd": 5.00,
    "sandboxLevel": "read-only"
  }
}
```

Environment variables use `${VAR}` syntax and resolve from the host environment at runtime. Project files may contain environment-variable references only, not raw secrets. API keys are never stored in the project file.

### 10.4 Function Library Files

Each function library is a standalone JSON file following the schema from Section 6.4. Libraries can be shared across projects by referencing them from `config.json`:

```json
{
  "libraries": [
    { "name": "shared-utils", "path": "../shared/llm-utilities.json" }
  ]
}
```

### 10.5 Run Manifests

Every execution persists a minimal run manifest under `runs/<executionId>/manifest.json`. This is a machine-readable provenance artifact, not a full history UI.

Minimum fields:
- `executionId`
- `graphId`
- `graphRevisionHash`
- `startedAt` / `completedAt`
- `status`
- `backendVersions`
- `resolvedDefaults` (budgets, sandbox defaults, workspace root)
- `nodeSummaries` (status, cached, duration, cost)
- `errors`
- `platform`
- `dirtyWorkspace` (true when a write-capable node was interrupted or failed after starting side effects)

---

## 11. Testing Strategy

### 11.1 Principle

Every phase boundary has input-to-output tests: given a specific input, verify the exact expected output. No phase proceeds until its tests pass.

### 11.2 Protocol Conformance Tests

**What:** A suite of JSON test fixtures -- each fixture is a pair of (input message, expected response/error).

**Examples:**
- Valid `initialize` request produces a response with capabilities
- `graph/load` with a type mismatch produces error code -33001 with the correct nodeId and portId
- `graph/load` with an unresolved wildcard produces error code -33002
- `graph/load` with a valid graph produces `valid: true`
- `execution/cancel` for an unknown executionId produces an error
- Malformed JSON produces error code -32700

**Count:** ~50-80 test fixtures covering all protocol messages and error paths.

**Run without engine:** These tests validate the protocol parser and message handler in isolation. They do not require the execution engine.

### 11.3 Engine Integration Tests

**What:** Full graph-in, output-out tests. Load a graph JSON file, execute it with mock LLM adapters, verify the outputs.

**Mock adapters:** Test LLM adapters that return deterministic responses. Example: a mock Claude CLI adapter that echoes the prompt back, or returns a canned response from a fixture file.

**Test scenarios:**
- Linear pipeline (A -> B -> C): verify data flows through all nodes
- Parallel branches: verify both branches execute and produce outputs
- Router node: verify correct branch is selected and non-selected nodes enter skipped state
- ForLoop: verify correct number of iterations, verify iteration outputs
- ForEachLoop over a list: verify each element is processed
- WhileLoop with max iterations: verify safety cap works
- WhileLoop with implicit-true startup plus Break: verify flagship retry loop shape works without a boolean helper node
- Break in a loop: verify loop exits early
- Graph revision conflict: stale `baseRevision` mutation is rejected until caller refreshes
- Cache hit: run twice with same inputs, verify only eligible cached nodes are skipped
- Cache miss: change an input, verify affected nodes re-execute
- Error port connected: verify error flows to fallback node
- Error port unconnected: verify execution aborts with structured error
- Human-in-the-loop: verify node suspends, verify response arrives
- Function node: verify inner graph executes and outputs are mapped correctly
- Nested functions: verify two levels of function nesting work
- Cancellation: verify running nodes are terminated
- Cost budget: verify execution stops when budget is exceeded
- Dirty workspace handling: cancel a write-capable node mid-run, verify `dirtyWorkspace: true` and no cache entry is created for that node
- Run manifest: verify manifest captures graph hash, backend versions, defaults, node summaries, and final status

**Count:** ~30-40 integration tests.

### 11.4 Adapter Tests

**What:** Tests for each LLM adapter in isolation.

**Claude CLI adapter tests:**
- Parse a sample JSONL stream into NodeEvent sequence
- Handle process exit code != 0 as NodeError
- Handle timeout (process killed after configured duration)
- Handle cancellation (process terminated on cancel signal)

**Gemini CLI adapter tests:**
- Parse a compatibility-matrix-pinned sample `stream-json` fixture into the expected NodeEvent sequence
- Verify unsupported major version returns `VersionIncompatible`
- Verify fixture-backed backend-specific error mapping for the pinned version

**Codex CLI adapter tests:**
- Parse a sample JSONL stream (ThreadStarted, ItemCompleted events) into NodeEvent sequence
- Handle approval-request failure in non-interactive mode
- Handle sandbox policy translation from generic studio policy to backend-native policy

**OpenRouter API adapter tests:**
- Parse a sample SSE stream into NodeEvent sequence
- Handle HTTP 429 (rate limit) as NodeError
- Handle mid-stream error (`finish_reason: "error"`)
- Handle connection timeout

**CLI auto-detection tests:**
- Detect installed CLI tool (mock binary on PATH) as Available
- Detect missing CLI tool as NotFound
- Detect missing OpenRouter credentials as `missing_credentials`
- Verify capabilities reported in initialize response

**Count:** ~25-30 adapter tests.

### 11.5 UI Tests

**What:** Component-level tests for critical UI interactions.

**Scenarios:**
- Drawing a valid wire creates a connection
- Drawing an invalid wire shows type mismatch tooltip
- Node palette filters by type when wire is dragging
- Error panel click navigates to the correct node
- Streaming tokens appear in node output display
- Loop iteration picker switches between iterations
- Function node double-click navigates to inner graph
- Breadcrumb navigation works for nested functions
- Multi-select: drag rectangle selects enclosed nodes
- Copy-paste: Ctrl+C/V duplicates selected nodes with internal wires
- Extract to function: selected nodes replaced by function node with correct ports
- Extract to function: multiple terminal exec exits are rejected with guidance to normalize to one return path
- Undo/redo: each operation is reversible
- Backend selector: unavailable CLI backends are grayed out with install hint tooltip
- Backend selector: credential-backed backends show `missing_credentials` instead of `available`
- Draft graph sync: external graph revision change triggers refresh via `graph/changed`

**Count:** ~20-25 component tests.

### 11.6 Performance Tests (Stretch Goal)

**What:** Load and concurrency tests to validate the engine handles realistic graph sizes.

**Scenarios:**
- Synthetic 200-node graph with mock adapters: verify execution completes without deadlock or memory exhaustion
- 50-node graph with 10 parallel branches: verify Tokio actor scheduling does not starve any branch
- Channel backpressure test: a fast-producing node paired with a slow consumer, verify bounded channel blocks the producer without data loss
- Cache lookup at 1000 entries: verify LRU cache operations remain sub-millisecond
- React Flow rendering with 200 custom nodes: verify canvas interaction (pan, zoom) remains responsive

These are stretch goals, not blocking criteria for any phase. They establish performance baselines for future optimization work.

### 11.7 Release-Blocking Acceptance Scenario

v1 includes one end-to-end acceptance scenario that matches the flagship workflow from the vision document and the explicit fixture in `docs/superpowers/specs/flagship-acceptance-scenario.md`:

- Research a target workspace with a read-only Claude node
- Generate output with a Gemini/OpenRouter node
- Review with a Claude node inside a bounded WhileLoop whose Router sends `approved` to Break and `retry` to the end of the loop body
- Apply approved output with a write-capable Codex node constrained to `workspace_root`
- Re-run and verify the read-only research node is cache-eligible while the write-capable apply step is not cross-run cached
- Persist a run manifest with backend versions, costs, and final status

This scenario is release-blocking on the supported v1 platform matrix.
