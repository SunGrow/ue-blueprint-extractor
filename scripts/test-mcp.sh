#!/usr/bin/env bash
set -euo pipefail

install=0
live=0
pack_smoke=0
publish_dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      install=1
      shift
      ;;
    --live)
      live=1
      shift
      ;;
    --pack-smoke)
      pack_smoke=1
      shift
      ;;
    --publish-dry-run)
      publish_dry_run=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
mcp_root="$repo_root/MCP"

run_step() {
  local label="$1"
  shift

  echo "==> $label"
  "$@"
}

cd "$mcp_root"

if [[ "$install" -eq 1 ]]; then
  run_step "npm install" npm install
fi

if [[ "$live" -eq 1 ]]; then
  run_step "npm run test:live" npm run test:live
else
  run_step "npm test" npm test
fi

if [[ "$pack_smoke" -eq 1 ]]; then
  run_step "npm run test:pack-smoke" npm run test:pack-smoke
fi

if [[ "$publish_dry_run" -eq 1 ]]; then
  run_step "npm publish --dry-run" npm publish --dry-run
fi
