# MCP Issues Fix & Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 5 open MCP issues (error diagnostics, sync_project_code, add_component, StateTree robustness, StateTree bindings) and raise test coverage from 34% to 60%+.

**Architecture:** Foundation-first approach — fix the error pipeline (Phase 0) so all subsequent features produce actionable errors. Then parallel fixes for sync_project_code and add_component (Phase 1). Then sequential StateTree improvements (Phase 2). Finally bulk test coverage (Phase 3). C++ and TS changes run in parallel within each phase.

**Tech Stack:** TypeScript (MCP server, Vitest tests), C++ (UE5.6 Plugin with BlueprintExtractorSubsystem)

**Spec:** `docs/superpowers/specs/2026-03-25-mcp-issues-fix-design.md`

**Rules for implementors:** Read rules from `work-code-building` skill before scaffolding, `work-code-research` before investigating UE APIs, `shared-ue-code` for C++ code. Code reviewer uses rules from `subagent-code-reviewer`.

---

## File Map

### Files to Modify (TS)

| File | Responsibility | Tasks |
|------|---------------|-------|
| `MCP/src/helpers/subsystem.ts` | Subsystem call wrapper, error detection, jsonToolSuccess guard | 1, 2, 4b |
| `MCP/src/helpers/tool-results.ts` | Error/success normalization | 3 |
| `MCP/src/ue-client.ts` | UE Remote Control HTTP client | 4 |
| `MCP/src/tools/project-control.ts` | sync_project_code tool | 7, 8 |
| `MCP/src/schemas/tool-inputs.ts` | Tool input validation schemas | 10 |
| `MCP/src/tools/blueprint-authoring.ts` | Blueprint member mutation tools | 10 |
| `MCP/src/tools/schema-and-ai-authoring.ts` | StateTree create/modify tools | 12, 14 |

### Files to Modify (C++)

| File | Responsibility | Tasks |
|------|---------------|-------|
| `BlueprintExtractor/Source/.../BlueprintExtractorSubsystem.cpp` | Subsystem entry points | 5, 13 |
| `BlueprintExtractor/Source/.../Authoring/StateTreeAuthoring.cpp` | StateTree create/modify | 5, 13, 15 |
| `BlueprintExtractor/Source/.../Authoring/BlueprintAuthoring.cpp` | Blueprint mutations | 5, 9 |
| `BlueprintExtractor/Source/.../Extractors/StateTreeExtractor.cpp` | StateTree extraction | 15 |

### Test Files to Modify/Create

| File | Tasks |
|------|-------|
| `MCP/tests/tool-results.test.ts` | 3 |
| `MCP/tests/subsystem.test.ts` (existing — add tests) | 1, 2, 4b, 17 |
| `MCP/tests/project-control.test.ts` | 7, 8 |
| `MCP/tests/blueprint-authoring.test.ts` | 10 |
| `MCP/tests/schema-and-ai-authoring.test.ts` | 12, 14 |

---

## Phase 0: Error Diagnostics Foundation

### Task 1: callSubsystemJson — catch `{ success: false }` with diagnostics

**Files:**
- Modify: `MCP/src/helpers/subsystem.ts:33-38`
- Test: `MCP/tests/subsystem.test.ts` (existing file — add to it, do NOT overwrite)

- [ ] **Step 1: Write failing test for `{ success: false, diagnostics: [...] }` response**

In `MCP/tests/subsystem.test.ts`, add new tests to the existing `callSubsystemJson` describe block:

```typescript
  it('throws on { success: false } with diagnostics array', async () => {
    const fakeClient = {
      callSubsystem: async () => JSON.stringify({
        success: false,
        diagnostics: [
          { severity: 'error', message: 'Schema class not found: /Script/Foo.BarSchema' },
          { severity: 'error', message: 'nodeStructType not resolved: /Script/Foo.BazTask' },
        ],
      }),
    };

    await expect(callSubsystemJson(fakeClient, 'CreateStateTree', {}))
      .rejects.toThrow('Schema class not found');
  });

  it('passes through { success: false } without diagnostics for orchestration', async () => {
    const fakeClient = {
      callSubsystem: async () => JSON.stringify({
        success: false,
        strategy: 'build_and_restart',
      }),
    };

    const result = await callSubsystemJson(fakeClient, 'SyncProjectCode', {});
    expect(result.success).toBe(false);
    expect(result.strategy).toBe('build_and_restart');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd MCP && npx vitest run tests/subsystem.test.ts --reporter=verbose`
Expected: First test FAILS (no throw), second test PASSES

- [ ] **Step 3: Implement — add diagnostics check in callSubsystemJson**

In `MCP/src/helpers/subsystem.ts`, after the existing `success === false` block (line 38), add:

```typescript
  // Catch structured error responses with diagnostics but no explicit message.
  // These come from FAssetMutationContext.BuildResult(false) in the C++ plugin.
  if (parsed.success === false
    && Array.isArray(parsed.diagnostics)
    && parsed.diagnostics.length > 0) {
    const messages = parsed.diagnostics
      .filter((d: unknown): d is Record<string, unknown> =>
        typeof d === 'object' && d !== null && typeof (d as Record<string, unknown>).message === 'string')
      .map((d: Record<string, unknown>) => d.message as string);
    const synthesized = messages.length > 0
      ? messages.join('; ')
      : `Operation failed with ${parsed.diagnostics.length} diagnostic(s)`;
    const err = new Error(synthesized);
    (err as any).ueResponse = parsed;
    throw err;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd MCP && npx vitest run tests/subsystem.test.ts --reporter=verbose`
