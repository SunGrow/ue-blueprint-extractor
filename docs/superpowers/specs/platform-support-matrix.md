# Platform Support Matrix - v1

**Date:** 2026-03-28
**Status:** Phase 0 baseline artifact
**Purpose:** Define what is release-blocking in v1 per platform and capability so support claims stay executable.

---

## Rules

- Linux is the only release-blocking platform for workspace-boundary enforcement.
- macOS and Windows may ship the desktop editor and read-only execution path, but degraded guarantees must be surfaced in UI capabilities and run manifests.
- `workspace-write` fails closed when the current platform/backend combination cannot enforce the configured workspace root.
- `full-access` is explicit opt-in and is not treated as a sandboxed mode.
- Backend availability outside the Linux release gate is surfaced dynamically and is not, by itself, a ship blocker.

## Capability Matrix

| Capability | Linux | macOS | Windows | Release-Blocking |
|---|---|---|---|---|
| Desktop editor shell (Tauri) | Supported | Supported | Supported | No |
| Headless stdio engine | Supported | Supported | Supported | No |
| Canonical draft graph mutation API | Supported | Supported | Supported | Yes |
| Read-only execution path | Supported | Supported with degraded-sandbox disclosure when needed | Supported with degraded-sandbox disclosure when needed | Yes |
| `workspace-write` boundary enforcement | Supported | Best effort only; fail closed when boundary cannot be enforced | Best effort only; fail closed when boundary cannot be enforced | Yes on Linux only |
| `full-access` explicit opt-in mode | Supported | Supported | Supported | No |
| Run manifest generation | Supported | Supported | Supported | Yes |
| Flagship acceptance scenario | Must pass | Informational/non-blocking unless promoted in a later release | Informational/non-blocking unless promoted in a later release | Yes on Linux only |

## Backend Gate Matrix

| Backend | Linux | macOS | Windows | Release-Blocking |
|---|---|---|---|---|
| Claude Code CLI | Targeted | Best effort | Best effort | Linux only |
| Gemini CLI | Targeted | Best effort | Best effort | Linux only |
| Codex CLI | Targeted | Best effort | Best effort | Linux only |
| OpenRouter API | Targeted | Best effort | Best effort | Linux only |

## QA Gate

The v1 release gate is:

1. The flagship acceptance scenario passes on Linux.
2. All four targeted backends satisfy the backend compatibility matrix on Linux.
3. Non-Linux builds disclose degraded sandbox guarantees correctly.
4. `workspace-write` is rejected on any platform/backend combination that cannot enforce the workspace root.
