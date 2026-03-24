# MCP Server Runtime Performance Analysis

**Analyzed files:**
- `MCP/src/ue-client.ts` (219 lines)
- `MCP/src/index.ts` (9340 lines)
- `MCP/src/automation-controller.ts` (492 lines)
- `MCP/src/compactor.ts` (151 lines)

> Status note (2026-03-24): this document describes the baseline runtime shape at research time. Several items discussed here are now implemented in-repo, including `checkConnection()` TTL caching, JSON success-path cleanup, automation-run cleanup, and the broader module decomposition. Use this file as historical analysis, not as a literal description of the current file layout.

---

## A. checkConnection() Overhead

### What it does (ue-client.ts:69-80)

```ts
async checkConnection(): Promise<boolean> {
  const res = await this.fetchImpl(`${this.baseUrl}/remote/info`, { signal: controller.signal });
  return res.ok;
}
```

- **HTTP request:** `GET /remote/info` (line 74)
- **Timeout:** `connectionTimeoutMs` = 5,000ms default (line 5, 59, 73)
- **Purpose:** Pure liveness check -- does UE's Remote Control HTTP server respond?

### Where it's called (ue-client.ts:196-200)

```ts
async callSubsystem(method, params): Promise<string> {
  const connected = await this.checkConnection();   // <-- line 197
  if (!connected) throw new Error(...);
  let objectPath = await this.discoverSubsystem();   // <-- line 202
  let res = await this.rawCall(objectPath, method, params);  // <-- line 203
```

**Every single `callSubsystem()` call** triggers `checkConnection()` unconditionally (line 197). There is no debounce, TTL cache, or skip-if-recently-checked logic.

### Frequency in index.ts

- `client.callSubsystem(...)` is called **25 times** across tool handlers (direct calls).
- `callSubsystemJson(...)` is a wrapper at line 2857-2864 that calls `client.callSubsystem()` -- it is called **86 times** across tool handlers.
- **Total: 111 tool-handler call sites** that each trigger `checkConnection()`.

### Cost per session

For a typical session with N tool invocations:
- **N extra HTTP round-trips** to `GET /remote/info` (each up to 5s timeout on failure)
- On a local machine, each round-trip is ~1-5ms, so for 20 tool calls: ~20-100ms wasted
- On a slow/loaded editor: can add 100ms+ per call, totaling 2-4 seconds per session
- On connection failure: each call blocks for up to **5 seconds** before throwing

### Recommendation

Cache the liveness result with a short TTL (e.g. 2-5 seconds). The subsystem discovery already caches; checkConnection should too.

---

## B. Subsystem Discovery Flow

### discoverSubsystem() (ue-client.ts:82-111)

1. **Fast path (cache hit):** If `this.subsystemPath` is already set, returns immediately (line 83).

2. **Discovery loop:** Iterates over `candidatePaths` (line 94), trying each one with a real RPC call:
   ```ts
   const res = await this.rawCall(path, 'ListAssets', {
     PackagePath: '/Game', bRecursive: false, ClassFilter: ''
   });
   ```
   This is a **full HTTP PUT to `/remote/object/call`** with 60s timeout per candidate (line 6, 147).

3. **Candidate paths tried** (lines 9-13):
   - `/Script/BlueprintExtractor.Default__BlueprintExtractorSubsystem`
   - `/Engine/Transient.BlueprintExtractorSubsystem`
   - `/Engine/Transient.BlueprintExtractorSubsystem_0`

   **3 candidates maximum**, each requiring a full HTTP round-trip on miss.

### Caching behavior

- **Cached after discovery:** Once a path works, it's stored in `this.subsystemPath` with source `'discovered'` (lines 99-100).
- **Cache invalidation:** Only in `callSubsystem()` when a call fails AND the path was discovered (not explicit). See lines 205-208:
  ```ts
  if (res.response === null && this.subsystemPathSource === 'discovered') {
    this.clearDiscoveredSubsystemPath();
    objectPath = await this.discoverSubsystem();  // re-discover
  }
  ```
- **Explicit paths never invalidated:** If the subsystem path was set via constructor or env var (`subsystemPathSource === 'explicit'`), `clearDiscoveredSubsystemPath()` is a no-op (lines 113-118).

### Worst-case per callSubsystem()

On a **cold start** or after cache invalidation:
1. `checkConnection()` -- 1 HTTP GET
2. `discoverSubsystem()` -- up to 3 HTTP PUTs (trying each candidate)
3. `rawCall()` -- 1 HTTP PUT (the actual method call)
4. If the rawCall fails and path was discovered: `clearDiscoveredSubsystemPath()` + re-discover (up to 3 more PUTs) + retry rawCall (1 more PUT)

