# Progressive Disclosure Feasibility Assessment

**Date:** 2026-03-23
**Context:** Blueprint Extractor MCP v2 -- 97 tools, ~15,000-18,000 tokens all-in
**Constraint:** Claude Code and Claude Desktop do NOT handle `notifications/tools/list_changed` (bug #4118 still open). Any approach must work without dynamic tool list updates.

---

## Approach A: Meta-Tool Pattern (Speakeasy-style)

### Feasibility: Medium

Replace all 97 tools with 3 meta-tools: `list_tools`, `describe_tool`, `execute_tool`.

### Token Savings

- **Initial context:** ~800-1,200 tokens (3 tool definitions + category index)
- **Per-query discovery overhead:** ~400-800 tokens (list category + describe 1-2 tools)
- **Savings vs baseline:** ~94-96% reduction in initial context tokens

### Pros

1. **Maximum token reduction.** From ~15,000-18,000 tokens down to ~1,000 tokens on initial context. The 97-tool definition block is entirely replaced by 3 compact meta-tools.
2. **Works with all MCP clients.** No dependency on `tools/list_changed`. The 3 tools are registered statically at startup.
3. **Scales indefinitely.** Adding tool #98 or #200 has zero impact on initial context cost.
4. **Proven pattern.** Speakeasy benchmarked this at 100x-160x token reduction on a 400-tool server. ProDisco and HuggingFace both ship production servers using this pattern.
5. **Category-based discovery is natural for this server.** The 97 tools already cluster into clear domains: extraction (17), widget authoring (12), material authoring (11), animation (8), data authoring (10), AI authoring (8), project management (9), import/export (7), capture/verification (5), utility (10).

### Cons

1. **Every operation requires 2-3 LLM turns.** For a simple `search_assets` call, the LLM must: (1) call `list_tools` or `describe_tool("search_assets")`, (2) read the schema, (3) call `execute_tool("search_assets", {...})`. This adds latency and token cost per-invocation that partially offsets the initial savings.
2. **No schema validation on `execute_tool`.** The LLM passes arguments as untyped JSON to `execute_tool(name, args)`. Zod schemas, enum constraints, min/max validators, and default values are all lost. The server must validate at runtime and return errors, which costs additional turns.
3. **Loss of tool annotations.** `readOnlyHint`, `destructiveHint`, `idempotentHint` cannot be attached to virtual tools. Claude Code cannot auto-approve read-only operations.
4. **Polymorphic tools become even harder.** Tools like `modify_widget_blueprint` (21 params, operation enum with 10 values) require the LLM to carefully read returned documentation and construct correct JSON. Without schema-enforced types, error rates will increase.
5. **Breaks outputSchema contracts.** 20 tools use custom output schemas (ImportJobSchema, automationRunSchema, etc.). These schemas enable structured content in responses. `execute_tool` would need to dynamically assign output schemas or lose them entirely.
6. **Higher per-query cost for common workflows.** A typical UI authoring session calls search_assets, extract_widget_blueprint, build_widget_tree, modify_widget, compile_widget_blueprint, capture_widget_preview, save_assets -- that's 7 tools. With meta-tools, the LLM needs 14-21 calls (2-3 per tool) instead of 7 direct calls.
7. **`execute_tool` becomes a god-function.** All 97 tool implementations must be reachable from a single handler, creating a complex dispatch layer.

### Implementation Complexity: High

- Build a tool registry with category metadata, full schema documentation as serializable text, and a dispatch function.
- Implement `list_tools(category?)` returning tool names + 1-line descriptions.
- Implement `describe_tool(name)` returning full description, input schema (as JSON Schema text), output schema, annotations, and usage examples.
- Implement `execute_tool(name, args)` with runtime validation, dispatch, and error normalization.
- Migrate all 97 tool callbacks to be callable from the dispatcher.
- Handle outputSchema diversity (20 distinct schemas across 97 tools).
- Estimated effort: 3-5 days for a clean implementation + thorough testing.

### Critical Risk

The LLM must correctly remember and apply schema details it read in a previous turn. For complex tools like `modify_material_instance` (11 params, nested array schemas for scalar/vector/texture/font parameters), schema recall errors will be frequent. This risk is **structural** -- it cannot be mitigated without re-sending the schema each time, which eliminates the token savings.

---

## Approach B: Two-Tier Static Registration

### Feasibility: Medium-High

Register 15-20 "core" tools statically with full schemas. Register a `discover_tools` meta-tool and an `execute_tool` meta-tool for the remaining ~77-82 tools.

### Token Savings

- **Initial context:** ~4,000-5,500 tokens (15-20 core tools + 2 meta-tools)
- **Per-query discovery overhead:** ~300-600 tokens per non-core tool invocation
- **Savings vs baseline:** ~65-75% reduction in initial context tokens

### Pros

1. **Core tools retain full schema validation.** The 15-20 most frequently used tools (search_assets, extract_blueprint, build_widget_tree, save_assets, etc.) work exactly as today with Zod validation, defaults, enums, and annotations.
2. **Works with all MCP clients.** Static registration, no `list_changed` dependency.
3. **Reasonable token savings.** 65-75% reduction covers the most impactful ground. The current ~15K-18K drops to ~4K-5.5K.
4. **Gradual migration path.** Can start by demoting rarely-used tools to the meta-tier while keeping all frequently-used tools as core.
5. **Core tools keep annotations.** Read-only core tools get auto-approved in Claude Code.

### Cons

1. **Non-core tools lose schema validation.** Same problem as Approach A for 77-82 tools: untyped JSON, no defaults, no enum constraints.
2. **Two-class tool system creates UX inconsistency.** The LLM must learn that some tools are called directly and others require discover+execute. This is a cognitive overhead that can cause the LLM to attempt direct calls to non-core tools.
3. **Core tool selection is inherently wrong for some users.** A material artist's "core" tools differ from a UI designer's. A static core set will always be suboptimal for some workflows.
4. **Still requires extra turns for non-core tools.** For any operation outside the core set, the latency penalty applies.
5. **Maintenance burden.** Every new tool requires a decision: core or non-core? Schema changes to core tools require normal MCP updates; schema changes to non-core tools require updating the documentation text in the meta-tier.

### Implementation Complexity: Medium

- Define the core tool set and keep those registered normally.
- Build `discover_tools(category?)` returning documentation for non-core tools.
- Build `execute_tool(name, args)` dispatching to non-core tool implementations.
- Only 77-82 tools need the meta-tier treatment; core tools are unchanged.
- Estimated effort: 2-3 days.

### Critical Risk

The LLM may not reliably distinguish core from non-core tools. If it tries to call `modify_blend_space` directly (not in core), it gets an error. It must then discover it via the meta-tool and retry -- wasting a turn. This friction is **inherent** in the two-tier design.

---

## Approach C: Category-Gated Static Registration (Ultra-Minimal Descriptions)

### Feasibility: High

Register all 97 tools with ultra-minimal 1-line descriptions (~15-25 words each). Provide a `get_tool_help(tool_name)` meta-tool that returns the full documentation, usage guidelines, parameter details, and examples for any tool on demand.

### Token Savings

- **Initial context:** ~4,500-6,000 tokens (97 tools with minimal descriptions + schemas + 1 help tool)
- **Per-query help overhead:** ~200-500 tokens per help call (only needed for complex tools)
- **Savings vs baseline:** ~60-70% reduction in initial context tokens

### Pros

1. **All 97 tools retain full Zod schema validation.** Input schemas, enum constraints, min/max validators, default values, and output schemas all remain intact. This is the single most important advantage.
2. **All tools retain annotations.** readOnlyHint, destructiveHint, idempotentHint all work, enabling Claude Code auto-approval for read-only operations.
3. **No two-class system.** Every tool is callable directly. The LLM never needs to go through a meta-tool to execute an operation -- only to understand one.
4. **Help is optional, not mandatory.** For simple tools (single-param extractors, save_assets, compile_*), the LLM can call them directly from the minimal description + schema alone. Only complex tools (modify_widget_blueprint, sync_project_code, modify_material_instance) benefit from help lookups.
5. **Works with all MCP clients.** Static registration, no `list_changed` dependency.
6. **Lowest cognitive overhead for the LLM.** Tool selection is based on the same `tools/list` mechanism as today. The LLM sees 97 tool names with 1-line descriptions plus full schemas and makes the same selection decisions.
7. **Incremental migration.** Can compress descriptions tool-by-tool. Each compression is independently testable.
8. **Description compression research already done.** The description-compression analysis (description-compression.md) identified 9,590 chars saveable from the top 30 descriptions alone (2,398 est. tokens). Extending to all 97 tools yields ~3,000-4,000 tokens saved from descriptions alone.
9. **serverInstructions absorbs cross-cutting guidance.** "Use search_assets first", "call save_assets after mutations", and other boilerplate currently duplicated across 30+ tool descriptions can move to the server instructions block (already 2,100 chars).

### Cons

1. **Less dramatic token savings than Approach A.** 60-70% reduction vs 94-96%. The schemas themselves (Zod types serialized as JSON Schema) account for a significant portion of the token cost, and those remain.
2. **97 tools still appear in `tools/list`.** Some MCP clients may have display limitations or performance issues with 97 tools. (Not a known problem with Claude Code as of March 2026.)
3. **Help tool adds one extra turn for complex tools.** For tools like `modify_widget_blueprint` (21 params), the LLM may need to call `get_tool_help` before constructing the call. But this is additive, not multiplicative -- it's 1 extra turn, not 2-3.
4. **Schema overhead is irreducible.** The Zod schemas for 97 tools generate ~8,000-10,000 tokens of JSON Schema regardless of description length. Description compression only addresses ~5,000-8,000 tokens of the ~15,000-18,000 total.

### Implementation Complexity: Low

- Compress all 97 tool descriptions to 1-2 sentence summaries.
- Move cross-cutting guidance to serverInstructions.
- Implement `get_tool_help(tool_name)` that returns the original verbose documentation, usage examples, parameter details, and workflow context.
- No changes to tool registration, schemas, callbacks, or dispatch logic.
- Estimated effort: 1-2 days.

---

## Recommended Approach

### Approach C: Category-Gated Static Registration

**Justification:**

1. **Schema validation is non-negotiable for this server.** Blueprint Extractor MCP tools operate on live Unreal Engine editor state. A malformed `modify_widget_blueprint` call with wrong operation enum, missing required nested fields, or incorrect type for `payload.fields` can corrupt asset state or cause editor crashes. Zod validation at the MCP boundary prevents this. Approaches A and B sacrifice validation for 77-97 tools.

2. **The token savings delta does not justify the accuracy risk.** Approach C saves ~60-70% of tokens (from ~16K to ~5K). Approach A saves ~95% (from ~16K to ~1K). But the *absolute difference* is ~4,000 tokens -- roughly 1-2 pages of text. In a conversation that already uses 30K-100K tokens for tool results, shaving an additional 4K tokens from tool definitions provides diminishing returns.

3. **Per-query overhead favors C.** In Approach A, *every* tool call costs 2-3 extra turns. In Approach C, only complex tools *optionally* incur 1 extra turn. For a 7-tool UI authoring workflow:
   - Approach A: 14-21 tool calls (2-3x multiplier)
   - Approach B: 7-14 tool calls (1-2x, depending on core coverage)
   - Approach C: 7-9 tool calls (1x + 0-2 help lookups)

4. **Implementation risk is lowest.** Approach C requires no dispatcher, no runtime validation layer, no god-function. It is a description-editing task with one new simple tool. This means lower bug risk, easier testing, and faster ship time.

5. **The existing description-compression research provides a ready-made migration plan.** The top-30 compression proposals in description-compression.md save 2,398 tokens (confirmed through char-by-char analysis). Extending to all 97 tools is mechanical.

6. **Hybrid enhancement path.** If 60-70% savings prove insufficient, Approach C can be enhanced later:
   - Add a `discover_tools(category)` alongside `get_tool_help` for category-level browsing
   - Selectively demote rarely-used tools to a meta-tier (Approach B hybrid)
   - Neither enhancement requires rearchitecting the core tool registration

### When to reconsider

If the tool count grows to 200+ tools, or if Claude Code/Desktop begins supporting `tools/list_changed`, revisit Approach B (two-tier) or dynamic registration respectively.

---

## Core Tool Set (15-20 tools)

These tools should receive the most careful description optimization (not ultra-minimal -- they benefit from slightly richer descriptions because they are the workflow entry points and most-used tools).

| # | Tool | Category | Rationale |
|---|------|----------|-----------|
| 1 | search_assets | Discovery | Entry point for nearly every workflow. Must find correct asset paths before any extract/modify. |
| 2 | list_assets | Discovery | Directory browsing when asset names are unknown. |
| 3 | extract_blueprint | Extraction | Most versatile extractor. Covers Blueprint, AnimBlueprint, WidgetBlueprint (via Components scope). |
| 4 | extract_widget_blueprint | Extraction | Dedicated widget snapshot for UI workflows. High-frequency in UI design sessions. |
| 5 | extract_material | Extraction | Material graph snapshot for material authoring workflows. |
| 6 | extract_material_instance | Extraction | Parameter override inspection for look-dev workflows. |
| 7 | build_widget_tree | Widget Authoring | Primary destructive widget construction tool. Complex recursive schema. |
| 8 | modify_widget | Widget Authoring | Per-widget property patching. High-frequency in iterative UI work. |
| 9 | modify_widget_blueprint | Widget Authoring | Polymorphic widget mutation (10 operations, 21 params). Needs rich documentation. |
| 10 | create_material_instance | Material Authoring | First step in material authoring workflows. |
| 11 | modify_material_instance | Material Authoring | 11 params, nested parameter arrays. Hard to use without full schema. |
| 12 | add_material_expression | Material Authoring | Composable material node creation -- the LLM uses this repeatedly. |
| 13 | connect_material_expressions | Material Authoring | Composable material wiring -- follows add_material_expression. |
| 14 | create_blueprint | Blueprint Authoring | Entry point for new Blueprint creation workflows. |
| 15 | modify_blueprint_members | Blueprint Authoring | Variable/component/function authoring. Complex operation dispatch. |
| 16 | save_assets | Utility | Final step in every write workflow. Must be easily discoverable. |
| 17 | compile_widget_blueprint | Utility | Validation step after widget mutations. Lightweight but critical. |
| 18 | wait_for_editor | Utility | Recovery tool after editor restarts. LLM must know this exists. |
| 19 | capture_widget_preview | Verification | Visual verification after UI mutations. Critical for workflow completion. |
| 20 | run_automation_tests | Testing | Entry point for test-driven verification workflows. |

**Selection criteria applied:**
- Frequency: search_assets, extract_blueprint, save_assets are called in nearly every session.
- Schema complexity: modify_widget_blueprint (21 params), modify_material_instance (11 params), build_widget_tree (recursive schema) are unusable without full schema.
- Workflow entry points: search_assets, create_blueprint, create_material_instance start multi-step flows.
- Planning visibility: wait_for_editor, save_assets, capture_widget_preview must be known for the LLM to plan correct multi-step operations.

---

## Token Impact

| Approach | Initial Tokens | Per-Query Overhead | Net Savings vs Baseline | Break-Even Point |
|----------|---------------|-------------------|------------------------|-----------------|
| **Baseline** (current) | ~16,000 | 0 | -- | -- |
| **A: Meta-Tool** | ~1,000 | ~600-1,200 per tool call (2-3 turns) | 94% initial, but offset by 2-3x call multiplier | ~12-15 tool calls per session (after which cumulative overhead exceeds savings) |
| **B: Two-Tier** | ~5,000 | ~400-800 per non-core tool call | 69% initial | ~14-20 non-core tool calls |
| **C: Ultra-Minimal + Help** | ~5,500 | ~300 per help lookup (optional, <50% of calls need it) | 66% initial | Never -- help is optional, so overhead is additive not multiplicative |

### Detailed Token Breakdown for Approach C

| Component | Current Tokens | Optimized Tokens | Savings |
|-----------|---------------|-----------------|---------|
| Tool descriptions (all 97) | ~5,000-7,000 | ~1,500-2,500 | ~3,500-4,500 |
| Input schemas (Zod -> JSON Schema) | ~7,000-9,000 | ~7,000-9,000 | 0 (irreducible) |
| Output schemas | ~1,500-2,000 | ~1,500-2,000 | 0 (irreducible) |
| Annotations | ~500-700 | ~500-700 | 0 |
| Tool names + titles | ~500-600 | ~500-600 | 0 |
| serverInstructions | ~600 | ~800 (absorbs cross-cutting boilerplate) | -200 (grows slightly) |
| `get_tool_help` tool definition | 0 | ~200 | -200 (new cost) |
| **Total** | **~15,000-18,000** | **~11,500-15,000** | **~3,500-5,000 (23-33%)** |

**Note on "60-70%" vs "23-33%":** The higher figure counts only description tokens; the lower counts all tool tokens including schemas. The realistic savings from description compression alone is ~3,500-5,000 tokens (23-33% of total). To reach 60-70%, schema compression would also be needed (e.g., removing parameter descriptions from schemas, collapsing enum descriptions) -- this is a separate optimization vector analyzed in description-compression.md.

### Revised Realistic Estimate

With description compression + parameter description trimming + serverInstructions consolidation:

| Optimization | Token Savings |
|-------------|--------------|
| Description compression (all 97 tools) | ~3,000-4,000 |
| Parameter `.describe()` trimming (redundant params) | ~1,500-2,500 |
| serverInstructions consolidation (remove "use search_assets first" from 15 tools) | ~500-800 |
| `get_tool_help` cost | -200 |
| **Net savings** | **~4,800-7,100 (30-45%)** |
| **Optimized total** | **~9,000-12,000** |

---

## Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| **LLM selects wrong tool due to minimal description** | Medium | Medium -- wrong tool call wastes a turn, returns error, LLM retries | Keep descriptions semantically distinct. Ensure tool names are self-documenting. Test with real workflows. |
| **LLM skips `get_tool_help` for complex tools** | Medium | High -- malformed args for modify_widget_blueprint (21 params) or modify_material_instance (11 params) waste 1-2 turns on validation errors | serverInstructions directive: "Call get_tool_help before first use of polymorphic tools with operation enums." Zod validation catches errors and returns structured next_steps. |
| **Schema compression removes useful constraints** | Low | Medium -- LLM sends out-of-range values or wrong types | Only compress descriptions and redundant `.describe()` text. Never remove Zod type constraints, enums, min/max, or defaults. |
| **Claude Code display issues with 97 tools** | Low | Low -- no known issues at this tool count | Monitor. If issues arise, Approach B hybrid (demote 20-30 least-used tools) is a fallback. |
| **`get_tool_help` returns stale documentation** | Low | Low -- documentation is generated from the same source | Generate help text from the same source as tool registration. Co-locate in code. |
| **Migration breaks existing workflows** | Medium | High -- users relying on verbose descriptions for tool selection may see regressions | Feature-flag the optimization. A/B test with description-compressed vs original. Roll back if accuracy drops. |
| **Future tool count growth (150+) makes 97-tool approach unsustainable** | Low (2-3 year horizon) | Medium -- would need to add meta-tier | Design get_tool_help with category browsing from the start. If needed, add discover_tools later. |
| **Approach A/B untyped JSON causes silent data corruption** (for context) | High (if A/B chosen) | Critical -- modify tools can corrupt live editor assets | This is why Approach C is recommended. Schema validation is the primary safety mechanism. |

---

## Migration Path

### Phase 1: Description Compression (1-2 days)

1. **Compress all 97 tool descriptions** to 1-2 sentence summaries using the proposals from description-compression.md as the starting template.
2. **Move cross-cutting boilerplate to serverInstructions:**
   - "Use search_assets first to find correct asset paths" (appears in 15+ descriptions)
   - "Changes are not saved until save_assets is called" (appears in 30+ descriptions)
   - "Set validate_only=true to preflight" (appears in 25+ descriptions)
   - "Returns JSON with validation summary, dirtyPackages, and diagnostics" (appears in 20+ descriptions)
3. **Trim redundant `.describe()` on parameters:**
   - `asset_path` descriptions are ~80 chars each across 80+ tools. Standardize to a single short form: `'UE content path to the asset.'`
   - `validate_only` descriptions are ~70 chars each across 25+ tools. Standardize to: `'Dry-run validation without mutation.'`
4. **Verify no Zod schema constraints are changed.** Only text descriptions should change; types, enums, defaults, min/max remain.

### Phase 2: Implement `get_tool_help` (0.5 day)

1. **Create a `get_tool_help` tool** registered statically alongside all 97 tools.
2. **Input schema:** `{ tool_name: z.string().describe('Name of the tool to get detailed help for.') }`
3. **Implementation:** Return a structured text block containing:
   - Full original verbose description (pre-compression)
   - Parameter documentation with types, constraints, and examples
   - Usage examples (workflow context)
   - Related tools (e.g., "After build_widget_tree, call compile_widget_blueprint then capture_widget_preview")
   - Operation enum values and their semantics (for polymorphic tools)
4. **Store help text as a static map** generated at build time or co-located with tool registrations.

### Phase 3: serverInstructions Enhancement (0.5 day)

1. **Expand serverInstructions** with workflow guidance that was removed from individual descriptions.
2. Add a directive: "For polymorphic tools with an operation enum parameter, call get_tool_help(tool_name) before first use to understand available operations and their payload requirements."
3. Add a directive: "All write tools mark packages dirty but do not save. Call save_assets explicitly after successful mutations."

### Phase 4: Testing & Validation (1-2 days)

1. **Automated tool selection test.** Present a set of 20 workflow scenarios to the LLM with the compressed tool set. Compare tool selection accuracy vs. the original verbose descriptions.
2. **Argument construction test.** For each of the 20 core tools, verify the LLM constructs valid arguments with compressed descriptions.
3. **Polymorphic tool test.** For each of the 16 polymorphic tools, verify the LLM calls `get_tool_help` when needed and constructs correct operation+payload combinations.
4. **Regression test.** Run the existing `server-contract.test.ts` and `live.e2e.test.ts` test suites to verify no functional regressions.

### Phase 5: Optional Enhancements (future)

1. **Category browsing.** Add `discover_tools(category?)` that returns tool names + 1-line descriptions grouped by domain (extraction, widget, material, AI, etc.). This helps when the LLM does not know which tool to look for.
2. **Schema compression.** Investigate further token savings from schema optimization: collapsing shared sub-schemas, removing redundant type annotations, using `$ref` patterns.
3. **Selective meta-tier demotion.** If tool count grows past 120-130, demote the least-used 30-40 tools to a meta-tier (Approach B hybrid) while keeping 80-90 as direct tools.

---

## Confidence Assessment

| Finding | Confidence |
|---------|-----------|
| Claude Code/Desktop do not handle `tools/list_changed` | HIGH -- verified via source analysis and open bug #4118 |
| Meta-tool pattern achieves 94%+ initial token reduction | HIGH -- benchmarked by Speakeasy on 400-tool server |
| Schema validation loss in Approaches A/B is a real accuracy risk | HIGH -- Zod validates enums, nested types, defaults for 38 crud + 16 polymorphic tools |
| Description compression alone saves ~3,000-4,000 tokens | HIGH -- char-by-char analysis in description-compression.md |
| Approach C total savings of 30-45% is achievable | HIGH -- description + param description + boilerplate consolidation |
| LLM accuracy will not regress with 1-2 sentence descriptions | MEDIUM -- no benchmark data for this specific server. Needs A/B testing. |
| `get_tool_help` usage rate for complex tools | MEDIUM -- LLM may skip help for tools it has used before in the same session |
| Future tool count growth rate | LOW -- depends on product roadmap beyond current scope |

---

## Appendix: Token Accounting Methodology

- **Description tokens:** Characters / 4 (conservative BPE estimate, validated against tiktoken for technical English)
- **Schema tokens:** Estimated from JSON Schema output of Zod types. Includes property names, type annotations, enum values, description strings, constraints (min, max, default), and nesting overhead.
- **OutputSchema tokens:** Counted separately for custom schemas. The default `v2ToolResultSchema` adds ~30 tokens shared across 77 tools (counted once).
- **Baseline ~15,000-18,000:** Sum of all description tokens (~5,000-7,000) + all schema tokens (~8,000-10,000) + output schema tokens (~1,500-2,000) + annotation/name/title overhead (~1,000).
