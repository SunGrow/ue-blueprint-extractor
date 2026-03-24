# MCP Server Startup Profiling

## Environment
- Node.js version: v25.8.1
- Platform: Windows 11 Pro 10.0.26200
- Shell: bash (Git Bash / MSYS2)
- Project: blueprint-extractor-mcp v2.5.0
- Date: 2026-03-23
- Profiling method: `process.hrtime.bigint()` around dynamic `import()`, fresh process per run

## 1. Build Status

`npm run build` (tsc) completed successfully with zero errors or warnings.

## 2. Startup / Import Time

Measured via `process.hrtime.bigint()` around `import('./dist/index.js')`. Each run is a separate `node` process (cold start, no V8 code cache).

### Measurements (5 runs)

| Run | Import Time (ms) |
|-----|-------------------|
| 1   | 103.70            |
| 2   | 103.13            |
| 3   | 105.76            |
| 4   | 103.01            |
| 5   | 103.81            |
| **Mean** | **103.88**   |
| **Min**  | 103.01       |
| **Max**  | 105.76       |
| **Spread (max-min)** | **2.75 ms** |
| **Std Dev (approx)** | **~1.0 ms** |

### Analysis

- Import time is very consistent at ~104 ms with only ~2.75 ms spread across 5 cold-start runs.
- Well within acceptable range for a tool-calling MCP server that starts once per session.
- The tight spread (~2.6% of mean) indicates no significant variability from disk I/O or JIT warmup.
- The ~104 ms includes parsing and executing dist/index.js (381 KB) plus all transitive dependencies from node_modules (primarily @modelcontextprotocol/sdk and zod).

## 3. Memory Footprint

All values in bytes. Human-readable equivalents in parentheses.

| Stage | RSS | HeapTotal | HeapUsed | External | ArrayBuffers |
|-------|-----|-----------|----------|----------|--------------|
| Baseline (bare Node.js) | 34,435,072 (32.8 MB) | 4,591,616 (4.4 MB) | 3,818,296 (3.6 MB) | 1,471,179 (1.4 MB) | 22,799 |
| After import | 66,473,984 (63.4 MB) | 26,497,024 (25.3 MB) | 21,156,008 (20.2 MB) | 2,331,324 (2.2 MB) | 28,947 |
| After server creation | 73,101,312 (69.7 MB) | 33,312,768 (31.8 MB) | 23,196,168 (22.1 MB) | 2,331,324 (2.2 MB) | 28,947 |

### Memory Growth Per Stage

| Transition | RSS Delta | HeapUsed Delta |
|------------|-----------|----------------|
| Baseline -> After import | +30.6 MB | +16.5 MB |
| After import -> After server creation | +6.3 MB | +1.9 MB |
| **Total (baseline -> server ready)** | **+36.9 MB** | **+18.5 MB** |

### Analysis

- The import phase is the dominant memory consumer, adding ~30.6 MB RSS and ~16.5 MB heap. This is where the MCP SDK, zod schemas, and all tool definitions are loaded and parsed.
- Server creation is lightweight by comparison: only +6.3 MB RSS and +1.9 MB heap. The `McpServer` constructor and tool registration are efficient.
- Total working set of ~70 MB RSS for a ready server is reasonable for a Node.js MCP server with schema validation (zod).
- External memory (C++ allocations outside V8 heap) grows only 0.8 MB, indicating minimal native addon overhead.

## 4. Bundle Size

| Metric | Value |
|--------|-------|
| dist/index.js bytes | 389,733 (381 KB) |
| dist/index.js lines | 7,613 |
| dist/ total size | 459 KB |

### dist/ Contents

| File | Size |
|------|------|
| index.js | 380.6 KB |
| project-controller.js | 16.9 KB |
| automation-controller.js | 13.0 KB |
| ue-client.js | 6.9 KB |
| project-controller.d.ts | 4.9 KB |
| compactor.js | 3.9 KB |
| automation-controller.d.ts | 3.1 KB |
| index.d.ts | 1.2 KB |
| ue-client.d.ts | 1.1 KB |
| compactor.d.ts | 501 B |
| types.d.ts | 344 B |
| types.js | 11 B |

