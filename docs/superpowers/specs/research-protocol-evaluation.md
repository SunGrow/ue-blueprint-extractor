# Protocol Evaluation: Pipeline Studio Communication Layer

**Date:** 2026-03-27
**Author:** Research Agent (pipeline-studio team)
**Context:** Evaluating JSON-RPC 2.0 vs. alternatives for Pipeline Studio — a Rust/Tokio graph engine with TypeScript/React UI via Tauri IPC, streaming LLM output, and embedded MCP server.

---

## 1. What We Actually Need

Before evaluating protocols, the concrete requirements:

| Requirement | Details |
|---|---|
| **Bidirectional messaging** | Client sends requests; engine pushes execution events asynchronously |
| **Streaming partial output** | LLM nodes emit `node/output/partial` tokens incrementally |
| **Lifecycle handshake** | `initialize` → `initialized` → operations → `shutdown` → `exit` |
| **Cancellation** | `$/cancelRequest` must interrupt in-flight graph execution |
| **MCP compatibility** | Embedded MCP server speaks JSON-RPC 2.0 to external LLM clients |
| **LLM readability** | Graph schema JSON must be readable/writable by LLMs directly |
| **Tauri IPC transport** | Primary desktop transport is Tauri's `invoke`/`emit` IPC bridge |
| **Scale target** | 100+ concurrent nodes streaming tokens; not millions of RPS |
| **Developer ergonomics** | Rust engine + TypeScript React UI must both be productive |

The architecture already specifies two transports (stdio and streamable HTTP/SSE). The question is which wire format and RPC convention to use over those transports.

---

## 2. Protocol Evaluations

### 2.1 JSON-RPC 2.0 (Current Choice)

**What it is:** A minimal RPC spec layered over JSON. Defines request/response, notifications (no-id), and batch calls. Transport-agnostic — works over stdio, HTTP, WebSocket, etc.

#### Throughput

JSON parsing in Rust via `serde_json` is fast (~500 MB/s on modern hardware), but not free. For token streaming, each `node/output/partial` notification is a small JSON object (~150–300 bytes). At 100 concurrent LLM nodes each emitting 20 tokens/second, that is 2,000 messages/second. `serde_json` handles millions of small objects per second in benchmarks; 2,000/s is negligible.

**Verdict:** JSON overhead is not a bottleneck at this scale. The engine's Tokio actor channels and LLM API latency (50–200ms per token) dominate.

#### Latency

Per-message serialization cost is on the order of microseconds for small payloads. Graph schema serialization (potentially 10–100 KB for large graphs) takes ~10–100µs. Neither affects user-visible latency in a workflow where each LLM call takes seconds.

**Verdict:** Latency is not a concern for this use case.

#### Streaming Support

JSON-RPC 2.0 has no built-in streaming primitive. The TDD handles this correctly: LLM streaming is implemented as a sequence of `node/output/partial` notifications over an SSE stream (HTTP transport) or stdout (stdio transport). This is the same pattern used by MCP, LSP, and all major JSON-RPC-over-stdio protocols.

The streaming story is not elegant in the spec (no `stream<T>` at the wire level), but it is well-understood, debuggable, and consistent with ecosystem tools.

**Verdict:** Adequate. Not elegant, but proven.

#### Bidirectional Streaming

Over stdio: both directions are always open (stdin/stdout). Full duplex.
Over HTTP: requests go client→engine via POST; server-push goes engine→client via SSE. SSE is server-to-client only — the client sends new requests via new POSTs. This is not true bidirectional streaming, but it matches how MCP "Streamable HTTP" works and is sufficient for the workflow: clients rarely need to stream data *to* the engine (they send inputs once, then listen for events).

**Verdict:** Adequate for this use case. Not WebSocket, but WebSocket adds connection management complexity without meaningful benefit here.

#### Developer Experience

