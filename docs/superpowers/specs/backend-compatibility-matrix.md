# Backend Compatibility Matrix - v1

**Date:** 2026-03-28
**Status:** Phase 0 baseline artifact
**Purpose:** Freeze backend policy assumptions, version-pin rules, and adapter responsibilities in one document.

---

## Rules

- Each backend gets one supported major line per release branch.
- Unsupported major versions fail fast with `VersionIncompatible`; the engine does not guess at event taxonomies or exit-code meanings.
- Exact pinned versions are recorded here before Milestone 2.5 exit and are verified by fixture tests.
- Generic studio sandbox policies are translated into backend-native flags by the adapter. The generic policy names are not assumed to match CLI flags 1:1.
- Backend-specific network behavior is recorded here and surfaced in capabilities/UI when it affects user expectations.

## Matrix

| Backend | Probe | Credentials | Transport | Adapter Contract | Sandbox Translation | Fixture Source | Release Gate |
|---|---|---|---|---|---|---|---|
| Claude Code CLI | `claude --version` | Local CLI auth/session | JSONL stdout | Parse only the pinned `stream-json` surface; fail fast on unsupported major versions | Studio policy translated per pinned CLI contract | Pinned sample streams from verified CLI build | Linux release-blocking |
| Gemini CLI | `gemini --version` | Local CLI auth/session | JSONL stdout | Parse only the pinned `stream-json` surface defined by fixture tests; do not assume stable undocumented event names across versions | No special translation beyond generic policy handling | Pinned sample streams from verified CLI build | Linux release-blocking |
| Codex CLI | `codex --version` | Local CLI auth/session | JSONL stdout | Parse only the pinned JSON event surface; approval requests must fail fast in non-interactive mode | `read-only -> read-only`, `workspace-write -> workspace-write` when supported, `full-access -> danger-full-access` | Pinned sample streams from verified CLI build | Linux release-blocking |
| OpenRouter API | Credential reference resolution | `${OPENROUTER_API_KEY}` or equivalent reference | HTTPS + SSE | Parse only the pinned response shape from fixture and contract tests; fail fast on incompatible API assumptions | No local CLI sandbox; studio safety rules still govern cache/budget/provenance behavior | Pinned SSE fixtures and HTTP error fixtures | Linux release-blocking |

## Required Test Coverage

- Availability detection: installed, missing, missing credentials, incompatible version.
- Fixture-backed parsing for the pinned version line.
- Policy translation coverage where backend-native flags differ from studio policy names.
- Cost extraction coverage where the backend exposes cost/usage data.
- Negative tests for malformed streams, timeout, cancellation, and provider-specific errors.
