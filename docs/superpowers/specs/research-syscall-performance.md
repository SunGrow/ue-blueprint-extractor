# Research: Syscall Avoidance & Performance Optimization for Pipeline Studio

**Date:** 2026-03-27
**Context:** Pipeline Studio — Rust + Tokio node-based execution engine running 100+ concurrent node actors communicating via bounded mpsc channels, spawning CLI child processes, streaming partial results to a UI.

---

## 1. io_uring (Linux)

### How it reduces syscalls

Traditional Linux I/O requires a syscall per operation: `read()`, `write()`, `accept()`, `open()`, etc. io_uring replaces this with two shared memory ring buffers (submission queue + completion queue) between userspace and kernel. The application fills the SQ with operation descriptors, then issues a single `io_uring_enter()` to submit a batch; in `SQPOLL` mode, a kernel thread polls the SQ continuously — eliminating even that one syscall for high-throughput workloads.

**Reduction mechanism:**
- Batch N operations → 1 syscall (or 0 in SQPOLL mode)
- Zero-copy for fixed buffers registered with `io_uring_register()`
- Eliminates `epoll_wait` overhead for event notification

### Rust crate support

| Crate | Maturity | Notes |
|-------|----------|-------|
| `tokio-uring` | Beta, actively maintained | Wraps io_uring; incompatible with standard Tokio runtime — requires its own runtime |
| `io-uring` (low-level) | Stable | Raw bindings, full control, no async integration |
| `monoio` | Production at ByteDance | Single-threaded per-core model (like io_uring's natural fit); incompatible with multi-threaded Tokio |
| `glommio` | Production | Structured around io_uring, thread-per-core; incompatible with Tokio |

**Critical compatibility issue:** `tokio-uring` requires replacing `#[tokio::main]` with `#[tokio_uring::main]` and does not compose with `tokio::spawn` across the boundary. Pipeline Studio is already built on standard multi-threaded Tokio — migrating to `tokio-uring` or `monoio` would require a full runtime rewrite.

### Applicability to Pipeline Studio

**Impact: LOW for v1, MEDIUM for future Linux-only backend**

Operations that benefit most: file I/O (graph JSON load/save), large sequential stdout reads from child processes.

Operations that benefit least: short-lived mpsc channel wakes, tiny in-process messages.

**Blockers:**
- Linux kernel >= 5.11 required for full feature set (5.19+ for some stability fixes)
- Windows (IOCP) and macOS (kqueue) have no io_uring; Tauri must support all three
- Runtime incompatibility with standard Tokio

**Verdict:** Defer to post-v1. Consider behind a `cfg(target_os = "linux")` feature flag in a future "Linux performance" tier.

---

## 2. Zero-Copy I/O Patterns in Rust

### `bytes::Bytes` — shared reference-counted buffers

`bytes::Bytes` is an `Arc`-backed byte buffer with cheap clone via reference count increment — no heap copy. Ideal for passing large text chunks (LLM output) between multiple downstream nodes without copying.

```
LLM stdout → parse chunk → Bytes::copy_from_slice once → clone into N channel sends
```

**Impact: HIGH.** Pipeline Studio streams partial LLM output to both downstream nodes and the UI. Using `Bytes` eliminates repeated allocation per subscriber. Already used internally by Tokio's network stack — no compatibility concerns.

**Action:** Replace `Vec<u8>` / `String` in event payloads with `bytes::Bytes` for large streaming chunks. Use `BytesMut` for accumulation, then `freeze()` into `Bytes` before broadcast.

### `mmap` for file I/O

`memfd_create` / `mmap` maps a file directly into the process's virtual address space. A "read" is a page fault handled by the kernel — zero userspace syscalls for the data transfer itself.

For graph JSON files (typically < 1 MB): the benefit over `std::fs::read` is marginal because a single `pread()` on a hot page cache is already fast. The complexity (platform differences, lifetime management, `unsafe`) is not worth it for < 1 MB files.

**Impact: LOW.** Graph JSON files are small and loaded once per execution. Not worth the complexity.

### `splice` / `sendfile` — kernel-space piping

`splice` moves data between two file descriptors inside the kernel without copying to userspace. Useful when piping subprocess stdout directly to a socket or file.

For Pipeline Studio, LLM CLI output must be parsed in Rust (to detect streaming markers, extract JSON lines), so the data *must* enter userspace. `splice` is not applicable.

**Impact: LOW.** Cannot be used when userspace parsing of the stream is required.

---

## 3. Process I/O Optimization (Child Process stdout)

### Current state

`tokio::process::ChildStdout` wraps an OS pipe and uses Tokio's async read machinery. Under the hood: each `AsyncReadExt::read_buf()` call on a pipe issues one `read()` syscall. If LLM CLI tools write small chunks (e.g., one JSON token at a time), the consumer issues many `read()` syscalls.

### Buffering strategy

**Use `tokio::io::BufReader`** wrapping `ChildStdout`. Set buffer size to 64 KB–256 KB:

```rust
let reader = BufReader::with_capacity(256 * 1024, child.stdout.take().unwrap());
let mut lines = reader.lines();
while let Some(line) = lines.next_line().await? { ... }
```

`BufReader` issues one `read()` syscall to fill the buffer, then serves multiple `next_line()` calls from it without further syscalls. For LLM streaming output this can reduce syscalls by 10–50x depending on chunk sizes.

**Pipe buffer size:** On Linux, default pipe capacity is 64 KB. If the child process writes faster than we read, it blocks on write — stalling the LLM. Increase pipe capacity with `fcntl(F_SETPIPE_SZ, 1MB)` for high-throughput adapters. This is a `libc` call; wrap it as `#[cfg(target_os = "linux")]`.

**Impact: HIGH.** Easy to implement, cross-platform (BufReader), measurable reduction in syscall overhead for all LLM adapter nodes.

### PTY vs pipe

PTY (pseudo-terminal) adds line buffering and ioctl overhead. Pipes are faster for programmatic I/O. CLI tools that detect `isatty()` and switch to line-buffered mode when not in a PTY can cause problems — but this is a tool behavior issue, not a syscall count issue.

**Recommendation:** Always use pipes (the Tokio default), not PTY, for child processes.

---

## 4. Message Passing Optimization

### Tokio mpsc internals

`tokio::sync::mpsc` uses atomic operations (CAS on a linked-list queue) for the fast path — **no syscalls** when a receiver task is awake and polling. Syscalls only occur when a receiver parks (via Tokio's waker → eventfd/epoll on Linux). In a pipeline engine where nodes are continuously processing, parking is rare during active execution.

**Verdict:** Tokio mpsc is already highly optimized for the use case. Do not replace it.

### When channels DO trigger syscalls

1. Task parking: when all senders are idle and the receiver calls `recv()` on an empty channel, Tokio parks the task. Wakeup costs one `eventfd` write + `epoll_wait` cycle.
2. Bounded channel backpressure: `send().await` on a full channel parks the sender, same cost as above.

These are inherent to async scheduling and are **not avoidable without busy-waiting** (which wastes CPU).

### `crossbeam` vs `tokio::sync::mpsc`

`crossbeam::channel` uses epoch-based memory reclamation and is faster for pure CPU-bound passing (no async). However:
- It blocks the thread on `recv()`, making it incompatible with Tokio's cooperative scheduler
- Using it in an async context requires `spawn_blocking`, which adds thread pool overhead

**Verdict:** Do not use crossbeam for async node communication. Only applicable for purely synchronous transform nodes that have no I/O — a narrow use case.

### `flume`

`flume` provides both sync and async APIs over the same channel, with performance competitive with crossbeam for sync use. The async API is implemented with an atomics-based waker queue similar to Tokio's mpsc.

**Impact: LOW.** The primary benefit is API unification (one channel type for sync and async). Performance difference vs `tokio::sync::mpsc` is negligible for this workload.

---

## 5. Memory Allocation

### `jemalloc` vs system allocator

The system allocator on Windows is NT Heap (slow for many small allocations). On Linux it's glibc malloc (reasonable). `jemalloc` has better multi-threaded performance due to per-thread arenas that reduce lock contention.

For Pipeline Studio, 100+ tasks each allocating small `String`/`Vec` messages creates allocator pressure. `jemalloc` typically shows 10–30% improvement in allocation-heavy workloads.

**Rust integration:**
```toml
# Cargo.toml
[dependencies]
tikv-jemallocator = "0.6"
```
```rust
// main.rs
#[cfg(not(target_env = "msvc"))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;
```

**Platform note:** `jemalloc` does not support MSVC targets. On Windows with MSVC toolchain it silently falls back to the system allocator. The `cfg(not(target_env = "msvc"))` guard is required.

**Impact: MEDIUM.** Easy to add, no code changes required, measurable for allocation-heavy workloads. Worth adding in v1 for Linux/macOS builds.

### Arena allocation

Arena allocators (e.g., `bumpalo`) pre-allocate a large slab and bump-allocate from it. Deallocation is all-at-once when the arena is dropped.

For Pipeline Studio: each graph execution is a natural arena lifetime boundary. Scratch buffers, intermediate strings, and deserialized graph structures could all live in a per-execution arena.

**Complexity:** Requires `'arena` lifetime annotations to propagate through execution context. Non-trivial refactor.

**Impact: MEDIUM.** Real benefit (eliminates per-allocation overhead for execution-scoped data), but significant refactor cost. Defer to post-v1.

### Object pooling

Pool frequently-created objects (e.g., event structs, message envelopes) using `object-pool` or a custom `Arc<Mutex<Vec<T>>>` free list.

**Impact: LOW.** Tokio's internal allocations already amortize. Pool overhead (lock + pointer chase) often exceeds benefit for small objects. Not recommended unless profiling shows specific hot allocations.

---

## 6. Serialization Performance

### JSON at scale

`serde_json` is the standard but is not the fastest. For a pipeline with 100+ nodes each emitting JSON events, parsing overhead accumulates.

**Benchmark comparison (approximate, 1 KB JSON payload):**
| Library | Relative throughput |
|---------|-------------------|
| `serde_json` | 1x (baseline) |
| `sonic-rs` (SIMD, Rust port) | ~3–4x |
| `simd-json` | ~2–3x |
| `serde-json-borrow` | ~2x (zero-copy, borrow from slice) |

### `simd-json`

`simd-json` uses SIMD intrinsics (SSE4.2, AVX2) to accelerate JSON parsing. It has a `serde` compat layer:

```toml
[dependencies]
simd-json = { version = "0.14", features = ["serde_impl"] }
```

**Compatibility:** Requires mutable input buffer (it modifies bytes in-place during parsing). The API is slightly different: `simd_json::from_slice(&mut bytes)` vs `serde_json::from_slice(&bytes)`.

**Cross-platform:** Works on x86-64 (SSE4.2 required, available on all modern CPUs) and ARM64 (NEON). Falls back to scalar on unsupported targets.

**Applicability:** Graph load/save (large JSON), node config parsing, event deserialization.

**Impact: MEDIUM.** Worth it for graph loading (can be 1–5 MB). For small event payloads (< 200 bytes), the SIMD overhead setup cost exceeds benefit — keep `serde_json` for small messages.

### Binary serialization (MessagePack, etc.)

`rmp-serde` (MessagePack) is ~40% smaller on wire and 2x faster to parse than JSON. However:
- Loses human readability (debugging graphs requires a decoder)
- Protocol break: the TDD specifies JSON-RPC 2.0 over the wire
- UI clients (Tauri/browser) would need MessagePack support

**Verdict:** Do not use binary serialization for the protocol wire format. Consider it optionally for graph cache files (not user-editable), but the benefit is marginal compared to the debugging cost.

---

## 7. Cross-Platform Considerations

### Platform I/O model comparison

| Platform | Async I/O model | Kernel interface | Tokio support |
|----------|----------------|-----------------|---------------|
| Linux | io_uring (modern), epoll (legacy) | `io_uring_enter`, `epoll_wait` | epoll (built-in); io_uring via `tokio-uring` |
| Windows | IOCP (I/O Completion Ports) | `GetQueuedCompletionStatus` | Built-in (Tokio uses IOCP on Windows) |
| macOS | kqueue | `kevent` | Built-in |

**Tokio already uses the best available platform primitive.** On Windows it uses IOCP, which is completion-based like io_uring. On macOS it uses kqueue. Standard `tokio::fs` and `tokio::process` route through these optimally.

### Platform-agnostic syscall reduction strategies

These work on all three platforms and are the recommended focus for v1:

1. **Buffered reads** (`BufReader`) — OS-agnostic, pure userspace buffering
2. **`bytes::Bytes`** — OS-agnostic, avoids copies in Rust
3. **`jemalloc`** — Linux + macOS (not Windows MSVC)
4. **`simd-json`** — x86-64 + ARM64, all OS
5. **Larger bounded channel capacities** — reduces sender wakeup frequency

### Windows-specific note

On Windows, Tokio's process I/O uses anonymous pipes backed by IOCP. The BufReader recommendation still applies — it reduces the number of `ReadFile` calls regardless of completion model.

---

## Prioritized Recommendations

### v1 — Implement Now (high impact, low risk, cross-platform)

| Priority | Optimization | Effort | Impact |
|----------|-------------|--------|--------|
| 1 | `BufReader::with_capacity(256KB)` on all `ChildStdout` | 1 hour | HIGH — reduces read() syscalls by 10–50x per LLM stream |
| 2 | `bytes::Bytes` for streaming event payloads | 1 day | HIGH — eliminates copy per downstream subscriber |
| 3 | `jemalloc` global allocator (Linux/macOS only) | 30 min | MEDIUM — 10–30% allocation throughput improvement |
| 4 | `simd-json` for graph JSON load/save | 2 hours | MEDIUM — 2–3x faster for large graph files |

### v1 — Easy Wins (implement if time permits)

| Priority | Optimization | Effort | Impact |
|----------|-------------|--------|--------|
| 5 | Increase pipe buffer size to 1 MB on Linux via `F_SETPIPE_SZ` | 1 hour | MEDIUM — prevents LLM CLI stalling on slow consumer |
| 6 | Tune bounded channel capacities (default 32 → 256) | 30 min | LOW-MEDIUM — reduces backpressure parking frequency |

### Post-v1 — Defer

| Optimization | Why Defer |
|-------------|-----------|
| `io_uring` / `tokio-uring` | Runtime incompatibility; Linux-only; complexity too high for v1 |
| Arena allocation | Requires lifetime refactor across execution context |
| Binary serialization (MessagePack) | Protocol break; debugging cost; marginal benefit |
| `crossbeam` channels | Not async-safe; narrow applicability |
| `monoio` / `glommio` | Full runtime replacement; not cross-platform |
| Object pooling | Profile first — likely premature optimization |

---

## Summary

The highest-leverage changes for Pipeline Studio are entirely in **userspace and cross-platform**: buffered reads on child process streams, `bytes::Bytes` for zero-copy broadcast, `jemalloc`, and `simd-json` for large JSON. These collectively address the main syscall and allocation hot paths without any platform-specific kernel changes.

`io_uring` is the "right answer" for maximum syscall reduction on Linux but requires a runtime rewrite and breaks Windows/macOS support — defer until the engine has a proven Linux-production deployment and clear justification for platform-specific tuning.

The core Tokio mpsc channels are already nearly syscall-free during active execution and should not be replaced.