- Schema-free: no IDL, no codegen step, no `.proto` files to maintain.
- Debuggable: paste any message into `jq` or your browser's Network tab.
- Rust: `serde_json` + `jsonrpsee` is mature and well-documented.
- TypeScript: any JSON-RPC client library works; or hand-roll a thin wrapper in ~50 lines.
- Error codes are plain integers — easy to extend with custom ranges (already done in TDD §1.9).
- Testing: snapshot tests on raw JSON strings work perfectly.

**Verdict:** Excellent developer experience for a two-person team or small project.

#### MCP Compatibility

MCP *is* JSON-RPC 2.0. Using the same protocol for the engine API and the embedded MCP server means:
- One transport implementation serves both surfaces.
- MCP clients can potentially talk to the engine's API layer with minimal adaptation.
- No impedance mismatch between internal and external protocol layers.

**This is a decisive advantage unique to JSON-RPC 2.0.**

#### LLM Readability

JSON is the native language of LLMs. Graph schemas, node configs, and execution events are all readable and writable by Claude, GPT, etc. without any decoding step. This enables LLMs to inspect, generate, and modify pipelines directly.

**Verdict:** Best possible for LLM interaction.

#### Summary

| Criterion | Score | Notes |
|---|---|---|
| Throughput | Good | 2k msg/s is trivial for serde_json |
| Latency | Good | Not a bottleneck at LLM timescales |
| Streaming | Adequate | Notifications over SSE/stdio work |
| Bidirectional | Adequate | HTTP needs POST+SSE; stdio is full-duplex |
| DX | Excellent | No codegen, debuggable, familiar |
| MCP compat | Excellent | MCP IS JSON-RPC 2.0 |
| LLM readable | Excellent | Native JSON |

---

### 2.2 gRPC / Protocol Buffers

**What it is:** Google's RPC framework using Protocol Buffers (protobuf) for binary serialization. Rust support via `tonic`; TypeScript via `@grpc/grpc-js` or `connect-es`.

#### Throughput & Latency

Protobuf serialization is 3–10x faster than JSON and produces 30–70% smaller payloads. For this project's 2,000 messages/second workload, this advantage is irrelevant — the difference is nanoseconds per message versus LLM API calls that take 50–200ms each.

**Verdict:** Real advantage at high-frequency financial data or game networking. Irrelevant here.

#### Streaming Support

gRPC has native bidirectional streaming (client-streaming, server-streaming, and bidi-streaming RPCs). This is genuinely better than JSON-RPC's notifications. However, gRPC requires HTTP/2.

#### Tauri IPC Compatibility

This is the fatal problem. Tauri's IPC bridge (`invoke`/`emit`) is based on Tauri's own message-passing layer, not raw TCP or HTTP/2 sockets. gRPC requires HTTP/2, which Tauri's IPC does not expose. To use gRPC, you would need to:

1. Run a gRPC server on a localhost port inside the Tauri process, OR
2. Use gRPC-Web (which only supports unary and server-streaming, not bidi-streaming), OR
3. Abandon Tauri IPC entirely and use a WebSocket or TCP connection

Option 1 introduces a localhost port, an attack surface, firewall issues, and complexity. Option 2 loses the main gRPC advantage. Option 3 defeats a key architectural choice in the TDD.

**Verdict:** gRPC is incompatible with Tauri IPC without significant architectural compromise.

#### MCP Compatibility

MCP uses JSON-RPC 2.0. If the engine's internal API uses gRPC, the MCP server layer must translate between gRPC and JSON-RPC 2.0 at runtime. This is a non-trivial impedance mismatch.

**Verdict:** Poor MCP compatibility.

#### Developer Experience

- Requires `.proto` schema files for all messages and RPCs.
- Codegen step (`tonic-build` in `build.rs`) must be maintained.
- Debugging binary wire format requires `grpcurl` or Wireshark with protobuf dissectors.
- TypeScript client requires `@grpc/grpc-js` or a code-gen pipeline.
- Any schema change requires regenerating code on both sides.

For a project where the graph schema evolves rapidly during development, protobuf's schema coupling is a significant drag.