### Analysis

- dist/index.js at 381 KB / 7,613 lines is the dominant output file. This is the MCP server entry point containing all tool registrations and server logic.
- Supporting modules (automation-controller, project-controller, ue-client, compactor) total ~41 KB combined -- modest and well-factored.
- Total dist/ at 459 KB is compact. No obvious bloat from the TypeScript compilation.

## 5. Dependencies

| Metric | Value |
|--------|-------|
| node_modules/ total size | 73 MB |
| Top-level packages in node_modules | 133 |
| @modelcontextprotocol/sdk dist/ total | 5.6 MB |
| @modelcontextprotocol/sdk dist/cjs | 2.8 MB |
| @modelcontextprotocol/sdk dist/esm | 2.8 MB |

### Top Dependencies by Size

| Package | Size | Note |
|---------|------|------|
| typescript | 23 MB | Dev only |
| @esbuild | 11 MB | Dev only |
| @modelcontextprotocol/sdk | 5.6 MB | Runtime -- core MCP protocol |
| zod | 4.8 MB | Runtime -- schema validation |
| @rollup | 4.4 MB | Dev only |
| rollup | 2.8 MB | Dev only |
| @types | 2.7 MB | Dev only |
| hono | 2.4 MB | Runtime transitive (MCP SDK) |
| vite | 2.3 MB | Dev only |
| ajv | 2.0 MB | Runtime transitive (MCP SDK) |
| vitest | 1.6 MB | Dev only |

### Analysis

- 73 MB total node_modules is typical for a TypeScript project with build tooling and test framework.
- Dev-only dependencies (typescript, esbuild, rollup, vite, vitest, @types) account for ~46 MB. These do not affect runtime.
- Runtime dependencies are primarily @modelcontextprotocol/sdk (5.6 MB) and zod (4.8 MB). Both ship dual CJS+ESM formats.
- The SDK ships both CJS and ESM dist (2.8 MB each). Since this project uses ESM, the CJS bundle is unused at runtime.

## Summary

| Metric | Value | Assessment |
|--------|-------|------------|
| Cold-start import time | ~104 ms (mean of 5) | Good -- well under 200 ms |
| Import time variability | 2.75 ms spread | Excellent -- highly consistent |
| Memory at server-ready | ~70 MB RSS | Acceptable for Node.js MCP server |
| Memory cost of import | +30.6 MB RSS / +16.5 MB heap | Dominant phase (83% of growth) |
| Memory cost of server creation | +6.3 MB RSS / +1.9 MB heap | Lightweight |
| Bundle size (dist/) | 459 KB | Compact |
| node_modules (all) | 73 MB | Typical; ~46 MB is dev-only |
| Runtime deps on disk | ~10.4 MB | SDK (5.6 MB) + zod (4.8 MB) |

### Key Takeaways

1. **Startup is fast and stable.** At ~104 ms cold-start with <3 ms jitter, the server initializes quickly. No lazy-loading optimization is urgently needed.

2. **Memory is dominated by the import phase.** The +30.6 MB RSS from importing accounts for ~83% of total growth. The MCP SDK and zod schema definitions are the primary contributors. Server construction itself is cheap (+6.3 MB).

3. **Bundle output is lean.** The 459 KB dist/ is well-structured with clear module separation. The 381 KB index.js is the main entry point; it is large but not unreasonably so for a server with 20+ tool definitions.

4. **Production install could save ~46 MB on disk** by excluding dev dependencies. This does not affect runtime performance but matters for deployment packaging.

5. **Dual-format SDK shipping** (CJS + ESM at 2.8 MB each) means unused CJS code sits on disk. This is an upstream concern, not actionable in this project.

6. **No red flags detected.** Startup time, memory footprint, and bundle size are all within healthy ranges for an MCP server of this complexity.
