# Tool Description Compression Analysis

**Source:** `MCP/src/index.ts` (97 tools, ~12,753 est. tokens in tool definitions)
**Generated:** 2026-03-23
**Research basis:** arxiv:2602.14878 (97.1% of MCP descriptions have deficiencies; examples removable without accuracy loss; annotations can replace safety text)

> Status note (2026-03-24): the repository has already applied the non-breaking description-compression pass described here. The counts and line references below remain useful as the baseline that motivated the change, but they no longer describe the live tool descriptions exactly.

---

## Methodology

1. **Read every `server.registerTool()` call** in `MCP/src/index.ts` (lines 3149-9320, 97 tools).
2. **Extracted** the description text, parameter descriptions, and annotations for each tool.
3. **Identified removable patterns** appearing across tool descriptions:
   - `USAGE GUIDELINES:` / `USAGE:` sections (present in 30+ tools) -- these are operational tips, not tool-selection signals
   - `RETURNS:` sections (present in 30+ tools) -- output format details belong in resources
   - "Use search_assets first..." boilerplate (present in 15+ extract tools) -- already in `serverInstructions`
   - Class filter enum lists in parameter descriptions (e.g., "Blueprint", "AnimBlueprint", "WidgetBlueprint"...) -- duplicated in search_assets and list_assets; belongs in a resource
   - Detailed scope/size hints (e.g., "~1-2KB", "~2-10KB") -- already documented in `blueprint://scopes` resource
4. **Compression strategy per research findings:**
   - Keep: **Purpose** (1-2 sentences: WHAT the tool does + WHAT asset type it acts on)
   - Keep: Critical parameter constraints that affect correct usage (e.g., required fields per operation)
   - Remove: USAGE GUIDELINES, RETURNS sections, examples, safety warnings, boilerplate
   - Rely on: `annotations` (readOnlyHint, destructiveHint, idempotentHint) instead of textual safety warnings
   - Move detailed docs to: existing resources (`blueprint://scopes`, `blueprint://write-capabilities`, `blueprint://selector-conventions`, etc.)
5. **Token estimation:** chars / 4 (conservative BPE estimate for English + JSON-style text)

---

## Existing Resources That Already Cover Removed Information

The server already registers 18+ resources that document what we propose to remove from descriptions:

| Resource URI | Covers |
|---|---|
| `blueprint://scopes` | Extraction scope levels, typical sizes, when to use each |
| `blueprint://write-capabilities` | Write-capable families, supported selectors, operation surfaces, explicit deferrals |
| `blueprint://import-capabilities` | Import payloads, job polling, status fields, texture/mesh options |
| `blueprint://authoring-conventions` | validate_only behavior, explicit-save flows, compact authoring habits |
| `blueprint://selector-conventions` | Selector naming across all write families |
| `blueprint://widget-best-practices` | Widget authoring guidance, CommonUI patterns |
| `blueprint://material-graph-guidance` | Material graph operations, selectors, defaults |
| `blueprint://font-roles` | Font import/application guidance |
| `blueprint://project-automation` | Build, Live Coding, restart, reconnect flows |
| `blueprint://verification-workflows` | Semantic, visual, gameplay verification mapping |
| `blueprint://design-spec-schema` | design_spec_json contract |
| `blueprint://multimodal-ui-design-workflow` | Canonical multimodal menu workflow |
| `blueprint://widget-motion-authoring` | Widget animation authoring guidance |
| `blueprint://motion-verification-workflow` | Keyframe-bundle verification |
| `blueprint://examples/{family}` | Example payloads and recommended flows |
| `blueprint://widget-patterns/{pattern}` | Widget composition patterns |
| `blueprint://captures/{captureId}` | Visual verification capture PNGs |
| `blueprint://automation-runs/{runId}/{artifact}` | Automation test run artifacts |

This means **most of the content in USAGE GUIDELINES and RETURNS sections is already available as resources**. The tool descriptions are duplicating it.

---

## Compression Results -- Top 20 Tools

