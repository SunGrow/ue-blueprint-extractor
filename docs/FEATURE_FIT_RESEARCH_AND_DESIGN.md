# Feature Fit Research And Design

> Historical research/design document. Not the current public contract. Use `docs/CURRENT_STATUS.md` to find normative docs.

**Version:** 1.0
**Date:** 2026-03-30
**Status:** Working draft
**Applies to:** Blueprint Extractor product-direction research after MCP v6 stabilization

---

## 1. Executive Summary

This document evaluates whether Aura-adjacent capabilities belong in Blueprint Extractor because they fit the product, not because they exist in the market. The baseline matters: Blueprint Extractor is currently a research-aligned Unreal MCP backend optimized for typed extraction, authoring, verification, automation, and code sync. It is not positioned as a full in-editor chat product, a general-purpose scene manipulation shell, or a first-party media-generation platform.

The main conclusion is simple:

- **Strong fit:** project intelligence, review/lint surfaces, and richer read-only editor context.
- **Conditional fit:** bounded asset audits and narrow previewable automation flows.
- **Weak or non-fit:** chat-shell UX, raw Python breadth, first-party image/3D/audio generation, and broad scene/world-editing parity.

The implication is equally simple: **do not chase Aura parity as a product strategy.** Blueprint Extractor should deepen its lead where it already has structural advantages:

- typed Unreal-native contracts,
- deterministic verification,
- low-context MCP ergonomics,
- and backend value for external coding agents.

---

## 2. Research Method And Source Quality

### 2.1 Research Question

Which competitor capabilities should influence Blueprint Extractor's design direction, and which should be treated as market noise or client-layer concerns?

### 2.2 Local Product-Boundary Anchors

These local sources define the current product identity and guardrails:

- [`README.md`](../README.md)
- [`docs/unsupported-surfaces.md`](./unsupported-surfaces.md)
- [`docs/VISION_AND_REQUIREMENTS.md`](./VISION_AND_REQUIREMENTS.md)
- [`MCP/src/resources/example-and-capture-resources.ts`](../MCP/src/resources/example-and-capture-resources.ts)
- [`MCP/src/resources/static-doc-resources.ts`](../MCP/src/resources/static-doc-resources.ts)

### 2.3 External Evidence Tiers

| Tier | Source Type | Examples Used Here | Weight |
|---|---|---|---|
| 1 | Official product docs and official product sites | Aura docs, Ludus docs, CreateLex site, UnrealAI docs | High |
| 2 | Official launch or vendor statements | Epic forum launch thread, PRNewswire Telos release | Medium |
| 3 | Third-party review or hands-on writeup | Unreal University review | Medium |
| 4 | Public user feedback | Epic forum replies and public discussion snippets | Low |

### 2.4 Important Caveat

Aura does not appear to expose a public source repository for direct code inspection. The pricing page explicitly markets source access as an enterprise feature. This document therefore compares **public product surfaces**, not internal implementation quality.

---

## 3. Boundary Memo

### 3.1 What Blueprint Extractor Is

Blueprint Extractor is:

- an Unreal Engine plugin plus MCP server,
- a strict machine-friendly contract for reading, creating, modifying, verifying, and saving UE assets,
- a backend optimized for external coding assistants and agentic workflows,
- a product that deliberately favors typed surfaces, scoped tool exposure, and deterministic verification over broad open-ended control.

This reading is directly supported by the current README statement that the project exists for assistants that need to "read, build, modify, verify, and save real UE assets instead of guessing," and by the architecture direction in `VISION_AND_REQUIREMENTS.md` that frames the server as a "reference implementation of research-aligned MCP design."

### 3.2 What Blueprint Extractor Is Not

Blueprint Extractor is not:

- a full in-editor chat application,
- a general-purpose agent shell with threads, bookmarks, undo history, checkpoints, and UX controls,
- a first-party image, mesh, music, or sound-generation product,
- or a generic world-editing layer.

The current public guidance is explicit that "world editing and runtime actor manipulation are out of scope for this server." The static-doc resources also currently state there are no live world-editing surfaces.

### 3.3 Boundary Rubric

Use this rubric when evaluating any new capability family.