**Worst case: 1 GET + 7 PUTs = 8 HTTP requests** for a single tool call.

---

## C. JSON Parse/Stringify Chains

### Raw counts in index.ts

| Operation        | Count |
|------------------|-------|
| `JSON.parse`     | **27** |
| `JSON.stringify`  | **101** |

### Additional in ue-client.ts (lines 153, 216, 217)

| Operation        | Count |
|------------------|-------|
| `JSON.stringify`  | **3** (request body serialization, fallback ReturnValue) |

### Full data path for `extract_blueprint` (compact=true)

Tracing a single successful call with `compact=true`:

| Step | Operation | Location | What happens |
|------|-----------|----------|-------------|
| 1 | `JSON.stringify(body)` | ue-client.ts:153 | Serialize the RPC request body for HTTP PUT |
| 2 | `res.json()` | ue-client.ts:177 | Node fetch parses the HTTP response body (implicit JSON.parse) |
| 3 | ReturnValue extraction | ue-client.ts:216-217 | If ReturnValue is not a string, `JSON.stringify(returnValue)` is called. ReturnValue is typically a string (JSON-encoded by UE), so this is usually a pass-through. |
| 4 | `JSON.parse(result)` | index.ts:3204 | Parse the JSON string from callSubsystem return |
| 5 | `compactBlueprint(parsed)` | index.ts:3209 / compactor.ts:15-37 | In-place traversal and mutation of the parsed object. No parse/stringify, but deep object walking. |
| 6 | `JSON.stringify(parsed)` | index.ts:3211 | Serialize compacted object for text content |
| 7 | Tool return `{ content: [{ type: 'text', text }] }` | index.ts:3215 | Creates the raw handler result |
| 8 | `extractToolPayload(result)` | index.ts:1473-1491 | Tries to extract structuredContent (not present), falls back to extracting text content and **re-parsing it**: `tryParseJsonText(text)` at line 1480, which calls `JSON.parse(text)` at line 1458 |
| 9 | `normalizeToolSuccess()` | index.ts:1653-1679 | `{ ...payload }` spread copy (line 1658), then `{ ...basePayload }` spread copy into envelope (line 1666), then `JSON.stringify(envelope)` (line 1674) |
| 10 | SDK serialization | MCP SDK | The SDK serializes the final `CallToolResult` to send over stdio (another implicit JSON.stringify) |

### Parse/stringify tally for extract_blueprint (compact=true)

| # | Operation | Avoidable? |
|---|-----------|-----------|
| 1 | `JSON.stringify` -- request body | No (required for HTTP) |
| 2 | Implicit `JSON.parse` -- fetch res.json() | No (required for HTTP) |
| 3 | `JSON.parse` -- handler parses ReturnValue string | **Questionable** -- UE sends JSON as a string inside JSON |
| 4 | `JSON.stringify` -- handler serializes for text content | **Yes** -- immediately re-parsed in step 5 |
| 5 | `JSON.parse` -- extractToolPayload re-parses text | **Yes** -- round-trip from step 4 |
| 6 | `JSON.stringify` -- normalizeToolSuccess creates text | **Partly** -- duplicates structuredContent |
| 7 | Implicit `JSON.stringify` -- SDK stdio transport | No (required for transport) |

**Total: 3 JSON.stringify + 3 JSON.parse in-process, plus 2 more for transport = 8 serialization operations for a single tool call.**

**At least 2 are fully redundant** (steps 4+5: stringify then immediately re-parse). The normalizeToolSuccess wrapper at step 6 also duplicates the data as both `structuredContent` (object) and `content[0].text` (JSON string), meaning the same data exists in memory twice.

### The callSubsystemJson wrapper (line 2857)

86 tool handlers use this helper, which calls `client.callSubsystem()` (returns string) then immediately `JSON.parse(result)`. Combined with the normalizeToolSuccess wrapper, each of these 86 handlers follows the same redundant parse-stringify-reparse pattern.

---

## D. Spread Copies and Memory

### Spread copy sites in the normalization pipeline

