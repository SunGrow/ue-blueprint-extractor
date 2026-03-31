# Pipeline Studio -- Versioned Implementation Plan

**Date:** 2026-03-27
**Version:** 1.0

---

## Guiding Principle

Each layer establishes a reviewed baseline before the next layer consumes it. The protocol is the contract; the engine implements the contract; the UI consumes the contract. Tests validate each layer boundary. When a later layer reveals a problem in an earlier layer, the earlier layer is updated under change control, the baseline is re-frozen, and dependent tests are re-run.

```
Phase 0: Contract Baseline ─► Phase 1: Protocol ──────► Phase 2: Engine ──────► Phase 3: UI
      (scope + authority)        (spec + tests)            (implementation)        (visual editor)
               │                        │                        │                       │
               │        controlled backflow updates ◄───────────┴───────────────────────┘
```

---

## Phase 0: Contract Baseline

**Goal:** Lock the small set of rules that every downstream team depends on before schema work starts.

### Deliverables

- A single v1 scope baseline covering:
  - immutable execution snapshots
  - exec-only control flow
  - fixed action-node contracts
  - root action-node start behavior
  - graph-level MCP only
  - explicit `workspace_root`
  - cache eligibility defaults
  - minimal run manifests in v1
- A deployment matrix that separates:
  - embedded desktop transport (Tauri commands/events)
  - external JSON-RPC transport (`stdio` in v1; HTTP deferred)
  - MCP host transport
- A graph-authority decision:
  - the engine owns authoritative draft graph state
  - the editor mirrors that state
  - the editor and MCP host both mutate that draft through the same canonical `graph/*` mutation API with revision checks
- A published v1 platform/support matrix at `docs/superpowers/specs/platform-support-matrix.md`
- A shared-artifact ownership table for protocol, execution events, config schema, safety policy, acceptance fixtures, and support matrices

### Shared-Artifact Ownership

| Artifact | Primary Owner | Required Reviewers | Why ownership is explicit |
|---|---|---|---|
| Protocol schemas and JSON-RPC method contracts | Protocol lead | Engine lead, UI lead, QA lead | Prevents transport or payload drift between docs and implementation |
| Execution event model and state semantics | Engine lead | Protocol lead, UI lead, QA lead | Keeps scheduler behavior, skipped-state behavior, and loop/function reporting consistent |
| Draft graph authority and mutation rules | Engine lead | Protocol lead, UI lead, MCP/automation lead | Makes it explicit that the engine owns authoritative draft graph state in v1 |
| Desktop bridge mappings (Tauri commands/events) | UI lead | Engine lead, Protocol lead | Ensures the desktop shell stays a wrapper over canonical engine contracts |
| Config schema, credential references, and backend capability surface | Platform/safety lead | Engine lead, UI lead, QA lead | Prevents the UI from promising credentials flows or backend support the engine does not implement |
| Sandbox policy, budget policy, cache eligibility, and run manifests | Platform/safety lead | Engine lead, QA lead | Forces conservative defaults and testable guarantees |
| Platform/support matrix (`platform-support-matrix.md`) | Platform/safety lead | Product/manager, QA lead, Engine lead | Converts support claims into a release-blocking artifact instead of prose |
| Backend compatibility matrix (`backend-compatibility-matrix.md`) | Platform/safety lead | Engine lead, QA lead | Freezes backend-version and adapter-policy assumptions before release |
| Flagship acceptance fixture and release gate | QA lead | Product/manager, Protocol lead, Engine lead, UI lead | Gives every team the same executable definition of "ready" |

### Exit Criteria

- Vision, TDD, and plan all state the same baseline rules with no count drift
- Desktop transport and external transport are no longer described as the same runtime mechanism
- MCP scope is graph-level only in v1
- Control-flow ownership is defined well enough that Sequence, Router, and loop behavior are not left to implementation inference
- Product, engineering, and QA sign off on `docs/superpowers/specs/flagship-acceptance-scenario.md` and the published support matrices

---

## Phase 1: Protocol

**Goal:** A baseline protocol specification v0.1 with a conformance test suite. No production engine runtime or UI implementation. Thin reference harnesses are allowed when they clarify the protocol or validate schemas.

### Milestone 1.1: Message Schema Definition

**Deliverable:** JSON Schema files defining every protocol message type.

**Work:**
- Define the JSON-RPC 2.0 envelope (request, response, notification, error)
- Define `initialize` / `initialized` / `shutdown` / `exit` messages with capability objects
- Define `graph/get` and `graph/load` request/response pairs, including graph revision semantics
- Define canonical `graph/*` mutation methods (`create_node`, `delete_node`, `connect`, `disconnect`, `set_config`, `copy_nodes`, `extract_function`) with `baseRevision` conflict handling
- Define `graph/changed` notification
- Define `graph/validate_connection` request and response
- Define `execution/start` request
- Define `execution/cancel` request
- Define all execution event notifications (Table from TDD Section 1.7)
- Define `human/prompt` and `human/respond` messages
- Define error code ranges and structured error format

**Tests that validate this milestone:**
- JSON Schema validation: every example message passes schema validation
- Roundtrip test: serialize a message to JSON, deserialize it, compare to original
- Negative tests: messages missing required fields are rejected by schema