| Disposition | Admit When | Route Elsewhere When | Reject When |
|---|---|---|---|
| **Core fit** | The feature strengthens Blueprint Extractor as a typed Unreal MCP backend and can be verified deterministically | N/A | N/A |
| **Client-layer** | The value is real but mostly about chat UX, sessioning, or operator controls | The MCP backend only needs hooks or data sources | It would distort the server into a UI app |
| **Integration-only** | The repo should connect to the capability, not own it | Another system should generate content and Blueprint Extractor should import, wrap, or verify it | Owning it would duplicate a market commodity with weak differentiation |
| **Out of scope** | N/A | N/A | The feature requires broad untyped editor control, weak verification, or persistent shell behavior unrelated to core backend value |

### 3.4 Product Fit Test

A feature family should be considered a likely fit only if the answer is "yes" to most of these:

1. Does it improve external-agent workflows more than in-editor chat convenience?
2. Can it be exposed as a typed, bounded, testable surface?
3. Can success be verified semantically or visually in a repeatable lane?
4. Can failures be contained without editor-fragile behavior?
5. Does it deepen Blueprint Extractor's differentiation rather than erase its focus?

---

## 4. Market Bundle Matrix

The most useful comparison is by bundle, not by individual feature checkbox.

| Bundle | Blueprint Extractor Today | Aura | Ludus | CreateLex | UnrealAI | Notes |
|---|---|---|---|---|---|---|
| **Typed Unreal backend authoring** | **Strong** | Medium | Medium | Medium | Medium | Blueprint Extractor is strongest on typed asset-family coverage, constrained contracts, and explicit verification lanes. |
| **Project intelligence** | Partial | **Strong** | Medium in plugin, weak in MCP | Weak in public materials | Partial | Aura centers indexing, quick search, and project memory. Ludus emphasizes project awareness in-plugin but explicitly says MCP is knowledge-only. |
| **Static review / analysis** | Partial | **Strong** for Blueprint review | **Strong** for Blueprint analysis and broader Insights reports | Weak in public materials | Partial | This is the clearest market gap that still fits Blueprint Extractor's backend identity. |
| **Read-only editor context** | Partial | **Strong** | **Strong** in plugin, weak in MCP | Partial | **Strong** | Competitors commonly expose current selection, open asset, viewport, or world context. Blueprint Extractor currently exposes process-level editor selection and screenshot capture, but not richer state snapshots. |
| **Scene automation / world editing** | Intentionally narrow | **Strong** via Editor Agent | Partial to medium | **Strong** in public messaging | **Strong** | This is where the market broadens into open-ended editor control. It is not a natural fit for Blueprint Extractor's current boundary. |
| **Generative media** | Import/integration only | **Strong** | **Strong** on 3D generation | Medium | **Strong** | The market treats generation as table stakes for full product shells, but this is weakly aligned with Blueprint Extractor's backend value. |
| **Product shell** | Minimal by design | **Strong** | **Strong** | **Strong** | **Strong** | Threads, sessions, provider switching, checkpoint UX, and built-in chat are common product-layer features. They are not server-shaping reasons for Blueprint Extractor to expand scope. |
| **Visual verification / comparison** | **Strong** | Weak in public docs | Weak in public docs | Weak in public docs | Weak in public docs | This is one of Blueprint Extractor's clearest differentiators. Competitors emphasize creation and context more than explicit verification artifacts and diff flows. |
| **External MCP editor control** | **Strong** | Medium | Weak on editor control, strong on knowledge MCP | Medium | **Strong** | Ludus explicitly positions MCP as knowledge access, not local-editor control. Blueprint Extractor remains unusually strong here. |

### 4.1 Competitor Readings

#### Aura

Aura's public materials present a broad Unreal-native agent shell:

- indexing, quick search, and project memory,
- Blueprint planning, editing, and code review,
- Behavior Tree editing,
- audio generation plus MetaSound wrapping,
- editor automation through Unreal Python,
- image and 3D generation,
- and a full product shell with Ask/Plan/Agent modes, thread history, bookmarks, and settings.

#### Ludus

Ludus is narrower than Aura on editor control but strong on:

- plugin-native project context,
- Blueprint analysis and editing in-plugin,
- a separate Insights report pipeline,
- and a knowledge-focused MCP surface.

Its docs are especially useful because they explicitly separate plugin context from MCP context. That distinction supports Blueprint Extractor's backend-first reading.

