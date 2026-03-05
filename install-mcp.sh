#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# install-mcp.sh — Register BlueprintExtractor MCP server with Claude Code
#
# Adds the MCP server as a user-scoped server so it's available
# across all projects. Requires Node.js 18+ and Claude Code CLI.
# ──────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_DIR="${SCRIPT_DIR}/MCP"
DIST_INDEX="${MCP_DIR}/dist/index.js"
SERVER_NAME="blueprint-extractor"

# ── Colours ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
else
    GREEN=''; YELLOW=''; RED=''; NC=''
fi

info()  { printf "${GREEN}[+]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$*"; }
error() { printf "${RED}[x]${NC} %s\n" "$*" >&2; }

# ── Pre-flight checks ───────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    error "Node.js not found. Install Node.js 18+ and re-run."
    exit 1
fi

if ! command -v claude &>/dev/null; then
    error "Claude Code CLI not found. Install it first: https://docs.anthropic.com/en/docs/claude-code"
    exit 1
fi

if [ ! -d "${MCP_DIR}" ]; then
    error "MCP directory not found at ${MCP_DIR}"
    exit 1
fi

# ── Build MCP server ────────────────────────────────────────────────
info "Installing npm dependencies..."
(cd "${MCP_DIR}" && npm install --silent)

info "Building MCP server..."
(cd "${MCP_DIR}" && npm run build --silent)

if [ ! -f "${DIST_INDEX}" ]; then
    error "Build failed — ${DIST_INDEX} not found."
    exit 1
fi

# ── Register with Claude Code ───────────────────────────────────────
info "Registering MCP server with Claude Code (user scope)..."

# Remove existing entry if present (idempotent)
claude mcp remove "${SERVER_NAME}" 2>/dev/null || true

claude mcp add \
    --scope user \
    --transport stdio \
    --env UE_REMOTE_CONTROL_PORT=30010 \
    "${SERVER_NAME}" \
    -- node "${DIST_INDEX}"

info "Done! MCP server '${SERVER_NAME}' registered globally."
info "Restart Claude Code to pick up the new server."
echo ""
info "Prerequisites:"
info "  1. Enable 'Remote Control API' plugin in UE5 Editor (Edit > Plugins)"
info "  2. Start the UE5 Editor before using the tools"