**Verdict:** High ceremony, poor fit for an evolving spec.

#### Summary

| Criterion | Score | Notes |
|---|---|---|
| Throughput | Excellent | Irrelevant at this scale |
| Latency | Excellent | Irrelevant at LLM timescales |
| Streaming | Excellent | Native bidi streaming |
| Bidirectional | Excellent | Native in protocol |
| DX | Poor | .proto files, codegen, binary debugging |
| MCP compat | Poor | Requires translation layer |
| LLM readable | Poor | Binary format |
| **Tauri IPC** | **Incompatible** | **HTTP/2 not available via Tauri IPC** |

**Recommendation: Do not use.**

---

### 2.3 Cap'n Proto

**What it is:** A zero-copy serialization format designed by the author of Protocol Buffers. Data is stored in a form that requires no parse step — you access fields directly from the serialized buffer.

#### Throughput & Latency

Cap'n Proto's zero-copy read access is genuinely impressive: deserialization time is near-zero for read-only access. However, the advantage only materializes when you are processing the same serialized data many times or when deserialization is a bottleneck (e.g., a database that reads a record many times before discarding it). In a message-passing pipeline where each message is deserialized once and then processed, the advantage evaporates.

**Verdict:** Zero-copy advantage does not apply to fire-and-forget message passing.

#### Rust & TypeScript Support

- Rust: `capnp` crate is maintained but niche. `capnproto-rust` documentation is sparse compared to `serde_json` or `tonic`.
- TypeScript: `capnp-ts` exists but is not widely used. Community support is thin.

#### Tauri IPC Compatibility

Same problem as gRPC: Cap'n Proto is a serialization format, not a transport protocol, but using it over Tauri IPC requires either custom framing or a separate socket. Tauri's IPC layer uses `serde_json` by default; injecting binary payloads requires base64 encoding, which negates the size advantage.

#### MCP Compatibility

None. MCP is JSON-RPC; bridging to Cap'n Proto adds a translation layer.

**Verdict: Overkill and poor ecosystem fit. Do not use.**

---

### 2.4 FlatBuffers

**What it is:** Google's alternative to protobuf with zero-copy random-access reads. Used in games (Unity, Firebase) and embedded systems where read performance on the same buffer is critical.

#### Applicability

FlatBuffers' key feature — random-access reads without full deserialization — is useful when you need to inspect one field of a large serialized object without decoding the whole thing. In Pipeline Studio, messages are small and fully consumed on receipt. There is no random-access read pattern.

#### TypeScript Support

`flatbuffers` npm package exists and is maintained. However, the TypeScript codegen pipeline is more complex than JSON.

#### Tauri IPC Compatibility

Same binary-over-IPC problem as Cap'n Proto. FlatBuffers buffers cannot be directly passed through Tauri's JSON-based IPC without base64 encoding.

#### MCP Compatibility

None.

**Verdict: Random-access advantage inapplicable. Binary format hurts Tauri and MCP. Do not use.**

---

### 2.5 MessagePack

**What it is:** Binary JSON — the same data model as JSON (null, bool, integer, float, string, array, object) but encoded in a more compact binary form. Typically 20–50% smaller than equivalent JSON, with 2–5x faster encode/decode.

#### Throughput & Latency

The speedup is real but moderate. For Pipeline Studio's workload (2,000 messages/second), the difference between JSON and MessagePack is in the tens of milliseconds per second of CPU time — imperceptible.

#### LLM Readability

MessagePack is binary. LLMs cannot read or write it without a decode step. This breaks the LLM-readability requirement: an LLM cannot inspect a `.msgpack` graph file and understand or modify it.

**Verdict: The binary format is a dealbreaker for LLM graph manipulation.**

#### Drop-in for JSON-RPC?