Expected: Both new tests PASS, all existing tests PASS

- [ ] **Step 5: Commit**

```bash
cd MCP && git add src/helpers/subsystem.ts tests/subsystem.test.ts
git commit -m "fix: callSubsystemJson throws on {success:false} with diagnostics"
```

---

### Task 2: callSubsystemJson — preserve ueResponse on all thrown errors

**Files:**
- Modify: `MCP/src/helpers/subsystem.ts:26-47`
- Test: `MCP/tests/subsystem.test.ts` (add to existing)

- [ ] **Step 1: Write failing test — thrown error should have ueResponse**

```typescript
it('preserves ueResponse on errors thrown from { error: "..." } responses', async () => {
  const fakeClient = {
    callSubsystem: async () => JSON.stringify({
      error: 'Component not found',
      errorCode: 'COMPONENT_NOT_FOUND',
      details: { componentName: 'Foo' },
    }),
  };

  try {
    await callSubsystemJson(fakeClient, 'PatchComponent', {});
    expect.fail('Should have thrown');
  } catch (err: any) {
    expect(err.message).toBe('Component not found');
    expect(err.ueResponse).toBeDefined();
    expect(err.ueResponse.errorCode).toBe('COMPONENT_NOT_FOUND');
    expect(err.ueResponse.details).toEqual({ componentName: 'Foo' });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd MCP && npx vitest run tests/tool-results.test.ts --reporter=verbose`
Expected: FAIL — `err.ueResponse` is undefined

- [ ] **Step 3: Implement — attach ueResponse to all thrown errors**

In `MCP/src/helpers/subsystem.ts`, modify the three existing throw points:

```typescript
  // Line 26-28: Replace:
  if (typeof parsed.error === 'string' && parsed.error.length > 0) {
    const err = new Error(parsed.error);
    (err as any).ueResponse = parsed;
    throw err;
  }

  // Lines 33-37: Replace:
  if (parsed.success === false) {
    const explicitMessage = parsed.message ?? parsed.errorMessage;
    if (typeof explicitMessage === 'string' && explicitMessage.length > 0) {
      const err = new Error(explicitMessage);
      (err as any).ueResponse = parsed;
      throw err;
    }
  }

  // Lines 40-43: Replace:
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    const err = new Error(typeof firstError === 'string' ? firstError : JSON.stringify(firstError));
    (err as any).ueResponse = parsed;
    throw err;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd MCP && npx vitest run tests/tool-results.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd MCP && git add src/helpers/subsystem.ts tests/tool-results.test.ts
git commit -m "fix: preserve full ueResponse on all callSubsystemJson errors"
```

---

### Task 3: normalizeToolError — extract diagnostics from ueResponse

**Files:**
- Modify: `MCP/src/helpers/tool-results.ts:98-186`
- Test: `MCP/tests/tool-results.test.ts`

- [ ] **Step 1: Write failing test — Error with ueResponse.diagnostics**

```typescript
it('extracts diagnostics from Error.ueResponse when available', () => {
  const err = new Error('Schema class not found');
  (err as any).ueResponse = {
    success: false,
    diagnostics: [
      { severity: 'error', code: 'SCHEMA_NOT_FOUND', message: 'Schema class not found: /Script/Foo.Bar' },
      { severity: 'warning', message: 'F-prefix was auto-normalized' },
    ],
  };

  const result = normalizeToolError('create_state_tree', err);
  const structured = result.structuredContent as Record<string, unknown>;
  expect(structured.diagnostics).toHaveLength(2);
  expect((structured.diagnostics as any[])[0].code).toBe('SCHEMA_NOT_FOUND');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd MCP && npx vitest run tests/tool-results.test.ts --reporter=verbose`
Expected: FAIL — diagnostics is empty or undefined

- [ ] **Step 3: Implement — extract ueResponse diagnostics in normalizeToolError**

In `MCP/src/helpers/tool-results.ts`, inside `normalizeToolError()`, after line 106 (`diagnostics` assignment), add:

```typescript
    // Merge diagnostics from ueResponse if the error carries one (set by callSubsystemJson).
    if (
      diagnostics.length === 0
      && payloadOrError instanceof Error
      && isRecord((payloadOrError as any).ueResponse)
    ) {
      const ueResp = (payloadOrError as any).ueResponse as Record<string, unknown>;
      if (Array.isArray(ueResp.diagnostics)) {
        diagnostics.push(...ueResp.diagnostics);
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd MCP && npx vitest run tests/tool-results.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd MCP && git add src/helpers/tool-results.ts tests/tool-results.test.ts
git commit -m "fix: normalizeToolError extracts diagnostics from Error.ueResponse"
```

---

### Task 4: ue-client.ts — include response body in formatCallFailure

**Files:**
- Modify: `MCP/src/ue-client.ts:164-180`

- [ ] **Step 1: Read the current formatCallFailure and rawCall methods**

Verify exact line numbers and the `RawCallResult` type definition.

- [ ] **Step 2: Add `responseBody` field to `RawCallResult` type**

The `RawCallResult` interface at `ue-client.ts:19-24` currently has `response`, `status`, `error`, `timedOut` — no raw body field. Add one:

```typescript
interface RawCallResult {
  response: RemoteCallResponse | null;
  status?: number;
  error?: string;
  timedOut?: boolean;
  responseBody?: string;  // Raw response text for error diagnostics
}
```