**Expected protocol updates:** None (this is the initial definition).

### Milestone 1.2: Type System Specification

**Deliverable:** Formal definition of the type system with a compatibility test matrix.

**Work:**
- Define all core types (text, number, boolean, json, binary, image, error, exec, any)
- Define composite types (list\<T\>, optional\<T\>, stream\<T\>, struct)
- Define the type compatibility matrix (TDD Section 4.3)
- Define wildcard resolution algorithm (adopt, propagate, revert)
- Define coercion rules (number->text, boolean->text, stream\<T\>->T)

**Tests that validate this milestone:**
- Compatibility matrix tests: for every cell in the matrix, verify `is_compatible(source, target)` returns the expected boolean
- Wildcard resolution tests: connect wildcard to concrete, verify resolution; disconnect, verify revert; connect two wildcards to same node, verify co-resolution
- Coercion tests: verify `number` value converts to `text` correctly

**Expected protocol updates:** None.

### Milestone 1.3: Validation Rules Specification

**Deliverable:** Formal definition of all build-time validation checks with test fixtures.

**Work:**
- Define connection-time validation rules (type compatibility, direction, no self-connection)
- Define build-time validation rules (unresolved wildcards, root action-node eligibility, missing required ports, unintended cycles, no implicit exec reconvergence, break-outside-loop, undefined function references, recursive functions, effective budget requirement)
- Define the validation report format
- Define error severity levels (error vs. warning)
- Create test fixtures: ~30 graph JSON files, each testing one validation rule (some valid, some invalid with expected error codes)

**Tests that validate this milestone:**
- For each fixture: load graph JSON -> run validation -> compare output to expected errors
- Positive tests: valid graphs produce `valid: true` with no errors
- Negative tests: each invalid graph produces the specific expected error code, nodeId, and portId

**Expected protocol updates:** None.

### Milestone 1.4: Protocol Conformance Test Suite

**Deliverable:** Complete test suite that any protocol implementation must pass.

**Test format and runner:** Tests are JSON fixture files with a thin Rust harness. Each fixture is a JSON file containing an array of test steps:
```json
[
  { "send": { "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { ... } } },
  { "expect": { "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": "0.1.0", "..." } } }
]
```

The test runner is a Rust binary (`pipeline-studio-conformance`) that:
1. Reads fixture files from a directory
2. Spawns the system under test as a stdio subprocess
3. Sends each `send` message, reads each response, and compares against `expect` (using a JSON-aware diff that ignores field ordering)
4. Reports pass/fail per fixture

The runner is written in Rust to (a) exercise the same JSON shapes the engine will later consume, and (b) validate the schemas with the same Rust JSON Schema library the engine will embed. This is intentional overlap, but it is still a protocol harness rather than the production engine runtime.

For Phase 1, the runner tests against a trivial mock server (a 50-line Rust program that pattern-matches on method names and returns canned responses). In Phase 2, the same fixtures run against the real engine.

**Work:**
- Write ~50-80 test fixtures covering all protocol messages
- Include lifecycle tests (initialize -> normal operation -> shutdown)
- Include error path tests (malformed JSON, unknown methods, invalid params)
- Include cancellation tests
- Build the conformance runner binary
- Build the mock server

**Tests that validate this milestone:**
- The test suite itself is the deliverable. All fixtures pass against the mock server.

**Expected protocol updates:** None.

### Phase 1 Exit Criteria

- All JSON Schema files are defined and self-consistent
- All type system rules are specified with tests
- All validation rules are specified with fixtures
- The conformance test suite passes against the mock server (validates message format and schema compliance only; behavioral correctness is validated in Phase 2 when the real engine passes the same test suite)
- The protocol specification is reviewed and baselined as v0.1 under change control

---

## Phase 2: Engine

**Goal:** A working headless engine that can load graph JSON, validate it, execute it with real and mock LLM adapters, and produce correct output -- all without a UI. Includes a CLI runner for headless execution.

**Structural prerequisite:** The engine is organized as a Rust workspace with two crates:
- `pipeline-studio-engine` (library crate): contains all engine logic (data model, validation, scheduler, node types, adapters, MCP server). This is what Tauri embeds in Phase 3.
- `pipeline-studio-cli` (binary crate): a thin CLI wrapper that depends on `pipeline-studio-engine` and provides the command-line interface (Milestone 2.10).

This separation is established in Milestone 2.1 and maintained throughout Phase 2. All engine milestones (2.1-2.9) build the library crate. Milestone 2.10 builds the binary crate.

### Milestone 2.1: Core Data Model and Parsing

**Deliverable:** Rust workspace with a library crate (`pipeline-studio-engine`) that parses graph JSON into typed data structures and serializes back.

**Work:**
- Set up Rust workspace with `pipeline-studio-engine` (lib) and `pipeline-studio-cli` (bin) crates
- Configure `tikv-jemallocator` as global allocator on Linux/macOS (behind `cfg(not(target_env = "msvc"))`)
- Add `simd-json` with serde compat for large JSON parsing (graph load/save); keep `serde_json` for small event payloads
- Add `bytes` crate for zero-copy streaming payloads
- Define Rust types for the graph schema: `Graph`, `Node`, `Port`, `Connection`, `TypeDescriptor`, `NodeConfig`
- Implement serde deserialization from the protocol's JSON schema
- Implement serde serialization back to JSON (roundtrip fidelity)
- Implement the type compatibility checker (`is_compatible(source: &TypeDescriptor, target: &TypeDescriptor) -> bool`)
- Implement wildcard resolution logic