#### CreateLex

CreateLex markets:

- Blueprint generation,
- object manipulation,
- material creation,
- UMG generation,
- and broad natural-language scene control.

Its public positioning is heavily scene-automation oriented and bundled with a standalone assistant shell.

#### UnrealAI

UnrealAI presents the broadest bundle:

- 9 generators,
- 100+ MCP tools,
- scene building,
- mesh modeling,
- AI providers and CLI providers,
- built-in chat, history, and `@` mentions,
- and strong direct tool-calling inside the editor.

This is a useful market signal, but it is not a blueprint for Blueprint Extractor. It is a fundamentally broader product.

---

## 5. Jobs-To-Be-Done Matrix

| Job | Current Blueprint Extractor Support | Frequency For External Agents | Value | Audience Alignment | Fit Implication |
|---|---|---|---|---|---|
| Understand a project quickly without opening every asset manually | Partial: `search_assets`, `find_and_extract`, extraction families, prompts/resources | High | High | **High** | Strong case for project intelligence and ranked context search |
| Inspect, review, or explain a Blueprint or other asset family | Partial: extraction is strong, first-class review is missing | High | High | **High** | Strong case for read-only review/lint surfaces |
| Get trustworthy local editor context such as current selection or open asset | Partial: process/editor binding exists, richer state snapshots do not | Medium-High | High | **High** | Strong case for bounded read-only context surfaces |
| Verify that a user-facing UE change actually looks correct | Strong: capture, compare, motion verification, runtime screenshot lanes | Medium | High | **High** | Continue to treat verification as a core differentiator |
| Execute broad level-editing chores or batch scene manipulation | Weak by design | Medium | Medium | Medium | Only narrow audits or previewable automation may fit |
| Generate placeholder images, 3D models, music, or SFX | Weak by design; import is supported | Medium | Medium | Low-Medium | Better handled as integration-only, not core server scope |
| Use a full chat shell with history, bookmarks, modes, or provider switching | Outside current identity | High in end-user products | Medium | Low | Client-layer concern, not backend concern |

### 5.1 JTBD Takeaway

The two highest-value underserved jobs for Blueprint Extractor's actual audience are:

1. **project understanding for external agents**, and
2. **first-class review/analysis surfaces.**

The market is also signaling demand for editor context, but not all editor context is equal. Read-only context aligns well; broad world-editing control does not.

---

## 6. Feature Family Scoring

Scores use a 1-5 scale where 5 is strongest. `Opportunity cost pressure` is inverse: `Low` is easier to justify, `High` means the work risks displacing more important roadmap effort.

| Feature Family | Strategic Fit | Leverage | Contractability | Safety | Verification | Differentiation | Opportunity Cost Pressure | Disposition |
|---|---:|---:|---:|---:|---:|---:|---|---|
| Project intelligence / indexing / ranked context search | 5 | 5 | 4 | 4 | 4 | 4 | Medium | **Advance** |
| Review / lint / analysis surfaces | 5 | 5 | 5 | 5 | 4 | 5 | Medium | **Advance** |
| Read-only editor context | 4 | 4 | 4 | 4 | 4 | 4 | Medium | **Advance** |
| Asset audits and bounded metadata checks | 4 | 4 | 4 | 4 | 4 | 3 | Medium | **Advance cautiously** |
| Narrow previewable editor automation | 3 | 3 | 3 | 2 | 2 | 2 | High | **Hold** |
| Raw Python or generic script execution | 1 | 3 | 1 | 1 | 1 | 1 | High | **Reject** |
| First-party image / mesh / audio generation | 1 | 2 | 2 | 2 | 2 | 1 | Very High | **Integration only** |
| Product shell UX: chat tabs, bookmarks, modes, provider UI | 1 | 2 | 3 | 3 | 1 | 1 | High | **Client-layer** |
| Broad scene/world editing parity | 1 | 3 | 1 | 1 | 1 | 1 | Very High | **Reject** |

### 6.1 Advancement Rule

Only the first four families should advance into deeper design work inside this repo. The rest either belong in a client/product shell or should remain outside Blueprint Extractor entirely.

---

## 7. Scenario Reviews

This section compares actual user scenarios rather than abstract feature lists.

### 7.1 Scenario: An External Agent Needs To Understand A Project Quickly

