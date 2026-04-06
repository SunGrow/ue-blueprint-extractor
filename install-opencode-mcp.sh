#!/usr/bin/env bash
set -euo pipefail

# Register BlueprintExtractor MCP server with OpenCode.
# Usage: ./install-opencode-mcp.sh [--local]
# Default installs the published MCP package into the OpenCode config dir.
# --local builds from source instead of installing from npm.

SERVER_NAME="blueprint-extractor"
LOCAL=false

for arg in "$@"; do
    case $arg in
        -l|--local) LOCAL=true ;;
    esac
done

if [ -t 1 ]; then
    GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
else
    GREEN=''; RED=''; NC=''
fi

info()  { printf "${GREEN}[+]${NC} %s\n" "$*"; }
error() { printf "${RED}[x]${NC} %s\n" "$*" >&2; }

resolve_config_file() {
    if [ -n "${OPENCODE_CONFIG:-}" ]; then
        printf '%s\n' "${OPENCODE_CONFIG}"
        return
    fi

    local config_root
    if [ -n "${XDG_CONFIG_HOME:-}" ]; then
        config_root="${XDG_CONFIG_HOME}/opencode"
    else
        config_root="${HOME}/.config/opencode"
    fi

    if [ -f "${config_root}/opencode.json" ]; then
        printf '%s\n' "${config_root}/opencode.json"
    elif [ -f "${config_root}/opencode.jsonc" ]; then
        printf '%s\n' "${config_root}/opencode.jsonc"
    else
        printf '%s\n' "${config_root}/opencode.json"
    fi
}

if ! command -v opencode &>/dev/null; then
    error "OpenCode CLI not found. Install it first: https://opencode.ai/docs/"
    exit 1
fi

if ! command -v node &>/dev/null; then
    error "Node.js not found. Install Node.js 18+ and re-run."
    exit 1
fi

if ! command -v npm &>/dev/null; then
    error "npm not found. Install Node.js 18+ and re-run."
    exit 1
fi

CONFIG_FILE="$(resolve_config_file)"
CONFIG_DIR="$(dirname "${CONFIG_FILE}")"
mkdir -p "${CONFIG_DIR}"

COMMAND_JSON=''

if [ "$LOCAL" = true ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    MCP_DIR="${SCRIPT_DIR}/MCP"
    DIST_INDEX="${MCP_DIR}/dist/index.js"

    if [ ! -d "${MCP_DIR}" ]; then
        error "MCP directory not found at ${MCP_DIR}"
        exit 1
    fi

    info "Installing npm dependencies..."
    (cd "${MCP_DIR}" && npm install --silent)

    info "Building MCP server..."
    (cd "${MCP_DIR}" && npm run build --silent)

    if [ ! -f "${DIST_INDEX}" ]; then
        error "Build failed - ${DIST_INDEX} not found."
        exit 1
    fi

    COMMAND_JSON="$(node -e 'console.log(JSON.stringify(["node", process.argv[1]]))' "${DIST_INDEX}")"
else
    INSTALLED_BIN="${CONFIG_DIR}/node_modules/.bin/blueprint-extractor-mcp"

    info "Installing Blueprint Extractor MCP into ${CONFIG_DIR}..."
    npm install --prefix "${CONFIG_DIR}" --silent --save-exact blueprint-extractor-mcp@latest

    if [ ! -f "${INSTALLED_BIN}" ]; then
        error "Installed MCP binary not found at ${INSTALLED_BIN}"
        exit 1
    fi

    COMMAND_JSON="$(node -e 'console.log(JSON.stringify([process.argv[1]]))' "${INSTALLED_BIN}")"
fi

ENV_JSON='{"UE_REMOTE_CONTROL_PORT":"30010"}'

info "Updating OpenCode config at ${CONFIG_FILE}..."
node - "${CONFIG_FILE}" "${SERVER_NAME}" "${COMMAND_JSON}" "${ENV_JSON}" <<'NODE'
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const [configFile, serverName, commandJson, environmentJson] = process.argv.slice(2);
const command = JSON.parse(commandJson);
const environment = JSON.parse(environmentJson);

function parseConfig(text) {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {}

  try {
    const value = vm.runInNewContext(`(${text})`, {}, { timeout: 1000 });
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Config root must be an object.');
    }

    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new Error(`Failed to parse existing OpenCode config: ${error.message}`);
  }
}

const existing = fs.existsSync(configFile)
  ? parseConfig(fs.readFileSync(configFile, 'utf8'))
  : {};

if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
  throw new Error('OpenCode config root must be an object.');
}

if ('mcp' in existing && (!existing.mcp || typeof existing.mcp !== 'object' || Array.isArray(existing.mcp))) {
  throw new Error('OpenCode config field "mcp" must be an object when present.');
}

const next = {
  ...existing,
  $schema: existing.$schema ?? 'https://opencode.ai/config.json',
  mcp: {
    ...(existing.mcp ?? {}),
    [serverName]: {
      type: 'local',
      command,
      enabled: true,
      environment,
    },
  },
};

fs.mkdirSync(path.dirname(configFile), { recursive: true });
fs.writeFileSync(configFile, `${JSON.stringify(next, null, 2)}\n`);
NODE

info "Done! MCP server '${SERVER_NAME}' added to OpenCode."
info "Start a new OpenCode session to pick up the updated config."
echo ""
info "Prerequisites:"
info "  1. Enable 'Remote Control API' plugin in UE5 Editor (Edit > Plugins)"
info "  2. Start the UE5 Editor before using the tools"
