#Requires -Version 5.1
<#
.SYNOPSIS
    Register BlueprintExtractor MCP server with Claude Code.
.DESCRIPTION
    Builds the MCP server and adds it as a user-scoped server so it's
    available across all projects. Requires Node.js 18+ and Claude Code CLI.
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$McpDir    = Join-Path $ScriptDir 'MCP'
$DistIndex = Join-Path $McpDir 'dist' 'index.js'
$ServerName = 'blueprint-extractor'

function Write-Info { param([string]$Msg) Write-Host "[+] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$Msg) Write-Host "[x] $Msg" -ForegroundColor Red }

# ── Pre-flight checks ───────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err "Node.js not found. Install Node.js 18+ and re-run."
    exit 1
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Err "Claude Code CLI not found. Install it first: https://docs.anthropic.com/en/docs/claude-code"
    exit 1
}

if (-not (Test-Path $McpDir)) {
    Write-Err "MCP directory not found at $McpDir"
    exit 1
}

# ── Build MCP server ────────────────────────────────────────────────
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

# ── Register with Claude Code ───────────────────────────────────────
Write-Info "Registering MCP server with Claude Code (user scope)..."

# Remove existing entry if present (idempotent)
claude mcp remove $ServerName 2>$null
if ($LASTEXITCODE) { $LASTEXITCODE = 0 }

claude mcp add `
    --scope user `
    --transport stdio `
    --env UE_REMOTE_CONTROL_PORT=30010 `
    $ServerName `
    -- node $DistIndex

Write-Info "Done! MCP server '$ServerName' registered globally."
Write-Info "Restart Claude Code to pick up the new server."
Write-Host ''
Write-Info 'Prerequisites:'
Write-Info "  1. Enable 'Remote Control API' plugin in UE5 Editor (Edit > Plugins)"
Write-Info '  2. Start the UE5 Editor before using the tools'
