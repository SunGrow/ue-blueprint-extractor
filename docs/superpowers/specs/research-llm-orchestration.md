# Research: LLM Orchestration and CLI Integration

**Date:** 2026-03-27
**Task:** #4 — Research LLM orchestration and CLI integration for pipeline-studio

---

## 1. CLI Tool Architectures

### 1.1 Claude Code (Claude Agent SDK)

**Input mechanisms:**
- `claude -p "query"` — non-interactive print mode; accepts piped stdin (`cat file.txt | claude -p "query"`)
- `--input-format stream-json` — keeps stdin open for a session with multiple JSON messages (used by SDK)
- `--output-format text|json|stream-json` — controls stdout format; `stream-json` emits JSONL events
- `--mcp-config ./mcp.json` — loads MCP servers from a JSON file; `--strict-mcp-config` ignores all other MCP configs
- `--model claude-opus-4-6|sonnet|opus` — selects model per session
- `--bare` — minimal mode: skips CLAUDE.md, hooks, skills, plugins, MCP auto-discovery; faster cold start for scripted calls
- `--system-prompt`, `--append-system-prompt`, `--system-prompt-file` — per-session system prompts
- `--max-turns N` — limits agent turns in print mode
- `--max-budget-usd N` — cost cap in print mode
- `--dangerously-skip-permissions` — headless unattended execution
- `--no-session-persistence` — discard session after run (print mode only)
- `--session-id <uuid>` — deterministic session IDs for resumption
- `--add-dir` — adds extra directories to the context

**Output:**
- `stream-json` output is JSONL to stdout; each line is a `ThreadEvent`
- `--include-partial-messages` — include streaming deltas
- `--json-schema` — forces structured JSON output matching a schema (print mode)

**Agent teams / sub-agents:**
- Sub-agents run inside a session, report results back to the parent
- Agent teams: separate Claude Code processes coordinated via shared task list + mailbox; requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- Team config stored at `~/.claude/teams/{name}/config.json`; task list at `~/.claude/tasks/{name}/`
- Teammates communicate via `SendMessage` tool; task claiming uses file locking
- Display modes: in-process (Shift+Down to cycle) or tmux split panes

**Key integration pattern:**
```bash
# Non-interactive, JSONL output, no persistence
claude --bare -p "query" \
  --output-format stream-json \
  --mcp-config ./node-mcp.json \
  --model claude-sonnet-4-6 \
  --no-session-persistence \
  --dangerously-skip-permissions
```

### 1.2 Gemini CLI

**Input mechanisms:**
- `-p` / `--prompt` — headless mode; activates automatically in non-TTY environments
- Stdin piping: `echo "prompt" | gemini` appends stdin content to prompt context
- `--output-format json` — single JSON object `{response, stats, error}`
- `--output-format stream-json` / JSONL — streaming events: `init`, `message`, `tool_use`, `tool_result`, `error`, `result`

**Exit codes:** 0 (success), 1 (error), 42 (input validation), 53 (turn limit exceeded)

**Configuration:** JSON settings files at user, project, and system levels; env vars override settings; CLI flags override all.

**Key limitation:** No equivalent to Claude Code's `--bare` or `--strict-mcp-config` documented as of March 2026; tool configuration for headless use is less granular.

### 1.3 OpenAI Codex CLI (codex exec)

**Input mechanisms:**
- `codex exec "task"` — positional argument
- `codex exec -` — reads task from stdin
- `--image, -i <path>` — vision attachments
- `--model, -m` — model override

**Output:**
- Default: progress to **stderr**, final answer to **stdout**
- `--json` flag — JSONL events to **stdout** (type: `ThreadStarted`, `TurnStarted`, `ItemCompleted`, etc.); each line has event type and metadata
- `--output-last-message <file>` — writes final response to file

**Sandboxing:**
- `-s <policy>` — `read-only`, `workspace-write`, `danger-full-access`
- Platform-specific: Linux = Landlock, macOS = Seatbelt, Windows = restricted tokens
- `--yolo` — bypass all sandboxing
- `--full-auto` — workspace-write with on-request approvals
- Non-interactive constraint: approval requests cause **immediate failure** unless auto-approval is configured

