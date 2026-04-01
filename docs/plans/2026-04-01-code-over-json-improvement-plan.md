# Code-Over-JSON Improvement Plan

> LLMs are better at generating code than constructing large JSON payloads, and best at generating structured .md files. This plan redesigns how the MCP server exposes capabilities to exploit those strengths.

**Date:** 2026-04-01
**Inputs:** Architectural analysis of blueprint-extractor MCP (106 tools, v6.3.1), Claude Code internals (MCP client, structuredContent, truncation), OpenCode MCP client, Codex CLI

---

## The Problem

The current architecture requires the LLM to construct precise, deeply nested JSON payloads for every operation. A single widget tree replacement can easily exceed 2KB of JSON with exact class names, property paths, slot configurations, and nested children. Blueprint graph authoring is worse — node UUIDs, pin connections, and expression chains demand pixel-perfect JSON that the LLM frequently gets wrong on first attempt.

**Measured pain points:**

| Surface | Avg payload size | LLM error rate (estimated) | Root cause |
|---------|-----------------|---------------------------|------------|
| `build_widget_tree` / `replace_widget_tree` | 1-5 KB | High | Deep nesting, slot semantics, class name recall |
| `modify_blueprint_graphs` | 2-10 KB | Very high | Node UUIDs, pin IDs, connection wiring |
| `modify_material` (batch ops) | 1-3 KB | Medium | Expression names, connection selectors |
| `modify_state_tree` | 1-4 KB | High | Nested state/transition/binding selectors |
| `batch_widget_operations` | 1-8 KB | High | Array of heterogeneous operation objects |

Meanwhile, the same LLM can fluently generate:
- TypeScript code that builds these structures programmatically (with type checking)
- Markdown descriptions that a deterministic parser can convert to operations
- Concise DSL fragments that express intent without serialization noise

**What coding agents taught us:**

1. **Claude Code** treats MCP tool results as opaque text (structuredContent is JSON-stringified, truncated at 25k tokens). The model never sees native JSON — it sees text. This means our response normalization overhead (structured envelopes, execution metadata, next-step hints) is consumed as text, not structured data.

2. **All agents** are thin passthroughs — the LLM constructs the full tool input JSON from the schema description alone. There is no "smart client" that transforms a high-level intent into low-level calls. The intelligence gap between "what the LLM wants to express" and "what the tool schema requires" is bridged entirely by the LLM, at token cost.

3. **Codex** (OpenAI) skips MCP entirely and generates shell commands + code files. This is the extreme "code-over-JSON" position — the LLM writes executable code rather than declarative data.

---

## Design Principles

1. **Meet the LLM where it's strong.** Let it write code, pseudocode, or structured text — not hand-craft JSON trees.
2. **Don't break what works.** Low-level JSON tools stay for precision work. New layers are additive.
3. **Reduce round-trips.** A single "intent" call that does extract → plan → mutate → compile → verify is better than 5 separate tool calls.
4. **Compress what the LLM reads.** Extraction output that fits in 2K tokens instead of 8K lets the LLM keep more context for generation.
5. **Progressive disclosure still matters.** Core tools stay compact; power tools stay behind scopes.

---

## Phase 1: DSL-Based Authoring (High Impact, Medium Effort)

### 1A. Widget Tree DSL

Add a `build_widget_tree_from_dsl` tool (or extend `replace_widget_tree`) that accepts a concise indentation-based DSL instead of nested JSON.

**LLM writes this:**
```
CanvasPanel "Root"
  VerticalBox "MainContent" [anchor=center]
    TextBlock "Title" {Text: "Main Menu", Font.Size: 24} [var]
    Spacer {Size.Y: 20}
    CommonButtonBase "PlayBtn" {Text: "Play"} [var]
    CommonButtonBase "SettingsBtn" {Text: "Settings"} [var]
    CommonButtonBase "QuitBtn" {Text: "Quit"} [var]
```

