# MCP Optimization Research — Consolidated Report

## Executive Summary

Blueprint Extractor MCP had a clear optimization opportunity at the original v2.5.0 research snapshot:

- **97 tools** in a monolithic 9,340-line `index.ts` consuming **~15,000–18,000 tokens** of context window per session
- **Token cost reducible by 35–50%** (~5,500–8,000 tokens saved) through description compression, tool consolidation, and parameter trimming
- **Response sizes reducible by 15–40%** on high-traffic extraction tools via compactor extensions
- **Runtime overhead reducible** by eliminating 2 redundant JSON parse/stringify ops per call (111 call sites) and caching connection checks
- **Codebase decomposable** from 1 file → 35 focused modules with ~18% LOC reduction

That baseline roadmap is now substantially implemented, including the `v3.0.0` Phase 2 hard-break consolidation.

## Implementation Status (2026-03-24)

The repository has now moved well past the original "research only" state.

- **Phase 1 non-breaking work implemented:** description compression, `checkConnection()` TTL caching, `get_tool_help`, automation-run cleanup, structured-content-first tool normalization, compactor wiring for widget/BT/StateTree/material extraction, generic GUID/position stripping for compact extractions, and parameter text trimming.
- **Phase 2 hard-break consolidation implemented:** server/package version is now **`3.0.0`**, 17 legacy tool names were removed, and the public contract now exposes **`extract_asset`** plus **`material_graph_operation`** instead of the old per-family micro-tools.
- **Phase 3 decomposition implemented:** `index.ts` is now a **19-line CLI shim**, server construction lives in `server-factory.ts` (**115 lines**), and `MCP/src/` is split across **47 files** (`tools/`, `helpers/`, `resources/`, `prompts/`, `catalogs/`, `schemas/`).
- **Public API preserved:** `createBlueprintExtractorServer`, `exampleCatalog`, `promptCatalog`, and `UEClientLike` are still re-exported from `src/index.ts`.
- **Validation refreshed on 2026-03-24:** `npm run build`, `npm run test:unit`, and `npm run test:stdio` pass. Unit coverage now includes helper behavior plus direct module-local registration tests for **all 18 tool modules** under `MCP/src/tools/`, with `server-contract.test.ts` retained as the integration net.

### Quick Wins (< 1 day each)

| Item | Impact | Effort |
|------|--------|--------|
| P3: checkConnection TTL cache | ~30–60 ms/call saved; up to 5s on failure paths | 0.5 day |
| P6: `get_tool_help` meta-tool | ~500–1,500 additional tokens saved | 0.5 day |
| P7: runs Map LRU cleanup | Memory leak fix for long-running servers | 0.5 day |

---

## Research Task Index

References like **(T1)**, **(T2)** etc. throughout this document refer to the research tasks below:

| ID | Document | Scope |
|----|----------|-------|
| T1 | [tool-inventory.md](tool-inventory.md) | Full catalog of all 97 tools with token estimates |
| T2 | [runtime-analysis.md](runtime-analysis.md) | HTTP chain, serialization, memory profiling |
| T3 | [sdk-capabilities.md](sdk-capabilities.md) | MCP SDK features, progressive disclosure feasibility |
| T4 | [compactor-gaps.md](compactor-gaps.md) | Response size reduction opportunities |
| T5 | [startup-profiling.md](startup-profiling.md) | Startup time, memory footprint, bundle size |
| T6 | [consolidation-map.md](consolidation-map.md) | Tool consolidation analysis (97→84) |
| T7 | [description-compression.md](description-compression.md) | Description and parameter text optimization |
| T8 | [module-decomposition.md](module-decomposition.md) | Architecture: 1 file → 35 modules |
| T9 | [progressive-feasibility.md](progressive-feasibility.md) | Progressive disclosure approach assessment |
| T10 | This file (synthesis) | |

---

## Current State