| Option | Shape | Strengths | Weaknesses | Verdict |
|---|---|---|---|---|
| Current Blueprint Extractor | Search plus extraction plus prompts/resources | Typed and trustworthy; can already inspect many Unreal families deeply | Too manual for large projects; no persistent index, quick-search layer, or project memory surface | Good foundation, incomplete workflow |
| Aura | Indexing, quick search, project memory, context objects | Strongest public project-understanding story | Lives inside a broader product shell; not evidence of a typed backend advantage by itself | Strong signal that the market values project intelligence |
| Ludus | Plugin project awareness, MCP knowledge mode | Clear split between plugin context and MCP research role | Public MCP does not control editor or expose local project state the same way | Useful model for separating plugin-only context from MCP scope |
| Do nothing / let agents compose manually | External agent uses file search plus current extractors | No scope expansion | Repeated token and latency cost; project recall stays shallow | Not enough for backend-first differentiation |

**Decision:** project intelligence is a strong fit and should be designed for external-agent use, not for chat-shell parity.

### 7.2 Scenario: An External Agent Needs Static Review Of A Blueprint Or Asset Family

| Option | Shape | Strengths | Weaknesses | Verdict |
|---|---|---|---|---|
| Current Blueprint Extractor | Manual extract plus general model reasoning | Rich raw data is available | No first-class review semantics, no stable findings schema, no reproducible lint surface | Biggest design gap that still fits the product |
| Aura | Blueprint code review from chat and diff entry points | Strong user-facing review story | Public docs emphasize UX, not typed result shape | Validates the need, not the implementation approach |
| Ludus | Blueprint analysis and broader Insights reports | Strong analysis positioning | Insights is asynchronous PDF-style reporting, less MCP-native | Confirms analysis demand beyond generation |
| Do nothing | Keep extract-only model | No new surfaces | Users keep reinventing review prompts and result shapes | Weak strategic choice |

**Decision:** first-class review/lint is the highest-confidence addition Blueprint Extractor should research further.

### 7.3 Scenario: An External Agent Needs Richer Local Context From Selection / Open Asset / Editor State

| Option | Shape | Strengths | Weaknesses | Verdict |
|---|---|---|---|---|
| Current Blueprint Extractor | Active editor binding, screenshot tools, asset search | Good editor/process control, good capture lanes | Missing read-only snapshots for open asset editors, selected assets, current level context, and similar state | Strong candidate for bounded expansion |
| Aura | Context objects, selected assets, right-click add-to-context, headless/editor switching | Strong local-context UX | Product-shell heavy; public docs focus on user flows, not backend contracts | Good evidence of demand |
| Ludus | Open Blueprint, selected assets, World Outliner awareness in plugin | Strong plugin contextuality | Explicitly not the same thing in MCP mode | Helpful precedent for separating plugin context from external MCP |
| Do nothing | Ask user to attach more assets manually | Lowest scope cost | Friction stays high for external agents | Under-serves the backend audience |

**Decision:** richer **read-only** editor context is a fit. Mutation should remain separate.

### 7.4 Scenario: A User Wants Batch Scene Edits Or Asset Audits

| Option | Shape | Strengths | Weaknesses | Verdict |
|---|---|---|---|---|
| Current Blueprint Extractor | Asset search, extraction, verification, no broad world-editing | Safe, bounded | Does not help much with chore automation today | Gap exists, but current boundary is clear |
| Aura | Unreal Python Editor Agent, batch edits, renaming, unused-asset checks | Broadest flexible editor-automation story | Safety and verification are harder to bound; product shell absorbs some risk | Validates demand, but also highlights why parity is risky |
| CreateLex / UnrealAI | Object manipulation, scene building, actor management | High convenience for interactive creation | Drifts into general editor control and broad scene mutation | Wrong default direction for Blueprint Extractor |
| Ludus Insights | Audits and reports without direct broad scene mutation | Better match for backend-style analysis | More report-oriented than MCP-native | Good inspiration for audit-first surfaces |

**Decision:** asset audits are plausible. Broad scene editing is not. Any automation work should start from read-only audit plus preview, not raw control.

### 7.5 Scenario: A User Wants Generated Media Or Chat UX Conveniences

