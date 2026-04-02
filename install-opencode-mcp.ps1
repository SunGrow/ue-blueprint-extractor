#Requires -Version 5.1
# SYNOPSIS: Register BlueprintExtractor MCP server with OpenCode.
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
function Assert-LastExitCode {
    param([string]$Message)

    if ($LASTEXITCODE -ne 0) {
        Write-Err $Message
        exit $LASTEXITCODE
    }
}

function Get-OpenCodeConfigPath {
    if ($env:OPENCODE_CONFIG) {
        return $env:OPENCODE_CONFIG
    }

    if ($env:XDG_CONFIG_HOME) {
        $configRoot = Join-Path $env:XDG_CONFIG_HOME 'opencode'
    } else {
        $configRoot = Join-Path $HOME '.config/opencode'
    }

    $jsonPath = Join-Path $configRoot 'opencode.json'
    if (Test-Path $jsonPath) {
        return $jsonPath
    }

    $jsoncPath = Join-Path $configRoot 'opencode.jsonc'
    if (Test-Path $jsoncPath) {
        return $jsoncPath
    }

    return $jsonPath
}

if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
    Write-Err 'OpenCode CLI not found. Install it first: https://opencode.ai/docs/'
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err 'Node.js not found. Install Node.js 18+ and re-run.'
    exit 1
}

$commandJson = '["npx","-y","blueprint-extractor-mcp@latest"]'

if ($Local) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    $McpDir    = Join-Path $ScriptDir 'MCP'
    $DistIndex = Join-Path $McpDir 'dist' 'index.js'

    if (-not (Test-Path $McpDir)) {
        Write-Err "MCP directory not found at $McpDir"
        exit 1
    }

    Write-Info 'Installing npm dependencies...'
    Push-Location $McpDir
    try {
        npm install --silent 2>&1 | Out-Null
        Assert-LastExitCode 'npm install failed.'
        Write-Info 'Building MCP server...'
        npm run build --silent 2>&1 | Out-Null
        Assert-LastExitCode 'npm run build failed.'
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $DistIndex)) {
        Write-Err "Build failed - $DistIndex not found."
        exit 1
    }

    $commandJson = & node -e "console.log(JSON.stringify(['node', process.argv[1]]))" $DistIndex
    Assert-LastExitCode 'Failed to prepare the local OpenCode command.'
}

$ConfigFile = Get-OpenCodeConfigPath
$ConfigDir = Split-Path -Parent $ConfigFile
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

$commandJsonBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($commandJson))
$envJsonBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"UE_REMOTE_CONTROL_PORT":"30010"}'))

$nodeScript = @'
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const [configFile, serverName, commandJsonBase64, environmentJsonBase64] = process.argv.slice(1);
const command = JSON.parse(Buffer.from(commandJsonBase64, 'base64').toString('utf8'));
const environment = JSON.parse(Buffer.from(environmentJsonBase64, 'base64').toString('utf8'));

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
'@

Write-Info "Updating OpenCode config at $ConfigFile..."
& node -e $nodeScript -- $ConfigFile $ServerName $commandJsonBase64 $envJsonBase64
Assert-LastExitCode 'Failed to update the OpenCode config.'

Write-Info "Done! MCP server '$ServerName' added to OpenCode."
Write-Info 'Start a new OpenCode session to pick up the updated config.'
Write-Host ''
Write-Info 'Prerequisites:'
Write-Info "  1. Enable 'Remote Control API' plugin in UE5 Editor (Edit > Plugins)"
Write-Info '  2. Start the UE5 Editor before using the tools'