**Instead of this JSON (current):**
```json
{
  "class": "CanvasPanel", "name": "Root",
  "children": [
    {
      "class": "VerticalBox", "name": "MainContent",
      "slot": {"Anchors": {"Minimum": {"X": 0.5, "Y": 0.5}, "Maximum": {"X": 0.5, "Y": 0.5}}},
      "children": [
        {"class": "TextBlock", "name": "Title", "is_variable": true, "properties": {"Text": "Main Menu", "Font": {"Size": 24}}},
        {"class": "Spacer", "name": "Spacer_0", "properties": {"Size": {"Y": 20}}},
        {"class": "CommonButtonBase", "name": "PlayBtn", "is_variable": true, "properties": {"Text": "Play"}},
        ...
      ]
    }
  ]
}
```

**Implementation:**
- Add a DSL parser in `src/helpers/widget-dsl-parser.ts`
- Indentation = hierarchy (like YAML/Python)
- `ClassName "Name"` = widget node
- `{Key: Value}` = properties (JSON5-like, supports dotted paths)
- `[anchor=center]` = slot presets (maps to common slot configurations)
- `[var]` = `is_variable: true`
- Parser produces the same `WidgetNode` tree that `BuildWidgetTree` already consumes
- New tool `replace_widget_tree_dsl` OR new `dsl` parameter on existing `replace_widget_tree`

**Token savings:** ~60-70% reduction in input tokens for typical widget trees.

### 1B. Blueprint Graph DSL

Add a `modify_blueprint_graphs_from_dsl` tool that accepts pseudocode-style graph descriptions.

**LLM writes this:**
```
EventGraph:
  Event BeginPlay ->
    GetPlayerController -> CastTo(APlayerController) as PC
    PC.GetPawn -> CastTo(ABP_Character) as Character
    Character.Health > 0 ? Branch
      True -> SetActorHidden(self, false)
      False -> DestroyActor(self)
```

**Implementation:**
- Parser in `src/helpers/blueprint-graph-dsl-parser.ts`
- Maps pseudocode to `add_node`, `connect_pins` operations
- Auto-generates node positions (left-to-right flow layout)
- Resolves function/variable names to proper node classes via UE reflection (call `SearchAssets` or use cached class metadata)
- Falls back to raw JSON for operations the DSL can't express

**This is the highest-value DSL** because blueprint graph JSON is the most error-prone surface.

### 1C. Material Graph DSL

```
# Material: M_ButtonBase
Settings: MaterialDomain=Surface, BlendMode=Translucent, ShadingModel=Unlit

Param Color "BaseColor" = (0.1, 0.14, 0.22, 1.0)
Param Scalar "Opacity" = 0.95
Param Scalar "CornerRadius" = 12.0

BaseColor <- Lerp(Color, Multiply(Color, 1.3), HoverAlpha)
Opacity <- Multiply(Opacity, FadeAlpha)
```

---

## Phase 2: Intent-Level Composite Tools (High Impact, Medium Effort)

### 2A. High-Level Workflow Tools

The current `find_and_extract` composite is the right pattern. Extend it to mutation workflows.

**New tools:**

| Tool | What it does in one call |
|------|-------------------------|
| `create_menu_screen` | create_widget_blueprint → build_widget_tree → patch_class_defaults → compile → capture → save |
| `apply_widget_patch` | extract_widget_blueprint → apply DSL diff → compile → capture_preview |
| `create_material_setup` | create_material → material_graph_operation (batch) → compile → save |
| `scaffold_blueprint` | create_blueprint → modify_blueprint_members (vars + functions) → modify_blueprint_graphs (stubs) → trigger_live_coding |

Each accepts a high-level description and orchestrates the multi-step flow internally. The LLM makes one call instead of 5-8.

**Key design rule:** These tools return the final state (extraction + capture), not intermediate results. The LLM sees what it built, not the build steps.

### 2B. Diff-Based Widget Patching

Instead of requiring the LLM to specify exact operations (insert_child, remove_widget, move_widget), accept a **diff** between current state and desired state.