| Option | Shape | Strengths | Weaknesses | Verdict |
|---|---|---|---|---|
| Current Blueprint Extractor | Import, authoring, verification, no first-party generation shell | Clear scope, strong backend identity | Missing one-stop convenience | Acceptable given product identity |
| Aura | Image, mesh, audio generation plus product shell UX | Compelling all-in-one experience | Broad, expensive, and weakly tied to Blueprint Extractor's core strengths | Strong product-layer competitor, weak feature-fit justification |
| UnrealAI / CreateLex | Similar broad shell with generators and sessions | High breadth | Similar dilution risk | Good market signal, poor scope fit |
| Integration-only strategy | Let external tools generate; Blueprint Extractor imports, wraps, verifies | Plays to Blueprint Extractor's strengths | Requires coordination across tools | Best fit for this repo |

**Decision:** do not convert Blueprint Extractor into a generator shell. Prefer import, wrap, validate, and verify workflows.

---

## 8. Design Briefs For Likely-Fit Candidate Families

These are design briefs only. They are intentionally non-binding and do not change the public contract.

### 8.1 Project Intelligence And Ranked Context Search

**User job**

- Help an external coding agent understand a project quickly without manually stitching together dozens of search and extract calls.

**Why it fits**

- Strong backend leverage.
- Naturally complements existing extraction families.
- Reduces repeated reasoning and tool-call overhead, which is aligned with the repo's research-driven design philosophy.

**Recommended surface type**

- one low-frequency indexing tool family,
- one search tool,
- and one or more resources for persistent project memory or index status.

**Design constraints**

- Keep the public surface snippet-first and provenance-heavy.
- Do not return opaque embeddings or hidden relevance logic without enough provenance to explain why results ranked highly.
- Treat project memory as a backend-consumed text artifact, not as a client UX system.

**Safety model**

- Read-only.
- No automatic mutation of source or assets.
- Clear invalidation and reindex boundaries.

**Verification lane**

- Deterministic recall tests against known fixture projects.
- Ranking and provenance checks.
- Status visibility for stale or partial indices.

**Context budget**

- Search results must be paginated and summarized.
- Favor ranked snippets plus references over large dumps.

**Non-binding contract sketch**

```json
{
  "tool": "search_project_context",
  "arguments": {
    "query": "How is the player spawn flow wired?",
    "sources": ["asset_index", "code_index", "project_memory"],
    "limit": 8
  }
}
```

```json
{
  "success": true,
  "operation": "search_project_context",
  "results": [
    {
      "kind": "blueprint_function",
      "source": "asset_index",
      "asset_path": "/Game/Blueprints/BP_GameMode",
      "summary": "Handles spawn-point selection and pawn possession.",
      "evidence": [
        "Calls ChoosePlayerStart in BeginPlay path",
        "References BP_PlayerSpawnManager"
      ],
      "score": 0.92
    }
  ]
}
```

**Disposition**

- Advance into later design or implementation planning.

### 8.2 Review / Lint / Analysis Surfaces

**User job**

- Give external agents a stable, first-class way to review Blueprints and other asset families without inventing ad hoc prompting every time.

**Why it fits**

- Read-only and highly MCP-native.
- Strongly aligned with Blueprint Extractor's existing extraction depth.
- Strengthens a current gap that competitors already market.

**Recommended surface type**

- typed review tools with strongly structured findings,
- optionally paired with prompts/resources explaining interpretation and next steps.

**Design constraints**

- Findings-first output.
- Stable severity levels and categories.
- No hidden "magic score" without readable evidence.

**Safety model**

- Read-only only.
- No auto-fix in the first version of the design.

**Verification lane**

- Seeded bad fixtures for expected findings.
- Clean fixtures with low false-positive budgets.

**Context budget**

- Findings should summarize issues without requiring the full graph unless the caller asks for follow-up extraction.

**Non-binding contract sketch**

```json
{
  "tool": "review_blueprint",
  "arguments": {
    "asset_path": "/Game/Blueprints/BP_Weapon",
    "checks": ["logic", "references", "conventions", "replication"]
  }
}
```