**Session lifecycle:**
- New / Resume / Review session types
- State persists to JSONL rollout files unless `--ephemeral`
- Resume by thread ID

**Key integration pattern:**
```bash
codex exec --json --sandbox read-only "analyze repo" | jq '.type'
```

### 1.4 Arbitrary CLI Tools

For tools that require an interactive terminal (not stdin piping), a **PTY (pseudo-terminal)** must be allocated. Key Rust crates:
- `pty-process` — wraps `tokio::process::Command` to allocate a PTY; stdin/stdout/stderr point at the PTY master, implementing `AsyncRead + AsyncWrite`
- `tokio-pty-process` — older but similar; extends `std::process::Command` with `spawn_pty_async`

For non-interactive tools accepting stdin:
- `tokio::process::Command` with `.stdin(Stdio::piped())` / `.stdout(Stdio::piped())`
- Use `tokio::select!` to multiplex stdout + stderr reads concurrently

---

## 2. LLM Orchestration Frameworks

### 2.1 LangGraph

- **Architecture:** Directed graph (DAG); nodes = agents/functions/decision points; edges = data flow
- **State:** Centralized `StateGraph` stores context and intermediate results
- **Streaming:** Native token-by-token streaming; zero overhead by design
- **Multi-model routing:** Each node can use a different model; LangChain abstractions handle dispatch
- **Multi-agent:** Each agent is a node; communication through graph state; conditional branching
- **Production:** Used by 60% of AI developers for agent orchestration; supports persistence, debugging, deployment
- **Recommendation for pipeline-studio:** LangGraph's explicit node/edge model directly maps to a visual graph. Its state management and conditional branching patterns are directly applicable.

### 2.2 CrewAI

- **Architecture:** Role-and-task model; agents have defined roles, tasks have defined outputs
- **Coordination:** `Process.Sequential` or `Process.Hierarchical` (manager agent delegates)
- **2025 update:** Added `Flows` (state-machine layer) alongside classic Process model
- **Swarm patterns (late 2025):** Agent-initiated handoffs via Hierarchical Process
- **Best for:** Rapid prototyping, role-based workflows, small teams

### 2.3 AutoGen (Microsoft, v0.4)

- **Architecture:** Async-first, event-driven; message-passing between agents
- **`AgentChat` API:** Configurable agents with defined roles and communication patterns
- **`SelectorGroupChat`:** Dynamic next-speaker selection based on conversation context
- **Human-in-the-loop:** Strong support; fine-grained control over agent behaviors
- **2025 update:** Complete async rewrite; Swarm patterns added
- **Best for:** Enterprise workflows, complex debugging, observability requirements

### 2.4 Claude Agent SDK

- **Architecture:** Orchestrator-worker; lead agent (Opus) coordinates specialized sub-agents (Sonnet)
- **Sub-agents:** Own context window; results summarized back to orchestrator (not full context)
- **Agent teams:** Full peer-to-peer coordination via shared task list + mailbox; each teammate is a separate Claude Code process
- **Pipelines:** Sub-agents can be chained (analyst → architect → implementer → tester) or run in parallel
- **Key insight for pipeline-studio:** The task list + mailbox pattern is exactly the coordination model needed for a visual graph engine. Nodes = teammates; edges = message/task dependencies.

### 2.5 Semantic Kernel (Microsoft)

- Plugin-based orchestration; agents use "skills" (semantic + native functions)
- Strong enterprise integration (Azure, Office 365)
- Less relevant for CLI-first pipeline-studio approach

### 2.6 Key Patterns Across Frameworks

| Pattern | How frameworks handle it |
|---|---|
| Multi-model routing | Each node/agent specifies its own model; router node selects based on task type |
| Error recovery | Retry with exponential backoff; supervisor agent reroutes on failure |
| Streaming | SSE or JSONL token-by-token; mid-stream errors use `finish_reason: "error"` |
| Tool use | JSON schema tool definitions; model emits tool call events; framework executes and feeds results back |
| Parallel execution | Async tasks per agent; tokio/asyncio concurrency primitives |