| Metric | Value | Source |
|--------|-------|--------|
| Total tools | 97 | T1 |
| Token cost (tool definitions) | ~12,753 est. / ~15,000–18,000 realistic | T1 |
| Startup time | ~104 ms mean (5 runs, 2.75 ms spread) | T5 |
| Memory at idle | ~70 MB RSS (~23 MB heap used) | T5 |
| index.ts LOC | 9,340 | T1 |
| Bundle size (dist/) | 459 KB (index.js = 381 KB) | T5 |
| Runtime deps | @modelcontextprotocol/sdk 5.6 MB + zod 4.8 MB | T5 |
| node_modules total | 73 MB (~46 MB dev-only) | T5 |
| SDK version | @modelcontextprotocol/sdk v1.27.1 | T3 |

### Implemented Snapshot (2026-03-24)

| Metric | Value | Source |
|--------|-------|--------|
| Public tools exposed | 83 | Current contract tests |
| Server/package version | 3.0.0 | Current repository state |
| `MCP/src/index.ts` LOC | 22 | Current repository state |
| `MCP/src/server-factory.ts` LOC | 127 | Current repository state |
| Files under `MCP/src/` | 47 | Current repository state |
| Direct tool-module unit test files | 18 | Current repository state |
| Bootstrap helper tests | `server-bootstrap.test.ts` added | Current repository state |
| Validation status | `build`, `test:unit`, `test:stdio` all green | Current repository state |

---

## Optimization Roadmap

Sorted by priority. **ROI** = impact relative to effort (★★★ = best ratio).

| Pri | Optimization | Impact | Effort | Risk | ROI | Details |
|-----|-------------|--------|--------|------|-----|---------|
| P1 | Description compression (97 tools) | ~4,200 tokens saved (28–30%) | 1–2 d | Low | ★★★ | [description-compression.md](description-compression.md) |
| P2 | Tool consolidation (97→84) | ~1,440 tokens + cognitive load ↓ | 2–3 d | Low | ★★ | [consolidation-map.md](consolidation-map.md) |
| P3 | checkConnection TTL cache | 30–60 ms/call; 5s on failure paths | 0.5 d | Low | ★★★ | [runtime-analysis.md](runtime-analysis.md) |
| P4 | JSON parse/stringify chain reduction | 2 redundant ops eliminated (111 sites) | 1 d | Low | ★★ | [runtime-analysis.md](runtime-analysis.md) |
| P5 | Compactor extension (widget BP, BT, ST) | 15–40% response size ↓ on 3 tools | 2–3 d | Low–Med | ★★ | [compactor-gaps.md](compactor-gaps.md) |
| P6 | `get_tool_help` meta-tool | ~500–1,500 tokens saved | 0.5 d | Low | ★★★ | [progressive-feasibility.md](progressive-feasibility.md) |
| P7 | runs Map LRU cleanup | Memory leak fix | 0.5 d | Low | ★★★ | [runtime-analysis.md](runtime-analysis.md) |
| P8 | Module decomposition (1→35 files) | Maintainability, testability, −18% LOC | 5–8 d | Med | ★ | [module-decomposition.md](module-decomposition.md) |
| P9 | Generic GUID/position stripper | 5–25% response ↓ on 10+ tools | 2–3 d | Low–Med | ★★ | [compactor-gaps.md](compactor-gaps.md) |
| P10 | Parameter `.describe()` trimming | ~375 tokens saved | 1 d | Low | ★ | [description-compression.md](description-compression.md) |

### Impact vs Effort

```
  Impact ▲
  High   │  P1●            P2●
         │  P3● P6● P7●    P5●  P9●
         │                  P4●
  Low    │                  P8●  P10●
         └──────────────────────────► Effort
              < 1d    1-3d    5-8d
```

---

## Token Impact

### Per-Optimization Breakdown

| Optimization | Baseline | After | Savings | Confidence |
|-------------|----------|-------|---------|-----------|
| Description compression | ~5,000–7,000 (desc text) | ~1,500–2,500 | **~4,200** | ✅ char-by-char on top 30; pattern on remaining 67 |
| Tool consolidation 97→84 | ~12,753 (all defs) | ~11,310 | **~1,440** | ✅ routing table analysis validated |
| `get_tool_help` (new tool) | 0 | +200 | **−200** (cost) | ✅ known definition cost |
| Parameter `.describe()` trimming | ~8,000 (param descs) | ~6,500 | **~375–1,500** | ⚠️ estimated from top-5 expensive tools |
| serverInstructions consolidation | ~600 | ~800 | **~500–800** net | ⚠️ deduplicates text from 30+ tools |

