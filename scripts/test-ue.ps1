[CmdletBinding()]
param(
    [string]$EngineRoot = $env:UE_ENGINE_ROOT,
    [string]$ProjectPath = (Join-Path $PSScriptRoot '..\tests\fixtures\BlueprintExtractorFixture\BPXFixture.uproject'),
    [string]$StageRoot = $env:UE_FIXTURE_STAGE_ROOT,
    [string]$AutomationFilter = 'BlueprintExtractor',
    [switch]$BuildPlugin,
    [switch]$SkipBuildProject,
    [switch]$NoNullRHI
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-ue-lib.ps1')

function Assert-PathExists {
    param(
        [string]$Path,
        [string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Description not found: $Path"
    }
}

function Invoke-Step {
    param(
        [string]$Label,
        [string]$FilePath,
        [string[]]$Arguments,
        [int]$Retries = 1,
        [int]$RetryDelaySeconds = 3
    )

    for ($Attempt = 1; $Attempt -le $Retries; $Attempt++) {
        Write-Host "==> $Label"
        & $FilePath @Arguments
        if ($LASTEXITCODE -eq 0) {
            return
        }

        if ($Attempt -lt $Retries) {
            Write-Warning "$Label failed with exit code $LASTEXITCODE (attempt $Attempt of $Retries). Retrying in $RetryDelaySeconds seconds..."
            Start-Sleep -Seconds $RetryDelaySeconds
            continue
        }

        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

function Sync-Directory {
    param(
        [string]$Source,
        [string]$Destination,
        [string[]]$ExcludeDirectories = @()
    )

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null

    $robocopyArgs = [System.Collections.Generic.List[string]]::new()
    foreach ($arg in @(
        $Source,
        $Destination,
        '/MIR',
        '/NFL',
        '/NDL',
        '/NJH',
        '/NJS',
        '/NP'
    )) {
        $robocopyArgs.Add($arg)
    }

    if ($ExcludeDirectories.Count -gt 0) {
        $robocopyArgs.Add('/XD')
        foreach ($exclude in $ExcludeDirectories) {
            $robocopyArgs.Add($exclude)
        }
    }

    & robocopy @robocopyArgs | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Directory sync failed with robocopy exit code $LASTEXITCODE"
    }
}

if ([string]::IsNullOrWhiteSpace($EngineRoot)) {
    throw 'Set UE_ENGINE_ROOT or pass -EngineRoot.'
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ResolvedProjectPath = (Resolve-Path $ProjectPath).Path
$FixtureSourceRoot = Split-Path -Parent $ResolvedProjectPath
$PluginSource = Join-Path $RepoRoot 'BlueprintExtractor'
$EditorCmd = Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$BuildBat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\Build.bat'
$RunUat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat'
$EngineLabel = Split-Path -Leaf $EngineRoot
$BuildPluginOutput = Join-Path $RepoRoot ".artifacts\BuildPlugin\$EngineLabel"
$PluginDescriptor = Join-Path $PluginSource 'BlueprintExtractor.uplugin'

Assert-PathExists -Path $PluginSource -Description 'Plugin source'
Assert-PathExists -Path $ResolvedProjectPath -Description 'Fixture project'
Assert-PathExists -Path $EditorCmd -Description 'UnrealEditor-Cmd'
Assert-PathExists -Path $BuildBat -Description 'Build.bat'
Assert-PathExists -Path $RunUat -Description 'RunUAT.bat'
Assert-PathExists -Path $PluginDescriptor -Description 'BlueprintExtractor.uplugin'

if ([string]::IsNullOrWhiteSpace($StageRoot)) {
    $StageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("BPXFixture-{0}-{1}" -f $EngineLabel, [guid]::NewGuid().ToString('N'))
}

Write-Host "==> Staging fixture project into $StageRoot"
Sync-Directory `
    -Source $FixtureSourceRoot `
    -Destination $StageRoot `
    -ExcludeDirectories @(
        'Binaries',
        'DerivedDataCache',
        'Intermediate',
        'Saved',
        '.vs',
        (Join-Path $FixtureSourceRoot 'Plugins\BlueprintExtractor')
    )

$FixtureRoot = $StageRoot
$ResolvedProjectPath = Join-Path $FixtureRoot (Split-Path -Leaf $ResolvedProjectPath)
$PluginDestination = Join-Path $FixtureRoot 'Plugins\BlueprintExtractor'
$AutomationReportPath = Join-Path $FixtureRoot 'Saved\AutomationReports'

Write-Host "==> Syncing plugin into staged fixture project"
Sync-Directory `
    -Source $PluginSource `
    -Destination $PluginDestination `
    -ExcludeDirectories @(
        'Binaries',
        'Intermediate',
        'Saved',
        '.vs'
    )

if ($BuildPlugin) {
    if (Test-Path -LiteralPath $BuildPluginOutput) {
        Remove-Item -LiteralPath $BuildPluginOutput -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $BuildPluginOutput | Out-Null
    Invoke-Step `
        -Label 'RunUAT BuildPlugin' `
        -FilePath $RunUat `
        -Arguments @(
            'BuildPlugin',
            "-Plugin=$PluginDescriptor",
            "-Package=$BuildPluginOutput",
            '-Rocket'
        ) `
        -Retries 3 `
        -RetryDelaySeconds 5
}

$BuildPlan = Get-UEFixtureBuildPlan `
    -ProjectPath $ResolvedProjectPath `
    -FixtureRoot $FixtureRoot `
    -PlatformDir 'Win64' `
    -SkipBuildProject $SkipBuildProject.IsPresent

if ($BuildPlan.Warning) {
    Write-Warning $BuildPlan.Warning
}

if ($BuildPlan.ShouldBuildProject) {
    Invoke-Step `
        -Label 'Build fixture editor target' `
        -FilePath $BuildBat `
        -Arguments @(
            'BPXFixtureEditor',
            'Win64',
            'Development',
            "-Project=$ResolvedProjectPath",
            '-WaitMutex',
            '-NoHotReloadFromIDE'
        )
}

New-Item -ItemType Directory -Force -Path $AutomationReportPath | Out-Null

$AutomationArgs = @(
    $ResolvedProjectPath,
    '-unattended',
    '-nop4',
    '-nosplash'
)

if (-not $NoNullRHI.IsPresent) {
    $AutomationArgs += '-NullRHI'
}

$AutomationArgs += @(
    '-RCWebControlEnable',
    '-RCWebInterfaceEnable',
    "-ReportExportPath=$AutomationReportPath",
    "-ExecCmds=Automation RunTests $AutomationFilter;Quit"
)

Invoke-Step `
    -Label 'Run BlueprintExtractor automation tests' `
    -FilePath $EditorCmd `
    -Arguments $AutomationArgs