**Tests that validate this milestone:**
- Parse every test fixture from Phase 1 Milestone 1.3 into Rust types
- Roundtrip: parse -> serialize -> parse -> compare
- Type compatibility: reuse the matrix tests from Milestone 1.2, now running against Rust code
- Wildcard resolution: reuse tests from Milestone 1.2

**Expected protocol updates:** Minor JSON schema adjustments if Rust deserialization reveals ambiguities (e.g., clarifying nullable vs. optional fields).

### Milestone 2.2: Validation Engine

**Deliverable:** The validation subsystem that runs all build-time checks.

**Work:**
- Implement connection-time validation (type check, direction check, self-connection check)
- Implement build-time validation pass:
  - Unresolved wildcard detection
  - Missing required port detection
  - Root action-node eligibility
  - Cycle detection using `petgraph::algo::tarjan_scc()` with loop-boundary exemptions
  - No implicit exec reconvergence
  - Break-outside-loop detection
  - Function reference resolution
  - Recursive function detection
  - Effective budget requirement
- Produce structured validation reports matching the protocol format

**Tests that validate this milestone:**
- Run all ~30 validation fixtures from Phase 1 Milestone 1.3 against the Rust validation engine
- Every fixture must produce the identical error codes and nodeId/portId references

**Expected protocol updates:** Possible additions to error codes if new validation edge cases are discovered.

### Milestone 2.3: Scheduler and Actor Runtime

**Deliverable:** The core execution engine -- topological sort, ready queue, actor spawning, output routing, completion detection.