### Cumulative Waterfall

Optimizations are **not fully additive** — consolidation removes tools whose descriptions would also be compressed:

| Step | Action | Running Total |
|------|--------|---------------|
| 0 | Baseline | ~15,000–18,000 |
| 1 | Description compression (97 tools) | ~12,300 (−4,200) |
| 2 | Tool consolidation (−15 tools, already compressed) | ~10,860 (−1,440) |
| 3 | Parameter `.describe()` trimming | ~9,700–10,500 (−375 to −1,500) |
| 4 | serverInstructions consolidation | ~9,000–10,000 (−500 to −800) |
| 5 | `get_tool_help` cost | ~9,200–10,200 (+200) |

**Result: ~9,000–10,500 tokens (35–50% reduction, saving ~5,500–8,000 tokens)**

---

## Response Size Impact

| Optimization | Tools Affected | Reduction | Confidence |
|-------------|---------------|-----------|-----------|
| Optional widget extractor compaction | extract_widget_blueprint | 15–30% | ✅ wired behind `compact=true` |
| BehaviorTree compactor | extract_behavior_tree | 25–40% | ✅ implemented for routed compact extraction |
| StateTree compactor | extract_statetree | 20–35% | ✅ implemented for routed compact extraction |
| Material graph compactor | extract_material, extract_material_function | 15–25% | ✅ optional `compact=true` strips layout noise and rewrites expression refs |
| DataTable compactor | extract_datatable | 10–30% | ❓ highly variable by table structure |
| Material instance compactor | extract_material_instance | 10–20% | ⚠️ parameterGuid + empty array removal |
| Widget animation compactor | extract_widget_animation | 10–20% | ⚠️ section/binding GUID removal |
| Generic GUID/position stripper | routed `extract_asset` families and compact material paths | 5–15% | ✅ shared `stripFields()` utility powers compact extraction cleanup |

**Architecture recommendation (T4):** Keep using a shared `stripFields(obj, patterns)` utility for common GUID/position/empty-default cleanup, while reserving specialized compactors for cases that need structural rewriting (short-ID assignment, exec-pin simplification, expression-reference rewrites).

---

## Runtime Impact

| Optimization | Current | After | Savings | Confidence |
|-------------|---------|-------|---------|-----------|
| checkConnection cache | +1 HTTP GET per call (111 sites) | Skip if <2–5s since last success | 1–5 ms local; 100 ms loaded; 5s on failure | ✅ traced at ue-client.ts:69-80 |
| JSON parse/stringify reduction | 8 ser/deser ops per call | 6 ops (eliminate redundant stringify→reparse) | 2 ops across 111 call sites | ✅ steps 4+5 confirmed redundant |
| Dual text+structuredContent | Response serialized twice | structuredContent only | 1 copy per call | ✅ normalized tool results no longer mirror JSON into text blocks |
| Spread copy reduction | 3–5 payload copies | 2–3 copies | ~200–400 KB transient for 200 KB payloads | ⚠️ requires normalizeToolSuccess refactor |
| runs Map cleanup | Pruned by max-age TTL + history cap | LRU eviction or max-age TTL | Prevents multi-MB leak over hundreds of runs | ✅ cleanup is implemented |
| Subsystem discovery caching | Already cached; retry on failure | Consider explicit path via env var | 0–3 PUTs on cold start | ✅ adequate, low priority |

**Worst-case HTTP chain per tool call:** Cold start or cache-invalidation: 1 GET + up to 7 PUTs = **8 HTTP requests** for a single tool call. The checkConnection cache alone eliminates 1 per call in the hot path.

---

## Architecture Impact