---

## 3. MCP Server Embedding

### 3.1 Transport Options

| Transport | Use case | Status |
|---|---|---|
| **stdio** | Desktop app embeds server as subprocess; host writes JSON-RPC to stdin, reads from stdout | Preferred for local |
| **Streamable HTTP** | Remote/network servers; POST requests + SSE responses | New standard (March 2025 spec) |
| **SSE (legacy)** | Older HTTP-based; deprecated in 2025 spec | Avoid for new work |

**Recommendation:** For a desktop app, embed each MCP server as a stdio subprocess. The app owns the process lifecycle.

### 3.2 Exposing Graph Manipulation as MCP Tools

The pipeline-studio engine can expose its own graph API as MCP tools served over stdio. Node definitions:
```
graph_add_node(node_type, config) → node_id
graph_connect(from_node, to_node, port) → edge_id
graph_run_subgraph(root_node_id) → execution_id
graph_get_output(node_id) → output_data
```

This allows any MCP-capable LLM (Claude Code, Gemini CLI, etc.) to manipulate the graph programmatically — enabling "meta-orchestration" where an LLM builds and modifies its own workflow.

### 3.3 MCP Proxying / Bridging

Multiple proxy implementations exist for routing tool calls:
- **mcp-proxy** (sparfenyuk): bridges Streamable HTTP ↔ stdio transports
- **FastMCP proxy provider**: forwards tool calls to a backend MCP server, dynamically reflecting its current state
- **MCP Bridge** (arxiv 2504.08999): RESTful proxy; supports STDIO and SSE backends; risk-based execution model (standard / confirmation / Docker isolation)

**Pattern for pipeline-studio nodes:** Each node configuration specifies which MCP servers it has access to. The engine acts as an MCP proxy: when a node's LLM calls a tool, the engine routes the call to the appropriate server (local or remote) and returns the result. This is essentially the same pattern as Claude Code's `--mcp-config` but implemented at the engine level.

### 3.4 Rust MCP SDK Options

| SDK | Spec compliance | Transport support |
|---|---|---|
| `modelcontextprotocol/rust-sdk` (official) | Full spec | stdio, HTTP/SSE |
| `rust-mcp-sdk` (crates.io) | 2025-11-25 spec + backward compat | stdio, HTTP/SSE |
| `mcp-protocol-sdk` | 2025-06-18 spec | stdio, HTTP/SSE, WebSocket |
| `Prism MCP Rust SDK` | 2025-06-18 spec, enterprise-grade | stdio, HTTP/SSE |

**Recommendation:** Use `rust-mcp-sdk` (latest spec, backward compatible) or the official `modelcontextprotocol/rust-sdk` for the engine's MCP server/client implementation.

---

## 4. Process Management Patterns

### 4.1 Spawning Concurrent CLI Processes in Rust

**Core approach with Tokio:**
```rust
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};

let mut child = Command::new("claude")
    .args(["-p", "--output-format", "stream-json", "--bare", "query"])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()?;

let stdout = child.stdout.take().unwrap();
let mut reader = BufReader::new(stdout).lines();

// Multiplex stdout + stderr with tokio::select!
tokio::select! {
    line = reader.next_line() => { /* process JSONL event */ }
    status = child.wait() => { /* process exit */ }
}
```

**For PTY-requiring tools:**
```rust
use pty_process::Command as PtyCommand;
// Returns child with stdin/stdout pointing at PTY master
let child = PtyCommand::new("interactive-cli").spawn()?;
```

### 4.2 Process Lifecycle Management

| Operation | Mechanism |
|---|---|
| Start | `tokio::process::Command::spawn()` |
| Write input | `child.stdin.write_all(data).await` |
| Read output | `tokio::select!` on stdout/stderr readers |
| Timeout | `tokio::time::timeout(duration, future)` |
| Pause | Send SIGSTOP (Unix); Windows has `SuspendThread` |
| Resume | Send SIGCONT (Unix) |
| Kill | `child.kill().await` or `child.start_kill()` |
| Resource limits | `hakoniwa` crate (Linux): namespaces, cgroups v2, Landlock, seccomp-BPF |

