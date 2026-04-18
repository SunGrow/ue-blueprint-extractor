function Get-UEFixtureBuildPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectPath,

        [Parameter(Mandatory = $true)]
        [string]$FixtureRoot,

        [Parameter(Mandatory = $true)]
        [string]$PlatformDir,

        [Parameter(Mandatory = $true)]
        [bool]$SkipBuildProject
    )

    $ProjectName = [System.IO.Path]::GetFileNameWithoutExtension($ProjectPath)
    $TargetMarkerPath = Join-Path $FixtureRoot (Join-Path "Binaries\$PlatformDir" "$ProjectName`Editor.target")

    if (-not $SkipBuildProject) {
        return [pscustomobject]@{
            ShouldBuildProject = $true
            Reason             = 'build_requested'
            TargetMarkerPath   = $TargetMarkerPath
            Warning            = $null
        }
    }

    if (Test-Path -LiteralPath $TargetMarkerPath) {
        return [pscustomobject]@{
            ShouldBuildProject = $false
            Reason             = 'reuse_existing_build'
            TargetMarkerPath   = $TargetMarkerPath
            Warning            = $null
        }
    }

    return [pscustomobject]@{
        ShouldBuildProject = $true
        Reason             = 'missing_existing_build'
        TargetMarkerPath   = $TargetMarkerPath
        Warning            = "SkipBuildProject requested but no staged editor build marker was found at $TargetMarkerPath. Building the fixture editor target instead."
    }
}

function Get-UEAutomationWarningCount {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject
    )

    if ($null -eq $InputObject) {
        return $null
    }

    $BestCount = $null

    if ($InputObject -is [System.Collections.IDictionary]) {
        foreach ($Key in @('warningCount', 'warnings', 'numWarnings', 'succeededWithWarnings')) {
            if ($InputObject.Contains($Key)) {
                $Candidate = $InputObject[$Key]
                if ($Candidate -is [System.Collections.IEnumerable] -and -not ($Candidate -is [string])) {
                    $Candidate = @($Candidate).Count
                }

                if ($Candidate -is [ValueType]) {
                    $Numeric = [int]$Candidate
                    if ($null -eq $BestCount -or $Numeric -gt $BestCount) {
                        $BestCount = $Numeric
                    }
                }
            }
        }

        foreach ($Value in $InputObject.Values) {
            $Nested = Get-UEAutomationWarningCount -InputObject $Value
            if ($null -ne $Nested -and ($null -eq $BestCount -or $Nested -gt $BestCount)) {
                $BestCount = $Nested
            }
        }

        return $BestCount
    }

    if ($InputObject -is [System.Collections.IEnumerable] -and -not ($InputObject -is [string])) {
        foreach ($Item in $InputObject) {
            $Nested = Get-UEAutomationWarningCount -InputObject $Item
            if ($null -ne $Nested -and ($null -eq $BestCount -or $Nested -gt $BestCount)) {
                $BestCount = $Nested
            }
        }

        return $BestCount
    }

    $Properties = $InputObject.PSObject.Properties
    if ($null -eq $Properties) {
        return $null
    }

    foreach ($Key in @('warningCount', 'warnings', 'numWarnings', 'succeededWithWarnings')) {
        $Property = $Properties[$Key]
        if ($null -ne $Property) {
            $Candidate = $Property.Value
            if ($Candidate -is [System.Collections.IEnumerable] -and -not ($Candidate -is [string])) {
                $Candidate = @($Candidate).Count
            }

            if ($Candidate -is [ValueType]) {
                $Numeric = [int]$Candidate
                if ($null -eq $BestCount -or $Numeric -gt $BestCount) {
                    $BestCount = $Numeric
                }
            }
        }
    }

    foreach ($Property in $Properties) {
        $Nested = Get-UEAutomationWarningCount -InputObject $Property.Value
        if ($null -ne $Nested -and ($null -eq $BestCount -or $Nested -gt $BestCount)) {
            $BestCount = $Nested
        }
    }

    return $BestCount
}

function ConvertFrom-BPXJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Json
    )

    if ($PSVersionTable.PSVersion.Major -ge 6) {
        return $Json | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    }

    return $Json | ConvertFrom-Json -ErrorAction Stop
}

function Get-UEAutomationReportSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ReportPath
    )

    if ([string]::IsNullOrWhiteSpace($ReportPath) -or -not (Test-Path -LiteralPath $ReportPath)) {
        return [pscustomobject]@{
            ReportAvailable = $false
            ReportPath      = $ReportPath
            WarningCount    = $null
            MatchedFile     = $null
        }
    }

    $ReportFiles = Get-ChildItem -LiteralPath $ReportPath -Recurse -File -Filter '*.json' |
        Sort-Object @{
            Expression = {
                if ($_.Name -ieq 'index.json') {
                    return 0
                }
                if ($_.Name -ieq 'summary.json') {
                    return 1
                }
                return 2
            }
        }, FullName

    $BestWarningCount = $null
    $BestMatchedFile = $null

    foreach ($ReportFile in $ReportFiles) {
        try {
            $Raw = Get-Content -LiteralPath $ReportFile.FullName -Raw -ErrorAction Stop
            $Parsed = ConvertFrom-BPXJson -Json $Raw
        }
        catch {
            continue
        }

        $WarningCount = Get-UEAutomationWarningCount -InputObject $Parsed
        if ($null -ne $WarningCount -and ($null -eq $BestWarningCount -or $WarningCount -gt $BestWarningCount)) {
            $BestWarningCount = [int]$WarningCount
            $BestMatchedFile = $ReportFile.FullName
        }
    }

    return [pscustomobject]@{
        ReportAvailable = $true
        ReportPath      = $ReportPath
        WarningCount    = $BestWarningCount
        MatchedFile     = $BestMatchedFile
    }
}
