#!/usr/bin/env bash
set -euo pipefail

install=0
live=0

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