### 4.3 Structured Data Piping

All three CLI tools (Claude Code, Gemini CLI, Codex) support `--output-format stream-json` / `--json` producing JSONL. The orchestrator reads lines and parses each JSON event. This is the natural interface for a Rust orchestrator.

**Deadlock prevention:** Never write to stdin and read from stdout synchronously in sequence when using large inputs. Use separate async tasks (one for writing stdin, one for reading stdout/stderr).

### 4.4 Resource Limits and Sandboxing

For untrusted or experimental nodes:
- `hakoniwa` (Rust): process isolation using Linux namespaces, cgroups v2, Landlock, seccomp-BPF
- `nsjail` (Google): namespace isolation + resource limits; can be invoked as a subprocess wrapper
- `sandbox-rs`: Linux namespaces + seccomp BPF + cgroup v2 + filesystem isolation in a unified Rust API

**Note:** Codex CLI has built-in sandboxing (`--sandbox read-only`). For Claude Code and Gemini CLI, sandboxing must be applied at the process spawner level.

---

## 5. API Adapter Patterns

### 5.1 OpenRouter API

- **Endpoint:** OpenAI-compatible chat completions (`/api/v1/chat/completions`)
- **Models:** Kimi K2.5, DeepSeek R2, Llama 4, Gemini 2.5 Pro, etc. via single endpoint
- **Streaming:** `stream: true` → SSE events; parse `data: {...}` lines; `[DONE]` terminates stream
- **Tool use:** OpenAI-compatible function calling schema; streaming tool calls accumulate across chunks
- **Rate limits:** Free tier: 20 req/min; Paid: dynamic, `$1 = 1 RPS` up to 500 RPS
- **Error handling:** Pre-stream errors = HTTP 4xx/5xx JSON; mid-stream errors = SSE event with `finish_reason: "error"` (HTTP 200)
- **Rust crates:** `openrouter_api` (retry logic, memory-safe key handling); `openrouter-rs` (type-safe, async, builder pattern)

### 5.2 Unified Node Interface Design

To make CLI nodes and API nodes look the same to the engine:

```rust
trait NodeExecutor {
    /// Start execution, return a stream of events
    async fn execute(&self, input: NodeInput) -> impl Stream<Item = NodeEvent>;
    /// Check if the node is still alive
    async fn is_running(&self) -> bool;
    /// Terminate the node
    async fn kill(&self);
}

enum NodeEvent {
    Token(String),           // Streaming text token
    ToolCall(ToolCallEvent), // LLM wants to use a tool
    ToolResult(Value),       // Tool returned a result
    Done(NodeOutput),        // Final output
    Error(NodeError),        // Error occurred
}
```

**CLI adapter:** Spawns process, reads JSONL, maps events to `NodeEvent`.
**API adapter:** Calls OpenRouter SSE stream, maps SSE chunks to `NodeEvent`.

### 5.3 Rate Limiting and Cost Tracking

- Per-node token budget: pass `--max-budget-usd` (Claude Code) or track `stats.tokenUsage` (Gemini JSONL)
- Global rate limiter: `tokio::sync::Semaphore` with permits = concurrent node limit
- Cost tracking: accumulate `usage` field from final JSONL events; emit cost events to UI

---

## 6. The Ralph Loop Pattern

### 6.1 How It Works

The Ralph Loop is a plugin for Claude Code that implements a **persistent iterative improvement loop**:

1. User provides a prompt and optional `--completion-promise TEXT` (a statement that must be *literally true* to exit the loop)
2. Claude works on the task; when it tries to exit, the **same prompt is fed back** for the next iteration
3. Claude sees its previous work in files and git history, allowing iterative refinement
4. The loop continues until the `completion-promise` condition is genuinely and unequivocally true

**Critical constraint:** Claude may only output the completion promise when it is completely true. It cannot emit false promises to escape the loop, even when stuck.

**Setup:** A shell script (`setup-ralph-loop.sh`) configures the session to loop the prompt back on each exit.

