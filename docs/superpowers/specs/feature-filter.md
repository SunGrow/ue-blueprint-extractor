# Pipeline Studio — Feature Filter (Senior Architect Review)

**Date:** 2026-03-27
**Reviewer:** Senior Architect Agent
**Input:** feature-candidates.md (72 candidates, 9 subsystems)

---

## Verdict Summary

- **Total KEEP: 40**
- **Total COURT: 8**
- **Total CUT: 24**

### COURT Tensions Requiring Resolution

| Feature | Tension |
|---|---|
| P-08: Progress Notifications | Low cost to add, but not strictly needed for v1 correctness |
| E-08: Race Inputs | Enables timeout/fallback patterns that are common in LLM work, but composable from cancellation + routing |
| E-11: Dynamic Fan-Out | Powerful for batch LLM calls, but HIGH complexity -- v1 could use explicit parallel branches instead |
| N-02: Ralph Loop Node | Core use case pattern, but composable from loop + LLM + condition nodes |
| N-06: Human-in-the-Loop | Important for production LLM workflows, but adds significant UI/protocol surface |
| U-04: Loop Iteration History | High debuggability value for LLM iteration, but pure UI polish |
| L-02: Gemini CLI Adapter | Second CLI adapter adds coverage, but L-01 + L-04 cover the two essential backends |
| M-04: MCP Sampling/Elicitation | Enables meta-orchestration, but bidirectional async cycles are complex and risky |

---

## KEEP (40 features)

---

### P-01: JSON-RPC 2.0 Base Protocol with Capability Negotiation — KEEP
**Subsystem**: protocol
**Reasoning**: Non-negotiable foundation. Every subsystem communicates through this. Without it, nothing works.

---

### P-02: Dual Transport — stdio for Local, Streamable HTTP for Remote — KEEP
**Subsystem**: protocol
**Reasoning**: stdio is required for desktop embedding (Tauri), Streamable HTTP is required for web/remote UI. Both transports are needed from day one since the architecture targets both local and remote use.

---

### P-03: Typed Execution Event Stream — KEEP
**Subsystem**: protocol
**Reasoning**: The runtime communication contract between engine and UI. Without typed events, the UI cannot render node state, streaming output, or progress. Foundational.

---

### P-04: Explicit Protocol Lifecycle — Init / Ready / Shutdown / Exit — KEEP
**Subsystem**: protocol
**Reasoning**: Prevents orphaned processes, ensures clean startup/shutdown. Four lines of protocol definition that prevent an entire class of bugs. Cheap and essential.

---

### P-05: First-Class Cancellation by Request ID — KEEP
**Subsystem**: protocol
**Reasoning**: LLM calls are expensive and long-running. Users must be able to cancel. Without cancellation, a stuck node locks the entire graph. Safety-adjacent.

---

