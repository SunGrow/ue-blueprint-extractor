# Flagship Acceptance Scenario - v1

**Date:** 2026-03-28
**Status:** Phase 0 baseline artifact
**Purpose:** Provide one concrete end-to-end fixture definition that product, QA, engine, and UI all use as the common release gate.

---

## Objective

Run the headline Pipeline Studio workflow without inventing extra runtime semantics:

1. Research a workspace with Claude in read-only mode.
2. Generate output with Gemini via OpenRouter.
3. Review the output with Claude inside a bounded retry loop.
4. Exit the loop through Router -> Break on approval.
5. Apply the approved output with Codex in `workspace-write`.
6. Persist a run manifest.

## Canonical Graph Shape

| Step | Node Type | Key Config | Notes |
|---|---|---|---|
| 1 | LLM Node `Research` | Claude Code CLI, read-only | Root action node |
| 2 | WhileLoop `QualityGateLoop` | `maxIterations = 5`, `condition` unconnected | Implicit-true startup |
| 3 | LLM Node `Generate` | Gemini/OpenRouter, read-only | Inside loop body |
| 4 | LLM Node `Review` | Claude Code CLI, read-only | Inside loop body |
| 5 | Router `QualityDecision` | `approved` vs `retry` conditions over review output | Inside loop body |
| 6 | Break `ExitApprovedLoop` | Triggered only by Router `approved` branch | Inside loop body |
| 7 | LLM Node `Apply` | Codex CLI, `workspace-write` | Runs only after loop exit |

## Required Wiring

- `Research.exec_out -> QualityGateLoop.exec_in`
- `QualityGateLoop.body -> Generate.exec_in`
- `Generate.exec_out -> Review.exec_in`
- `Review.exec_out -> QualityDecision.exec_in`
- `Review.response -> QualityDecision.value`
- `QualityDecision.approved -> ExitApprovedLoop.exec_in`
- `QualityDecision.retry` terminates the loop body region without Break, causing the next iteration
- `Review.response -> Generate.context` for retry feedback
- `QualityGateLoop.completed -> Apply.exec_in`

## Required Assertions

- The loop terminates either through Break on approval or through `maxIterations`.
- No hidden boolean helper node is required for the approval loop.
- Re-running in the same engine session may cache eligible read-only nodes.
- The `Apply` node is never cross-run cached.
- The run manifest records backend versions, defaults, per-node summaries, final status, and `dirtyWorkspace` when applicable.
- On degraded platforms, `workspace-write` fails closed if the workspace boundary cannot be enforced.

## Release Gate

This scenario is release-blocking under the Linux row of [platform-support-matrix.md](/D:/Development/llm-tools/ue-blueprint-extractor/docs/superpowers/specs/platform-support-matrix.md).
