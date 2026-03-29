[CmdletBinding()]
param(
    [string]$EngineRoot = $env:UE_ENGINE_ROOT,
    [string]$ProjectPath,
    [string]$StageRoot = $env:UE_FIXTURE_STAGE_ROOT,
    [string]$AutomationFilter = 'BlueprintExtractor',
    [switch]$BuildPlugin,
    [switch]$SkipBuildProject,
    [switch]$AllowSoftwareRendering,
    [switch]$NoNullRHI
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-ue-lib.ps1')

$ScriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ScriptRoot)) {
    $ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
    $ProjectPath = Join-Path $ScriptRoot '..\tests\fixtures\BlueprintExtractorFixture\BPXFixture.uproject'
}

function Assert-PathExists {
    param(
        [string]$Path,
        [string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Description not found: $Path"
    }
}

function ConvertTo-BPXArgumentString {
    param(
        [string[]]$Arguments
    )

    $QuotedArguments = foreach ($Argument in $Arguments) {
        if ([string]::IsNullOrEmpty($Argument)) {
            '""'
            continue
        }

        if ($Argument -match '[\s"]') {
            '"' + ($Argument -replace '"', '\"') + '"'
            continue
        }

        $Argument
    }

    return ($QuotedArguments -join ' ')
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
        $ArgumentString = ConvertTo-BPXArgumentString -Arguments $Arguments
        $Process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentString -Wait -PassThru -NoNewWindow
        if ($Process.ExitCode -eq 0) {
            return
        }

        if ($Attempt -lt $Retries) {
            Write-Warning "$Label failed with exit code $($Process.ExitCode) (attempt $Attempt of $Retries). Retrying in $RetryDelaySeconds seconds..."
            Start-Sleep -Seconds $RetryDelaySeconds
            continue
        }

        throw "$Label failed with exit code $($Process.ExitCode)"
    }
}

function Stop-BPXFixtureProcesses {
    param(
        [string[]]$MatchPatterns = @()
    )

    $ProcessNames = @(
        'UnrealEditor-Cmd.exe',
        'UnrealEditor.exe',
        'dotnet.exe',
        'UnrealBuildTool.exe',
        'UbaHost.exe',
        'UbaAgent.exe',
        'UbaCacheService.exe',
        'UbaStorageProxy.exe'
    )

    $Deadline = (Get-Date).AddSeconds(30)
    do {
        $Matches = @(
            Get-CimInstance Win32_Process |
                Where-Object {
                    $ShouldStop = $false
                    foreach ($Pattern in $MatchPatterns) {
                        if ($Pattern -and $Pattern.Length -gt 0 -and $_.CommandLine -like "*$Pattern*") {
                            $ShouldStop = $true
                            break
                        }
                    }

                    $ProcessNames -contains $_.Name -and
                    $_.CommandLine -and
                    $ShouldStop
                }
        )

        foreach ($Match in $Matches) {
            Stop-Process -Id $Match.ProcessId -Force -ErrorAction SilentlyContinue
        }

        if ($Matches.Count -gt 0) {
            Start-Sleep -Seconds 1
        }
    }
    while ($Matches.Count -gt 0 -and (Get-Date) -lt $Deadline)
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

$RepoRoot = (Resolve-Path (Join-Path $ScriptRoot '..')).Path
$ResolvedProjectPath = (Resolve-Path $ProjectPath).Path
$FixtureSourceRoot = Split-Path -Parent $ResolvedProjectPath
$PluginSource = Join-Path $RepoRoot 'BlueprintExtractor'
$EditorCmd = Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$UnrealBuildToolDll = Join-Path $EngineRoot 'Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll'
$RunUat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat'
$EngineLabel = Split-Path -Leaf $EngineRoot
$BuildPluginOutput = Join-Path $RepoRoot ".artifacts\BuildPlugin\$EngineLabel"
$PluginDescriptor = Join-Path $PluginSource 'BlueprintExtractor.uplugin'

Assert-PathExists -Path $PluginSource -Description 'Plugin source'
Assert-PathExists -Path $ResolvedProjectPath -Description 'Fixture project'
Assert-PathExists -Path $EditorCmd -Description 'UnrealEditor-Cmd'
Assert-PathExists -Path $UnrealBuildToolDll -Description 'UnrealBuildTool.dll'
Assert-PathExists -Path $RunUat -Description 'RunUAT.bat'
Assert-PathExists -Path $PluginDescriptor -Description 'BlueprintExtractor.uplugin'

try {
    if ([string]::IsNullOrWhiteSpace($StageRoot)) {
        $StageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("BPXFixture-{0}-{1}" -f $EngineLabel, [guid]::NewGuid().ToString('N'))
    }

    $FixtureRoot = $StageRoot
    $ResolvedProjectPath = Join-Path $FixtureRoot (Split-Path -Leaf $ResolvedProjectPath)
    $PluginDestination = Join-Path $FixtureRoot 'Plugins\BlueprintExtractor'
    $AutomationReportPath = Join-Path $FixtureRoot 'Saved\AutomationReports'
    $ReuseStagedFixture = $false

    if ($SkipBuildProject.IsPresent -and (Test-Path -LiteralPath $StageRoot)) {
        $ExistingBuildPlan = Get-UEFixtureBuildPlan `
            -ProjectPath $ResolvedProjectPath `
            -FixtureRoot $FixtureRoot `
            -PlatformDir 'Win64' `
            -SkipBuildProject $true
        $StagedPluginDescriptor = Join-Path $PluginDestination 'BlueprintExtractor.uplugin'
        if ($ExistingBuildPlan.Reason -eq 'reuse_existing_build' -and (Test-Path -LiteralPath $StagedPluginDescriptor)) {
            $ReuseStagedFixture = $true
            Write-Host "==> Reusing staged fixture project in $StageRoot"
        }
    }

    if (-not $ReuseStagedFixture) {
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
    }

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
            -FilePath 'dotnet' `
            -Arguments @(
                $UnrealBuildToolDll,
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
    if ($AllowSoftwareRendering.IsPresent) {
        $AutomationArgs += '-AllowSoftwareRendering'
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
}
finally {
    Stop-BPXFixtureProcesses -MatchPatterns @($ResolvedProjectPath, $ProjectPath, $StageRoot, $EngineRoot, $BuildPluginOutput, 'BPXFixture', 'BlueprintExtractorFixture', 'UnrealBuildTool', 'Uba')
}