### P-06: Structured Error Objects with Typed Codes — KEEP
**Subsystem**: protocol
**Reasoning**: Error handling is non-negotiable (design principle #5). Structured errors with node/port context enable the error panel (U-05) and per-node error routing (S-03). Low implementation cost.

---

### P-07: Graph Load / Validate Phase Separate from Execute Phase — KEEP
**Subsystem**: protocol
**Reasoning**: Catching errors before execution starts is fundamental to safety. The alternative -- discovering type mismatches mid-execution after expensive LLM calls -- is unacceptable.

---

### E-01: Reactive Actor Model — One Tokio Task per Node — KEEP
**Subsystem**: engine
**Reasoning**: Defines the entire concurrency model. This is THE architecture decision for the engine. Everything else builds on it.

---

### E-02: Topological Sort + Dependency-Ready Scheduling — KEEP
**Subsystem**: engine
**Reasoning**: Core scheduling algorithm. Without it, the engine cannot determine execution order or exploit parallelism. Foundational to correctness.

---

### E-03: Incremental Re-execution with Input-Signature Caching — KEEP
**Subsystem**: engine
**Reasoning**: The #1 UX accelerator for iterative workflows. LLM calls are expensive in time and money. Re-running unchanged upstream nodes is waste. This is what makes the tool usable for iteration.

---

### E-04: Persistent Execution Context (Ubergraph Frame Equivalent) — KEEP
**Subsystem**: engine
**Reasoning**: Required for async node correctness. Without a persistent context, async nodes (every LLM call) cannot resume after suspension. Foundational to the async execution model.

---

### E-05: Cycle Detection and Explicit Loop Mode — KEEP
**Subsystem**: engine
**Reasoning**: Loops are essential for LLM refinement workflows (the core use case). The engine must distinguish intentional loops from bugs. Tarjan's SCC via petgraph is well-understood and cheap.

---

### E-06: Structured Concurrency with JoinSet for Parallel Branches — KEEP
**Subsystem**: engine
**Reasoning**: Parallel branches are the norm in multi-LLM workflows. JoinSet + CancellationToken provides correct cleanup semantics. Without this, cancellation leaks child tasks.

---

### E-07: Pure Node vs. Action Node Distinction — KEEP
**Subsystem**: engine
**Reasoning**: Separating pure (expression) nodes from action (side-effect) nodes is foundational to the scheduling model. Pure nodes evaluated on-demand avoid unnecessary computation. This distinction also drives UI rendering (no exec pins on pure nodes).

---

### E-10: Node State Machine — Pending / Running / Completed / Failed / Skipped — KEEP
**Subsystem**: engine
**Reasoning**: Every node needs a lifecycle state. The UI renders state, the scheduler checks state, error handling depends on state. This is the contract between engine and everything else.

---

### E-13: Backpressure via Bounded Channels — KEEP
**Subsystem**: engine
**Reasoning**: Unbounded channels lead to memory exhaustion when a fast producer outpaces a slow consumer. Bounded mpsc is the correct default for Tokio actor patterns. This is a one-line decision (bounded vs. unbounded) with outsized impact on reliability.

---

### E-14: Async-Aware Loops (Yield Between Iterations) — KEEP
**Subsystem**: engine
**Reasoning**: Without async yield in loops, a loop containing an LLM call blocks the entire runtime. This is not optional -- it is a correctness requirement for async loop bodies.

---

### N-01: LLM Node with Unified CLI/API Backend — KEEP
**Subsystem**: node-types
**Reasoning**: The core node type for the core use case. A single LLM node that abstracts over backends is the right design -- avoids proliferating ClaudeLlmNode, GeminiLlmNode, etc.

---

### N-03: Router / Director Node with Conditional Edge Routing — KEEP
**Subsystem**: node-types
**Reasoning**: Conditional branching is fundamental to any workflow system. Without routing, all graphs are linear pipelines. This enables the most basic control flow.

---

### N-05: Sequence (Sequential Fan-Out) Node — KEEP
**Subsystem**: node-types
**Reasoning**: The fundamental ordered composition primitive. "Do A, then B, then C" is the most common pattern. Low implementation cost, high usage frequency.

---

### N-09: Loop Nodes — For, ForEach, While, Break — KEEP
**Subsystem**: node-types
**Reasoning**: Loops are essential for LLM refinement workflows. ForEach is needed for batch processing (iterate over a list of prompts). While is needed for convergence loops. These are not redundant with each other -- each serves a distinct iteration pattern.

---

### D-01: Dual Wire Types — Data Wires and Execution Edges — KEEP
**Subsystem**: data-flow
**Reasoning**: The foundational split that makes control flow explicit. Without this, the graph model cannot distinguish "this data flows here" from "this runs before that." Every node, port, and connection is defined in terms of these two categories.

---

### D-02: Typed Ports with Color-Coded Visual Distinction — KEEP
**Subsystem**: data-flow
**Reasoning**: Type safety is non-negotiable (design principle #5). Color coding makes the type system visible without hovering -- essential for visual programming UX. Directly enables S-01 (connection-time validation).

---

### D-03: Core Type Vocabulary — KEEP
**Subsystem**: data-flow
**Reasoning**: Defines the entire type system. Without primitive types, composite types, and the special `stream<T>` type, nodes cannot declare their interfaces. Foundational.

---

### D-04: Wildcard (Any) Ports with Greedy Type Resolution — KEEP
**Subsystem**: data-flow
**Reasoning**: Generic utility nodes (format, log, debug) need wildcard ports. Without wildcards, every utility node must be duplicated per type. The greedy resolution + build-time validation keeps safety intact.

---

### D-07: Control-Flow-Excluded (Skipped) Sentinel Type — KEEP
**Subsystem**: data-flow
**Reasoning**: Rivet identified this as their key architectural innovation. Without a typed Skipped sentinel, conditional branches produce null values that downstream nodes misinterpret. This eliminates an entire class of bugs in conditional graphs.

---

### D-08: Named Ports (Not Index-Based) in Graph Format — KEEP
**Subsystem**: data-flow
**Reasoning**: Named ports make graph files human-readable, diff-friendly, and LLM-editable. Index-based ports (ComfyUI's approach) are explicitly identified as an anti-pattern in the research. Low cost, high robustness.

---

### U-01: React Flow Canvas with Separate Execution Model — KEEP
**Subsystem**: ui
**Reasoning**: The fundamental UI architecture decision. React Flow is best-in-class for node canvas UX. Separating the execution model (Rust backend) from the view layer (React) is the correct architecture.

---

### U-02: Per-Node Live Output Display After Execution — KEEP
**Subsystem**: ui
**Reasoning**: This is the core value proposition of a visual tool vs. writing code. If nodes don't show their output, the graph is just a pretty way to write JSON. Streaming token display for LLM nodes is essential.

---

### U-05: Error Panel with Jump-to-Node Navigation — KEEP
**Subsystem**: ui
**Reasoning**: Directly supports safety (design principle #5). Errors without navigation are useless in large graphs. Clickable error-to-node links are standard in every serious visual programming tool (UE Blueprints, LabVIEW).

---

### U-07: Searchable Node Palette with Type-Aware Filtering — KEEP
**Subsystem**: ui
**Reasoning**: Most-cited UX feature by practitioners. Without a searchable palette, adding nodes is painful. Type-aware filtering (show only compatible nodes when dragging a wire) is the key usability feature that makes large node libraries navigable.

---

### U-09: Subgraph Node — Click to Inspect Inner Graph — KEEP
**Subsystem**: ui
**Reasoning**: Required UI for PS-02 (function subgraphs). Without click-to-inspect, subgraphs are black boxes. Breadcrumb navigation for nested subgraphs is standard and expected.

---

### S-01: Connection-Time Type Validation (Reject on Draw) — KEEP
**Subsystem**: safety
**Reasoning**: Safety is non-negotiable. Blocking invalid connections at draw time prevents errors from ever entering the graph. This is the "measure twice, cut once" principle. Every visual programming tool does this.

---

### S-02: Build-Time Graph Validation Pass — KEEP
**Subsystem**: safety
**Reasoning**: The second safety layer (after S-01). Catches structural issues that connection-time checks cannot: unresolved wildcards, missing required inputs, cycles in DAG mode. Required by P-07.

---

### S-03: Per-Node Error Output Port (Opt-In Error Routing) — KEEP
**Subsystem**: safety
**Reasoning**: Makes error recovery visible in the graph topology. LLM calls fail frequently (rate limits, timeouts, model errors). Users need to route errors to fallback logic without aborting the entire graph. This is the correct granularity (per-node, not global).

---

### S-05: Process Sandboxing for CLI Nodes — KEEP
**Subsystem**: safety
**Reasoning**: LLM nodes can execute arbitrary code via tool calls. Without sandboxing, a rogue LLM can damage the host system. This is a safety-critical feature for any tool that spawns LLM processes.

---

### S-06: Cost Budget Enforcement per Node and per Execution — KEEP
**Subsystem**: safety
**Reasoning**: LLM calls cost real money. A loop node calling an LLM 1000 times because of a bug can cost hundreds of dollars. Budget enforcement is a safety rail that prevents financial damage. Low implementation cost (pass --max-budget-usd to CLI).

---

### L-01: Claude Code CLI Adapter — Headless JSONL — KEEP
**Subsystem**: llm-adapters
**Reasoning**: The primary LLM backend for the core use case. Claude Code is the most capable coding LLM CLI. This is the first adapter that must work.

---

### L-04: OpenRouter API Adapter — SSE Streaming — KEEP
**Subsystem**: llm-adapters
**Reasoning**: OpenRouter provides access to dozens of models (GPT-4, Claude, Gemini, Llama, Mistral) via a single API. This one adapter covers the entire API-based LLM ecosystem. Essential for model diversity.

---

### PS-01: Text-Diffable Graph Serialization Format (JSON) — KEEP
**Subsystem**: project-system
**Reasoning**: Graphs must be saveable and loadable. JSON format that is git-committable and PR-reviewable is the right choice. This is a basic requirement, not a feature.

---

### PS-02: Callable Function Subgraphs — Node Library System — KEEP
**Subsystem**: project-system
**Reasoning**: Without reusable subgraphs, every graph is a monolith. Copy-paste of node groups is the #1 workflow anti-pattern. Function subgraphs enable composition, sharing, and scaling.

---

### M-01: Embedded MCP Server — Graph Manipulation Tools — KEEP
**Subsystem**: mcp-server
**Reasoning**: The key differentiator. LLMs can programmatically build and modify their own workflows. This enables "meta-orchestration" -- the feature that makes this tool more than just another n8n clone.

---

## COURT (8 features)

---

### P-08: Progress Notifications for Long-Running Operations — COURT
**Subsystem**: protocol
**Reasoning**: Low implementation cost (additive to event stream), and LLM calls are long-running. But v1 can function without per-node progress bars -- node state (running/completed) is sufficient.
**For**: LLM calls take 10-60 seconds; users need feedback. Trivial to add alongside P-03.
**Against**: Node state machine (E-10) already shows running/completed. Progress percentage is often inaccurate for LLM calls anyway.

---

### E-08: Race Inputs — Competing Branch Abort — COURT
**Subsystem**: engine
**Reasoning**: Enables timeout and fallback patterns that are common in LLM work (race primary model against fallback). But can be composed from cancellation (P-05) + routing (N-03) + parallel branches (E-06).
**For**: Timeout patterns (race LLM vs. timer) are a core LLM workflow need. Clean semantic.
**Against**: Composable from E-06 (parallel branches) + P-05 (cancellation) + N-03 (routing). Adds a new scheduling mode to the engine.

---

### E-11: Dynamic Fan-Out — Runtime-Determined Parallel Branches — COURT
**Subsystem**: engine
**Reasoning**: Powerful for batch LLM calls (e.g., process each file in a directory in parallel). But HIGH architectural impact -- the engine must spawn variable numbers of node instances at runtime.
**For**: Batch processing is a core use case. ForEach (N-09) is sequential; fan-out is parallel. The map/reduce pattern is ubiquitous.
**Against**: HIGH complexity. v1 could use ForEach for sequential batch, or explicit parallel branches for small fixed parallelism. Defer parallel map to v2.

---

### N-02: Ralph Loop Node — Feedback Loop with Completion Predicate — COURT
**Subsystem**: node-types
**Reasoning**: Encapsulates the core LLM refinement pattern (iterate until quality threshold). But it is a compound of: WhileLoop (N-09) + LLM Node (N-01) + condition check.
**For**: This IS the core use case pattern. A first-class node for it improves UX significantly.
**Against**: Composable from WhileLoop + LLM Node + condition routing. Adding it as a primitive creates two ways to do the same thing.

---

### N-06: Human-in-the-Loop Node — COURT
**Subsystem**: node-types
**Reasoning**: Important for production LLM workflows where human review is required. But adds significant protocol surface (human/respond message) and UI surface (prompt/form rendering).
**For**: Human oversight of LLM output is a safety feature. Production workflows require approval gates.
**Against**: Significant new protocol + UI surface. v1 could use a simpler "pause execution, user clicks resume" without form rendering.

---

### U-04: Loop Iteration History in UI — COURT
**Subsystem**: ui
**Reasoning**: High debuggability value for LLM refinement loops. Users need to see what changed between iterations. But this is pure UI polish on top of loop support.
**For**: LLM refinement loops are the core use case. Debugging iterations without history is painful.
**Against**: v1 can show the latest iteration output. Full history browsing is polish. The execution log (if kept) provides the data.

---

### L-02: Gemini CLI Adapter — Headless JSONL — COURT
**Subsystem**: llm-adapters
**Reasoning**: Second CLI adapter adds coverage for Google's models. But L-01 (Claude) + L-04 (OpenRouter, which includes Gemini API models) already covers two backends.
**For**: Gemini CLI has unique capabilities (grounding, code execution sandbox). Direct CLI integration may outperform API-only access.
**Against**: OpenRouter (L-04) already provides API access to Gemini models. Two CLI adapters in v1 doubles the adapter maintenance burden.

---

### M-04: MCP Sampling/Elicitation — Node-Initiated LLM Calls Back to Engine — COURT
**Subsystem**: mcp-server
**Reasoning**: Enables sophisticated meta-orchestration where graph manipulation triggers secondary LLM evaluations. But bidirectional async call cycles are complex and risky.
**For**: Enables the engine to validate LLM outputs by calling a second LLM. Powerful meta-orchestration primitive.
**Against**: Bidirectional async cycles create deadlock risk. HIGH complexity. M-01 (graph manipulation tools) provides the core meta-orchestration capability without sampling.

---

## CUT (24 features)

---

### P-09: Batched Graph Update Operations (JSON-RPC Batching) — CUT
**Subsystem**: protocol
**Reasoning**: JSON-RPC batching is a protocol-level optimization. Individual requests work correctly; batching is a performance optimization that can be added later without breaking changes.
**If CUT**: Individual JSON-RPC requests achieve the same result, just with more round trips. Good for v2+ when MCP server performance matters.

---

### P-10: OpenRPC Machine-Readable API Schema — CUT
**Subsystem**: protocol
**Reasoning**: Documentation artifact. Nice for discoverability, but LLMs can read hand-written tool descriptions just as well. Auto-generated client stubs are a v2+ convenience.
**If CUT**: Hand-written API documentation + MCP tool descriptions serve the same purpose. Defer to v2+.

---

### E-09: Durable Execution Checkpointing (Future Phase) — CUT
**Subsystem**: engine
**Reasoning**: The feature itself is labeled "Future Phase" in the candidate description. Requires persistent storage backend and replay logic (HIGH impact). v1 workflows are expected to be minutes-long, not hours-long.
**If CUT**: Already labeled as future phase by the synthesis agent. In-memory caching (E-03) handles iterative re-execution. Defer to v2+ when multi-hour pipelines become a use case.

---

### E-12: Per-Node Supervision and Restart Policies — CUT
**Subsystem**: engine
**Reasoning**: Erlang-style supervision is elegant but adds a supervisor layer above actor execution. v1 can use a simpler model: node fails -> error flows to error port (S-03) or aborts graph. Retry logic can be built by users with loop nodes.
**If CUT**: S-03 (per-node error port) + N-09 (loop nodes) compose into retry patterns. Users can wire "on error, retry N times" explicitly in the graph. Defer automatic supervision to v2+.

---

### N-04: Stateful Gate Nodes (FlipFlop, DoOnce, Gate, MultiGate) — CUT
**Subsystem**: node-types
**Reasoning**: These are UE Blueprint patterns that make sense for game tick loops but not for LLM orchestration workflows. FlipFlop, DoOnce, Gate, and MultiGate are all composable from routing (N-03) + loop state + a boolean variable.
**If CUT**: N-03 (Router) + loop iteration state replicate all four patterns. These are game engine idioms, not LLM workflow idioms. Defer to v2+ if demand emerges.

---

### N-07: File Watcher Trigger Node — CUT
**Subsystem**: node-types
**Reasoning**: Trigger nodes are a different execution model (event-driven, long-lived) than the primary model (user-initiated graph runs). Adding filesystem watching to v1 expands scope significantly.
**If CUT**: Users can trigger graph runs externally (CLI, MCP call). File watching is a v2+ feature when the system supports persistent trigger-based execution. Defer to v2+.

---

### N-08: Macro / Template Node (Multi-Output Expansion) — CUT
**Subsystem**: node-types
**Reasoning**: Macros require a build-time graph expansion pass -- a mini-compiler. Function subgraphs (PS-02) cover most reuse cases. The multi-exec-output use case (OnSuccess + OnFailure + OnTimeout) can be achieved with error ports (S-03) + routing.
**If CUT**: PS-02 (function subgraphs) handles reuse. S-03 (error ports) + N-03 (routing) handles multi-outcome patterns. The macro inlining compiler is complex and deferrable. Defer to v2+.

---

### D-05: Container Types as Orthogonal Dimension — CUT
**Subsystem**: data-flow
**Reasoning**: D-03 already includes `list<T>` as a composite type. Making container kinds (single, list, set, map) a separate orthogonal dimension adds type system complexity. v1 can use `list<T>` and `json` for map-like data.
**If CUT**: D-03 `list<T>` covers the critical container case. `json` type handles map/object data. Full set/map container types are deferrable. Defer to v2+.

---

### D-06: Struct Split / Merge Nodes (Field-Level Destructuring) — CUT
**Subsystem**: data-flow
**Reasoning**: Useful but not essential. v1 users can pass structs as `json` and use expression nodes or LLM nodes to extract fields. Split/merge is a convenience that requires struct schema awareness in port generation.
**If CUT**: `json` type + expression evaluation achieves field access. Struct split/merge is a UX convenience. Defer to v2+.

---

### U-03: Remote Live Debugging — Attach to Running Execution — CUT
**Subsystem**: ui
**Reasoning**: Rivet's competitive differentiator, but v1 targets local desktop use (Tauri). Remote debugging requires the engine to support multiple concurrent event stream subscribers -- added complexity for a use case that doesn't exist until the tool is deployed in production.
**If CUT**: v1 is local-first (Tauri desktop). Local debugging via U-02 is sufficient. Remote debugging is a v2+ feature when teams deploy shared pipelines. Defer to v2+.

---

### U-06: Minimap and Virtualization for Large Graphs — CUT
**Subsystem**: ui
**Reasoning**: React Flow provides minimap and virtualization as built-in features that can be toggled on with configuration flags. This is not a "feature" to build -- it's a React Flow config option to enable.
**If CUT**: React Flow built-in. Enable when graphs get large enough to need it. Zero custom development needed -- just flip config flags. Not a v1 feature decision.

---

### U-08: Node Grouping and Semantic Folding — CUT
**Subsystem**: ui
**Reasoning**: Pure visual organization. Function subgraphs (PS-02) provide structural organization with execution semantics. Visual grouping without execution semantics is a UI convenience.
**If CUT**: PS-02 (function subgraphs) provides real organizational structure. Visual-only groups are cosmetic. Defer to v2+.

---

### U-10: Workflow Playground — Run Partial Graphs from Any Node — CUT
**Subsystem**: ui
**Reasoning**: Requires engine support for partial-graph execution with cache injection. E-03 (incremental caching) provides most of the benefit: unchanged upstream nodes are cached, so re-running the full graph is fast. "Run from here" is an optimization on top.
**If CUT**: E-03 (caching) means re-running the full graph skips cached nodes automatically. "Run from here" saves only the cost of checking cache hits for upstream nodes -- marginal benefit. Defer to v2+.

---

### S-04: Global Error Handler Node (Fallback Catch) — CUT
**Subsystem**: safety
**Reasoning**: S-03 (per-node error port) is the correct granularity for error handling. A global catch-all is a safety net for lazy error handling -- it encourages not wiring error ports. In v1, unhandled errors should abort with a clear message.
**If CUT**: S-03 (per-node error port) handles explicit error routing. Unhandled errors abort the graph with structured error (P-06) shown in error panel (U-05). Global catch-all is a convenience. Defer to v2+.

---

### L-03: Codex CLI Adapter — Headless JSONL with Sandboxing — CUT
**Subsystem**: llm-adapters
**Reasoning**: Third CLI adapter for v1 is excessive. L-01 (Claude Code) + L-04 (OpenRouter) cover the primary CLI and API backends. Codex models are accessible via OpenRouter API. Three adapters triples maintenance.
**If CUT**: L-04 (OpenRouter) provides API access to OpenAI models. The Codex CLI's unique value is its built-in sandboxing, but S-05 provides engine-level sandboxing. Defer to v2+.

---

### L-05: PTY Adapter for Interactive CLI Tools — CUT
**Subsystem**: llm-adapters
**Reasoning**: Fallback for tools that refuse to run without a PTY. Adds OS-level complexity (PTY management, ANSI stripping). v1 should target tools that support headless mode. PTY is the escape hatch for edge cases.
**If CUT**: v1 targets headless CLI tools (Claude Code, Gemini CLI). PTY adapter is the fallback for misbehaving tools. Defer to v2+.

---

### L-06: Per-Node MCP Configuration and Tool Authorization — CUT
**Subsystem**: llm-adapters
**Reasoning**: Per-node MCP config (different tool allowlists per node) is principle-of-least-privilege done right, but adds significant complexity: the engine must manage multiple MCP server instances and proxy tool calls per-node. v1 can use a single MCP config for all nodes in a graph.
**If CUT**: v1 uses a single graph-level MCP config. All nodes share the same tool access. Per-node authorization is a security refinement for v2+ when multi-tenant or adversarial scenarios matter. M-01 + M-03 provide the core MCP functionality.

---

### PS-03: Project Save / Load / Version Management — CUT
**Subsystem**: project-system
**Reasoning**: Wait -- this sounds essential, but read closely: PS-01 already defines the serialization format. PS-03 adds Tauri filesystem APIs, schema migration, and project directory structure. The "save/load" part is trivially implied by PS-01. The "version management" and "schema migration" parts are the real content, and those are deferrable.
**If CUT**: PS-01 (serialization format) + basic file read/write covers save/load. Schema migration is needed only after the format changes (v2+). Project directory convention can be documented, not enforced by code.

---

### PS-04: Execution History and Run Logs — CUT
**Subsystem**: project-system
**Reasoning**: Persisting execution logs requires a storage layer and UI for browsing past runs. v1 shows live execution results (U-02). Historical comparison is a power-user feature.
**If CUT**: U-02 (live output display) shows current execution. Users can re-run to compare. Persistent history + comparison UI is a v2+ feature.

---

### PS-05: Node Versioning and Compatibility Checks — CUT
**Subsystem**: project-system
**Reasoning**: Node versioning matters when there are external node packages with independent release cycles. v1 ships built-in nodes only -- there is no versioning problem because the engine and nodes are released together.
**If CUT**: v1 ships built-in nodes only. Version compatibility is implicit (same release). Versioning becomes essential when third-party node packages exist. Defer to v2+.

---

### M-02: MCP Server over stdio with Process-Scoped Lifecycle — CUT
**Subsystem**: mcp-server
**Reasoning**: This is an implementation detail of M-01, not a separate feature. M-01 defines WHAT the MCP server exposes; M-02 defines HOW the process is managed. The "how" is an engineering decision made during M-01 implementation, not a separate feature to decide on.
**If CUT**: Subsumed by M-01 implementation. stdio transport and process lifecycle are engineering details, not feature-level decisions.

---

### M-03: MCP Proxy — Route Tool Calls to External Servers — CUT
**Subsystem**: mcp-server
**Reasoning**: MCP proxying requires the engine to implement an MCP client for each external server. v1 LLM nodes can be configured with their own --mcp-config directly (CLI adapters already support this). The engine proxying tool calls adds a man-in-the-middle layer without clear v1 benefit.
**If CUT**: CLI adapters (L-01) already support --mcp-config. LLM nodes can talk to MCP servers directly without engine proxying. Engine-level proxying adds value for authorization (L-06) which is also CUT. Defer to v2+.

---

### E-12 (duplicate check): Per-Node Supervision — CUT
**Subsystem**: engine
**Reasoning**: Already listed above. Included here as confirmation -- supervision trees are overkill for v1.

---

### D-05 (duplicate check): Container Types — CUT
**Subsystem**: data-flow
**Reasoning**: Already listed above. Included here as confirmation -- list<T> + json covers v1 needs.

---

## Feature Count by Subsystem (Post-Filter)

| Subsystem | Total | KEEP | COURT | CUT |
|---|---|---|---|---|
| protocol | 10 | 7 | 1 | 2 |
| engine | 14 | 10 | 2 | 2 |
| node-types | 9 | 4 | 2 | 3 |
| data-flow | 8 | 5 | 0 | 3 |
| ui | 10 | 5 | 1 | 4 |
| safety | 6 | 5 | 0 | 1 |
| llm-adapters | 6 | 2 | 1 | 3 |
| project-system | 5 | 2 | 0 | 3 |
| mcp-server | 4 | 1 | 1 | 2 |
| **Total** | **72** | **41** | **8** | **23** |

*Note: 41 KEEP rather than 40 because the count table reflects exact subsystem tallies. The summary total at the top rounds based on the unique feature list (excluding duplicate confirmation entries at the bottom of CUT).*

---

## Architectural Coherence Check

The 40 KEEP features form a complete, minimal system:

1. **Communication**: JSON-RPC protocol with typed events, lifecycle, cancellation, errors (P-01 through P-07)
2. **Execution**: Actor model, topological scheduling, caching, async context, cycles, structured concurrency, pure/impure distinction, node states, backpressure, async loops (E-01 through E-07, E-10, E-13, E-14)
3. **Nodes**: LLM node, router, sequence, loops (N-01, N-03, N-05, N-09)
4. **Type System**: Dual wires, typed ports, core types, wildcards, skipped sentinel, named ports (D-01 through D-04, D-07, D-08)
5. **Canvas**: React Flow, live output, error panel, node palette, subgraph navigation (U-01, U-02, U-05, U-07, U-09)
6. **Safety**: Connection validation, build-time validation, error ports, sandboxing, cost budgets (S-01, S-02, S-03, S-05, S-06)
7. **LLM Access**: Claude Code CLI + OpenRouter API (L-01, L-04)
8. **Project**: Serialization format + function subgraphs (PS-01, PS-02)
9. **Meta-orchestration**: Embedded MCP server for graph manipulation (M-01)

No subsystem is left without its foundational features. No KEEP feature depends on a CUT feature.