```json
{
  "success": true,
  "operation": "review_blueprint",
  "summary": {
    "finding_count": 3,
    "highest_severity": "warning"
  },
  "findings": [
    {
      "severity": "warning",
      "category": "logic",
      "graph_path": "EventGraph/Reload",
      "message": "Execution path can reach ammo decrement before null-check on CurrentWeapon.",
      "evidence": [
        "Branch guarding CurrentWeapon is downstream from decrement path"
      ],
      "next_steps": [
        "Move the validity check ahead of ammo mutation"
      ]
    }
  ]
}
```

**Disposition**

- Advance first among all candidate families.

### 8.3 Read-Only Editor Context Surfaces

**User job**

- Let an external agent understand the relevant local editor state without relying on screenshots or asking the user to manually enumerate selection and open assets.

**Why it fits**

- It improves agent grounding without requiring broad editor mutation.
- It matches what competitor plugins treat as table stakes.
- It can remain clearly bounded and testable.

**Recommended surface type**

- one or two read-only tools,
- or a single context tool with narrow typed sections and explicit opt-in fields.

**Design constraints**

- Keep it shallow by default.
- Separate process binding from editor-state snapshots.
- Avoid silently pulling large amounts of context.

**Safety model**

- Read-only.
- No hidden side effects such as editor focus switching or asset opening.

**Verification lane**

- Editor integration tests against known selection and open-asset states.

**Context budget**

- Default summaries only.
- Explicit arguments for detailed expansion.

**Non-binding contract sketch**

```json
{
  "tool": "get_editor_context",
  "arguments": {
    "include_selection": true,
    "include_open_assets": true,
    "include_level_context": true
  }
}
```

```json
{
  "success": true,
  "operation": "get_editor_context",
  "selection": {
    "selected_asset_paths": ["/Game/UI/WBP_HUD"],
    "selected_actor_names": ["BP_PlayerStart_2"]
  },
  "open_assets": [
    {
      "asset_path": "/Game/UI/WBP_HUD",
      "asset_class": "WidgetBlueprint"
    }
  ],
  "level_context": {
    "level_name": "L_TestArena"
  }
}
```

**Disposition**

- Advance, but keep strictly read-only in early design.

### 8.4 Asset Audits And Narrow Automation

**User job**

- Help users run high-value project audits or limited chore automation without opening the door to broad untyped world editing.

**Why it only partly fits**

- Read-only audits fit well.
- Mutating automation quickly drifts toward the general editor-agent space that current docs explicitly avoid.

**Recommended surface type**

- start with audits, reports, and previews,
- defer mutations or place them behind a narrower, more opinionated surface later.

**Design constraints**

- Prefer asset-focused audits over actor/world manipulation.
- Any future mutation must have `validate_only`, explicit targets, and narrow operation families.

**Safety model**

- Audit-only surfaces are safest.
- Mutation should remain opt-in and preview-first if it ever lands.

**Verification lane**

- Fixture-based audits.
- Preview/apply consistency tests if mutation is ever explored.

**Context budget**

- Summary counts first, then itemized issues or candidates.

**Non-binding contract sketch**

```json
{
  "tool": "audit_project_assets",
  "arguments": {
    "checks": ["unused_assets", "naming_conventions", "oversized_textures"],
    "scope_paths": ["/Game"]
  }
}
```

**Disposition**

- Advance cautiously for audits.
- Hold on generic automation until a separate research pass proves bounded value and verification.

---

## 9. Anti-Roadmap

The purpose of this section is to stop parity pressure from reopening settled scope boundaries.

| Feature Family | Why It Does Not Fit Blueprint Extractor Well | Preferred Handling |
|---|---|---|
| Chat tabs, bookmarks, thread history, Ask/Plan/Agent modes | Product-shell UX, not backend capability | Leave to the client or plugin shell |
| Provider selection, billing, credits, subscription UX | Commercial shell concern, not Unreal MCP value | Leave to client/product shell |
| First-party image generation | Commodity generator surface; weak differentiation here | Integrate through file import and verification |
| First-party 3D model generation | High surface area and weak verification alignment | Integrate through import, validation, and wrapping workflows |
| First-party audio generation | Similar issue; MetaSound authoring may fit better than generation itself | Consider wrapping or import workflows, not generation ownership |
| Raw Python execution | Too open-ended, hard to secure, hard to verify, easy to destabilize editor state | Reject or isolate into a separate explicitly unsafe product |
| Broad scene/world editing parity | Contradicts current public boundary and verification posture | Reject for this repo |
| Full in-editor chat shell or standalone desktop app | Changes the product identity entirely | Leave to clients or separate products |
| General-purpose knowledgebase SaaS | Different product and operational burden | Keep Blueprint Extractor focused on local Unreal project control |