| Line | Code | Context |
|------|------|---------|
| 1253 | `{ ...payload }` | `normalizeVerificationArtifact` -- shallow copy of payload |
| 1270 | `{ ...basePayload, ... }` | Same function -- spread copy into return object |
| 1293 | `{ ...artifact, ... }` | `normalizeVerificationArtifactReference` -- copy of artifact |
| 1301 | `{ ...nested }` | `normalizeVerificationComparison` -- copy of nested object |
| 1445 | `{ ...payload }` | `normalizeAutomationRunResult` -- shallow copy |
| 1447 | `{ ...basePayload, ... }` | Same function -- spread into return |
| 1593 | `{ ...payloadOrError }` | `normalizeToolError` -- copy of error payload |
| 1615 | `{ ...payload, ... }` | Same function -- spread into envelope |
| 1658 | `{ ...payload }` | `normalizeToolSuccess` -- copy into basePayload |
| 1666 | `{ ...basePayload, ... }` | Same function -- spread into envelope |
| 1684 | `{ ...config }` | registerTool wrapper -- copy of tool config |

### Per-tool-call copy chain (normalizeToolSuccess path)

For a typical successful tool call, the normalization wrapper creates:

1. **Copy 1** (line 1658): `{ ...payload }` -- shallow clone of the entire parsed result
2. **Copy 2** (line 1666): `{ ...basePayload, success, operation, execution }` -- another shallow clone plus metadata
3. **Copy 3** (line 1674): `JSON.stringify(envelope)` -- serialized string copy for text content

**3 copies of the full payload** are created in `normalizeToolSuccess` alone, on top of any copies made in the handler itself.

For the `extract_blueprint` handler specifically, the data exists simultaneously as:
- The parsed object from `JSON.parse(result)` (handler local)
- The compacted version (in-place mutation, so same reference)
- The `JSON.stringify(parsed)` text string (handler return)
- The re-parsed object from `extractToolPayload` -> `tryParseJsonText`
- The `{ ...payload }` basePayload copy
- The `{ ...basePayload }` envelope copy
- The `JSON.stringify(envelope)` final text string
- The `structuredContent: envelope` reference (shared with envelope)

**At peak: 5 distinct copies of the data in memory** (3 objects + 2 strings) for one tool call.

For a 200KB blueprint extraction, this means approximately **800KB-1MB of transient memory** per call just from normalization overhead.

---

## E. Unbounded State

### AutomationController.runs Map (automation-controller.ts:203)

```ts
private readonly runs = new Map<string, MutableAutomationRun>();
```

**No cleanup mechanism exists.** Searched for `runs.delete` and `runs.clear` -- zero results. Every automation run is stored permanently for the lifetime of the MCP server process.

Each `MutableAutomationRun` includes:
- Full command args and paths (lines 256-277)
- An `artifacts` array with file paths and metadata (line 275)
- An `artifactMap` Map (line 276)
- A `diagnostics` array (line 272)
- A `summary` object with test counts (line 328)

The `cloneRun()` method at lines 412-418 also creates spread copies every time a run is queried:
```ts
private cloneRun(run: MutableAutomationRun, operation): AutomationRunResult {
  return {
    ...run,           // spread copy of entire run
    operation,
    artifacts: [...run.artifacts],  // shallow copy of artifacts array
  };
}
```

### Other potentially unbounded state

| Location | What | Bounded? |
|----------|------|----------|
| index.ts:1086 | `cachedProjectAutomationContext` | Single value, overwritten -- bounded |
| index.ts:1087 | `lastExternalBuildContext` | Single value, overwritten -- bounded |
| ue-client.ts:51 | `subsystemPath` cache | Single string -- bounded |
| index.ts:43 | `taskAwareTools` Set | Static, compile-time -- bounded |
| automation-controller.ts:203 | `runs` Map | **UNBOUNDED -- never cleaned** |

### Impact assessment

For a long-running MCP server that orchestrates repeated automation test runs:
- Each `MutableAutomationRun` is moderate-sized (~2-5KB base + artifacts metadata)
- File references (stdout/stderr/report paths) remain but files themselves are on disk
- The `artifactMap` per run adds Map overhead
- Over hundreds of runs, the Map could accumulate several MB of unreclaimable memory

---

## Summary of Findings

| Issue | Severity | Impact |
|-------|----------|--------|
| checkConnection() on every tool call | Medium | 1 extra HTTP round-trip per tool call, up to 5s blocking on failure |
| Discovery worst-case: 8 HTTP requests | Low | Only on cold start or after cache invalidation |
| Redundant JSON parse-stringify-reparse in handler->normalizeToolSuccess | High | 2 fully redundant serialization steps per tool call across all 111 call sites |
| Dual text+structuredContent serialization | Medium | Every response payload serialized twice (object + JSON string) |
| 3-5 copies of payload data in memory during normalization | Medium | ~4x memory amplification for large payloads (200KB blueprint -> ~800KB transient) |
| Unbounded automation runs Map | Low-Medium | Slow memory leak in long-running servers with repeated test runs |
