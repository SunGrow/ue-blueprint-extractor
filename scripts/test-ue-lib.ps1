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