| Change | Before | After | Effect | Confidence |
|--------|--------|-------|--------|-----------|
| Module decomposition | 1 file, 9,340 LOC | 35 files, ~7,700 LOC | −1,640 LOC (~18%) | ✅ line-by-line plan |
| ToolRegistrationContext | Closure-based (16 deps) | Interface-based: single `ctx` object | Explicit deps; unit-testable | ✅ all 16 deps mapped |
| Registration factories | Inline per-tool registration | 15 `register*Tools(ctx)` groups | Standardized, independently testable | ✅ 20-step migration defined |
| Schema extraction | ~640 LOC inside closure | 8 schema modules in `schemas/` | Zero behavior change | ✅ zero closure deps |

### Incremental Migration (20 PRs)

| Steps | Scope | Risk |
|-------|-------|------|
| 0–2 | Types, schemas, pure helpers | **Zero** — pure file moves |
| 3–8 | Normalization, verification, context, prompts, resources | **Low** |
| 9–13 | Extraction, data, material, AI, import tools | **Low** |
| 14–17 | Widget, capture, project, build tools | **Medium** — complex deps |
| 18–19 | modify_widget_blueprint, apply_window_ui_changes | **Medium–High** — largest handlers |

**Stable public API:** `createBlueprintExtractorServer()`, `exampleCatalog`, `promptCatalog`, `UEClientLike` — all re-exported from `index.ts` throughout migration.

---

## Breaking Changes

### Phase 1 — Non-Breaking (v2.x)

All of the following are additive or internal-only:

- Description compression (text-only changes)
- Runtime optimizations (implementation changes only)
- Compactor extensions (new optional `compact` parameter)
- Module decomposition (public API unchanged)
- `get_tool_help` tool (new, additive)
- Parameter `.describe()` trimming (text-only)

### Phase 2 — Breaking (v3.0.0)

**Implemented in-repo on 2026-03-24 as a hard break. No deprecated alias cycle was shipped.**

**Tool consolidation removed 17 legacy tool names and replaced them with 2 consolidated tools:**

| Removed Tools | Consolidated Into |
|--------------|-------------------|
| `extract_statetree`, `extract_dataasset`, `extract_datatable`, `extract_behavior_tree`, `extract_blackboard`, `extract_user_defined_struct`, `extract_user_defined_enum`, `extract_curve`, `extract_curvetable`, `extract_material_instance`, `extract_anim_sequence`, `extract_anim_montage`, `extract_blend_space` | **`extract_asset`** |
| `set_material_settings`, `add_material_expression`, `connect_material_expressions`, `bind_material_property` | **`material_graph_operation`** |

**Migration required:** MCP clients, prompt templates, serverInstructions, and `exampleCatalog` must use the new names and shapes.

---

## Migration Path

### Phase 1: Non-Breaking (est. 2–3 weeks)

**Sprint 1 — Token & Runtime Quick Wins:**
1. **P1:** Compress all 97 tool descriptions to 1–2 sentences; move boilerplate to serverInstructions (~4,200 tokens saved)
2. **P3:** Add 2–5s TTL cache to `ue-client.ts:checkConnection()` (~30–60 ms/call saved)
3. **P7:** Add LRU eviction to `AutomationController.runs` Map (memory leak fix)

**Sprint 2 — Serialization & Progressive Disclosure:**
4. **P4:** Refactor `normalizeToolSuccess` to accept parsed object directly (eliminate stringify→reparse roundtrip)
5. **P5a:** Wire `extract_widget_blueprint` through existing compactor (zero new code)
6. **P6:** Register `get_tool_help` meta-tool for on-demand verbose docs

**Sprint 3 — Compactor Extensions:**
7. **P5b:** Implement `compactBehaviorTree()` (~40–60 new lines)
8. **P5c:** Implement `compactStateTree()` (~30–50 new lines)
9. **P10:** Trim redundant `.describe()` text on top-5 token-expensive tools

### Phase 2: Breaking Consolidation (implemented in `v3.0.0`)

10. `extract_asset` implemented with routing logic, DataTable truncation preservation, and shared `compact` cleanup across routed asset families with specialized BT/StateTree compactors
11. `material_graph_operation` implemented with exact legacy payload quirks preserved (`set_material_settings` double-nesting, `add_expression` remapping)
12. serverInstructions, exampleCatalog, prompt references, and tests updated to the new contract
13. Hard-break shipped directly; deprecated aliases were not retained

### Phase 3: Architecture Modernization (est. 3–4 weeks, zero external impact)