### 9.1 Important Nuance

Rejecting first-party generation does **not** mean rejecting those workflows for users. It means Blueprint Extractor should be the Unreal-native bridge that:

- imports results,
- wraps them into usable UE assets,
- verifies them,
- and exposes trustworthy state back to external agents.

---

## 10. Draft Guardrails For Any Future Design

If a later implementation plan is written for any candidate family, it should preserve the following guardrails:

1. New surfaces must remain scoped and discoverable through the existing MCP progressive-disclosure model.
2. Read-only designs should ship before mutation-heavy designs in the same family.
3. Every new family must define its verification lane before implementation begins.
4. Large result sets must be snippet-first and provenance-rich.
5. Any automation surface must start with preview, audit, or `validate_only`, not open-ended execution.
6. No new family should erode the current unsupported-surfaces posture without an explicit replacement design.

---

## 11. Recommendation

The recommended product direction is:

- **double down on backend strengths,**
- **borrow only the parts of competitor products that reinforce those strengths,**
- and **avoid copying bundles that belong to a client shell or a broader all-in-one Unreal AI suite.**

Concretely, the next research or design passes should focus on:

1. project intelligence,
2. review/lint,
3. read-only editor context,
4. and asset-audit surfaces.

Everything else should be treated as:

- client-layer,
- integration-only,
- or out of scope.

---

## 12. Sources

### 12.1 Local Sources

- [README.md](../README.md)
- [docs/unsupported-surfaces.md](./unsupported-surfaces.md)
- [docs/VISION_AND_REQUIREMENTS.md](./VISION_AND_REQUIREMENTS.md)
- [MCP/src/resources/example-and-capture-resources.ts](../MCP/src/resources/example-and-capture-resources.ts)
- [MCP/src/resources/static-doc-resources.ts](../MCP/src/resources/static-doc-resources.ts)

### 12.2 Competitor And Market Sources

- [Aura Project Understanding](https://www.tryaura.dev/documentation/project-understanding)
- [Aura Blueprints](https://www.tryaura.dev/documentation/blueprints)
- [Aura Behavior Tree Agent](https://www.tryaura.dev/documentation/behavior-trees/)
- [Aura Audio Agent](https://www.tryaura.dev/documentation/audio/)
- [Aura Coding Agent (C++)](https://www.tryaura.dev/documentation/coding-agent-cpp/)
- [Aura Editor Agent](https://www.tryaura.dev/documentation/editor-agent/)
- [Aura Advanced Settings](https://www.tryaura.dev/documentation/advanced-settings/)
- [Aura IDE / Claude Code](https://www.tryaura.dev/documentation/aura-ide-mcp/)
- [Aura launch thread on Epic forums](https://forums.unrealengine.com/t/aura-ai-agent-for-unreal-editor/2689209)
- [PRNewswire Telos launch statement](https://www.prnewswire.com/news-releases/ramen-vr-introduces-telos-the-breakthrough-ai-agent-for-unreal-blueprints-302561368.html)
- [Unreal University review of Aura](https://www.unreal-university.blog/this-ai-can-now-generate-blueprints-in-unreal-engine/)
- [Ludus overview](https://docs.ludusengine.com/how-to-use-ludus/overview)
- [Ludus Blueprint Interactions & Workflows](https://docs.ludusengine.com/blueprint-tool/examples-of-usage/)
- [Ludus Insights Tool](https://docs.ludusengine.com/insights-tool)
- [Ludus MCP Integration](https://docs.ludusengine.com/mcp)
- [CreateLex main site](https://createlex.com/)
- [CreateLex products page](https://createlex.com/products)
- [CreateLex FAQ](https://createlex.com/faq)
- [UnrealAI documentation](https://unrealai.studio/docs.html)

### 12.3 Source Reading Notes

- Official docs are useful for feature-surface comparison but naturally present the strongest version of each product.
- The Epic forum thread and Unreal University review were used to cross-check user-facing claims and limitations.
- No attempt was made to infer hidden implementation details from marketing claims alone.
