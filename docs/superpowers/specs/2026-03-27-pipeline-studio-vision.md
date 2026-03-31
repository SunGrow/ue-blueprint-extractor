# Pipeline Studio -- Vision Document

**Date:** 2026-03-27
**Version:** 1.0

---

## 1. The Problem

A single LLM session is surprisingly capable -- until the task outgrows its context window, requires coordination between different models, or spans multiple projects.

Consider a real workflow: you need Claude Code to research a UI component library, then pass its findings to Gemini to generate CSS utility classes, then have Claude review the output for accessibility issues, then feed the results into a build system. Today, you do this manually: copy output from one terminal, paste it into another, adjust prompts based on intermediate results, re-run when something fails. If step three reveals a problem, you restart from step one.

This breaks down in predictable ways:

- **Context is lost between steps.** Each LLM session starts fresh. The researcher's findings are flattened into a pasted blob, losing structure and nuance.
- **Error recovery is manual.** When the CSS generator produces invalid output, you notice (or don't), then manually re-run with adjusted prompts. There is no automatic fallback path.
- **Cost is invisible.** You have no idea how much each step costs until you check your billing dashboard days later. A loop that was supposed to run three times ran thirty because the prompt was ambiguous.
- **Iteration is painful.** Changing one step in the middle of a pipeline means re-running everything, including the expensive upstream steps that didn't change.
- **Parallelism is impossible.** You can't run the CSS generator and the accessibility checker simultaneously, even when they have no dependencies on each other.

These are not limitations of any individual LLM. They are limitations of treating LLM interactions as isolated conversations instead of steps in a structured workflow.

---

## 2. What Pipeline Studio Is

Pipeline Studio is a desktop application where you build LLM workflows visually -- dragging nodes onto a canvas, connecting them with wires, and running the whole pipeline with one click. Each node is a self-contained step: call an LLM, route execution, loop until a quality threshold is met, or pause for human review. Wires carry typed data or execution signals, and the system prevents incompatible connections before you ever run anything. The engine executes eligible nodes in parallel, caches eligible read-only work so you don't re-run unchanged steps, and streams output in real time so you can watch each node work. An embedded MCP server lets external LLMs build and modify draft workflows programmatically, making the tool itself programmable infrastructure.

### v1 Ground Rules

These rules define the v1 contract across this document stack:

- **Immutable execution snapshot:** every run executes against a frozen graph snapshot. Graph edits made through the editor or MCP apply before the next run, not to the active run.
- **Exec-only control flow:** execution order travels only on `exec` wires. Branches not taken enter a skipped node state; v1 does not model "branch not taken" as a data value on exec wires.
- **Fixed action-node contracts:** built-in action nodes expose canonical ports defined in the TDD. The editor may show friendly labels, but execution semantics always use the canonical ports.
- **Root action startup:** an action node with no incoming exec wire receives an implicit start signal once its required data inputs are satisfied.
- **Graph-level MCP in v1:** MCP configuration is owned at the graph/project level in v1. Per-node MCP authorization is deferred.
- **Explicit workspace root:** write-capable nodes are constrained by a configured `workspace_root`, not by an overloaded idea of "the project."
- **Conservative cache defaults:** only eligible read-only work may hit the in-memory cross-run cache for the current engine session.
- **Minimal provenance in v1:** every run persists a machine-readable run manifest. Rich history UI and diff tooling remain deferred.

**Document roles:** this vision explains product intent and v1 scope. The TDD is normative for behavior and data contracts. The implementation plan is normative for sequencing, ownership, and exit gates.

---

## 3. Core Concepts

### Nodes

A node is a single step in a workflow. It has typed input ports (where data arrives), typed output ports (where results leave), and a configuration panel (where you set parameters like which model to use).

In v1, built-in action nodes have fixed canonical ports. For example, the LLM Node always has `exec_in`, `prompt`, optional `systemPrompt`, optional `context`, `response`, `stream`, `usage`, `error`, and `exec_out`. Product examples may describe the business meaning of a value ("review feedback", "workspace root path"), but the runtime contract still uses those canonical ports.

### Wires

Wires connect output ports to input ports, defining how data flows between nodes. There are two kinds:

- **Data wires** carry typed values (text, numbers, JSON, images). They are color-coded by type -- purple for text, blue for numbers, orange for JSON.
- **Execution wires** control the order nodes run in. They are gray and look like arrows. A node with an incoming execution wire only runs when the previous node finishes. If an action node has no incoming execution wire, the engine treats it as a root action node and injects an implicit start signal when its required data inputs are ready.

**Example:** A wire from the research node's `response` output to the CSS generator's `context` input. The wire is purple because both ports are type `text`. If you tried to connect the `response` output to a port expecting a `number`, the wire would snap back with a tooltip explaining the type mismatch.

### Typed Data

Every port declares what kind of data it accepts or produces. The most common types are:

- **text** -- strings, prompts, LLM responses
- **number** -- integers and floats
- **boolean** -- true/false for conditions
- **json** -- arbitrary structured data
- **binary** -- raw bytes (files, encoded data)
- **image** -- image data with format metadata
- **error** -- a structured error with code, message, and context
- **exec** -- an execution signal that controls the order nodes run in (carries no data)
- **stream\<T\>** -- a value that arrives incrementally (like LLM tokens streaming in)
- **list\<T\>** -- an ordered collection of any type
- **struct** -- a bundle of named typed fields (like `{name: text, count: number}`)
- **optional\<T\>** -- a value that may or may not be present
- **any** -- a wildcard that adopts the type of whatever connects to it

The full type system, including coercion rules and compatibility matrix, is specified in the TDD. Type checking happens the moment you draw a wire, not when you run the pipeline. You cannot save an invalid graph.

### Graph Editing

The canvas supports standard editing operations that make building workflows fast:

- **Multi-select:** Click and drag a selection rectangle to select multiple nodes. Selected nodes can be moved, copied, or deleted together.
- **Copy-paste:** Ctrl+C / Ctrl+V duplicates the selected nodes and their internal wires. Wires that cross the selection boundary are not copied -- the pasted group has disconnected ports that you wire up.
- **Extract to Function:** Select a group of nodes, right-click, and choose "Extract to Function." The system identifies all wires crossing the selection boundary, turns them into the function's input and output ports, and replaces the selected nodes with a single function node. This is the primary way functions are created.
- **Undo/redo:** Standard Ctrl+Z / Ctrl+Y with full operation history.

### Functions

Functions are reusable subgraphs. The "Extract to Function" workflow creates them from existing nodes, or you can build them from scratch. Functions can contain other functions. Extracted functions live inline inside the graph by default; reusable libraries are exported as separate files.

**Example:** A "Research and Summarize" function that wraps an LLM Node (research), a Router Node (check quality), and a WhileLoop (retry if quality is low). From the outside, it looks like one node with an input port (`topic`: text) and an output port (`summary`: text). Double-click to see the inner graph.

### Projects

A **studio project** is a directory containing your pipeline graph (a JSON file), any exported function libraries, and configuration (MCP server settings, environment-variable references, and workspace settings). The graph file is human-readable, diff-friendly, and designed to be committed to git and reviewed in pull requests.

The codebase the workflow acts on is the **target workspace**. In the common case, the studio project and target workspace are the same directory. When they differ, v1 requires an explicit workspace root so write-capable nodes know exactly where they may operate.

The authoritative execution boundary is the configured workspace root (`config.json.workspaceRoot`, called `workspace_root` in prose). If a node also receives a path string through `prompt` or `context`, that string is advisory context for the backend, not the engine's security boundary.

---

## 4. How It Works

Here is the user's original scenario built as a Pipeline Studio workflow -- Claude Code researches a UI library, Gemini generates CSS, Claude reviews for accessibility, and the results feed into a build step.

The scenario below names the business meaning of the values moving through the graph. The actual v1 action-node ports still use the canonical contracts described in the TDD.

### Step 1: Research Node

An LLM Node configured with:
- **Backend:** Claude Code CLI
- **Model:** claude-opus-4-6
- **System prompt:** "Research the shadcn/ui component library. List all button variants, their CSS classes, and any accessibility attributes they include."
- **Inputs:** an implicit root `exec_in`, plus `prompt` text containing the configured workspace root path for agent context
- **Outputs:** `response` (the findings text), `error`, and `exec_out`

The node spawns a headless Claude Code process. As Claude works, tokens stream into the node's output display in real time.

### Step 2: CSS Generator Node

An LLM Node configured with:
- **Backend:** OpenRouter API
- **Model:** gemini-2.5-pro (via OpenRouter)
- **System prompt:** "Generate Tailwind CSS utility classes for each button variant described in the input."
- **Inputs:** `exec_in`, plus `context` wired from the research node's `response`
- **Outputs:** `response` (the generated CSS classes), `error`, and `exec_out`

This node runs when both conditions are true: its required data input is available, and its `exec_in` signal arrives from the research node.

### Step 3: Accessibility Review Node

An LLM Node configured with:
- **Backend:** Claude Code CLI
- **Model:** claude-sonnet-4-6
- **System prompt:** "Review these CSS classes for WCAG 2.1 AA compliance. Report any issues."
- **Inputs:** `exec_in`, plus `prompt`/`context` derived from the CSS generator's `response`
- **Outputs:** `response` (the review text), a structured `usage` payload, `error`, and `exec_out`

In v1, if you need a boolean like `issues_found`, you derive it explicitly in the loop/control-flow design rather than assuming the LLM node grows custom boolean output ports.

### Step 4: Quality Gate (WhileLoop + Router)

A WhileLoop owns the retry cycle. Its body region contains:
- the CSS Generator
- the Accessibility Review
- a Router Node that decides whether the body should exit as `approved` or continue as `retry`
- a Break node reached only from the Router's `approved` branch

The review text is wired back into the CSS Generator's `context` input, so on each retry the generator sees the specific accessibility issues it needs to fix. In this flagship pattern, the WhileLoop leaves its `condition` input unconnected, which means "keep looping until a Break or `max_iterations = 5`." When the Router selects `approved`, it fires Break and the loop ends. When it selects `retry`, the body ends and the next iteration begins. Non-selected exec branches enter skipped state; they do not receive data values.

### Step 5: Build Step Node

An LLM Node configured with:
- **Backend:** Codex CLI (using its built-in workspace sandboxing)
- **Sandbox policy:** `workspace-write`
- **System prompt:** "Apply these CSS classes to the project's button components."
- **Input ports:** `exec_in`, `prompt`, and `context` containing the approved CSS plus the workspace root path for agent context
- **Output ports:** `response`, `error`, and `exec_out`

This step uses Codex because it needs to write files, and the node's `workspace-write` policy is constrained by the configured workspace root for this run where the platform/backend can enforce that boundary. Pipeline Studio translates its generic sandbox policy into backend-native flags per adapter. The scenario now uses three different backends (Claude Code CLI, OpenRouter API with Gemini, Codex CLI) -- demonstrating that each node can independently choose the best tool for its task.

### What Happens When You Click Run

1. The engine validates the entire graph -- type checking, cycle detection, required port connections. Any problems appear in the error panel with clickable links to the offending nodes.
2. The research node starts. Tokens stream into its output display.
3. When research completes, the CSS generator starts automatically because its required data is now available and its `exec_in` signal has arrived.
4. If the CSS generator fails (rate limit, timeout), the error flows to its error output port. If you've wired that port to a fallback node, the fallback runs. If not, the graph stops with a clear error message.
5. The accessibility review runs. If it finds issues, the router takes the retry branch and the WhileLoop starts another iteration. If it passes, the router hits Break and the loop exits. The iteration inspector shows each pass's inputs and outputs.
6. When the review passes, the build step runs.
7. On re-run: the research node may be served from cache because it is read-only and cache-eligible. The write-capable build step is not cross-run cached by default.

---

## 5. Architecture

Pipeline Studio is built in four layers, each one complete before the next starts.

### Layer 1: Protocol

A formal specification defining how all components communicate. Built on JSON-RPC 2.0 (the same message format used by the Language Server Protocol and the Model Context Protocol).

The protocol defines:
- **Message types:** How the engine and UI exchange information -- requests (expect a response), notifications (fire-and-forget), and streaming events.
- **Graph schema:** The JSON format for describing nodes, ports, connections, and types.
- **Type system:** The core data types, type checking rules, and how wildcard ports resolve.
- **Lifecycle:** The startup handshake (capabilities negotiation), the validate-then-execute phases, cancellation, and shutdown sequence.
- **Event stream:** The typed events emitted during execution -- `node/started`, `node/output/partial` (streaming tokens), `node/completed`, `node/error`, and so on.

Why JSON-RPC 2.0: we evaluated five alternatives (gRPC/protobuf, Cap'n Proto, FlatBuffers, MessagePack) and JSON-RPC 2.0 is the clear winner for this project. Binary protocols are faster in isolation, but the bottleneck is LLM API latency (50-200ms per token), not serialization (microseconds). JSON-RPC 2.0 matches MCP and is readable by LLMs. The desktop app reuses the same request/response/event schemas over Tauri commands and events; it does not treat Tauri as a raw stdio transport.

Why a formal protocol first: every other layer is a client or server of this protocol. If the protocol is wrong, everything built on it is wrong. By defining and testing the protocol before writing engine code, we catch design problems when they're cheap to fix.

### Layer 2: Engine

A standalone Rust engine library with a thin CLI runner. It does not have a user interface and does not depend on one. The same engine can be embedded in the desktop app or run headlessly.

The engine:
- Parses and validates graphs against the protocol schema
- Compiles the frozen execution snapshot into a scheduler region DAG and runs nodes when their required data inputs and exec preconditions are satisfied, enabling automatic parallelism without leaving loop/function boundaries to guesswork
- Runs each node as an independent Tokio task (Rust's async runtime), communicating through bounded message channels -- this means one node failing doesn't crash others
- Caches eligible read-only node outputs keyed by input signatures for the current engine session, so unchanged eligible work can be skipped on re-run
- Targets four initial backends: Claude Code CLI, Gemini CLI, Codex CLI, and OpenRouter API. Release-blocking support is defined by the published platform/support matrix and backend compatibility matrix.
- Enforces safety rules: type checking, inherited cost budgets, process sandboxing, and run-manifest capture
- Exposes an MCP server for programmatic graph manipulation

The engine can run graphs headlessly from the command line, without the visual editor. That enables CI use for compatible backends and environments, but CI is still conditional on non-interactive auth, sandbox configuration, network access, and provider policy.

### Layer 3: Editor

A Tauri 2 desktop application with a React-based visual editor.

The editor:
- Renders the node canvas using React Flow (the industry-standard node graph library)
- Communicates with the embedded engine via Tauri commands and events that map to the same request/response/event schemas used by the external protocol
- Displays real-time streaming output per node as the engine executes
- Provides a searchable node palette with type-aware filtering (when you drag a wire from a text port, the palette shows only nodes with compatible text inputs)
- Supports standard graph editing: multi-select, copy-paste, extract-to-function, undo/redo
- Shows an error panel where each error links directly to the problem node on the canvas
- Supports function subgraph navigation -- double-click a function node to see its inner graph, with breadcrumb navigation for nested functions

### Layer 4: MCP Server (API Surface)

The engine library includes a Model Context Protocol service surface that a headless host mode exposes over stdio. The desktop app and the headless MCP host use the same engine library, but they are separate deployment modes in v1. "Layer 4" refers to the API surface, not a second runtime contract.

Tools include:
- `create_node` -- add a node to the graph
- `connect` -- wire two ports together
- `set_config` -- configure a node's parameters
- `validate` -- check the graph for errors
- `execute` -- run the graph
- `get_output` -- read a node's result

In v1, those tools operate on draft graphs or future runs. They do not mutate an active execution snapshot. That keeps the execution model stable while still making the product programmable infrastructure rather than just a GUI that humans click through.

---

## 6. Safety by Default

Pipeline Studio assumes things will go wrong and prevents damage before it happens. The safety system operates at three levels:

### Wire-Time: Prevent Invalid Connections

When you draw a wire between two ports, the system checks type compatibility immediately. Connecting a text output to a number input is blocked before the wire is created. You cannot save a graph with invalid connections.

**Example:** You try to wire a Router Node's `selected` output (type: text) to a ForLoop's `count` input (type: number). The wire snaps back, and a tooltip says "Cannot connect text to number. Feed a numeric value into `count` instead."

### Build-Time: Validate Before Executing

Before any node runs, the engine performs a full validation pass:
- All wildcard (`any`) ports must have resolved to concrete types
- All required input ports must be connected
- Cycles are only allowed through explicitly marked loop nodes
- Cost budgets are set on LLM nodes

**Example:** You have a Router Node whose `value` port is still untyped. The error panel shows: "Node 'Quality Gate' port 'value' has unresolved type. Connect it to a typed output or remove it." Clicking the error navigates to the node.

### Run-Time: Limit Blast Radius

During execution:
- **Error ports:** Built-in node types expose an error output only when their node contract says they do. When such a node fails, the error can flow through the graph as data instead of immediately crashing the run. If you do not wire that error port, the run stops with a clear error.
- **Cost budgets:** Each LLM node inherits a project default dollar limit unless you override it. A loop that accidentally calls Claude 500 times hits that budget cap and stops, with a clear error explaining what happened.
- **Process sandboxing:** CLI nodes run in sandboxed processes where supported. Sandboxing is a risk-reduction layer, not an absolute guarantee. Filesystem containment is strongest on Linux in v1, and network access may remain enabled depending on backend and platform.

**The v1 default model:** Safety features are configured from the project baseline. Nodes inherit a default budget unless you override it, sandboxes default to read-only, write-capable sandboxes require explicit opt-in, and platform limits are surfaced in the UI. The goal is predictable risk reduction, not an unqualified security guarantee.

---

## 7. LLM Self-Editing

Pipeline Studio includes a built-in MCP server that exposes graph manipulation as tools. This means any LLM that supports the Model Context Protocol can create, modify, validate, and run draft pipelines programmatically.

### What This Enables

**An LLM builds its own workflow.** You give Claude Code an MCP config pointing to Pipeline Studio's server. You say: "Create a pipeline that takes a GitHub repo URL, clones it, analyzes the codebase structure, generates documentation for each module, then combines it into a README." Claude calls `create_node` to add each step, `connect` to wire them together, `set_config` to configure models and prompts, `validate` to check for errors, and `execute` to run it.

**Workflows evolve between runs.** An external authoring session can inspect the last run, add new nodes based on what it learned, re-validate the graph, and launch another execution. In v1, the edit applies to the next run; the active run stays immutable.

**Pipelines become sharable programs.** Because the graph is a JSON file and the MCP tools have a formal schema, pipelines are sharable and inspectable like source code. Reproducible execution still depends on compatible backend versions, credentials, MCP server configuration, and local environment setup.

### Why This Matters

Most visual workflow tools are GUIs for humans. Pipeline Studio is also an API for machines. This makes it infrastructure -- a layer that LLMs can build on top of, not just a tool that humans operate. The combination of visual editing (for understanding and debugging) and programmatic authoring (for automation and repeatability) is what separates Pipeline Studio from a prettier version of bash scripts piping between LLM CLIs.

---

## 8. What's Different

### Compared to ComfyUI

ComfyUI is a powerful tool for image generation workflows, and Pipeline Studio borrows its best idea: incremental execution with input-signature caching for eligible unchanged work. But ComfyUI has no subgraph/function system (large workflows become unmanageable spaghetti), no loop nodes (loops require an advanced tail-recursion trick), no typed error routing (a failed node kills the whole graph), and no programmatic API (there is no standard way for code or an LLM to build a ComfyUI workflow). Pipeline Studio addresses all four.

### Compared to n8n

n8n is excellent for SaaS integration workflows (connect Stripe to Slack to a database) with 1,100+ integrations. Pipeline Studio is not a SaaS integrator -- it is an LLM orchestrator. The key differences: Pipeline Studio has a type system (n8n connections are untyped, leading to silent data shape mismatches), first-class loop nodes (n8n loops are workarounds), function subgraphs (n8n's "Execute Workflow" is the only reuse mechanism), and LLM self-editing via MCP (n8n has no programmatic workflow manipulation API).

### Compared to LangFlow / Flowise

LangFlow and Flowise are visual builders for LangChain applications. They are tightly coupled to the LangChain library -- when LangChain's API changes, the tools break. Their node vocabularies are LangChain concepts (agents, chains, vector stores), not general-purpose workflow primitives. Pipeline Studio is framework-independent: nodes are generic (LLM call, router, loop, sequence), and adapters handle the specifics of each backend (Claude Code CLI, OpenRouter API). That reduces coupling to any single orchestration framework.

### Compared to Rivet

Rivet is the closest existing tool. It has typed connections, subgraphs, loop nodes, and live debugging. Pipeline Studio borrows the general strengths of that model while adding: a formal protocol specification (enabling headless execution and third-party clients), Rust engine with Tokio actors (vs. Rivet's TypeScript/Node.js runtime), incremental caching for eligible read-only work, adapters for multiple LLM CLIs with auto-detection of installed tools, and MCP self-editing (Rivet has no programmatic manipulation API).

---

## 9. What's NOT in v1

The following features are intentionally deferred to keep v1 focused and shippable:

| Feature | Why Deferred | Target |
|---|---|---|
| **Dynamic fan-out** (runtime-determined parallel branches) | Shatters the static-graph model. Requires the engine to spawn variable numbers of node instances at runtime, handle dynamic Join barriers, and invalidate cache for variable-width sections. Sequential ForEach provides correctness; parallel fan-out provides performance, which is a v2 optimization. | v2 (high priority) |
| **Live mutation of the active execution graph** | v1 executes an immutable graph snapshot. Allowing mid-run graph mutation would require scheduler re-planning, cache invalidation, UI resync, and new authorization rules. | v2 |
| **Race inputs** (first-to-complete branch wins, others cancelled) | Composable from cancellation + routing + parallel branches already in v1. Edge cases (side effects in losing branch, interaction with caching) need the core scheduling model to be stable first. | v2 |
| **Progress notifications** | Streaming tokens ARE the progress indicator for LLM nodes. For non-streaming nodes, progress percentages are either absent or inaccurate. Node state (running/completed) is sufficient for v1. | v2 |
| **Remote live debugging** | v1 targets local desktop use. Remote debugging requires the engine to support multiple concurrent event stream subscribers -- complexity for a use case that doesn't exist until shared deployment. | v2 |
| **Durable execution checkpointing** | Requires a persistent storage backend and replay logic. v1 workflows are expected to be minutes-long, not hours-long. In-memory caching handles iterative re-execution. | v2 |
| **Per-node MCP configuration** | v1 uses a single graph-level MCP config. All nodes share the same tool access. Per-node authorization is a security refinement for multi-tenant scenarios. | v2 |
| **MCP sampling/elicitation** | Bidirectional async recursion creates deadlock risk. The core MCP server (graph manipulation tools) provides meta-orchestration without the complexity of nested LLM callbacks. | v3 |
| **Macro/template nodes** | Function subgraphs cover most reuse cases. Multi-output expansion patterns (OnSuccess/OnFailure/OnTimeout) are achievable with error ports and routing. | v2 |
| **Stateful gate nodes** (FlipFlop, DoOnce, Gate) | Game engine idioms, not LLM workflow idioms. Composable from routing + loop state. | v2 if demanded |
| **Rich execution history UI and diff tooling** | v1 persists minimal machine-readable run manifests for reproducibility and audit. Rich browsing, comparison, and time-travel UI remain power-user polish. | v2 |
| **Node versioning** | v1 ships built-in nodes only. Version compatibility is implicit (same release). Versioning becomes essential when third-party node packages exist. | v2 |
| **Built-in pure nodes** (format, parse, math) | The engine supports the pure/action node distinction in its scheduler, but v1 ships only action nodes (LLM, Router, Sequence, HITL, loops). Pure utility nodes are planned alongside the function library ecosystem. | v2 |
| **Router expression mode** | v1 ships condition mode only (declarative rules with operators like equals, contains, regex). A full expression evaluator adds language design scope. For complex routing, use an LLM node upstream to produce a branch name. | v2 |

These are not features we forgot. They are features we evaluated, understood the cost of, and chose to defer so that the foundation (protocol, engine, editor, MCP server) ships solid.
