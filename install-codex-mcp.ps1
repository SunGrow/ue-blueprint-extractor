#Requires -Version 5.1
# SYNOPSIS: Register BlueprintExtractor MCP server with Codex.
# -Local switch builds from source instead of using npx.

[CmdletBinding()]
param(
    [switch]$Local
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServerName = 'blueprint-extractor'

function Write-Info { param([string]$Msg) Write-Host "[+] $Msg" -ForegroundColor Green }
function Write-Err  { param([string]$Msg) Write-Host "[x] $Msg" -ForegroundColor Red }

# Pre-flight: codex CLI required for both modes
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    Write-Err "Codex CLI not found. Install it first."
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err "Node.js not found. Install Node.js 18+ and re-run."
    exit 1
}

# Remove existing entry (idempotent)
try { codex mcp remove $ServerName 2>&1 | Out-Null } catch {}

if ($Local) {
    # Build locally so Codex launches the checked-out server code.
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    $McpDir    = Join-Path $ScriptDir 'MCP'
    $DistIndex = Join-Path $McpDir 'dist' 'index.js'

    if (-not (Test-Path $McpDir)) {
        Write-Err "MCP directory not found at $McpDir"
        exit 1
    }

    Write-Info "Installing npm dependencies..."
    Push-Location $McpDir
    try {
        npm install --silent 2>&1 | Out-Null
        Write-Info "Building MCP server..."
        npm run build --silent 2>&1 | Out-Null
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $DistIndex)) {
        Write-Err "Build failed - $DistIndex not found."
        exit 1
    }

    Write-Info "Registering MCP server with Codex (local build)..."
    codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 $ServerName -- node $DistIndex
} else {
    Write-Info "Registering MCP server with Codex (npx)..."
    codex mcp add --env UE_REMOTE_CONTROL_PORT=30010 $ServerName -- cmd /c npx -y blueprint-extractor-mcp@latest
}

Write-Info "Done! MCP server '$ServerName' registered with Codex."
Write-Info "Open a new Codex session or restart the Codex app to pick up the new server."
Write-Host ''
Write-Info 'Prerequisites:'
Write-Info "  1. Enable 'Remote Control API' plugin in UE5 Editor (Edit > Plugins)"
Write-Info '  2. Start the UE5 Editor before using the tools'