### 6.2 What Makes It Effective

- **Persistence:** Claude cannot escape by saying "done" unless it actually is — prevents premature exit
- **Accumulated context:** Git history + written files carry state across iterations without relying on context window continuity
- **Self-correction:** Each iteration Claude sees what it accomplished and can identify gaps
- **Externalized state:** Output lives on disk, not in the context window — survives context resets
- **Deterministic completion:** The boolean completion promise is objectively verifiable, not subjective

### 6.3 Representing the Ralph Loop as a Node

In a visual graph, the Ralph Loop is a **feedback loop node**:

```
┌─────────────────────────────────────────────┐
│  RALPH LOOP NODE                            │
│                                             │
│  [LLM Node] ──→ [Completion Check]          │
│       ↑               │                    │
│       │    false       │ true               │
│       └───────────────┘       ↓             │
│                          [Output Node]      │
└─────────────────────────────────────────────┘
```

**Node configuration:**
- `prompt`: the task prompt
- `completion_promise`: boolean condition evaluated after each iteration
- `max_iterations`: safety limit
- `state_backend`: filesystem path where Claude writes its work (persisted across loop iterations)
- `model`: which Claude model to use per iteration

**Implementation:** The node spawns a Claude Code process with `--print`, evaluates the completion promise (either by asking Claude or by running a deterministic check script), and re-queues itself if false. The node outputs only when the promise is true.

This is the visual equivalent of an `until <condition>` loop with an LLM as the loop body.

---

## 7. CLI Integration Architecture (Recommendation)

### 7.1 Process Model

Each graph node maps to one **NodeHandle** in the engine:

```
Engine
├── NodeHandle(claude-node-1)   → tokio Task + Child process
├── NodeHandle(gemini-node-2)   → tokio Task + Child process
├── NodeHandle(codex-node-3)    → tokio Task + Child process
├── NodeHandle(openrouter-4)    → tokio Task + HTTP stream
└── NodeHandle(ralph-loop-5)    → tokio Task + iteration state machine
```

**Concurrency model:** Each NodeHandle runs as a `tokio::task::spawn`-ed task. Communication with the engine uses `tokio::sync::mpsc` channels. The engine's event loop `tokio::select!`s across all node channels.

### 7.2 Process Spawn Strategy

| Scenario | Strategy |
|---|---|
| Claude Code (non-interactive) | `tokio::process::Command` with `--bare -p --output-format stream-json` |
| Claude Code (interactive/session) | `--input-format stream-json` + persistent stdin writer task |
| Gemini CLI | `tokio::process::Command` with `-p --output-format stream-json` |
| Codex exec | `tokio::process::Command` with `--json` |
| Tool requiring PTY | `pty-process` crate |
| OpenRouter API | `reqwest` async HTTP client, SSE parser |

### 7.3 MCP Embedding Strategy

**Preferred architecture:**
1. Engine embeds MCP servers as stdio subprocesses (one per server, persistent across the graph run)
2. Each node's LLM session receives its own `--mcp-config` pointing to the servers it needs
3. For tools that should be exposed to the LLM from the engine itself (graph manipulation), the engine runs its own MCP server as a stdio subprocess and includes it in node configs

**MCP proxy for external servers:**
- Engine acts as MCP proxy: intercepts tool calls from node LLM, routes to appropriate server, returns result
- Use `rust-mcp-sdk` for both client (talking to external servers) and server (exposing engine tools to node LLMs)

### 7.4 Input/Output Flow

```
User Graph Definition (JSON/YAML)
    │
    ▼
Engine parses graph → builds dependency DAG
    │
    ▼
For each ready node (no unresolved inputs):
    Spawn NodeHandle → configure env/cwd/MCP/model
    Write input to node's stdin (or API body)
    Stream NodeEvents via mpsc channel
    │
    ▼
Edge routing: when node emits Done(output):
    Engine evaluates edge conditions
    Routes output to dependent nodes as input
    │
    ▼
UI receives NodeEvent stream → renders streaming output per node
```

---

## 8. MCP Embedding Strategy (Summary)