14. Execute 20-step module decomposition from [module-decomposition.md](module-decomposition.md) — each step is a standalone PR

**Status:** effectively implemented in-repo as of 2026-03-24. The remaining work is documentation cleanup and any optional follow-up refactors, not the core decomposition itself.

---

## Unresolved Questions

Sorted by impact on the roadmap. 🚫 = blocking, ⚠️ = affects estimates, ℹ️ = informational.

| # | Question | Status | Impact |
|---|----------|--------|--------|
| 1 | **Claude Code `tools/list_changed` support** — bug #4118 still open (March 2026). Dynamic tool registration blocked. | ✅ Verified broken | 🚫 Blocks meta-tool approaches. Reason why Approach C (minimal desc + `get_tool_help`) was chosen over Approach A. |
| 2 | **LLM accuracy with compressed descriptions** — no A/B test run against this server. arxiv:2602.14878 suggests low risk. | ❓ Uncertain | ⚠️ Should feature-flag P1 and validate with real workflows before full rollout. |
| 3 | **Token counting precision** — ~12,753 estimate uses chars/4 heuristic. No tiktoken-based count performed. | ❓ Uncertain | ⚠️ Savings estimates could be 5–15% off in either direction. |
| 4 | **Compactor field assumptions** — BT/ST fields identified from known UE patterns but not validated against actual extraction output. | ⚠️ Likely valid | ⚠️ 25–40% BT and 20–35% ST estimates need empirical validation. |
| 5 | **DataTable compaction variability** — 10–30% estimate is wide; sparse tables benefit more than dense. | ❓ Uncertain | ℹ️ Needs profiling with real project DataTables before committing. |
| 6 | **Dual text+structuredContent elimination** — removing text serialization needs SDK testing. | ⚠️ Likely safe | ℹ️ Low-priority optimization; validate before P4 refactor. |
| 7 | **ResourceLink for large extractions** — appropriate for >4–8 KB results, but no implementation plan exists. | ⚠️ Likely viable | ℹ️ Future optimization vector, not in current roadmap. |

---

## Contradictions Reconciled

Three contradictions were found across research tasks and resolved:

### 1. Token savings: T7 vs T9 — different scopes, not different conclusions

T7 reported ~4,542 tokens (descriptions + parameters). T9 reported ~3,000–4,000 (descriptions only).

**Resolution:** T7 includes param trimming (~375 tokens) in its total; T9 does not. Authoritative figures used in this report:
- Description compression only: **~4,200 tokens** (✅)
- Including param trimming: **~4,500 tokens** (✅/⚠️)
- Including serverInstructions: **~5,000–5,300 tokens** (⚠️)

### 2. Consolidation target: "97→67" vs "97→84"

T6's task description mentioned 97→67, but code analysis found only 15–16 viable removals (Groups C/D/E rejected due to schema heterogeneity).

**Resolution:** The code-validated figure **97→82–84** is authoritative. (✅)

### 3. Progressive disclosure %: 60–70% vs 23–33% vs 30–45%

Three different denominators produced three different percentages: description-only tokens, all tool tokens, and combined optimizations.

**Resolution:** This report uses the **all-in denominator** (15,000–18,000 tokens) and reports **35–50% combined savings**. (⚠️)

---

## Confidence Legend

| Indicator | Meaning |
|-----------|---------|
| ✅ Verified | Confirmed through code analysis, profiling, or direct measurement |
| ⚠️ Likely | Based on strong patterns but not empirically validated for this server |
| ❓ Uncertain | Estimate with wide confidence interval; needs empirical validation |

---

## Appendix: Research Metrics

| Metric | Value |
|--------|-------|
| Tasks completed | 9/10 (T1–T9 research + T10 synthesis) |
| Contradictions found / resolved | 3 / 3 |
| Research documents produced | 9 analysis + 1 synthesis |
| Tools cataloged | 97 (all accounted for) |
| Subsystem functions mapped | 53 unique |
| Lines of code analyzed | 10,202 (index.ts: 9,340 + ue-client.ts: 219 + automation-controller.ts: 492 + compactor.ts: 151) |