**Work:**
- Compile an immutable execution snapshot at `execution/start`
- Compile a scheduler region DAG that treats loop bodies and function bodies as owned regions
- Implement topological sort using `petgraph::algo::toposort()` over the region DAG
- Implement the ready queue (nodes whose data inputs and exec preconditions are all satisfied)
- Implement the actor spawn pattern (Alice Ryhl's `Actor` + `ActorHandle` with bounded `mpsc`)
- Implement implicit root-start injection for action nodes with no incoming exec wire
- Implement output routing (when a node completes, send its outputs to downstream nodes' mailboxes)
- Implement the execution event stream (`broadcast` channel for `node/started`, `node/completed`, etc.)
- Implement event batching at the IPC boundary: accumulate `node/output/partial` events per node, flush every 16ms or 32 events (whichever comes first) as a single batched emit. Reduces IPC call frequency by 10-50x.
- Implement parallel branch execution with `JoinSet`
- Implement cancellation propagation via `CancellationToken`
- Implement the node state machine (Pending -> Ready -> Running -> Completed/Failed/Skipped)

**Tests that validate this milestone:**
- Linear pipeline test: A -> B -> C with mock nodes that pass data through
- Parallel branch test: A -> (B, C) -> D, verify B and C run in parallel
- Cancellation test: start execution, cancel, verify all nodes terminate
- State machine test: verify correct state transitions and event emissions

**Expected protocol updates:** Execution event timing/ordering clarifications.

### Milestone 2.4: Built-in Node Types

**Deliverable:** All 5 action node type implementations (9 counting loop variants). v1 ships no built-in pure node types -- the engine supports the pure/action scheduling distinction (implemented in Milestone 2.3) but built-in pure nodes (format, parse, math) are deferred to v2.

**Work:**
- Implement LLM Node (with mock adapter initially)
- Implement Router Node with condition evaluation and scheduler-level skipped-state behavior
- Implement Sequence Node with ordered fan-out and explicit control-flow region waiting
- Implement Human-in-the-Loop Node with suspend/resume via protocol messages
- Implement ForLoop, ForEachLoop, WhileLoop, Break nodes
  - Async-aware iteration (yield between iterations)
  - WhileLoop implicit-true startup and condition re-pull mechanism
  - Iteration event emission for UI history
  - Break signal propagation
  - Max iteration safety cap

**Tests that validate this milestone:**
- Router test: verify correct branch selection and skipped state on non-selected nodes
- Sequence test: verify A completes before B starts
- HITL test: verify node suspends, feed a mock response, verify node resumes
- ForLoop test: verify correct iteration count, verify index values
- ForEachLoop test: verify each element processed
- WhileLoop test: verify implicit-true startup plus Break-based approval loop, and verify max iterations cap
- Break test: verify loop exits early on break signal
- Combined test: a graph with routing, looping, and sequencing working together

**Expected protocol updates:** Possible additions to loop/iteration event fields based on implementation experience.

### Milestone 2.5: LLM Adapters (All Four)

**Deliverable:** All four LLM adapters: Claude Code CLI, Gemini CLI, Codex CLI, and OpenRouter API. Plus CLI auto-detection.

**Work:**
- Define the `NodeExecutor` trait
- Define and publish `docs/superpowers/specs/backend-compatibility-matrix.md` (supported major line, source fixtures, policy translation, fail-fast policy)
- Implement shared CLI infrastructure:
  - `BufReader::with_capacity(256KB)` on all `ChildStdout` streams
  - `bytes::Bytes` for streaming payloads (zero-copy broadcast)
  - Common process lifecycle (stdin close, concurrent stdout/stderr, kill, timeout)
  - Linux pipe buffer sizing via `fcntl(F_SETPIPE_SZ, 1MB)` behind `cfg(target_os = "linux")`
- Implement Claude Code CLI adapter:
  - Process spawning with `--bare -p --output-format stream-json`
  - JSONL parsing (line-by-line, map to NodeEvent)
  - Cost extraction from usage fields
- Implement Gemini CLI adapter:
  - Process spawning with `-p --output-format stream-json`
  - Fixture-backed event mapping for the pinned version from the compatibility matrix
  - Version-incompatible fail-fast handling
- Implement Codex CLI adapter:
  - Process spawning with `--json --sandbox <backend-policy>`
  - JSONL event type mapping (ThreadStarted, ItemCompleted)
  - Generic studio sandbox policy -> backend-native policy translation
  - Non-interactive constraint handling
- Implement OpenRouter API adapter:
  - HTTP POST with SSE streaming
  - SSE line parsing (map to NodeEvent)
  - Rate limiting (Semaphore)
  - Error handling (pre-stream HTTP errors, mid-stream errors)
  - Cost extraction
- Implement CLI auto-detection:
  - Probe `claude --version`, `gemini --version`, `codex --version` at startup
  - Report availability + version in `initialize` response capabilities
  - Report OpenRouter credential state separately
  - Include install hints for missing tools
- Implement mock adapter for testing (deterministic responses from fixture files)

**Tests that validate this milestone:**
- Claude CLI: parse sample JSONL, verify NodeEvent sequences
- Gemini CLI: parse compatibility-matrix-pinned fixture, verify event mapping, verify `VersionIncompatible`
- Codex CLI: parse sample JSONL, verify sandbox policy translation
- API adapter: parse sample SSE streams, verify NodeEvent sequences
- API adapter: handle HTTP 429, verify error mapping
- Auto-detection: mock installed/missing binaries, verify capabilities response
- Integration: run a graph with the mock adapter, verify end-to-end output

**Expected protocol updates:** Possible streaming event adjustments based on real JSONL/SSE format details. Initialize response capabilities schema extended for backend detection.

### Milestone 2.6: Function System

**Deliverable:** Function subgraphs that can be defined, called, and nested.

**Work:**
- Implement function definition storage in the graph model
- Implement function node execution (create child execution context, run inner graph, enforce one designated return boundary, map outputs via output bindings)
- Implement function nesting (functions containing function nodes)
- Implement recursive call detection (build-time error)
- Implement function library loading from JSON files

**Tests that validate this milestone:**
- Single function: collapse nodes into function, call it, verify outputs match direct execution
- Nested function: function A calls function B, verify correct execution
- Recursive detection: function A calls function A, verify build-time error
- Extraction rejection: multi-terminal exec selection is rejected until normalized
- Library loading: load a function library file, use a function from it

**Expected protocol updates:** Possible function schema refinements.

### Milestone 2.7: Incremental Caching

**Deliverable:** Input-signature caching that skips unchanged nodes on re-run.

**Work:**
- Implement cache eligibility rules (read-only only by default; no cross-run cache for write-capable or HITL nodes)
- Implement input-signature hashing (hash of resolved inputs + stable node config + backend/version/env digests + workspace root digest + graph-level MCP config digest)
- Implement LRU cache (in-memory, configurable capacity)
- Integrate caching into the scheduler (check cache before spawning actor)
- Emit `node/skipped` with `reason: "cached"` for cache hits
- Emit `node/output/final` with `cached: true` for cached outputs

**Tests that validate this milestone:**
- Run graph twice with same inputs in the same engine session: verify eligible nodes are skipped and outputs match
- Change one node's input: verify that node and its downstream re-execute, upstream stays cached
- Change a node's config: verify that node re-executes
- Change a declared env reference, backend version, workspace root, or graph-level MCP config: verify cache invalidation
- Cancel a write-capable node mid-run: verify no cache entry is created for that node
- Cache capacity: fill cache beyond limit, verify LRU eviction

**Expected protocol updates:** Possible cache-related event field additions.

### Milestone 2.8: Safety Systems

**Deliverable:** Process sandboxing, cost budget enforcement, error port routing.

**Work:**
- Implement error port routing in the scheduler (failed node -> error port -> downstream, or escalate)
- Implement inherited per-node cost budget (project defaults + node overrides)
- Implement per-execution cost tracking (sum usage across nodes, abort if exceeded)
- Implement explicit `workspace_root` resolution and pass it to write-capable backends
- Implement process sandboxing for CLI adapters:
  - Linux: integrate `hakoniwa` or equivalent for namespace/Landlock isolation
  - Windows: restricted process tokens
  - macOS: Seatbelt profiles
- Implement dirty-run handling for interrupted or failed write-capable nodes
- Surface degraded sandbox guarantees in manifests and UI capabilities
- Fail closed for `workspace-write` when the requested workspace boundary cannot be enforced on the current platform/backend

**Tests that validate this milestone:**
- Error port test: node fails, error routes to connected fallback node
- Unhandled error test: node fails with no error port, execution aborts
- Cost budget test: mock adapter returns high cost, verify execution stops at budget
- Sandbox test: sandboxed process cannot write outside workspace (platform-specific)
- Degraded-platform policy test: `workspace-write` is rejected when boundary enforcement is unavailable
- Dirty-run test: kill a write-capable node mid-write, verify `dirtyWorkspace` is set and cache reuse is suppressed

**Expected protocol updates:** Possible error code additions for sandbox violations and budget exceeded.

### Milestone 2.9: MCP Server

**Deliverable:** Headless MCP host mode exposing graph manipulation tools over stdio using the shared engine library.

**Work:**
- Implement MCP server using the official Rust SDK tier or the thinnest stable wrapper available, with the support tier called out explicitly
- Expose all tools from TDD Section 9.3
- Implement stdio transport (read JSON-RPC from stdin, write responses to stdout)
- Make every mutating tool graph-id-scoped
- Route every mutating tool through the same canonical `graph/*` mutation API used by the editor
- Enforce `baseRevision` conflict handling on mutating tools
- Enforce graph-level MCP configuration only in v1
- Reject attempts to mutate active execution snapshots
- Validate tool inputs against graph schema (type checking, cycle detection)
- Wire tool execution to the graph model (create_node modifies the graph, validate runs validation, execute starts execution)

**Tests that validate this milestone:**
- Tool tests: call each MCP tool, verify graph is modified correctly
- Validation through MCP: create an invalid graph via tools, call validate, verify errors
- Execution through MCP: create a graph, execute it, get outputs
- End-to-end: simulate an LLM session that builds a pipeline via MCP tools

**Expected protocol updates:** Possible MCP tool schema refinements.

### Milestone 2.10: CLI Runner

**Deliverable:** A command-line interface for running graphs headlessly.

**Work:**
- Implement `pipeline-studio run <graph.json> [--input key=value]` command
- Implement `pipeline-studio mcp` host mode for stdio MCP serving
- Output execution events to stdout as JSONL
- Output final results as JSON
- Persist a run manifest per execution
- Support `--validate-only` flag (run validation without execution)
- Support `--timeout` and `--max-budget` flags

**Tests that validate this milestone:**
- Run a graph from the command line, verify correct JSON output
- Run with `--validate-only`, verify validation report
- Run a graph and verify manifest creation/content
- Start `pipeline-studio mcp`, call graph tools over stdio, verify revision and conflict behavior
- Run with invalid graph, verify error output

**Expected protocol updates:** None expected at this stage.

### Phase 2 Exit Criteria

- All Phase 1 conformance tests pass against the real engine
- All ~30-40 integration tests pass
- All ~25-30 adapter tests pass (all four adapters + auto-detection)
- CLI auto-detection reports correct availability or credential state for all targeted backends
- The CLI runner can execute sample graphs headlessly
- The headless MCP host passes revision/conflict tests over stdio
- The MCP server can create, validate, and execute graphs via tool calls
- The flagship end-to-end scenario passes, including cache behavior, workspace-write constraints, and run-manifest output
- The published platform/support matrix and backend compatibility matrix are met
- Performance baselines established: BufReader, bytes::Bytes, jemalloc, simd-json all integrated
- Protocol changelog documents all updates made during Phase 2

---

## Phase 3: UI

**Goal:** A Tauri 2 desktop application with a complete visual editor. The engine (from Phase 2) runs as a Rust backend within the same Tauri binary. The desktop shell is a transport wrapper over the canonical engine contracts, not a second protocol.

### Milestone 3.1: Tauri Shell and IPC Setup

**Deliverable:** Tauri 2 application with React + Vite frontend, engine running as backend, and Tauri commands/events mapped cleanly to canonical engine methods and event payloads.

**Work:**
- Scaffold Tauri 2 project with React 19 + Vite + TypeScript template
- Integrate the Phase 2 engine as a Rust library within the Tauri backend
- Implement Tauri commands (IPC) as wrapper mappings for canonical engine methods:
  - `graph_get(graphId)` -> `graph/get`
  - `graph_load(graphJson, baseRevision?)` -> `graph/load`
  - `graph_create_node(...)` / `graph_delete_node(...)` / `graph_connect(...)` / `graph_disconnect(...)` / `graph_set_config(...)` / `graph_copy_nodes(...)` / `graph_extract_function(...)`
  - `validate_connection(sourceNode, sourcePort, targetNode, targetPort)` -> `graph/validate_connection`
  - `execution_start(graphId, inputs)` -> `execution/start`
  - `execution_cancel(executionId)` -> `execution/cancel`
  - `human_respond(executionId, nodeId, response)` -> `human/respond`
- Implement Tauri events (pub/sub) for:
  - `graph/changed` wrapper for canonical `graph/changed`
  - `execution/events_batch` wrapper carrying canonical execution events in batches
- Verify IPC roundtrip: load a graph, start execution, receive events in the frontend

**Tests that validate this milestone:**
- IPC test: call each Tauri command, verify correct response
- Event test: start execution, verify frontend receives event stream
- Latency test: validate_connection roundtrip < 5ms (critical for wire-drawing UX)

**Expected controlled updates:** Desktop-bridge serialization adjustments only. Canonical method names, payload meanings, and execution semantics do not fork for Tauri.

### Milestone 3.2: React Flow Canvas and Graph Editing

**Deliverable:** Node graph canvas with custom node rendering and standard editing operations, with the engine remaining the authoritative owner of draft graph state.

**Work:**
- Install React Flow v12
- Set up Zustand store as a mirror/cache of engine-owned draft graph state (nodes, edges, selections, undo history)
- Set up Jotai atoms for per-node streaming output
- Implement custom node component with:
  - Title bar with node type icon and label
  - Typed input/output ports (handles) with type-specific colors
  - Node state indicator (pending/running/completed/failed/skipped)
  - Compact output preview (collapsed by default, expandable)
- Implement custom edge component with type-specific colors
- Implement graph editing operations:
  - Multi-select: click-drag selection rectangle, Ctrl+click to add to selection
  - Copy-paste: Ctrl+C/V duplicates selected nodes and internal wires; boundary wires disconnected on paste
  - Delete selection: Delete key removes selected nodes and their wires
  - Undo/redo: each operation replays canonical `graph/*` mutations against the engine-owned draft graph
- Implement graph serialization for persistence and clipboard/export flows, while normal edit operations remain synchronized against the engine-owned draft graph revision
- Wire up Tauri commands for save/load (read/write studio project files)

**Tests that validate this milestone:**
- Render test: load a graph, verify all nodes and edges appear
- Port color test: verify ports render with correct type colors
- Multi-select test: drag rectangle, verify correct nodes selected
- Copy-paste test: paste selection, verify duplicated nodes with internal wires
- Undo test: perform action, undo, verify state reverted
- Save/load roundtrip: create graph in UI, save, load, verify identical
- Graph revision sync test: stale edit is rejected, UI refreshes from `graph/changed` / `graph_get`

**Expected controlled updates:** Possible node metadata additions for UI rendering hints, without changing graph authority or runtime semantics.

### Milestone 3.3: Wire Connection with Type Checking

**Deliverable:** Drawing wires between nodes with real-time type validation.

**Work:**
- Implement React Flow's `onConnect` handler to call `validate_connection` Tauri command
- On valid connection: create the edge, update Zustand store
- On invalid connection: snap wire back, show tooltip with error message (type mismatch explanation)
- Implement wildcard resolution UI feedback (update port color when wildcard resolves)
- Implement visual indicators: compatible ports highlight when dragging a wire, incompatible ports dim

**Tests that validate this milestone:**
- Valid connection: draw wire between compatible ports, verify edge created
- Invalid connection: draw wire between incompatible ports, verify rejection with tooltip
- Wildcard: connect to `any` port, verify port color updates to match

**Expected engine/protocol updates:** None expected.

### Milestone 3.4: Node Palette and Search

**Deliverable:** Searchable node palette with type-aware filtering.

**Work:**
- Implement side panel with all available v1 node types, grouped by category (LLM, Control Flow, Functions, Human, Safety)
- Implement search box with fuzzy matching on node name and description
- Implement type-aware filtering: when a wire is being dragged from a port, the palette shows only nodes with compatible input/output ports
- Implement drag-from-palette-to-canvas to create a new node
- Implement right-click context menu on the canvas with the same palette (UE Blueprint-style)

**Tests that validate this milestone:**
- Search test: type "loop", verify loop nodes appear
- Type filter test: drag wire from text output, verify palette shows only nodes with text-compatible inputs
- Drag-to-create test: drag LLM node from palette, verify node appears on canvas

**Expected engine/protocol updates:** None expected.

### Milestone 3.5: Per-Node Configuration Panels

**Deliverable:** Configuration panel for each node type.

**Work:**
- Implement a detail panel (sidebar or bottom panel) that shows configuration for the selected node
- For each node type, render the appropriate config fields:
  - LLM Node: backend selector (with auto-detection status), model selector, system prompt textarea, temperature slider, budget input, sandbox policy selector
  - Router Node: condition builder (field, operator, value rows)
  - Loop nodes: range inputs, max iterations
  - HITL Node: timeout, timeout action selector
  - Sequence Node: branch count
- Backend selector UX for LLM nodes:
  - Read backend availability from engine's `initialize` capabilities response
  - Available backends: selectable with version shown
  - Unavailable backends: grayed out with tooltip showing install instructions (e.g., "Install Claude Code: npm install -g @anthropic-ai/claude-code")
  - OpenRouter: shown as available only when its credential reference resolves at runtime; project files store references, not raw secrets
- Changes to config update the Zustand store and trigger re-validation

**Tests that validate this milestone:**
- Config change test: modify LLM node's model, verify Zustand store updates
- Validation trigger test: set required field to empty, verify validation error appears
- Backend selector test: mock unavailable backend, verify grayed out with install hint

**Expected controlled updates:** Possible config field additions or type clarifications, but backend availability semantics remain engine-authored.

### Milestone 3.6: Live Streaming Output Display

**Deliverable:** Real-time streaming output per node during execution.

**Work:**
- Subscribe to Tauri execution events keyed by node ID
- Implement per-node Jotai atom for streaming output buffer
- Render streaming tokens in the node's output area as they arrive (append-only text with auto-scroll)
- Show node state transitions visually (pulsing border for running, green checkmark for completed, red X for failed, gray for skipped)
- Implement full output detail panel (click a completed node to see its full output in a resizable panel)
- Display cost information per node (from `usage` in `node/output/final`)

**Tests that validate this milestone:**
- Streaming test: execute a graph with mock adapter, verify tokens appear in node output area
- State indicator test: verify visual state changes as execution progresses
- Cost display test: verify cost appears after node completes

**Expected engine/protocol updates:** Possible streaming event buffering adjustments.

### Milestone 3.7: Error Panel

**Deliverable:** Error panel with clickable navigation to offending nodes.

**Work:**
- Implement bottom panel listing all validation errors and runtime errors
- Each error entry shows: severity icon, error message, node name
- Clicking an error: scrolls the canvas to the node, selects it, highlights it (pulsing red border)
- Errors update in real-time during execution (runtime errors appear as they occur)
- Clear errors action (clears resolved errors after graph modification)

**Tests that validate this milestone:**
- Navigation test: click error, verify canvas scrolls to correct node
- Runtime error test: execute graph with failing node, verify error appears in panel
- Clear test: fix the issue, verify error disappears after re-validation

**Expected engine/protocol updates:** None expected.

### Milestone 3.8: Function System UI

**Deliverable:** Extract-to-function, click-to-inspect, breadcrumb navigation.

**Work:**
- Implement selection -> right-click -> "Extract to Function" action
  - Prompt for function name
  - Identify boundary wires, create input/output ports (incoming wires become inputs, outgoing wires become outputs)
  - Reject extraction if the selection has multiple terminal exec exits; show guidance to normalize to one return path
  - Replace selection with a function node wired to the same neighbors
- Implement double-click on function node -> navigate into inner graph
  - Render inner graph in the same canvas (replace content)
  - Show breadcrumb trail at the top (Main > ResearchAndSummarize > inner)
- Implement breadcrumb click -> navigate back to parent graph
- Implement function node rendering: show input/output ports, show spinner during execution
- Implement function library panel: list available functions, drag-to-use

**Tests that validate this milestone:**
- Collapse test: select nodes, collapse, verify function node created with correct ports
- Navigate test: double-click function, verify inner graph displayed
- Breadcrumb test: click breadcrumb, verify return to parent graph
- Execution display test: run graph with function, verify spinner on function node

**Expected engine/protocol updates:** Possible function metadata additions for UI display.

### Milestone 3.9: Loop Iteration Inspector

**Deliverable:** Per-iteration output display for loop nodes.

**Work:**
- Subscribe to `loop/iteration` events for loop nodes
- Render an iteration picker (numeric stepper) on loop nodes after execution
- Clicking a specific iteration number shows that iteration's recorded inputs, outputs, and scheduler metadata for that pass
- Display current iteration count during execution (live counter)
- Persist iteration data in Jotai atoms keyed by `(nodeId, iterationIndex)`

**Tests that validate this milestone:**
- Iteration display test: run a ForLoop with 5 iterations, verify picker shows 0-4
- Iteration switch test: click iteration 3, verify correct output displayed
- Live counter test: during execution, verify counter increments

**Expected engine/protocol updates:** None expected.

### Milestone 3.10: Project Save/Load

**Deliverable:** Full studio-project persistence via Tauri filesystem APIs.

**Work:**
- Implement File > Save: serialize the current draft graph and project config, write to file via Tauri fs API
- Implement File > Open: read the studio project, hydrate engine-owned draft graph state, then mirror it into the UI store
- Implement File > New: reset state to empty graph
- Implement auto-save (debounced, write to a `.autosave` file every 30 seconds if changes exist)
- Implement recent projects list (stored in Tauri app data)
- Handle `config.json`: load `workspaceRoot`, MCP graph-level config, and env-var references on project open without persisting raw credentials into the editor state
- Expose run manifest browsing for recent executions as a read-only project inspection surface
- Dirty indicator: show unsaved changes marker in title bar

**Tests that validate this milestone:**
- Save/load roundtrip: create graph, save, close, reopen, verify identical
- Config test: save project with `workspaceRoot`, MCP config, and env-var references; reopen and verify the resolved draft loads correctly
- Auto-save test: make changes, wait, verify autosave file created
- Run manifest test: reopen a project with prior runs, verify manifests are listed read-only

**Expected engine/protocol updates:** None expected.

### Phase 3 Exit Criteria

- All Phase 1 conformance tests still pass (no protocol regressions)
- All Phase 2 integration tests still pass (no engine regressions)
- All ~20-25 UI component tests pass
- The desktop wrapper mappings remain aligned with canonical engine contracts
- The desktop application passes the flagship acceptance scenario end-to-end, including the Break-based approval loop, cache behavior, degraded-platform handling, and run-manifest inspection
- The full application can: create a graph, configure nodes, draw wires with type checking, run the graph, see streaming output, inspect errors, extract functions, inspect loop iterations, save and reopen the project, and inspect run manifests
- Protocol and engine changelogs document all controlled updates made during Phase 3

---

## Dependencies Between Milestones

```
Phase 1:  1.1 ─── 1.2 ─── 1.3 ─── 1.4
                                      │
Phase 2:                    2.1 ──── 2.2 ──── 2.3 ──── 2.4
                                                │        │
                                                │    2.5 (adapters)
                                                │        │
                                                │    2.6 (functions)
                                                │        │
                                                │    2.7 (caching)
                                                │        │
                                                │    2.8 (safety)
                                                │        │
                                                │    2.9 (MCP server)
                                                │
                                           2.10 (CLI runner, depends on engine lib)
                                                │
Phase 3:  3.1 (depends on engine lib, not CLI runner)
           │
          3.2 ──── 3.3
           │        │
          3.4      3.5
           │        │
          3.6 ──── 3.7
           │
          3.8 ──── 3.9
           │
          3.10
```

**Notes:**
- Phase 0 is the gating freeze. Parallel work begins only after ownership, baseline semantics, and the flagship acceptance fixture are approved.
- Phase 2 milestones 2.4-2.9 all depend on 2.3 (scheduler) and on the Phase 0 baseline. They can parallelize only where ownership is disjoint and no contract artifact is being edited by two teams at once.
- Milestone 2.10 (CLI runner) depends on the engine library crate, not on any specific milestone. It can be built any time after 2.3.
- Phase 3 milestone 3.1 depends on the engine library crate and the canonical graph mutation API (milestones 2.1-2.8). MCP host packaging in 2.9/2.10 can finish in parallel once that shared graph API is frozen.
- Phase 3 milestone 3.2 depends on the graph-authority decision from Phase 0: the UI store mirrors engine-owned draft state and must not become a second source of truth.
- Phase 3 milestones 3.4-3.5 can parallelize with 3.3 once the node metadata surface and backend capability surface are stable.
- Phase 3 milestone 3.8 (functions) depends on 3.6 (streaming display) for showing execution inside functions.
- Any contract change discovered after Phase 0 routes back through controlled change control: update the source document, re-freeze the baseline, and re-run the dependent tests before downstream work continues.

---

## Backflow: Controlled Contract Updates

### During Phase 2

| Milestone | Likely Updates |
|---|---|
| 2.1 (parsing) | Minor JSON schema clarifications (nullable vs optional fields, default values) |
| 2.3 (scheduler) | Execution event timing and ordering clarifications |
| 2.4 (node types) | Loop iteration event field additions |
| 2.5 (adapters) | Streaming event format adjustments based on pinned fixture evidence; initialize response capabilities schema extended for backend detection |
| 2.8 (safety) | New error codes for sandbox violations and budget exceeded |

### During Phase 3

| Milestone | Likely Updates |
|---|---|
| 3.1 (Tauri shell) | IPC serialization adjustments |
| 3.5 (config panels) | Config field type clarifications |
| 3.8 (functions) | Function metadata for UI display |

All controlled updates are documented in a protocol changelog (`PROTOCOL_CHANGELOG.md`). When the protocol changes, all Phase 1 conformance tests are updated and re-run. When the engine changes, all Phase 2 integration tests are re-run. No downstream team ships against an unfrozen contract revision.

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Protocol design flaws discovered late | Phase 0 freezes the cross-team contracts before implementation starts. Controlled updates are expected, but each one re-freezes the baseline and re-runs the dependent suites. Protocol evaluation confirmed JSON-RPC 2.0 is the right choice for the canonical external contract. |
| Tokio actor deadlocks | DAG constraint prevents bounded-channel cycles. Integration tests with parallel branches exercise the scheduling model early (Milestone 2.3). |
| CLI adapter JSONL format changes | Four adapters share common infrastructure (BufReader, process lifecycle, NodeEvent mapping). Adapter tests parse real sample output. Pin supported CLI tool versions in CI and fail fast on unsupported major versions. Auto-detection distinguishes unavailable, incompatible, and missing-credential states. |
| CLI tool not installed on user's machine | Auto-detection at engine startup probes for each CLI. UI grays out unavailable backends with install instructions. OpenRouter is only available when its credential reference resolves at runtime; it is not treated as an unconditional fallback. |
| React Flow performance at 100+ nodes | Zustand atomic selectors + Jotai per-node atoms minimize re-renders. IPC event batching (16ms flush interval) reduces Tauri IPC calls by 10-50x. React Flow performance work explicitly includes memoization, narrow subscriptions, and selective visible-element rendering rather than assuming built-in virtualization. |
| MCP server integration complexity | MCP server (Milestone 2.9) is built after the graph API is stable. The Rust SDK support tier is called out explicitly in the compatibility docs, and the host uses the thinnest stable integration path rather than assuming a Tier 1 surface. |
| Cross-platform sandboxing | Linux (hakoniwa) is the release-blocking enforcement target. macOS and Windows sandboxing are degraded/best-effort in v1 and that reduced guarantee is surfaced in the UI and run manifest. Sandbox level is per-node config, but the docs never imply uniform isolation across OSes. |
| Cross-platform performance optimizations | jemalloc (Linux/macOS only, not MSVC), Linux pipe buffer sizing (cfg-gated). Core optimizations (BufReader, bytes::Bytes, simd-json) are cross-platform. |
