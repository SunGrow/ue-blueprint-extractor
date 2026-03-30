# Post-Stabilization Improvement Plan

> Working plan for the next roadmap slice. Use `docs/CURRENT_STATUS.md` for the current public contract and validated baseline.

**Date:** 2026-03-30
**Inputs:** `docs/FEATURE_FIT_RESEARCH_AND_DESIGN.md` dated 2026-03-30 and `docs/CURRENT_STATUS.md` last updated 2026-03-30

---

## Purpose

Use the now-green UE 5.6 / 5.7 baseline to add the next product-fit capabilities without diluting the repo into a general Unreal agent shell.

This plan assumes the current v2 contract remains the authority:

- 106 tools, 38 resources, 4 resource templates, and 12 prompts remain the validated baseline.
- Existing extraction, authoring, verification, PIE, screenshot, and code-sync surfaces stay stable while new work lands.
- New capability families must follow the same typed, bounded, verification-aware design rules as the current contract.

## Branch Status

Implemented on this branch:

- shared result contracts for analysis, context search, audit, and editor context
- workflow scopes `analysis` and `project_intelligence`
- read-only tools:
  - `review_blueprint`
  - `get_editor_context`
  - `refresh_project_index`
  - `get_project_index_status`
  - `search_project_context`
  - `audit_project_assets`
- zero-warning hardening for the UE 5.6 / 5.7 headless `BlueprintExtractor` lane
- zero-warning hardening for the UE 5.6 / 5.7 rendered smoke filters:
  - `BlueprintExtractor.ProjectControl.PIEAndScreenshots`
  - `BlueprintExtractor.Authoring.WidgetCaptureVerification`
  - `BlueprintExtractor.Authoring.CommonUIButtonStyleRoundTrip`
- live MCP smoke validated against a real staged `BPXFixture` editor session

The current execution focus after this branch is sustaining these gates and expanding fixture-backed coverage without weakening the compact default surface.

## Roadmap Rules

Every phase in this plan must preserve these rules:

1. Prefer read-only surfaces before mutation-heavy surfaces in the same family.
2. Add new families through progressive disclosure instead of bloating the compact default tool surface.
3. Keep results snippet-first, provenance-rich, and bounded by explicit limits.
4. Define fixture-backed validation before widening the public contract.
5. Do not reopen rejected scope:
   - raw Python execution
   - first-party image / mesh / audio generation
   - broad world or scene editing parity
   - chat-shell UX such as tabs, bookmarks, modes, or provider selection

## Priority Order

The candidate families from the feature-fit research should advance in this order:

1. review / lint / analysis
2. read-only editor context
3. project intelligence and ranked context search
4. asset audits

This sequence keeps the first two slices narrow, backend-native, and compatible with the current stabilization posture, while delaying the indexing-heavy work until the shared result contracts are proven.

## Phase 0: Shared Contract Design

**Goal:** Define the new result shapes, scope boundaries, and validation fixtures before shipping new tools.

### Deliverables

- A new design brief for read-only analysis surfaces and how they appear through workflow scopes.
- Stable result shapes for:
  - `analysis_summary`
  - `analysis_finding`
  - `context_snippet`
  - `context_search_result`
  - `audit_summary`
  - `audit_finding`
- Severity and category enums that are readable to callers and stable in tests.
- A decision on new scope names, likely one analysis-focused scope and one project-intelligence scope.

### Implementation seams

- MCP contract and scope wiring:
  - `MCP/src/register-server-tools.ts`
  - `MCP/src/tool-surface-manager.ts`
  - `MCP/src/schemas/tool-inputs.ts`
  - `MCP/src/schemas/tool-results.ts`
- Guidance surfaces:
  - `MCP/src/resources/static-doc-resources.ts`
  - `MCP/src/prompts/prompt-catalog.ts`
  - `docs/mcp-v2-reference.md`
  - `docs/prompt-catalog.md`

### Exit criteria

- Result envelopes are documented before implementation starts.
- New scopes are defined without weakening the compact default surface.
- Contract tests can fail on enum drift, missing fields, or undocumented scope changes.

## Phase 1: Review / Lint MVP

**Goal:** Ship the highest-confidence product-fit addition first: first-class, read-only review for Blueprint assets.

### Scope

Start with a single Blueprint-first review surface before broadening to other asset families.

Recommended first checks:

- logic flow
- null / validity guard ordering
- reference hygiene
- convention and naming issues
- replication / authority hazards where the extracted graph makes them detectable

### Deliverables

- One typed review tool for Blueprints with findings-first output.
- Structured summary fields such as finding count, highest severity, and covered check families.
- Evidence and next-step fields on every finding.
- A small set of generated examples and one prompt entry showing how review interacts with extraction follow-ups.

### Implementation notes

- First version should stay read-only in MCP and rely on existing extractors as much as possible.
- Only add UE plugin work when the current extracted graph lacks evidence needed for stable findings.
- Avoid auto-fix in the first public version.

### Validation

- MCP tests for tool schema, result shape, and contract counts.
- Seeded fixture cases in the UE project for positive and negative review scenarios.
- False-positive budget review on at least one clean Blueprint fixture.

### Stop / defer conditions

- If findings depend on weak heuristics or hidden scores, defer the check family rather than shipping noisy output.
- If a review requires opening or mutating assets, it belongs in a later phase.

## Phase 2: Read-Only Editor Context

