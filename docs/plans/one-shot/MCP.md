# MCP Track

## Scope

- server version and count single-sourcing
- tool registration and scope updates
- canonical-name cleanup in tests, examples, and static resources
- project automation context shape and project-resolution heuristics

## Completed Outcomes

- Runtime server version now resolves from `MCP/package.json`.
- Contract tests assert the live surface at 106 tools and fail on drift.
- UE 5.7 is part of engine-root fallback heuristics.
- `get_project_automation_context` exposes `isPlayingInEditor`.
- New editor-only public tools are registered and covered:
  - `start_pie`
  - `stop_pie`
  - `relaunch_pie`
  - `capture_editor_screenshot`
  - `capture_runtime_screenshot`

## Validation

- `npm test` passed
- `npm run test:pack-smoke` passed
- `npm run test:publish-gate` passed

## Notes

- Canonical v2 names remain the public contract. Removed aliases were not restored.
- Deprecated compatibility widget aliases remain available where they already existed, but public guidance now points callers to operation-specific widget tools and `compile_widget`.
