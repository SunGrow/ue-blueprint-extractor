[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Live,
    [switch]$PackSmoke,
    [switch]$PublishDryRun
)

$ErrorActionPreference = 'Stop'

function Invoke-Step {
    param(
        [string]$Label,
        [string]$FilePath,
        [string[]]$Arguments
    )

    Write-Host "==> $Label"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$McpRoot = Join-Path $RepoRoot 'MCP'

Push-Location $McpRoot
try {
    if ($Install) {
        Invoke-Step -Label 'npm install' -FilePath 'npm' -Arguments @('install')
    }

    if ($Live) {
        Invoke-Step -Label 'npm run test:live' -FilePath 'npm' -Arguments @('run', 'test:live')
    }
    else {
        Invoke-Step -Label 'npm test' -FilePath 'npm' -Arguments @('test')
    }

    if ($PackSmoke) {
        Invoke-Step -Label 'npm run test:pack-smoke' -FilePath 'npm' -Arguments @('run', 'test:pack-smoke')
    }

    if ($PublishDryRun) {
        Invoke-Step -Label 'npm run test:publish-gate' -FilePath 'npm' -Arguments @('run', 'test:publish-gate')
    }
}
finally {
    Pop-Location
}