- [ ] **Step 3: Capture raw response text in `rawCall()`**

In the `rawCall()` method (line 182+), after `const text = await res.text()`, store it in the result:

Find the line where `RawCallResult` is constructed and add `responseBody: text` (or the raw text variable name).

- [ ] **Step 4: Use responseBody in formatCallFailure**

In `formatCallFailure()`, before the return statement (line 179), add:

```typescript
    if (typeof result.responseBody === 'string' && result.responseBody.length > 0) {
      const truncated = result.responseBody.length > 500
        ? result.responseBody.slice(0, 500) + '…'
        : result.responseBody;
      details.push(`body=${truncated}`);
    }
```

- [ ] **Step 5: Build to verify no type errors**

Run: `cd MCP && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd MCP && git add src/ue-client.ts
git commit -m "fix: include truncated response body in UE client error messages"
```

---

### Task 4b: Tool handler audit — guard jsonToolSuccess against `{ success: false }`

**Files:**
- Modify: `MCP/src/helpers/subsystem.ts` (jsonToolSuccess function)
- Test: `MCP/tests/subsystem.test.ts`

This covers **spec task 0.6**. Multiple tool handlers call `jsonToolSuccess(result)` without checking `result.success`. The simplest fix is to add a guard inside `jsonToolSuccess` itself (similar to how `normalizeToolSuccess` in `tool-results.ts:196-197` delegates to `normalizeToolError` on `success === false`).

- [ ] **Step 1: Write failing test — jsonToolSuccess should reject `{ success: false }`**

In `MCP/tests/subsystem.test.ts`, add:

```typescript
describe('jsonToolSuccess', () => {
  it('returns isError when passed { success: false } payload', () => {
    const result = jsonToolSuccess({
      success: false,
      diagnostics: [{ message: 'Schema not found' }],
    });
    expect(result.isError).toBe(true);
  });

  it('passes through { success: true } normally', () => {
    const result = jsonToolSuccess({ success: true, data: 'ok' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ success: true, data: 'ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd MCP && npx vitest run tests/subsystem.test.ts --reporter=verbose`
Expected: First test FAILS — `isError` is undefined

- [ ] **Step 3: Implement — add success check in jsonToolSuccess**

In `MCP/src/helpers/subsystem.ts`, modify `jsonToolSuccess` (lines 52-63):