Sort of. There is no standard "MessagePack-RPC" equivalent to JSON-RPC 2.0 that is widely adopted. MsgPack-RPC exists but is not the same spec as JSON-RPC. Mapping JSON-RPC message semantics onto MessagePack requires defining your own framing — at that point you are off-spec and lose all JSON-RPC tooling compatibility.

#### MCP Compatibility

None. MCP requires JSON-RPC 2.0.

**Verdict: Moderate performance gains, but loses LLM readability and MCP compatibility. Do not use as primary protocol.**

---

### 2.6 Tauri IPC Deep Dive

Understanding the actual Tauri IPC mechanism is essential before choosing any protocol.

#### How Tauri IPC Works

Tauri's IPC has two primary mechanisms:

1. **`invoke` (request-response):** JavaScript calls `invoke('command_name', payload)`. Payload is serialized to JSON by Tauri's `serde_json` middleware, sent over a WebView postMessage bridge to the Rust backend, deserialized by serde, handled by a `#[tauri::command]` function, and the return value serialized back to JSON. Round-trip overhead: ~0.1–1ms depending on payload size.

2. **`emit`/`listen` (server-push events):** Rust calls `app_handle.emit('event_name', payload)`. Payload is again serialized to JSON via serde and sent via WebView JavaScript evaluation or postMessage. TypeScript side listens with `listen('event_name', handler)`.

**Key fact: Tauri's IPC is JSON-only by default.** The postMessage bridge does not natively support binary payloads. Binary data must be base64-encoded to cross the bridge.

#### Can Tauri Use Binary Protocols?

Technically yes, but with friction:

- **WebSocket server in Rust:** Spawn an `axum` or `warp` WebSocket server on a random localhost port, connect to it from the TypeScript side. Supports any binary protocol. Adds a localhost port and connection management complexity.
- **Custom protocol handler:** Tauri supports custom URI schemes that can serve binary responses. Not designed for bidirectional streaming.
- **Base64-encoded binary over IPC:** Works, but you pay base64 encode/decode overhead plus JSON overhead, negating any binary format advantage.

**Conclusion:** For Tauri desktop, binary protocols require a localhost TCP server, which adds architectural complexity and a new attack surface. JSON over Tauri IPC is the path of least resistance.

#### Overhead at Scale (100+ Streaming Nodes)

Each Tauri `emit` call involves:
1. Rust serde serialization (~microseconds for small payloads)
2. WebView postMessage crossing (~0.1–0.5ms)
3. JavaScript JSON parse (~microseconds for small payloads)
4. Event handler invocation

At 2,000 `node/output/partial` events per second, the IPC overhead is approximately 200–1000ms of latency budget per second — this is significant if events must be delivered with low latency. However, LLM token streaming in practice does not require sub-millisecond delivery; tokens arrive from the LLM API at 10–50 tokens/second per node, and the UI update cadence is 16ms (60fps). Batching multiple tokens per IPC call is a viable optimization if needed.

**Practical recommendation:** Batch `node/output/partial` events at the Rust layer (e.g., flush every 16ms or every N tokens) before emitting to Tauri. This reduces IPC call frequency by 10–50x with no visible latency impact.

---

## 3. Hybrid Architecture Analysis

One legitimate design question: should the *internal* engine communication (between the scheduler and node actors) use a different protocol than the *external* API (between engine and UI/MCP clients)?

**Internal communication (within the Rust process):** The TDD already answers this correctly — Tokio `mpsc` channels with typed Rust enums. This is not a "protocol" choice; it is native in-process message passing with zero serialization overhead. No protocol evaluation needed here.

**External communication (engine ↔ UI, engine ↔ MCP clients):** This is where the protocol question lives.

A hybrid that has been proposed in similar systems: JSON-RPC 2.0 for the external API surface + a binary format for high-throughput internal-to-IPC bridge. In practice, for this project:

- The internal engine never needs to serialize for external consumption — it uses Rust channels.
- Serialization only happens at the boundary: when the engine emits an event to the IPC layer.
- The bottleneck is not serialization; it is IPC call frequency.