**Goal:** Improve external-agent grounding with bounded editor-state snapshots, not broader editor control.

### Scope

Add a shallow, opt-in context surface that can report:

- current selected asset paths
- current selected actor names when available
- open asset editors
- active level or world context
- current PIE state where relevant

### Deliverables

- One typed context tool or one narrow tool family.
- Default summary mode with explicit expansion flags.
- Clear separation between editor binding, project automation context, and richer editor-state snapshots.

### Implementation notes

- Reuse the existing active-editor session and project-context machinery before adding new editor-side hooks.
- No hidden side effects such as focus changes, asset opening, or viewport switching.
- Keep the result small enough that it can be used as grounding in follow-up calls without dominating context.

### Likely implementation seams

- MCP:
  - `MCP/src/active-editor-session.ts`
  - `MCP/src/project-controller.ts`
  - `MCP/src/tools/project-control.ts`
- UE plugin:
  - `BlueprintExtractor/Source/BlueprintExtractor/Public/BlueprintExtractorSubsystem.h`
  - `BlueprintExtractor/Source/BlueprintExtractor/Private/BlueprintExtractorSubsystem.cpp`

### Validation

- UE automation fixtures that prove selection, open-asset, and level-context snapshots.
- MCP tests for opt-in field behavior and bounded default responses.

## Phase 3: Project Intelligence And Ranked Context Search

**Goal:** Reduce manual search-and-extract stitching for large projects while keeping the surface explainable and deterministic.

### Scope

Start with asset-centric and doc-centric indexing before broader code intelligence.

Recommended v1 sources:

- extracted asset metadata
- asset-family summaries
- public docs and prompt/resource metadata already published by the MCP server

Recommended later sources:

- project code index
- lightweight project memory derived from explicit indexing runs

### Deliverables

- One indexing entry point with explicit invalidation or refresh behavior.
- One search tool with ranked, provenance-rich snippets.
- One status or metadata resource for index freshness and coverage.

### Design rules

- No opaque relevance scores without human-readable evidence.
- No background mutation of assets or project files.
- Paginate aggressively and prefer snippets over large dumps.
- Make stale-index status visible in every relevant result.

### Likely implementation seams

- MCP:
  - `MCP/src/tools/utility-tools.ts` or a new project-intelligence tool module
  - `MCP/src/helpers/token-budget.ts`
  - `MCP/src/helpers/response-summarizer.ts`
  - `MCP/src/resources/static-doc-resources.ts`
- Potential indexing helpers:
  - new helper modules under `MCP/src/helpers/`
  - optional cache metadata in `MCP/src/catalogs/`

### Validation

- Deterministic recall fixtures against the UE fixture project.
- Ranking checks that assert provenance and evidence fields, not exact floating-point scores.
- Stale-index behavior tests.

## Phase 4: Asset Audit Surfaces

**Goal:** Add high-value project audits without drifting into broad scene automation.

### Scope

Limit the first release to read-only audits over assets and metadata.

Good initial candidates:

- naming-convention violations
- unused or orphaned assets where the signal is reliable
- oversized textures or obvious content-budget issues
- asset-family coverage or hygiene summaries

### Deliverables

- One audit entry tool with explicit `checks` and scoped package paths.
- Findings grouped by check family with summary counts first.
- Optional follow-up workflow guidance that routes callers to existing extract or verify tools.

### Design rules

- Start with asset/package scope, not actor/world scope.
- Prefer previewable reports over mutation.
- Any future mutation work must come through a separate plan and ship behind `validate_only` or preview-first semantics.

### Validation

- Fixture projects with known audit findings.
- Low-noise thresholds for heuristics such as unused-asset detection.
- Clear unsupported or low-confidence outcomes instead of silent omission.

## Phase 5: Rollout Hardening

**Goal:** Make the new families discoverable and safe without repeating the “tool exists but workflow skips it” failure mode.

### Deliverables

- README and reference updates only after the public contract is stable.
- New resources, prompt entries, and examples that teach the intended stopping rules.
- Coverage in:
  - `MCP/tests/server-contract.test.ts`
  - new tool-family test files
  - UE automation where editor-side evidence is involved

### Release gate

Do not mark a family complete until all of the following are true:

- the result schema is stable
- one happy-path fixture is green
- one negative-path fixture is green
- the docs and prompt surfaces teach the new workflow correctly
- unsupported edges return structured boundaries instead of implicit failure

## Not In This Plan

The following items remain deliberately outside the roadmap even if competitors market them:

- raw Python or generic script execution
- broad scene editing or world-manipulation parity
- first-party media generation
- full in-editor or desktop chat-shell UX
- provider-management or billing-layer features

These can be integrated through other tools or client layers, but they should not shape the Blueprint Extractor server contract.

## Recommended Execution Order

1. Complete Phase 0 contract design and fixture planning.
2. Implement Phase 1 review / lint MVP.
3. Implement Phase 2 read-only editor context.
4. Start Phase 3 project intelligence with asset-centric indexing only.
5. Add Phase 4 audits only after the search/result-shaping patterns are stable.
6. Run Phase 5 rollout hardening after each family, not only at the end.

## Success Criteria

This plan is successful if the next roadmap slice:

- strengthens external-agent project understanding without turning the repo into a chat product,
- adds first-class review semantics that reduce ad hoc prompting,
- improves editor grounding without widening mutation scope,
- and preserves the current green baseline on UE 5.6 and UE 5.7 while the contract grows.