### 1. extract_blueprint
**Original** (1167 chars, ~292 tokens):
> Extract a UE5 Blueprint asset to structured JSON.
>
> USAGE GUIDELINES:
> - Use search_assets first to find the correct asset path if you don't already have it.
> - Start with the narrowest scope that answers your question -- each level includes everything from the previous:
>   * ClassLevel -- parent class, interfaces, class flags, metadata (~1-2KB)
>   * Variables -- + all variables with types, defaults, flags (~2-10KB)
>   * Components -- + SCS component tree with property overrides (~5-20KB). For WidgetBlueprints, also includes the widget tree hierarchy with bindings.
>   * FunctionsShallow -- + function/event graph names only (~5-25KB)
>   * Full -- + complete graph nodes, pins, and connections (~20-500KB+)
>   * FullWithBytecode -- + raw bytecode hex dump (largest, rarely needed)
> - Only escalate to Full when you need to understand graph logic (node connections, pin values, execution flow).
> - Full scope on complex Blueprints can exceed 200KB and will be truncated. If truncated, use a narrower scope or inspect specific functions via the graph names from FunctionsShallow.
> - Use FunctionsShallow scope first to get graph names, then request specific graphs with graph_filter to reduce output size.
> - Use compact=true to reduce JSON size by ~50-70% for LLM consumption.
> - Use include_class_defaults=true to read CDO (Class Default Object) property values -- useful for checking TSubclassOf slots, EditDefaultsOnly properties inherited from C++ parent classes, and any other class default values that differ from the parent.
>
> RETURNS: JSON object with the extracted Blueprint data at the requested scope level.

**Compressed** (149 chars, ~37 tokens):
> Extract a UE5 Blueprint asset to structured JSON at a configurable scope depth. Supports graph filtering, compact output, and class defaults.

**Savings:** 1018 chars, ~255 tokens
**Moved to resources:** Scope level details already in `blueprint://scopes`. "Use search_assets first" already in `serverInstructions`. Compact/CDO details adequately described in parameter `.describe()` strings. RETURNS format covered by `blueprint://write-capabilities`.

### 2. apply_window_ui_changes
**Original** (153 chars, ~38 tokens):
> Thin helper that applies variable flags, class defaults, font work, compile, optional save, and optional code sync in one ordered flow. It does not replace the final visual verification step.

**Compressed** (118 chars, ~30 tokens):
> Apply variable flags, class defaults, font work, compile, optional save, and optional code sync in one ordered flow.

**Savings:** 35 chars, ~9 tokens
**Note:** This description is already fairly compact. The "thin helper" and "does not replace final visual verification" clauses are guidance that belongs in `blueprint://verification-workflows`. Main savings for this tool come from its 12 parameters with verbose `.describe()` strings (addressed separately below).

### 3. sync_project_code
**Original** (113 chars, ~28 tokens):
> Use explicit changed_paths to choose Live Coding vs build-and-restart. Generic Live Coding failure does not auto-fallback.

**Compressed** (93 chars, ~23 tokens):
> Sync C++ code changes via Live Coding or build-and-restart based on explicit changed_paths.

**Savings:** 20 chars, ~5 tokens
**Note:** Already compact. Main savings for this tool come from its 15 parameters. The Live Coding fallback policy is documented in `blueprint://project-automation`.

### 4. modify_widget_blueprint
**Original** (69 chars, ~17 tokens):
> Primary widget-authoring tool for compact structural and patch operations.

**Compressed** (69 chars, ~17 tokens):
> Primary widget-authoring tool for compact structural and patch operations.

**Savings:** 0 chars, 0 tokens
**Note:** Already minimal. 21 parameters carry the token cost here. Parameter descriptions are already concise and operation-specific.

