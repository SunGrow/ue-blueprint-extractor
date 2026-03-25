# MCP Blueprint Extractor — Issues Fix & Test Coverage Plan

**Date:** 2026-03-25
**Scope:** Full — all 5 open issues + test coverage (34% -> 60%+)
**Layers:** C++ UE Plugin + TypeScript MCP Server
**Priority:** Foundation first (#5 -> #4 -> #1 -> #2 -> #3 -> tests)
**Organization:** Parallel by issues + parallel by layers (C++/TS squads)

---

## Context

Source: `.issues/2026-03-25-mcp-issues-and-learnings.md`

The MCP Blueprint Extractor v3 has 5 open issues discovered during CyberVolleyball6vs6 coach behavior system development (39 C++ files, StateTree integration, Blueprint modifications):

| Issue | Severity | Summary |
|-------|----------|---------|
| #1 | MAJOR | No additive component creation for Blueprints — `replace_components` destroys all existing |
| #2 | HIGH | `create_state_tree` fails with complex C++ USTRUCT payloads |
| #3 | HIGH | StateTree input binding support completely missing |
| #4 | HIGH | `sync_project_code` always fails — outer catch swallows all context |
| #5 | HIGH | "Unknown error" messages lack diagnostics — multi-layer info loss |

Test coverage is at 34% (28/83 tools with contract tests).

---

## Architecture Summary

- **MCP Server:** TypeScript, Stdio transport, HTTP PUT to UE Remote Control at `localhost:30010`
- **UE Plugin:** C++ BlueprintExtractorSubsystem, exposes methods via Remote Control API
- **Error pipeline:** UEClient -> `callSubsystemJson()` -> tool registration wrapper -> `normalizeToolError()` / `normalizeToolSuccess()`
- **18 tool modules** in `MCP/src/tools/`, **83 tools** total

---

## Phases & Dependencies

```
Phase 0: Foundation (Issue #5 — Error Diagnostics)
    |
    +-- C++ squad: enrich error payloads in Subsystem + Authoring files
    +-- TS squad: improve normalizeToolError + callSubsystemJson + new helper
    |
    sync point: C++ compile + TS build + existing tests pass
    |
Phase 1: Parallel Fixes (Issues #4 + #1)
    |
    +-- TS squad: Issue #4 (sync_project_code refactor)
    +-- C++ squad + TS squad: Issue #1 (add_component)
    |   (these run in parallel — no dependencies between them)
    |
    sync point: C++ compile + TS build + tests
    |
Phase 2: StateTree (Issues #2 + #3, sequential)
    |
    +-- Issue #2: create_state_tree robustness (C++ + TS)
    |   sync point
    +-- Issue #3: StateTree input bindings (C++ + TS)
    |   sync point
    |
Phase 3: Test Coverage (34% -> 60%+)
    |
    +-- QC team: new tests for all modified tools + existing gaps
    |
    (Phase 3 can partially overlap with Phase 1+ for error pipeline tests)
```

### Dependency Rules

- Phase 1 depends on Phase 0 (new features need enriched error pipeline)
- Phase 2 depends on Phase 0 (StateTree errors need diagnostics)
- Issues #4 and #1 (Phase 1) are independent of each other
- Issue #3 depends on Issue #2 (bindings work on top of robustness fix)
- Phase 3 test writing for error pipeline can start after Phase 0

---

## Team Structure

```
                      LEAD COORDINATOR
                   (main context, manages
                    phases & sync points)
                           |
          +----------------+----------------+
          |                |                |
     C++ SQUAD        TS SQUAD         QC SQUAD
     ----------       ---------        ---------
     Senior C++       Senior TS       Code Reviewer
     Developer        Developer       Test Writer
     (Plugin)         (MCP)           QC Manager
     C++ Fixer        TS Fixer
     (compile loop)   (build loop)
```

### Agent Assignments

| Role | Agent Type | Dispatch Method | Responsibilities |
|------|-----------|----------------|-----------------|
| Lead Coordinator | Main context | — | Phase management, sync points, decisions |
| Senior C++ Dev | `subagent-code-writer` | `mcp__subagent-mcp__create_agent_with_prompt` | C++ implementation: AddComponent, error enrichment, bindings |
| C++ Fixer | `subagent-code-fixer` | `mcp__subagent-mcp__create_agent_with_prompt` | Compile loop: UBT build -> parse errors -> fix -> rebuild |
| Senior TS Dev | `Agent` (general-purpose) | Agent tool | TS implementation: normalizeToolError, schema, validation |
| TS Fixer | `Agent` (general-purpose) | Agent tool | `npm run build` + `npm run test:unit` -> fix -> retry |
| Code Reviewer | `subagent-code-reviewer` | `mcp__subagent-mcp__create_agent_with_prompt` | Check code against project rules after each phase |
| Test Writer | `Agent` (general-purpose) | Agent tool | Write Vitest tests for modified/new tools |
| QC Manager | `Agent` (general-purpose) | Agent tool | Final validation: full test suite, coverage report |

### Workflow Per Phase

1. Lead assigns tasks to C++ and TS squads in parallel
2. Senior Dev implements -> Fixer compiles/builds
3. Code Reviewer checks changes against rules
4. Test Writer writes tests for the changes
5. QC Manager runs full test suite
6. Lead verifies sync point -> next phase

### Rules for Implementors

All agent-developers MUST:
- Read rules from `work-code-building` skill before scaffolding
- Read rules from `work-code-research` skill before investigating UE APIs
- Follow coding conventions from `shared-ue-code` for C++ code
- Code Reviewer uses rules from `subagent-code-reviewer`

---

## Phase 0: Issue #5 — Error Diagnostics (Foundation)

### Root Cause

Multi-layer information loss in error pipeline:
1. C++ Subsystem returns generic "Failed to create StateTree" instead of propagating ValidationErrors
2. `callSubsystemJson()` throws bare `Error(parsed.error)` — loses full response context
3. `normalizeToolError()` can only extract `.message` from Error objects — no diagnostics, no step info
4. `ue-client.ts` `formatCallFailure()` doesn't include response body

### C++ Squad Tasks

| ID | File | Lines | Change |
|----|------|-------|--------|
| 0.1 | `BlueprintExtractorSubsystem.cpp` | 2450-2453 | Replace generic `MakeErrorJson("Failed to create StateTree")` with propagation of `ValidationErrors` from `FAssetMutationContext`. Return structured error with all collected errors. |
| 0.2 | `StateTreeAuthoring.cpp` | 1859-1964 | Enrich Create() errors: include which step failed (schema resolution, preview validation, compile), what exactly failed validation. Propagate `ValidationErrors` array through each step. |
| 0.3 | `BlueprintAuthoring.cpp` | mutation functions | Propagate `OutErrors` through mutation context instead of swallowing. Ensure all authoring files return structured errors with step context. |

### TS Squad Tasks

| ID | File | Lines | Change |
|----|------|-------|--------|
| 0.4 | `helpers/subsystem.ts` | 26-42 | Preserve full UE response in error object: `const err = new Error(parsed.error); (err as any).ueResponse = parsed; throw err;` |
| 0.5 | `helpers/tool-results.ts` | 98-186 | Improve `normalizeToolError()`: extract diagnostics from `ueResponse` property on Error objects, inspect object keys when no message found, populate diagnostics array with available context. |
| 0.6 | `helpers/error-diagnostics.ts` | new file | Create `ToolErrorContext` interface with fields: `toolName`, `step?`, `stepErrors?`, `ueResponse?`, `originalError?`. Create `buildDiagnosticsFromContext()` helper that extracts all available info into diagnostics array. |
| 0.7 | `ue-client.ts` | 179 | Include truncated response body (max 500 chars) in error message from `formatCallFailure()`. |

### Sync Point

- C++ compile succeeds (UBT build)
- `npm run build` succeeds
- `npm run test:unit` passes (existing tests)
- Verify: a tool that previously returned "Unknown error" now returns structured diagnostics

---

## Phase 1: Issues #4 + #1 (Parallel)

### Issue #4 — sync_project_code (TS Squad Only)

#### Root Cause

Outer try-catch at `project-control.ts:752-759` wraps 250+ lines of orchestration. ANY thrown exception bypasses the `stepErrors` accumulation (line 514) and produces a generic error. The workaround (`compile_project_code` + `restart_editor` separately) works because each tool has narrower catch scopes.

#### Tasks

| ID | File | Lines | Change |
|----|------|-------|--------|
| 1.1 | `tools/project-control.ts` | 493-759 | Refactor: wrap each internal step (live_coding, save, build, restart, reconnect) in its own try-catch. Each catch records the error in `stepErrors` and decides whether to continue or abort. |
| 1.2 | `tools/project-control.ts` | 752-759 | Outer catch: include step context (which step was executing), accumulated `stepErrors`, stack trace in error payload. Use `ToolErrorContext` from Phase 0. |
| 1.3 | `tools/project-control.ts` | overall | Ensure `stepErrors` is always included in the final response — both in success path (line 751) and exception path (lines 752-759). |

### Issue #1 — add_component (C++ Squad + TS Squad)

#### Root Cause

`replace_components` calls `ClearComponents()` (line 888) which destroys ALL existing components via `SCS->RemoveNode()`. `patch_component` uses `FindSCSNode()` lookup-only and returns error if component doesn't exist. `BuildComponentTree()` (line 827, `SCS->CreateNode()`) is the ONLY component creation path, called exclusively from `ReplaceComponents`.

#### C++ Tasks

| ID | File | Lines | Change |
|----|------|-------|--------|
| 1.4 | `BlueprintAuthoring.cpp` | after 1036 | New function `AddComponent()`: collect existing component names into `UsedNames`, resolve optional `parentComponentName` to `USCS_Node*`, call `BuildComponentTree()` without `ClearComponents()`. ~50 lines. |
| 1.5 | `BlueprintAuthoring.cpp` | after 1467 | Add dispatch in `ApplyOperation`: `if (Operation == "add_component") { OutMutationFlags |= Structural | Compile; return AddComponent(...); }` |

#### TS Tasks

| ID | File | Lines | Change |
|----|------|-------|--------|
| 1.6 | `schemas/tool-inputs.ts` | 407 | Add `'add_component'` to `BlueprintMemberMutationOperationSchema` enum |
| 1.7 | `tools/blueprint-authoring.ts` | tool help | Update tool description and help text for `modify_blueprint_members` to document `add_component` operation |

#### add_component Payload Schema

```json
{
  "operation": "add_component",
  "payload": {
    "component": {
      "componentName": "MyNewComponent",
      "componentClass": "/Script/Engine.BoxComponent",
      "parentComponentName": "Root",
      "properties": {
        "BoxExtent": {"x": 100, "y": 100, "z": 100}
      },
      "children": []
    }
  }
}
```

### Sync Point

- C++ compile succeeds
- `npm run build` succeeds
- `npm run test:unit` passes
- Manual verification: `add_component` adds component without destroying existing ones
- Manual verification: `sync_project_code` returns step-specific errors instead of "Unknown error"

---

## Phase 2: StateTree Improvements (Sequential)

### Issue #2 — create_state_tree Robustness

#### Root Cause

`Create()` does 2-step validation (preview + real) starting from scratch. When complex C++ USTRUCT payloads fail at `ApplyOperation` stage, errors are swallowed by Subsystem's `MakeErrorJson("Failed to create StateTree")`. The workaround (create minimal + `modify_state_tree` with `replace_tree`) works because Modify starts from an existing validated state with 1-step validation.

#### Tasks

| ID | File | Lines | Change |
|----|------|-------|--------|
| 2.1 | `StateTreeAuthoring.cpp` | 1859-1964 | Improve `Create()`: propagate `ValidationErrors` through each step (schema resolution, preview build, preview compile). Include specific error for each failing nodeStructType. |
| 2.2 | `BlueprintExtractorSubsystem.cpp` | 2431-2456 | Replace `MakeErrorJson("Failed to create StateTree")` with structured error containing all ValidationErrors from FAssetMutationContext. |
| 2.3 | `schema-and-ai-authoring.ts` | 521-603 | Extend MCP-side validation: check `nodeStructType` path format (no F-prefix), validate property names against known patterns, provide hints for common mistakes. |

### Issue #3 — StateTree Input Bindings

#### Root Cause

Complete absence in codebase. Bindings are editor-only metadata in `UStateTreeEditorNode`, not part of serializable state tree structure. Current extraction (`StateTreeExtractor.cpp:234-300`) only exports `nodeStructType`, `nodeProperties`, `instanceStructType`, `instanceProperties` — no binding information.

#### Tasks

| ID | File | Lines | Change |
|----|------|-------|--------|
| 3.1 | `StateTreeExtractor.cpp` | 234-300 | Add binding extraction from `UStateTreeEditorNode`: serialize binding metadata (source task/property -> target task/property mappings) into extraction JSON. |
| 3.2 | `StateTreeAuthoring.cpp` | new function | Add `ApplyBindings()`: deserialize binding JSON -> reconstruct editor node binding setup. Map task output properties to task input properties by name/path. |
| 3.3 | `schemas/tool-inputs.ts` | StateTree section | Add binding schema to StateTree payload: `bindings: [{ sourceTask, sourceProperty, targetTask, targetProperty }]` |
| 3.4 | `schema-and-ai-authoring.ts` | create/modify handlers | Pass bindings in payload to subsystem, validate binding references (task names exist, properties exist). |

#### Binding Payload Schema

```json
{
  "bindings": [
    {
      "sourceTask": "SelectRandomGesture",
      "sourceProperty": "SelectedGestureTag",
      "targetTask": "PlayMontage",
      "targetProperty": "MontageTag"
    }
  ]
}
```

### Sync Point

- C++ compile succeeds
- `npm run build` succeeds
- `npm run test:unit` passes
- Manual verification: `create_state_tree` with C++ USTRUCTs returns detailed errors (not "Unknown error")
- Manual verification: bindings can be specified in JSON and appear in editor

---

## Phase 3: Test Coverage (34% -> 60%+)

### New Tests for Modified Code

| Area | Test File | Tests to Add |
|------|-----------|-------------|
| Error pipeline | `tool-results.test.ts` | `normalizeToolError` with enriched ueResponse payload; error-diagnostics helper; callSubsystemJson error preservation |
| sync_project_code | `project-control.test.ts` | Per-step error accumulation; stepErrors in exception path; each step catch behavior |
| add_component | `blueprint-authoring.test.ts` | Additive creation (existing components preserved); duplicate name handling; parent attachment; missing parent error |
| create_state_tree | `schema-and-ai-authoring.test.ts` | Complex C++ USTRUCT payloads; schema resolution errors with details; validation error propagation |
| StateTree bindings | `schema-and-ai-authoring.test.ts` | Binding serialization roundtrip; invalid binding references; missing task/property errors |

### Existing Coverage Gaps to Close

| Priority | Tool/Area | Current Status |
|----------|----------|---------------|
| HIGH | `register-server-tools.ts` (parameter marshaling) | NOT TESTED |
| HIGH | `project-resolution.ts` (engine root resolution) | NOT TESTED |
| HIGH | `tool-inputs.ts` (input validation schemas) | NOT TESTED |
| MEDIUM | `modify_behavior_tree` | NOT TESTED |
| MEDIUM | `modify_state_tree` (beyond replace_tree) | PARTIAL |
| MEDIUM | `tool-help.ts` (help text generation) | NOT TESTED |

### Coverage Target

- **Current:** 28/83 tools (34%)
- **After Phase 3:** 50+/83 tools (60%+)
- **Test:Source ratio:** maintain 1.3:1 or better

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Issue #3 bindings require deep UE editor internals not exposed via reflection | HIGH | Phase 2 delay | Research UStateTreeEditorNode binding API first; scope down to most common binding patterns |
| C++ compile failures cascade across phases | MEDIUM | All phases blocked | C++ Fixer agent with autonomous compile loop; Phase 0 validates compile pipeline first |
| Existing tests break from error format changes in Phase 0 | MEDIUM | Phase 0 delay | Update existing assertions to match new enriched error structure |
| sync_project_code refactor introduces new failure modes | LOW | Phase 1 regression | Preserve existing test coverage; add per-step tests before refactoring |

---

## Success Criteria

1. All 5 issues resolved or have documented partial solutions with clear remaining work
2. No "Unknown error" messages — all errors include diagnostic context
3. `sync_project_code` works or returns actionable step-specific errors
4. `add_component` appends without destroying existing components
5. `create_state_tree` handles complex C++ payloads or returns detailed validation errors
6. StateTree bindings expressible via JSON (at minimum for common patterns)
7. Test coverage >= 60% of tools
8. All existing tests continue to pass