| Decision | Recommendation |
|---|---|
| Transport for local servers | stdio — lower latency, no network, process-scoped lifecycle |
| Transport for remote servers | Streamable HTTP (2025 spec), not SSE |
| SDK for Rust implementation | `rust-mcp-sdk` or official `modelcontextprotocol/rust-sdk` |
| Exposing engine tools to LLMs | Engine runs MCP server over stdio; include in `--mcp-config` for each node |
| Routing tool calls between servers | Engine as MCP proxy; `rust-mcp-sdk` client per external server |
| Tool authorization per node | Node config specifies allowed tool names; engine enforces at proxy layer |

---

## 9. Key Findings Summary

1. **Claude Code is the most automation-friendly CLI:** `--bare -p --output-format stream-json --mcp-config` gives a fully configurable, headless, JSONL-streaming process with per-session model selection and MCP configuration.

2. **All three CLIs produce JSONL in headless mode:** This is the natural lingua franca for a Rust orchestrator. Map JSONL event types to a unified `NodeEvent` enum.

3. **PTY is needed only for truly interactive tools:** Claude Code, Gemini CLI, and Codex all work without PTY in non-interactive mode. PTY support is needed only for tools that hardcode terminal detection.

4. **MCP stdio is the right embedding strategy for desktop:** Process-scoped, no network ports, engine owns lifecycle.

5. **Rust MCP SDKs exist and are production-ready:** Use `rust-mcp-sdk` for full 2025-11-25 spec compliance.

6. **The Ralph Loop is a feedback-loop node:** Implement as a state machine that re-queues the LLM with the same prompt until a completion predicate is true, using filesystem state as persistence.

7. **OpenRouter provides unified API access:** Kimi K2.5, DeepSeek, Gemini, etc. through a single OpenAI-compatible endpoint with SSE streaming. Use `openrouter_api` or `openrouter-rs` Rust crates.

8. **Agent team coordination model (task list + mailbox) is directly applicable to the graph engine:** Each node is a "teammate"; edges are task dependencies; the engine is the "lead."

---

## Sources

- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Gemini CLI Headless Mode](https://geminicli.com/docs/cli/headless/)
- [Codex Exec Headless Mode (DeepWiki)](https://deepwiki.com/openai/codex/4.2-headless-execution-mode-(codex-exec))
- [OpenRouter Streaming Docs](https://openrouter.ai/docs/api/reference/streaming)
- [OpenRouter Rate Limits](https://openrouter.ai/docs/api/reference/limits)
- [MCP Server Transports (Roo Code)](https://docs.roocode.com/features/mcp/server-transports)
- [MCP Build Server (Official)](https://modelcontextprotocol.io/docs/develop/build-server)
- [rust-mcp-sdk (crates.io)](https://crates.io/crates/rust-mcp-sdk)
- [Official Rust MCP SDK (GitHub)](https://github.com/modelcontextprotocol/rust-sdk)
- [pty-process crate](https://lib.rs/crates/pty-process)
- [tokio::process docs](https://docs.rs/tokio/latest/tokio/process/struct.Command.html)
- [hakoniwa process isolation](https://github.com/souk4711/hakoniwa)
- [LangGraph Multi-Agent Orchestration](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-orchestration-complete-framework-guide-architecture-analysis-2025)
- [CrewAI vs AutoGen 2025](https://latenode.com/blog/platform-comparisons-alternatives/automation-platform-comparisons/langgraph-vs-autogen-vs-crewai-complete-ai-agent-framework-comparison-architecture-analysis-2025)
- [Claude Agent SDK Best Practices](https://skywork.ai/blog/claude-agent-sdk-best-practices-ai-agents-2025/)
- [mcp-proxy (sparfenyuk)](https://github.com/sparfenyuk/mcp-proxy)
- [MCP Bridge (arxiv)](https://arxiv.org/html/2504.08999v2)
- [openrouter_api Rust crate](https://crates.io/crates/openrouter_api)
- [n8n/Dify AI Agent Platform Comparison](https://jimmysong.io/blog/open-source-ai-agent-workflow-comparison/)