### 5. extract_cascade
**Original** (772 chars, ~193 tokens):
> Extract multiple assets (Blueprint, AnimBlueprint, StateTree, BehaviorTree, Blackboard, DataAsset, DataTable, UserDefinedStruct, UserDefinedEnum, Curve, CurveTable, MaterialInstance, AnimSequence, AnimMontage, BlendSpace) with automatic reference following for supported dependency chains. Follows parent classes, interfaces, component classes, Blueprint references, blackboard links, material instance parents, and animation references up to max_depth levels deep.
>
> USAGE GUIDELINES:
> - Use when you need to understand an asset AND its dependencies (parent Blueprints, referenced Blueprints, etc.).
> - Results are written to files on disk (in the project's configured output directory), NOT returned inline -- the response contains a manifest summary with output filenames.
> - For a single asset without dependencies, prefer the specific extract_* tool for that asset type.
> - Cycle-safe: won't extract the same asset twice.
>
> RETURNS: Summary with extracted_count, output_directory path, and a per-asset manifest. Read the output files to inspect the data.

**Compressed** (160 chars, ~40 tokens):
> Extract multiple asset types with automatic dependency-chain reference following. Results are written to disk files; response contains a manifest summary.

**Savings:** 612 chars, ~153 tokens
**Moved to resources:** Supported asset type list, reference chain details, cycle-safe note -- all belong in `blueprint://write-capabilities`. RETURNS format is self-documenting via `outputSchema: CascadeResultSchema`.

### 6. search_assets
**Original** (592 chars, ~148 tokens):
> Search for UE5 assets by name. This is a lightweight lookup -- use it FIRST to find correct asset paths before calling any extract_* tool.
>
> USAGE GUIDELINES:
> - Always call this before any extract_* tool if you don't already have the exact asset path.
> - Searches asset names (not full paths) -- partial matches work (e.g. "Character" finds "BP_Character").
> - Filter by class to narrow results: "Blueprint" (default), "AnimBlueprint", "WidgetBlueprint", "StateTree", "BehaviorTree", "Blackboard", "DataAsset", "DataTable", "UserDefinedStruct", "UserDefinedEnum", "Curve", "CurveTable", "Material", "MaterialFunction", "MaterialInstance", "AnimSequence", "AnimMontage", "BlendSpace", or empty string for all.
>
> RETURNS: JSON array of objects with path, name, and class for each matching asset.

**Compressed** (105 chars, ~26 tokens):
> Search for UE5 assets by name with optional class filter. Returns matching asset paths, names, and classes.

**Savings:** 487 chars, ~122 tokens
**Moved to resources:** "Use FIRST before extract" already in `serverInstructions`. Class filter enum list duplicated in `class_filter` parameter `.describe()`. Partial match behavior is obvious from usage.

### 7. capture_widget_motion_checkpoints
**Original** (128 chars, ~32 tokens):
> Play a widget animation or automation-driven UI scenario, capture named checkpoints, and return a typed keyframe bundle.

**Compressed** (128 chars, ~32 tokens):
> Play a widget animation or automation-driven UI scenario, capture named checkpoints, and return a typed keyframe bundle.

**Savings:** 0 chars, 0 tokens
**Note:** Already concise. 12 parameters carry the token cost.

### 8. modify_blueprint_members
**Original** (621 chars, ~155 tokens):
> Modify Blueprint member authoring surfaces without synthesizing arbitrary graphs.
>
> USAGE:
> - operation="replace_variables" or "replace_components": payload replaces the full variable or component set using extractor-shaped entries.
> - operation="patch_variable": payload selects by variableName or name and patches metadata/defaults.
> - operation="patch_component": payload selects by componentName or name and patches component defaults or hierarchy fields.
> - operation="replace_function_stubs": payload.functionStubs or payload.functions replaces function shell graphs.
> - operation="patch_class_defaults": payload.classDefaults or payload.properties patches generated-class defaults.
> - operation="compile": validates and recompiles the Blueprint without saving it.
>
> RETURNS: JSON with validation and compile summaries, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.

**Compressed** (151 chars, ~38 tokens):
> Modify Blueprint variables, components, function stubs, or class defaults via operation dispatch. Returns validation, compile summaries, and diagnostics.

**Savings:** 470 chars, ~117 tokens
**Moved to resources:** Per-operation field requirements belong in `blueprint://write-capabilities` and `blueprint://selector-conventions`. RETURNS format is self-documenting via result shape.

### 9. modify_material_instance
**Original** (430 chars, ~108 tokens):
> Modify a UE5 MaterialInstanceConstant by reparenting it or applying scalar/vector/texture/static-switch parameter overrides.
>
> USAGE:
> - Provide any subset of parentMaterial, scalarParameters, vectorParameters, textureParameters, and staticSwitchParameters.
> - Set validate_only=true to verify the payload without mutating the asset.
> - textureParameters entries may set value to null to clear a texture override.
>
> RETURNS: JSON with validation summary, diagnostics, and dirtyPackages. Changes are not saved until save_assets is called.

**Compressed** (127 chars, ~32 tokens):
> Modify a MaterialInstanceConstant by reparenting or applying scalar/vector/texture/static-switch parameter overrides.

**Savings:** 303 chars, ~76 tokens
**Moved to resources:** validate_only behavior documented in `blueprint://authoring-conventions`. "null to clear" is obvious from nullable param type. RETURNS and save semantics in `blueprint://write-capabilities`.

### 10. modify_state_tree
**Original** (545 chars, ~136 tokens):
> Modify a UE5 StateTree with declarative tree, state, editor-node, and transition operations.
>
> USAGE:
> - operation="replace_tree": payload uses the extractor-shaped StateTree object.
> - operation="patch_state": payload selects a state by stateId or statePath and applies extractor-shaped state data.
> - operation="patch_editor_node": payload selects by editorNodeId and patches nodeStructType, instanceProperties, or nodeProperties.
> - operation="patch_transition": payload selects by transitionId and patches target, timing, or conditions.
> - operation="set_schema": payload.schema changes the StateTree schema class.
>
> RETURNS: JSON with validation and compile summaries, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.

**Compressed** (114 chars, ~29 tokens):
> Modify a UE5 StateTree via declarative operations on trees, states, editor nodes, transitions, or schema.

**Savings:** 431 chars, ~108 tokens
**Moved to resources:** Per-operation selector/payload details already in `blueprint://write-capabilities` and `blueprint://selector-conventions`. RETURNS format and save semantics in same resources.

### 11. extract_statetree
**Original** (317 chars, ~79 tokens):
> Extract a UE5 StateTree asset to structured JSON.
>
> USAGE GUIDELINES: [5 lines]
>
> RETURNS: JSON object with schema, state hierarchy, tasks, conditions, transitions, and linked assets.

**Compressed** (69 chars, ~17 tokens):
> Extract a UE5 StateTree asset to structured JSON.

**Savings:** 248 chars, ~62 tokens

### 12. extract_dataasset
**Original** (319 chars, ~80 tokens):
> Extract a UE5 DataAsset to structured JSON. Serializes all user-defined UPROPERTY fields using UE reflection.
>
> USAGE GUIDELINES: [4 lines]
>
> RETURNS: [...]

**Compressed** (110 chars, ~28 tokens):
> Extract a UE5 DataAsset to structured JSON. Serializes all user-defined UPROPERTY fields via UE reflection.

**Savings:** 209 chars, ~52 tokens

### 13. extract_datatable
**Original** (290 chars, ~73 tokens):
> Extract a UE5 DataTable asset to structured JSON. Includes the row struct schema and all row data.
>
> USAGE GUIDELINES: [4 lines]
>
> RETURNS: [...]

**Compressed** (98 chars, ~25 tokens):
> Extract a UE5 DataTable asset to structured JSON including row struct schema and all row data.

**Savings:** 192 chars, ~48 tokens

### 14. extract_behavior_tree
**Original** (333 chars, ~83 tokens):
> Extract a UE5 BehaviorTree asset to structured JSON.
>
> USAGE GUIDELINES: [4 lines]
>
> RETURNS: [...]

**Compressed** (53 chars, ~13 tokens):
> Extract a UE5 BehaviorTree asset to structured JSON.

**Savings:** 280 chars, ~70 tokens

### 15. extract_blackboard
**Original** (320 chars, ~80 tokens):
> Extract a UE5 Blackboard asset to structured JSON.
>
> USAGE GUIDELINES: [4 lines]
>
> RETURNS: [...]

**Compressed** (51 chars, ~13 tokens):
> Extract a UE5 Blackboard asset to structured JSON.

**Savings:** 269 chars, ~67 tokens

### 16. extract_user_defined_struct
**Original** (320 chars, ~80 tokens):
> Extract a UE5 UserDefinedStruct asset to structured JSON.
>
> USAGE GUIDELINES: [4 lines]
>
> RETURNS: [...]

**Compressed** (58 chars, ~15 tokens):
> Extract a UE5 UserDefinedStruct asset to structured JSON.

**Savings:** 262 chars, ~66 tokens

### 17. extract_user_defined_enum
**Original** (293 chars, ~73 tokens):
> Extract a UE5 UserDefinedEnum asset to structured JSON.
>
> USAGE GUIDELINES: [4 lines]
>
> RETURNS: [...]

**Compressed** (55 chars, ~14 tokens):
> Extract a UE5 UserDefinedEnum asset to structured JSON.

**Savings:** 238 chars, ~60 tokens

### 18. extract_material_instance
**Original** (355 chars, ~89 tokens):
> Extract a UE5 MaterialInstance asset to structured JSON.
>
> USAGE GUIDELINES: [4 lines]
>
> RETURNS: [...]

**Compressed** (57 chars, ~14 tokens):
> Extract a UE5 MaterialInstance asset to structured JSON.

**Savings:** 298 chars, ~75 tokens

### 19. list_assets
**Original** (336 chars, ~84 tokens):
> List UE5 assets under a package path. Use this to browse directory contents when you don't know asset names. If you know (part of) the asset name, prefer search_assets instead -- it's faster and doesn't require knowing the directory.
>
> When recursive=false, subdirectories are included in the results with class "Folder" -- use this to browse the content tree structure.
>
> RETURNS: JSON array of objects with path, name, and class for each asset (and subfolder when non-recursive) in the directory.

**Compressed** (72 chars, ~18 tokens):
> List UE5 assets under a package path. Prefer search_assets by name.

**Savings:** 264 chars, ~66 tokens
**Moved to resources:** Recursive/folder behavior is adequately described by `recursive` parameter `.describe()`.

### 20. modify_blueprint_graphs
**Original** (497 chars, ~124 tokens):
> Modify explicit Blueprint graph authoring surfaces with rollback-safe apply semantics.
>
> USAGE: [4 lines of per-operation detail]
>
> RETURNS: JSON with validation and compile summaries, dirtyPackages, diagnostics, and rollback diagnostics when an apply/compile failure forced the package to reload from disk.

**Compressed** (136 chars, ~34 tokens):
> Modify Blueprint graphs with rollback-safe semantics: upsert function graphs, append function calls, or compile. Returns diagnostics.

**Savings:** 361 chars, ~90 tokens

---

## Compression Results -- Tools 21-30

### 21. extract_anim_sequence
**Original** (356 chars, ~89 tokens) | **Compressed** (57 chars, ~14 tokens)
> Extract a UE5 AnimSequence asset to structured JSON.

**Savings:** 299 chars, ~75 tokens

### 22. extract_anim_montage
**Original** (308 chars, ~77 tokens) | **Compressed** (56 chars, ~14 tokens)
> Extract a UE5 AnimMontage asset to structured JSON.

**Savings:** 252 chars, ~63 tokens

### 23. extract_blend_space
**Original** (316 chars, ~79 tokens) | **Compressed** (55 chars, ~14 tokens)
> Extract a UE5 BlendSpace asset to structured JSON.

**Savings:** 261 chars, ~65 tokens

### 24. extract_curve
**Original** (303 chars, ~76 tokens) | **Compressed** (49 chars, ~12 tokens)
> Extract a UE5 curve asset to structured JSON.

**Savings:** 254 chars, ~64 tokens

### 25. extract_curvetable
**Original** (280 chars, ~70 tokens) | **Compressed** (53 chars, ~13 tokens)
> Extract a UE5 CurveTable asset to structured JSON.

**Savings:** 227 chars, ~57 tokens

### 26. create_data_asset
**Original** (299 chars, ~75 tokens) | **Compressed** (88 chars, ~22 tokens)
> Create a UE5 DataAsset with a concrete subclass and optional initial property patch.

**Savings:** 211 chars, ~53 tokens

### 27. modify_data_asset
**Original** (305 chars, ~76 tokens) | **Compressed** (72 chars, ~18 tokens)
> Apply a reflected property patch to an existing UE5 DataAsset.

**Savings:** 233 chars, ~58 tokens

### 28. create_data_table
**Original** (273 chars, ~68 tokens) | **Compressed** (82 chars, ~21 tokens)
> Create a UE5 DataTable with a concrete row struct and optional initial rows.

**Savings:** 191 chars, ~48 tokens

### 29. modify_data_table
**Original** (284 chars, ~71 tokens) | **Compressed** (90 chars, ~23 tokens)
> Modify a UE5 DataTable by upserting rows, deleting rows, or replacing the full row set.

**Savings:** 194 chars, ~49 tokens

### 30. create_blueprint
**Original** (366 chars, ~92 tokens) | **Compressed** (118 chars, ~30 tokens)
> Create a UE5 Blueprint with optional variables, component templates, function stubs, class defaults, and compile.

**Savings:** 248 chars, ~62 tokens

---

## Compression Results -- Remaining 67 Tools (Grouped by Pattern)

### Pattern A: Simple extract_* tools (already concise or with small USAGE/RETURNS)
Tools: extract_material, extract_material_function, extract_widget_blueprint, extract_widget_animation

These 4 tools already have compact descriptions (50-120 chars). Savings per tool: 0-30 chars.

**Group savings:** ~40 chars, ~10 tokens

### Pattern B: Simple create_* tools with USAGE/RETURNS boilerplate
Tools: create_widget_blueprint, create_widget_animation, create_material, create_material_instance, create_material_function, create_user_defined_struct, create_user_defined_enum, create_blackboard, create_behavior_tree, create_state_tree, create_anim_sequence, create_anim_montage, create_blend_space, create_commonui_button_style, create_input_action, create_input_mapping_context, create_curve, create_curve_table

18 tools. Average description: ~200 chars. Average compressed: ~80 chars. Average savings: ~120 chars per tool.

**Group savings:** ~2160 chars, ~540 tokens

### Pattern C: modify_* tools with USAGE/RETURNS boilerplate
Tools: modify_widget, modify_widget_animation, modify_material, modify_material_function, modify_commonui_button_style, modify_user_defined_struct, modify_user_defined_enum, modify_blackboard, modify_behavior_tree, modify_anim_sequence, modify_anim_montage, modify_blend_space, modify_data_table, modify_curve, modify_curve_table, modify_input_action, modify_input_mapping_context

17 tools. Average description: ~300 chars. Average compressed: ~100 chars. Average savings: ~200 chars per tool.

**Group savings:** ~3400 chars, ~850 tokens

### Pattern D: Material-specific composable tools (already compact)
Tools: set_material_settings, add_material_expression, connect_material_expressions, bind_material_property, compile_material_asset

5 tools. Average description: ~100 chars. Already near-optimal.

**Group savings:** ~50 chars, ~13 tokens

### Pattern E: Widget-specific tools (already compact)
Tools: build_widget_tree, compile_widget_blueprint, apply_commonui_button_style, extract_commonui_button_style

4 tools. Already compact (50-100 chars each).

**Group savings:** ~40 chars, ~10 tokens

### Pattern F: Verification/capture tools
Tools: capture_widget_preview, compare_capture_to_reference, compare_motion_capture_bundle, list_captures, cleanup_captures

5 tools. Average description: ~120 chars. Minor compression possible.

**Group savings:** ~100 chars, ~25 tokens

### Pattern G: Import tools with USAGE/RETURNS boilerplate
Tools: import_assets, reimport_assets, get_import_job, list_import_jobs, import_textures, import_meshes

6 tools. Average description: ~280 chars with USAGE/RETURNS blocks. Average compressed: ~100 chars.

**Group savings:** ~1080 chars, ~270 tokens

### Pattern H: Project/editor orchestration (already compact)
Tools: compile_project_code, trigger_live_coding, restart_editor, wait_for_editor, run_automation_tests, get_automation_test_run, list_automation_test_runs, get_project_automation_context, save_assets

9 tools. Mixed -- some already compact, some with USAGE blocks.

**Group savings:** ~600 chars, ~150 tokens

---

## Parameter Description Compression

Beyond tool descriptions, **parameter `.describe()` strings** are a significant token source, especially for tools with many parameters. Key compression targets:

### High-impact parameter compression targets

| Tool | Params | Param Desc Issue | Proposed Fix |
|---|---|---|---|
| search_assets.class_filter | 1 | 280-char enum list in `.describe()` | Remove list; reference `blueprint://write-capabilities` |
| list_assets.class_filter | 1 | Similar enum list | Same |
| extract_blueprint.compact | 1 | 258-char explanation of what compact strips | Shorten to "Minify JSON by stripping low-value fields (~50-70% smaller)." |
| extract_blueprint.include_class_defaults | 1 | 207-char explanation | Shorten to "Include CDO property values that differ from the parent class." |
| extract_blueprint.scope | 1 | 96 chars (OK) | Keep as-is |
| extract_cascade.graph_filter | 1 | 187-char explanation | Shorten to "Filter to specific graph names. Omit to extract all." |
| sync_project_code (all 15 params) | 15 | ~1200 chars total | Trim each by ~30% |
| apply_window_ui_changes (all 12 params) | 12 | ~900 chars total | Trim each by ~30% |
| modify_widget_blueprint (all 21 params) | 21 | ~800 chars total | Already concise |

**Estimated param description savings:** ~1,500 chars, ~375 tokens

---

## Summary Statistics

| Category | Count | Original Desc Chars | Compressed Desc Chars | Chars Saved | Est. Tokens Saved |
|----------|------:|--------------------:|----------------------:|------------:|------------------:|
| Top 10 tools | 10 | 5,389 | 1,176 | 4,213 | ~1,053 |
| Tools 11-20 | 10 | 3,372 | 764 | 2,608 | ~652 |
| Tools 21-30 | 10 | 3,090 | 714 | 2,376 | ~594 |
| Remaining 67 tools | 67 | ~11,970 | ~4,500 | ~7,470 | ~1,868 |
| **Description totals** | **97** | **~23,821** | **~7,154** | **~16,667** | **~4,167** |
| Parameter descriptions | -- | ~8,000 est. | ~6,500 est. | ~1,500 | ~375 |
| **Grand total** | **97** | **~31,821** | **~13,654** | **~18,167** | **~4,542** |

### Key metric: **~4,500 tokens saved from descriptions alone** (~35% of the 12,753 total tool-definition tokens)

Note: The 12,753 figure from T1 includes not just descriptions but also parameter schemas (Zod types), annotations objects, and tool names/titles. Description text and parameter `.describe()` strings account for roughly 60-70% of that total.

---

## Resource Recommendations

### New resources NOT needed
The existing 18+ resources already cover nearly all removed documentation. No new resources are required.

### Resource usage in serverInstructions
The `serverInstructions` array (lines 24-41) already contains the key behavioral guidance that we propose removing from individual tool descriptions:
- "Use search_assets before extract_* tools" (line 26)
- "Write tools mutate the running editor but do not save automatically" (line 29)
- "Prefer validate_only=true the first time you author a new asset family" (line 31)

### Proposed serverInstructions addition
One line to add for class filter guidance that gets removed from search_assets and list_assets parameter descriptions:

```
'search_assets class_filter and list_assets class_filter accept any asset class name from the write-capabilities resource, plus empty string for all types.'
```

---

## Risk Assessment

### Low risk of accuracy degradation
Per arxiv:2602.14878:
- Removing examples from descriptions does NOT degrade LLM task success rate
- Tool annotations (readOnlyHint, destructiveHint, idempotentHint) are already set correctly on all 97 tools and serve as the primary safety signal
- The `serverInstructions` already contain the critical ordering/workflow guidance
- All 18+ resources are available for the LLM to read on demand

### Specific risk areas

| Risk | Mitigation |
|---|---|
| LLM forgets to use search_assets first | Already in `serverInstructions` line 26 |
| LLM sends wrong scope to extract_blueprint | `scope` parameter has `.default('Variables')` and `.describe()` text that remains |
| LLM confused about operation fields on modify_* tools | Operation enum is in the Zod schema; parameter `.describe()` strings remain |
| LLM sends wrong class_filter values | Enum list moves to a resource; common values still in shortened `.describe()` |
| LLM forgets to call save_assets | Already in `serverInstructions` line 29 |

### Zero-risk changes (pure removals of duplicated text)
- All RETURNS sections: fully redundant with `outputSchema` and structured result shapes
- All "Use search_assets first" lines: already in `serverInstructions`
- All "Changes are not saved until save_assets" lines: already in `serverInstructions`
- All "Set validate_only=true" lines: already in `serverInstructions`

### Low-risk changes (removing detail that exists in resources)
- Scope level descriptions from extract_blueprint: exists in `blueprint://scopes`
- Per-operation field requirements from modify_* tools: exists in `blueprint://write-capabilities`
- Class filter enum lists: common values remain in shortened `.describe()`

---

## Implementation Priority

1. **Phase 1 (highest ROI, ~2,400 tokens saved):** Remove USAGE GUIDELINES and RETURNS sections from the 16 extract_* tools and 6 import tools. These are pure information duplication.

2. **Phase 2 (~1,200 tokens saved):** Remove USAGE and RETURNS sections from the 18 create_* and 17 modify_* tools. These duplicate `blueprint://write-capabilities` and `blueprint://authoring-conventions`.

3. **Phase 3 (~500 tokens saved):** Compress parameter `.describe()` strings for the top 5 most expensive tools (search_assets.class_filter, extract_blueprint.compact, extract_blueprint.include_class_defaults, extract_cascade.graph_filter, sync_project_code params).

4. **Phase 4 (~400 tokens saved):** Add one `serverInstructions` line for class filter guidance; trim remaining verbose parameter descriptions across remaining tools.