```typescript
export function jsonToolSuccess(
  parsed: unknown,
  options: {
    extraContent?: ContentBlock[];
  } = {},
): CallToolResult & { structuredContent: Record<string, unknown> } {
  const structuredContent = isRecord(parsed) ? parsed : { data: parsed };

  // Guard: if the UE response indicates failure, route through error path.
  // This prevents tool handlers from accidentally passing error payloads as successes.
  if (isRecord(parsed) && parsed.success === false) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${typeof parsed.message === 'string' ? parsed.message : 'Operation failed'}` }],
      structuredContent,
      isError: true,
    };
  }

  return {
    content: options.extraContent ? [...options.extraContent] : [],
    structuredContent,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd MCP && npx vitest run tests/subsystem.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Run full test suite — check for regressions**

Run: `cd MCP && npm run test:unit`
Expected: All tests pass. Some tools intentionally pass `{ success: false }` structured results for orchestration (e.g., `sync_project_code`). If tests fail, check whether the tool handler relies on `jsonToolSuccess` passing through `success: false` — those handlers should switch to checking `success` before calling `jsonToolSuccess`.

- [ ] **Step 6: Commit**

```bash
cd MCP && git add src/helpers/subsystem.ts tests/subsystem.test.ts
git commit -m "fix: jsonToolSuccess guards against { success: false } payloads"
```

---

### Task 5: C++ — audit error propagation in Subsystem and Authoring files

**Files:**
- Audit: `BlueprintExtractor/Source/.../BlueprintExtractorSubsystem.cpp:2450-2453`
- Audit: `BlueprintExtractor/Source/.../Authoring/StateTreeAuthoring.cpp:1859-1964`
- Audit: `BlueprintExtractor/Source/.../Authoring/BlueprintAuthoring.cpp:1429-1496`

- [ ] **Step 1: Read BlueprintExtractorSubsystem.cpp CreateStateTree**

Read lines 2431-2456. Verify whether `MakeErrorJson("Failed to create StateTree")` is dead code (i.e., `FAssetMutationContext.BuildResult(false)` always returns a valid pointer).

- [ ] **Step 2: Read StateTreeAuthoring.cpp Create()**

Read lines 1859-1964. Verify each error path populates `FAssetMutationContext` with step-specific diagnostics.

- [ ] **Step 3: Read BlueprintAuthoring.cpp ApplyOperation()**

Read lines 1429-1496. Verify all operations propagate `OutErrors` through `FAssetMutationContext`.

- [ ] **Step 4: Document findings**

If C++ already correctly propagates errors (as the spec review concluded), document this in a comment at the top of this task: "C++ error propagation verified — no changes needed. The bug is entirely in the TS layer." If issues are found, create follow-up tasks.

- [ ] **Step 5: If dead code found, remove it**

If `MakeErrorJson("Failed to create StateTree")` at line 2452 is confirmed dead code, either remove it or convert to a safety fallback:

```cpp
// Safety fallback — BuildResult should always return a valid pointer,
// but guard against edge cases where the context is somehow empty.
if (!Result.IsValid())
{
    TSharedPtr<FJsonObject> Fallback = MakeShared<FJsonObject>();
    Fallback->SetBoolField(TEXT("success"), false);
    Fallback->SetStringField(TEXT("error"), TEXT("StateTree creation failed with no diagnostic context"));
    return SerializeJsonObject(Fallback);
}
```

- [ ] **Step 6: Compile C++ to verify**

Run the UE build (via `compile_project_code` MCP tool or manual UBT invocation).

- [ ] **Step 7: Commit if changes were made**

```bash
git add BlueprintExtractor/
git commit -m "fix: clean up dead error code in CreateStateTree subsystem"
```

---

### Task 6: Phase 0 sync point verification

- [ ] **Step 1: Run full TS build**

Run: `cd MCP && npm run build`
Expected: No errors

- [ ] **Step 2: Run full unit test suite**

Run: `cd MCP && npm run test:unit`
Expected: All tests pass (including new tests from Tasks 1-3)

- [ ] **Step 3: Verify error enrichment works end-to-end**

If UE Editor is running, call a tool that would have previously returned "Unknown error" and verify it now returns structured diagnostics.

- [ ] **Step 4: Commit any remaining changes**

---

## Phase 1: Parallel Fixes

### Task 7: sync_project_code — refactor outer catch to preserve stepErrors

**Files:**
- Modify: `MCP/src/tools/project-control.ts:752-759`
- Test: `MCP/tests/project-control.test.ts`

- [ ] **Step 1: Write failing test — outer catch should include stepErrors**

In `MCP/tests/project-control.test.ts`, find the sync_project_code test section and add:

```typescript
it('includes accumulated stepErrors in outer catch error payload', async () => {
  // Mock: resolveProjectInputs succeeds, classifyChangedPaths returns build_and_restart,
  // but compileProjectCode throws an unexpected error
  const callSubsystemJson = vi.fn()
    .mockRejectedValueOnce(new Error('Unexpected subsystem crash'));

  // Register tool and invoke...
  // The result should contain stepErrors and failedStep context
  const result = await registry.getTool('sync_project_code').handler({
    changed_paths: ['/some/path.cpp'],
    force_rebuild: true,
    // ... other required args
  });

  const parsed = parseDirectToolResult(result);
  expect(parsed).toHaveProperty('stepErrors');
  expect(parsed).toHaveProperty('failedStep');
});
```

Note: Adapt this test to match the existing test setup pattern in `project-control.test.ts`. Read the file first to understand how `sync_project_code` tests are structured (mock setup, registry pattern, etc.).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd MCP && npx vitest run tests/project-control.test.ts --reporter=verbose`
Expected: FAIL — no `stepErrors` or `failedStep` in error result

- [ ] **Step 3: Implement — refactor outer catch**

In `MCP/src/tools/project-control.ts`, replace the outer catch block (lines 752-759):

```typescript
      } catch (error) {
        // Preserve accumulated step context even in unhandled exception path.
        const resolved = await resolveProjectInputs({ engine_root, project_path, target }).catch(() => ({}));
        const errorMessage = error instanceof Error ? error.message : String(error);
        const failurePayload: Record<string, unknown> = {
          success: false,
          operation: 'sync_project_code',
          message: explainProjectResolutionFailure(errorMessage, resolved as any),
          failedStep: 'unknown',
          stepErrors,
          changedPaths: changed_paths,
        };
        if (error instanceof Error && error.stack) {
          failurePayload.stack = error.stack;
        }
        return jsonToolError(failurePayload);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd MCP && npx vitest run tests/project-control.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd MCP && git add src/tools/project-control.ts tests/project-control.test.ts
git commit -m "fix: sync_project_code outer catch preserves stepErrors and failedStep"
```

---

### Task 8: sync_project_code — add failedStep tracking

**Files:**
- Modify: `MCP/src/tools/project-control.ts:493-751`
- Test: `MCP/tests/project-control.test.ts`

- [ ] **Step 1: Write failing test — result should identify which step failed**

```typescript
it('identifies failedStep when build step throws', async () => {
  // Setup: mock resolveProjectInputs success, classifyChangedPaths returns build_and_restart,
  // compileProjectCode throws
  // ...
  const parsed = parseDirectToolResult(result);
  expect(parsed.failedStep).toBe('build');
  expect(parsed.stepErrors).toHaveProperty('build');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd MCP && npx vitest run tests/project-control.test.ts --reporter=verbose`

- [ ] **Step 3: Implement — add currentStep tracking variable**

At line 514 (after `const stepErrors`), add:

```typescript
        let currentStep = 'init';
```

Then before each major block, set `currentStep`:
- Before live_coding: `currentStep = 'live_coding';`
- Before pre-save: `currentStep = 'pre_save';`
- Before pre-restart: `currentStep = 'pre_restart';`
- Before build: `currentStep = 'build';`
- Before save: `currentStep = 'save';`
- Before restart: `currentStep = 'restart';`
- Before reconnect: `currentStep = 'reconnect';`

And in the outer catch, replace `'unknown'` with `currentStep`:
```typescript
          failedStep: currentStep,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd MCP && npx vitest run tests/project-control.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd MCP && git add src/tools/project-control.ts tests/project-control.test.ts
git commit -m "fix: sync_project_code tracks currentStep for error diagnostics"
```

---

### Task 9: C++ — implement AddComponent in BlueprintAuthoring.cpp

**Files:**
- Modify: `BlueprintExtractor/Source/.../Authoring/BlueprintAuthoring.cpp`

- [ ] **Step 1: Read existing code**

Read `BlueprintAuthoring.cpp`:
- `BuildComponentTree()` (lines 771-876) — understand the component creation API
- `PatchComponent()` (lines 964-1036) — understand the lookup pattern
- `ApplyOperation()` (lines 1429-1496) — understand the dispatch pattern

- [ ] **Step 2: Implement AddComponent function**

After `PatchComponent()` (after line 1036), add:

```cpp
static bool AddComponent(UBlueprint* Blueprint,
                         const TSharedPtr<FJsonObject>& Payload,
                         TArray<FString>& OutErrors)
{
    if (!Blueprint || !Blueprint->SimpleConstructionScript)
    {
        OutErrors.Add(TEXT("Blueprint does not support component authoring (no SimpleConstructionScript)."));
        return false;
    }

    USCS_Node* ParentNode = nullptr;
    FString ParentComponentName;
    if (Payload->TryGetStringField(TEXT("parentComponentName"), ParentComponentName)
        && !ParentComponentName.IsEmpty())
    {
        ParentNode = Blueprint->SimpleConstructionScript->FindSCSNode(FName(*ParentComponentName));
        if (!ParentNode)
        {
            OutErrors.Add(FString::Printf(TEXT("Parent component '%s' was not found."), *ParentComponentName));
            return false;
        }
    }

    // Collect existing component names to avoid duplicates
    TSet<FName> UsedNames;
    for (USCS_Node* Node : Blueprint->SimpleConstructionScript->GetAllNodes())
    {
        if (Node)
        {
            UsedNames.Add(Node->GetVariableName());
        }
    }

    // Use the component definition from payload — either nested under "component" or the payload itself
    const TSharedPtr<FJsonObject>* ComponentObject = nullptr;
    TSharedPtr<FJsonObject> EffectivePayload = Payload;
    if (Payload->TryGetObjectField(TEXT("component"), ComponentObject)
        && ComponentObject && (*ComponentObject).IsValid())
    {
        EffectivePayload = *ComponentObject;
    }

    return BuildComponentTree(Blueprint, ParentNode, EffectivePayload, UsedNames, OutErrors);
}
```

- [ ] **Step 3: Add dispatch in ApplyOperation**

After the `patch_component` dispatch block (around line 1467), add:

```cpp
    if (Operation == TEXT("add_component"))
    {
        OutMutationFlags |= EBlueprintMutationFlags::Structural | EBlueprintMutationFlags::Compile;
        return AddComponent(Blueprint, Payload, OutErrors);
    }
```

- [ ] **Step 4: Compile C++**

Build via UBT or `compile_project_code` MCP tool. Fix any compile errors.

- [ ] **Step 5: Commit**

```bash
git add BlueprintExtractor/
git commit -m "feat: add add_component operation to modify_blueprint_members"
```

---

### Task 10: TS — add add_component to schema and tool help

**Files:**
- Modify: `MCP/src/schemas/tool-inputs.ts:407-415`
- Modify: `MCP/src/tools/blueprint-authoring.ts`
- Test: `MCP/tests/blueprint-authoring.test.ts`

- [ ] **Step 1: Write failing test — add_component should be a valid operation**

```typescript
it('accepts add_component operation and passes payload to subsystem', async () => {
  const callSubsystemJson = vi.fn(async () => ({ success: true }));
  // register tools, get handler...

  const result = await registry.getTool('modify_blueprint_members').handler({
    asset_path: '/Game/Test/BP_Test',
    operation: 'add_component',
    payload: {
      component: {
        componentName: 'TestComp',
        componentClass: '/Script/Engine.BoxComponent',
      },
    },
  });

  expect(callSubsystemJson).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      Operation: 'add_component',
    }),
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd MCP && npx vitest run tests/blueprint-authoring.test.ts --reporter=verbose`
Expected: FAIL — Zod validation rejects `add_component` as invalid enum value

- [ ] **Step 3: Add add_component to schema enum**

In `MCP/src/schemas/tool-inputs.ts`, line 407-415:

```typescript
export const BlueprintMemberMutationOperationSchema = z.enum([
  'replace_variables',
  'patch_variable',
  'replace_components',
  'patch_component',
  'add_component',
  'replace_function_stubs',
  'patch_class_defaults',
  'compile',
]);
```

- [ ] **Step 4: Update tool description in blueprint-authoring.ts**

Find the `modify_blueprint_members` tool description and add `add_component` to the list of operations. Read the file first to find the exact location.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd MCP && npx vitest run tests/blueprint-authoring.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Build TS**

Run: `cd MCP && npm run build`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd MCP && git add src/schemas/tool-inputs.ts src/tools/blueprint-authoring.ts tests/blueprint-authoring.test.ts
git commit -m "feat: add add_component operation to blueprint member mutation schema"
```

---

### Task 11: Phase 1 sync point verification

- [ ] **Step 1: Run full TS build**

Run: `cd MCP && npm run build`

- [ ] **Step 2: Run full unit test suite**

Run: `cd MCP && npm run test:unit`
Expected: All tests pass

- [ ] **Step 3: Verify C++ compiles**

Build via UBT.

- [ ] **Step 4: Commit any remaining changes**

---

## Phase 2: StateTree Improvements

### Task 12: create_state_tree — extend MCP-side validation

**Files:**
- Modify: `MCP/src/tools/schema-and-ai-authoring.ts:521-603`
- Test: `MCP/tests/schema-and-ai-authoring.test.ts`

- [ ] **Step 1: Write failing test — validation should catch common mistakes**

```typescript
it('returns validation warning when nodeStructType uses F-prefix that cannot be auto-fixed', async () => {
  // Setup with a payload that has a nodeStructType with unusual pattern
  const callSubsystemJson = vi.fn(async () => ({ success: true }));
  // ...register tools...

  const result = await registry.getTool('create_state_tree').handler({
    asset_path: '/Game/Test/ST_Test',
    payload: {
      schema: '/Script/Test.TestSchema',
      states: [{
        name: 'Root',
        type: 'State',
        children: [{
          name: 'Test',
          type: 'State',
          tasks: [{
            nodeStructType: '/Script/Test.FInvalidTask',
            name: 'TestTask',
          }],
        }],
      }],
    },
  });

  // The F-prefix should be auto-normalized and a warning emitted
  expect(callSubsystemJson).toHaveBeenCalled();
  const callArgs = callSubsystemJson.mock.calls[0];
  const payload = JSON.parse(callArgs[1].PayloadJson as string);
  expect(payload.states[0].children[0].tasks[0].nodeStructType).toBe('/Script/Test.InvalidTask');
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `cd MCP && npx vitest run tests/schema-and-ai-authoring.test.ts --reporter=verbose`
Note: This may already pass if F-prefix normalization is implemented. Check and add additional validation tests as needed.

- [ ] **Step 3: Implement additional validation**

Read `MCP/src/tools/schema-and-ai-authoring.ts:521-603` and add:
- Validation that `nodeStructType` paths match `/Script/...` pattern
- Warning when task/condition names might conflict
- Better error message synthesis from validation warnings

- [ ] **Step 4: Run tests**

Run: `cd MCP && npx vitest run tests/schema-and-ai-authoring.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd MCP && git add src/tools/schema-and-ai-authoring.ts tests/schema-and-ai-authoring.test.ts
git commit -m "feat: extend create_state_tree MCP-side validation"
```

---

### Task 13: C++ — improve StateTree Create() error propagation

**Files:**
- Modify: `BlueprintExtractor/Source/.../Authoring/StateTreeAuthoring.cpp:1859-1964`
- Modify: `BlueprintExtractor/Source/.../BlueprintExtractorSubsystem.cpp:2431-2456`

- [ ] **Step 1: Read StateTreeAuthoring.cpp Create()**

Read lines 1859-1964. Identify each error path and verify `FAssetMutationContext` is populated with step-specific info.

- [ ] **Step 2: Enhance error messages in Create()**

For each step that can fail, ensure the error message includes:
- Which step failed (schema resolution, preview validation, asset creation, compile)
- What specific entity caused the failure (nodeStructType path, property name)
- The step number in the sequence

Example enhancement at the schema resolution step:

```cpp
if (!SchemaClass)
{
    Context.AddError(FString::Printf(
        TEXT("[Step 1/4: Schema Resolution] Schema class '%s' could not be resolved. "
             "Ensure the class is compiled and loaded."),
        *SchemaPath));
    return Context.BuildResult(false);
}
```

- [ ] **Step 3: Improve Subsystem.cpp CreateStateTree error path**

At lines 2450-2453, ensure the result always carries structured errors:

```cpp
// After FStateTreeAuthoring::Create returns:
if (!Result.IsValid())
{
    // Safety fallback — should not happen since BuildResult always returns valid pointer
    TSharedPtr<FJsonObject> Fallback = MakeShared<FJsonObject>();
    Fallback->SetBoolField(TEXT("success"), false);
    Fallback->SetStringField(TEXT("error"),
        TEXT("StateTree creation failed with no diagnostic context — this is a bug, please report"));
    return SerializeJsonObject(Fallback);
}
```

- [ ] **Step 4: Compile C++**

Build via UBT. Fix any compile errors.

- [ ] **Step 5: Commit**

```bash
git add BlueprintExtractor/
git commit -m "fix: enrich StateTree Create() error messages with step context"
```

---

### Task 14: TS — StateTree binding schema (placeholder)

**Files:**
- Modify: `MCP/src/schemas/tool-inputs.ts`
- Modify: `MCP/src/tools/schema-and-ai-authoring.ts`
- Test: `MCP/tests/schema-and-ai-authoring.test.ts`

> **Note:** Issue #3 (bindings) requires deep C++ editor integration that may not be feasible without UE research. This task adds the TS schema and validation, preparing for C++ implementation.

- [ ] **Step 1: Write test — binding schema should be accepted in payload**

```typescript
it('accepts bindings array in create_state_tree payload', async () => {
  const callSubsystemJson = vi.fn(async () => ({ success: true }));
  // ...register tools...

  const result = await registry.getTool('create_state_tree').handler({
    asset_path: '/Game/Test/ST_Test',
    payload: {
      schema: '/Script/Test.TestSchema',
      states: [{ name: 'Root', type: 'State' }],
      bindings: [{
        sourceTask: 'SelectGesture',
        sourceProperty: 'SelectedTag',
        targetTask: 'PlayMontage',
        targetProperty: 'MontageTag',
      }],
    },
  });

  // Bindings should be passed through to subsystem
  expect(callSubsystemJson).toHaveBeenCalled();
  const callArgs = callSubsystemJson.mock.calls[0];
  const payload = JSON.parse(callArgs[1].PayloadJson as string);
  expect(payload.bindings).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd MCP && npx vitest run tests/schema-and-ai-authoring.test.ts --reporter=verbose`
Note: If the payload is passed through without schema validation, this may already pass. If Zod strips unknown fields, add `bindings` to the schema.

- [ ] **Step 3: Implement — add bindings to payload passthrough**

Ensure the `create_state_tree` and `modify_state_tree` handlers preserve `bindings` array in the payload sent to the subsystem. If payload is Zod-validated and strips unknowns, add:

```typescript
// In tool-inputs.ts, add to StateTree payload schema:
bindings: z.array(z.object({
  sourceTask: z.string(),
  sourceProperty: z.string(),
  targetTask: z.string(),
  targetProperty: z.string(),
})).optional().describe('Task output-to-input bindings (requires C++ plugin support)'),
```

- [ ] **Step 4: Add validation for binding references**

In `schema-and-ai-authoring.ts`, in the create/modify handlers, validate that `sourceTask` and `targetTask` names exist in the `states` array's tasks.

- [ ] **Step 5: Run tests**

Run: `cd MCP && npx vitest run tests/schema-and-ai-authoring.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd MCP && git add src/schemas/tool-inputs.ts src/tools/schema-and-ai-authoring.ts tests/schema-and-ai-authoring.test.ts
git commit -m "feat: add StateTree binding schema (TS side, C++ pending)"
```

---

### Task 15: C++ — StateTree binding extraction and application (research-dependent)

**Files:**
- Modify: `BlueprintExtractor/Source/.../Extractors/StateTreeExtractor.cpp:234-300`
- Modify: `BlueprintExtractor/Source/.../Authoring/StateTreeAuthoring.cpp`

> **HIGH RISK:** This task requires research into `UStateTreeEditorNode` binding internals. The implementor MUST use `work-code-research` skill to dispatch `subagent-ue-researcher` BEFORE writing code.

- [ ] **Step 1: Research UStateTreeEditorNode binding API**

Use `work-code-research` skill. Questions to answer:
1. How are task input/output bindings stored in `UStateTreeEditorNode`?
2. What API is available for reading/writing bindings?
3. Can bindings be reconstructed from JSON without editor UI?
4. What UE version introduced the current binding API?

- [ ] **Step 2: Implement extraction (if feasible)**

In `StateTreeExtractor.cpp:234-300`, add binding data to the extracted JSON. The exact implementation depends on research findings.

- [ ] **Step 3: Implement application (if feasible)**

In `StateTreeAuthoring.cpp`, add `ApplyBindings()` function. The exact implementation depends on research findings.

- [ ] **Step 4: If NOT feasible, document limitations**

Create a note in the issues file explaining what's needed for binding support and what UE API gaps exist.

- [ ] **Step 5: Compile and commit**

```bash
git add BlueprintExtractor/
git commit -m "feat: StateTree binding extraction/application (or docs if infeasible)"
```

---

### Task 16: Phase 2 sync point verification

- [ ] **Step 1: Run full TS build**

Run: `cd MCP && npm run build`

- [ ] **Step 2: Run full unit test suite**

Run: `cd MCP && npm run test:unit`

- [ ] **Step 3: Verify C++ compiles**

- [ ] **Step 4: Commit any remaining changes**

---

## Phase 3: Test Coverage

### Task 17: Write tests for error pipeline (tool-results, subsystem)

**Files:**
- Modify: `MCP/tests/subsystem.test.ts` (already exists — add missing tests, do NOT overwrite)
- Modify: `MCP/tests/tool-results.test.ts`

- [ ] **Step 1: Add missing tests to existing subsystem.test.ts**

Read `MCP/tests/subsystem.test.ts` first to see what's already covered. Then add only tests not already present. Likely missing tests:

```typescript
import { describe, expect, it } from 'vitest';
import { callSubsystemJson, jsonToolSuccess, jsonToolError, normalizeUStructPath } from '../src/helpers/subsystem.js';

describe('callSubsystemJson', () => {
  const makeClient = (response: unknown) => ({
    callSubsystem: async () => JSON.stringify(response),
  });

  it('returns parsed JSON on success', async () => {
    const result = await callSubsystemJson(makeClient({ success: true, data: 'test' }), 'Method', {});
    expect(result).toEqual({ success: true, data: 'test' });
  });

  it('throws on { error: "message" }', async () => {
    await expect(callSubsystemJson(makeClient({ error: 'fail' }), 'M', {}))
      .rejects.toThrow('fail');
  });

  it('throws on { success: false, message: "..." }', async () => {
    await expect(callSubsystemJson(makeClient({ success: false, message: 'nope' }), 'M', {}))
      .rejects.toThrow('nope');
  });

  it('throws on { errors: ["a", "b"] }', async () => {
    await expect(callSubsystemJson(makeClient({ errors: ['first', 'second'] }), 'M', {}))
      .rejects.toThrow('first');
  });

  it('throws on empty response', async () => {
    await expect(callSubsystemJson(makeClient({}), 'M', {}))
      .rejects.toThrow('Empty response');
  });

  it('preserves ueResponse on thrown errors', async () => {
    try {
      await callSubsystemJson(makeClient({ error: 'x', extra: 'data' }), 'M', {});
    } catch (err: any) {
      expect(err.ueResponse).toEqual({ error: 'x', extra: 'data' });
    }
  });

  it('throws on { success: false, diagnostics: [...] }', async () => {
    await expect(callSubsystemJson(makeClient({
      success: false,
      diagnostics: [{ message: 'Schema not found' }],
    }), 'M', {})).rejects.toThrow('Schema not found');
  });

  it('passes through { success: false } without message or diagnostics', async () => {
    const result = await callSubsystemJson(makeClient({ success: false, plan: {} }), 'M', {});
    expect(result.success).toBe(false);
  });
});

describe('jsonToolSuccess', () => {
  it('wraps record in structuredContent', () => {
    const result = jsonToolSuccess({ foo: 'bar' });
    expect(result.structuredContent).toEqual({ foo: 'bar' });
    expect(result.content).toEqual([]);
  });

  it('wraps non-record in { data: value }', () => {
    const result = jsonToolSuccess('hello');
    expect(result.structuredContent).toEqual({ data: 'hello' });
  });
});

describe('jsonToolError', () => {
  it('formats Error objects', () => {
    const result = jsonToolError(new Error('boom'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: boom');
  });

  it('formats string errors', () => {
    const result = jsonToolError('oops');
    expect(result.content[0].text).toBe('Error: oops');
  });
});

describe('normalizeUStructPath', () => {
  it('strips F prefix from USTRUCT path', () => {
    expect(normalizeUStructPath('/Script/Module.FMyStruct')).toBe('/Script/Module.MyStruct');
  });

  it('does not strip F from non-struct names', () => {
    expect(normalizeUStructPath('/Script/Module.Foo')).toBe('/Script/Module.Foo');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd MCP && npx vitest run tests/subsystem.test.ts --reporter=verbose`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
cd MCP && git add tests/subsystem.test.ts tests/tool-results.test.ts
git commit -m "test: comprehensive tests for callSubsystemJson and error normalization"
```

---

### Task 18: Write tests for sync_project_code error paths

**Files:**
- Modify: `MCP/tests/project-control.test.ts`

- [ ] **Step 1: Read existing sync_project_code tests**

Read `MCP/tests/project-control.test.ts` to understand existing test patterns and mock setup.

- [ ] **Step 2: Add tests for step error accumulation**

Add tests covering:
- Each step (live_coding, save, build, restart, reconnect) failing individually
- `stepErrors` present in both success and error responses
- `currentStep` / `failedStep` correctly identifies the failing step
- Outer catch preserves accumulated stepErrors from earlier steps

- [ ] **Step 3: Run tests**

Run: `cd MCP && npx vitest run tests/project-control.test.ts --reporter=verbose`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
cd MCP && git add tests/project-control.test.ts
git commit -m "test: sync_project_code step error accumulation and failedStep tracking"
```

---

### Task 19: Write tests for add_component

**Files:**
- Modify: `MCP/tests/blueprint-authoring.test.ts`

- [ ] **Step 1: Read existing blueprint-authoring tests**

Read `MCP/tests/blueprint-authoring.test.ts` to understand test patterns.

- [ ] **Step 2: Add add_component tests**

```typescript
describe('add_component', () => {
  it('sends add_component operation to subsystem', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    // ...setup...
    const result = await registry.getTool('modify_blueprint_members').handler({
      asset_path: '/Game/BP_Test',
      operation: 'add_component',
      payload: {
        component: {
          componentName: 'NewComp',
          componentClass: '/Script/Engine.StaticMeshComponent',
        },
      },
    });
    expect(callSubsystemJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ Operation: 'add_component' }),
      expect.anything(),
    );
  });

  it('passes parentComponentName in payload', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    // ...setup...
    const result = await registry.getTool('modify_blueprint_members').handler({
      asset_path: '/Game/BP_Test',
      operation: 'add_component',
      payload: {
        component: {
          componentName: 'Child',
          componentClass: '/Script/Engine.BoxComponent',
          parentComponentName: 'Root',
        },
      },
    });
    const payload = callSubsystemJson.mock.calls[0][1];
    expect(JSON.parse(payload.PayloadJson as string)).toHaveProperty('component.parentComponentName', 'Root');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd MCP && npx vitest run tests/blueprint-authoring.test.ts --reporter=verbose`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
cd MCP && git add tests/blueprint-authoring.test.ts
git commit -m "test: add_component operation contract tests"
```

---

### Task 20: Write tests for existing coverage gaps

**Files:**
- Create or modify test files for untested tools

- [ ] **Step 1: Read TEST_COVERAGE_AUDIT.md for gap list**

Read `MCP/TEST_COVERAGE_AUDIT.md` to identify the highest-priority untested tools.

- [ ] **Step 2: Write tests for HIGH priority gaps**

Focus on:
- `project-resolution.ts` — engine root/project path resolution
- `tool-help.ts` — help text generation
- Additional `create_*` and `modify_*` tools

Follow the existing test patterns from `tool-module-test-helpers.ts`.

- [ ] **Step 3: Run full test suite**

Run: `cd MCP && npm run test:unit`
Expected: All PASS

- [ ] **Step 4: Check coverage count**

Count tested tools vs total. Target: 50+/83 (60%+).

- [ ] **Step 5: Commit**

```bash
cd MCP && git add tests/
git commit -m "test: close high-priority coverage gaps (target 60%+)"
```

---

### Task 21: Final verification

- [ ] **Step 1: Run full TS build**

Run: `cd MCP && npm run build`

- [ ] **Step 2: Run full test suite**

Run: `cd MCP && npm run test:unit`

- [ ] **Step 3: Verify C++ compiles**

- [ ] **Step 4: Run coverage report if available**

Run: `cd MCP && npx vitest run --coverage` (if configured)

- [ ] **Step 5: Final commit**

```bash
git commit -m "chore: MCP issues fix complete — all 5 issues addressed, test coverage 60%+"
```