**LLM writes:**
```diff
CanvasPanel "Root"
  VerticalBox "MainContent"
-   TextBlock "OldTitle" {Text: "Old"}
+   TextBlock "NewTitle" {Text: "New", Font.Size: 28} [var]
    CommonButtonBase "PlayBtn"
+   HorizontalBox "ButtonRow"
+     CommonButtonBase "SettingsBtn" {Text: "Settings"}
+     CommonButtonBase "QuitBtn" {Text: "Quit"}
```

**Implementation:**
- Parse both sides of the diff using the widget DSL parser
- Compute the minimal set of structural operations (remove, insert, patch, move)
- Execute as a batch operation
- This replaces the need for the LLM to manually plan operation sequences

---

## Phase 3: Response Compression (Medium Impact, Low Effort)

### 3A. Extraction Output Optimization

Currently `compact: true` is the default for `find_and_extract` but `compact: false` is the default for standalone extraction tools. Given that Claude Code truncates at 25k tokens and our token budget is 8k:

**Changes:**
- Flip `compact: true` as the default for ALL extraction tools (already planned as P1-T01)
- Add `depth` parameter to widget extraction (e.g., `depth: 2` only shows 2 levels of hierarchy)
- Add `fields` parameter to extraction tools (e.g., `fields: ["name", "class", "is_variable"]` for structural-only extraction)
- Strip empty arrays, null values, and default-valued properties from extraction output

**Estimated savings:** 40-60% reduction in extraction response tokens.

### 3B. Response Envelope Slimming

The current response envelope includes `execution`, `diagnostics`, `next_steps`, and `recoverable` metadata on every response. Coding agents consume this as raw text.

**Changes:**
- Move `next_steps` hints to the `get_tool_help` system (already has examples and hints)
- Only include `execution` metadata on task-aware tools
- Only include `diagnostics` when there are actual diagnostics (not empty arrays)
- Remove `recoverable` classification from success responses

### 3C. Schema Token Budget

The tool input schemas are sent to the LLM as part of the tool definitions. Each Zod schema with `.describe()` strings contributes to the prompt token count.

**Changes:**
- Audit all `.describe()` strings — remove redundant ones (e.g., `z.string().describe('UE content path')` on `asset_path` is redundant when the parameter name is self-documenting)
- Use shorter descriptions — "Widget path" not "Slash-delimited widget path to modify. Safer than widget_name after structural edits."
- Move detailed usage guidance from schema descriptions to `get_tool_help` and prompt resources
- Target: < 100 tokens per tool schema on average (currently estimated at 150-300)

---

## Phase 4: Markdown Workflow Files (Medium Impact, Higher Effort)

### 4A. Workflow Recipes as .md Files

Instead of the LLM calling 8 tools in sequence, it writes a single `.md` file that describes the desired end state:

```markdown
# Recipe: Create Settings Menu

## Asset
path: /Game/UI/Screens/WBP_Settings
parent: CommonActivatableWidget

## Widget Tree
CanvasPanel "Root"
  VerticalBox "Content" [anchor=center, padding=40]
    TextBlock "Title" {Text: "Settings", Font.Size: 32}
    ScrollBox "SettingsList" [var]
    HorizontalBox "ButtonRow" [halign=right]
      CommonButtonBase "ApplyBtn" {Text: "Apply"} [var]
      CommonButtonBase "BackBtn" {Text: "Back"} [var]

## Class Defaults
SettingsListClass: /Game/UI/Elements/WBP_SettingItem

## After
compile, capture, save
```

**Implementation:**
- New tool: `execute_widget_recipe` that accepts a markdown string or file path
- Parses the recipe sections
- Executes: create → build tree → patch defaults → compile → capture → save
- Returns: final extraction + capture result

### 4B. Extraction-to-Recipe Round-Trip

`extract_widget_blueprint` should be able to output in recipe format, so the LLM can:
1. Extract (gets .md recipe)
2. Edit the .md (its strongest skill)
3. Execute the modified recipe

This creates a **read-modify-write** loop using the format the LLM handles best.

---

## Phase 5: Smart Defaults and Presets (Low Effort, Ongoing)

### 5A. Slot Presets

Instead of requiring exact anchor/alignment JSON, accept semantic presets:

| Preset | Maps to |
|--------|---------|
| `center` | Anchors 0.5/0.5, Alignment 0.5/0.5 |
| `fill` | Anchors 0/0 to 1/1 |
| `top-left` | Anchors 0/0 |
| `bottom-stretch` | Anchors 0/1 to 1/1 |

### 5B. Property Path Shorthand

Instead of `{"Font": {"TypefaceFontName": "Regular", "Size": 24}}`, accept `Font.Size: 24, Font.Typeface: Regular`.

The property path parser (`src/helpers/property-path-parser.ts`) already exists — expose it to the DSL layer.

### 5C. Widget Class Aliases

Instead of requiring `CommonButtonBase`, accept `button`. Instead of `CommonActivatableWidget`, accept `activatable`.

| Alias | Resolves to |
|-------|------------|
| `button` | `CommonButtonBase` |
| `text` | `TextBlock` |
| `image` | `Image` |
| `vbox` | `VerticalBox` |
| `hbox` | `HorizontalBox` |
| `canvas` | `CanvasPanel` |
| `overlay` | `Overlay` |
| `scroll` | `ScrollBox` |
| `border` | `Border` |
| `spacer` | `Spacer` |
| `activatable` | `CommonActivatableWidget` |
| `size_box` | `SizeBox` |

---

## Priority and Sequencing

| Phase | Effort | Impact | Dependencies | Ship order |
|-------|--------|--------|-------------|------------|
| 3A: Compact extraction defaults | S | Medium | None | 1st (quick win) |
| 3B: Response envelope slimming | S | Medium | None | 1st |
| 3C: Schema token budget | S | Medium | None | 1st |
| 5A-C: Presets and aliases | S | Medium | None | 2nd |
| 1A: Widget Tree DSL | M | High | 5A-C (uses presets) | 3rd |
| 2B: Diff-based widget patching | M | High | 1A (uses DSL parser) | 4th |
| 2A: Intent-level composites | M | High | 1A (widget), 3A (responses) | 5th |
| 4A: Markdown workflow recipes | M | High | 1A, 2A | 6th |
| 4B: Extract-to-recipe round-trip | S | High | 4A | 7th |
| 1B: Blueprint Graph DSL | L | Very High | UE reflection cache | 8th |
| 1C: Material Graph DSL | M | Medium | 1B patterns | 9th |

**First deliverable (Phases 3 + 5):** Reduce token overhead by 40-60% with zero behavior change. This is pure optimization that makes every existing workflow faster.

**Second deliverable (Phases 1A + 2B):** Widget DSL + diff patching. This is the highest-leverage change — widget authoring is the most-used surface and benefits most from concise input.

**Third deliverable (Phases 2A + 4A + 4B):** Composite workflows + markdown recipes. This is the "intent-level" upgrade that reduces multi-tool sequences to single calls.

**Fourth deliverable (Phases 1B + 1C):** Blueprint and material graph DSLs. These are the hardest to build (require UE reflection for name resolution) but have the highest error-reduction impact.

---

## What NOT To Do

1. **Don't remove low-level JSON tools.** They're the escape hatch when DSLs can't express something.
2. **Don't build a code execution sandbox.** The DSL approach is deterministic parsing, not arbitrary code execution.
3. **Don't add a conversational/chat layer.** The MCP protocol is tool-based; keep it tool-based.
4. **Don't try to infer intent from ambiguous input.** DSLs should have deterministic parsing — if the input is malformed, return a clear parse error.
5. **Don't break the v2 contract.** New tools are additive. Existing tools keep their schemas.

---

## Metrics

Track these to measure improvement:

| Metric | Current baseline | Target |
|--------|-----------------|--------|
| Avg input tokens per widget authoring sequence | ~3000 | ~1000 |
| Avg extraction output tokens (compact) | ~2000-4000 | ~800-1500 |
| Tool calls per widget creation workflow | 5-8 | 1-2 |
| Schema tokens per tool (avg) | ~200 | ~80 |
| LLM retry rate on blueprint graph ops | High (untracked) | Low |
| Response envelope overhead (non-payload tokens) | ~300-500 per response | ~50-100 |