The correct optimization (if needed) is **event batching at the boundary**, not a different serialization format.

---

## 4. Scoring Summary

| Protocol | Throughput | Latency | Streaming | Bidi | DX | MCP Compat | LLM Read | Tauri IPC | **Overall** |
|---|---|---|---|---|---|---|---|---|---|
| **JSON-RPC 2.0** | Good | Good | Adequate | Adequate | Excellent | Excellent | Excellent | Native | **Strong Fit** |
| gRPC / protobuf | Excellent | Excellent | Excellent | Excellent | Poor | Poor | Poor | Incompatible | **Not viable** |
| Cap'n Proto | Excellent | Excellent | N/A | N/A | Poor | Poor | Poor | Incompatible | **Not viable** |
| FlatBuffers | Excellent | Excellent | Adequate | Poor | Poor | Poor | Poor | Incompatible | **Not viable** |
| MessagePack | Good | Good | Adequate | Adequate | Good | Poor | Poor | Workaround needed | **Not viable** |

---

## 5. Recommendation

**Keep JSON-RPC 2.0. No changes to the protocol layer.**

### Rationale

The case for replacing JSON-RPC 2.0 rests on one claim: binary formats are faster. That claim is true in isolation, but it does not apply here:

1. **The bottleneck is not serialization.** At 100 concurrent LLM nodes each streaming at 10–50 tokens/second, the system processes 1,000–5,000 events/second. `serde_json` handles millions of small objects per second. Serialization is not in the hot path.

2. **The bottleneck is IPC call frequency.** Tauri IPC has a fixed per-call overhead of ~0.1–0.5ms regardless of payload format. Binary encoding does not reduce this. **Event batching** is the correct optimization.

3. **MCP compatibility is non-negotiable.** The embedded MCP server speaks JSON-RPC 2.0. Any other protocol for the engine's external API creates a translation layer that adds complexity, maintenance surface, and potential semantic mismatch. JSON-RPC 2.0 lets the engine and MCP server share the same protocol implementation.

4. **LLM readability is a first-class feature.** Pipeline Studio is a tool for working with LLMs. Graphs should be inspectable, generable, and modifiable by LLMs without a decode step. Binary formats break this.

5. **Tauri IPC is JSON-native.** All binary alternatives require either base64 overhead or a localhost TCP server. JSON is the zero-friction choice for Tauri.

6. **The streaming story is sufficient.** `node/output/partial` notifications over SSE (HTTP transport) or stdout (stdio transport) is the same pattern used by MCP, LSP, and the OpenAI streaming API. It is debuggable, well-understood, and does not require bidirectional streaming primitives.

### Actionable Optimizations (If Needed)

If performance becomes a concern later, the correct levers are:

| Optimization | Mechanism | Expected Gain |
|---|---|---|
| **Batch partial events** | Accumulate tokens for 16ms, emit one IPC call with an array of chunks | 10–50x reduction in IPC call count |
| **Compress large graph payloads** | gzip graph JSON before sending over HTTP transport | Smaller network transfer for remote clients |
| **Delta updates** | Emit only changed fields when updating graph state (not full graph resend) | Smaller payloads for incremental changes |
| **Dedicated event WebSocket** | For the HTTP transport, replace SSE with WebSocket for lower overhead push | ~10% reduction in HTTP framing overhead |

None of these require changing the serialization format or RPC convention.

### Protocol Finalization Checklist

The TDD's protocol design is sound. Before implementation begins, verify:

- [ ] `node/output/partial` events batch correctly at the Tauri IPC boundary (16ms flush interval or configurable)
- [ ] The MCP server reuses the same JSON-RPC dispatcher as the engine API (no duplication)
- [ ] Error code ranges in §1.9 are registered as Rust constants, not magic numbers
- [ ] The `stream<T>` type in the type system has a clear wire representation (sequence of `node/output/partial` notifications)
- [ ] The `initialize` handshake validates protocol version on both sides before any other messages are processed

---

*End of evaluation.*
