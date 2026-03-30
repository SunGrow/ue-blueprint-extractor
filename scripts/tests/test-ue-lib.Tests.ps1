$HelperScript = Join-Path $PSScriptRoot '..\test-ue-lib.ps1'
. $HelperScript

Describe 'Get-UEFixtureBuildPlan' {
    It 'falls back to building when SkipBuildProject is requested on a fresh stage' {
        $fixtureRoot = Join-Path $env:TEMP ("bpx-fixture-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null

        try {
            $plan = Get-UEFixtureBuildPlan `
                -ProjectPath (Join-Path $fixtureRoot 'BPXFixture.uproject') `
                -FixtureRoot $fixtureRoot `
                -PlatformDir 'Win64' `
                -SkipBuildProject $true

            $plan.ShouldBuildProject | Should Be $true
            $plan.Reason | Should Be 'missing_existing_build'
            $plan.TargetMarkerPath | Should Match 'BPXFixtureEditor\.target$'
            $plan.Warning | Should Match 'SkipBuildProject requested'
        }
        finally {
            Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'reuses an existing staged build when the editor target marker is present' {
        $fixtureRoot = Join-Path $env:TEMP ("bpx-fixture-" + [guid]::NewGuid().ToString('N'))
        $targetMarker = Join-Path $fixtureRoot 'Binaries\Win64\BPXFixtureEditor.target'
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetMarker) | Out-Null
        Set-Content -LiteralPath $targetMarker -Value 'marker'

        try {
            $plan = Get-UEFixtureBuildPlan `
                -ProjectPath (Join-Path $fixtureRoot 'BPXFixture.uproject') `
                -FixtureRoot $fixtureRoot `
                -PlatformDir 'Win64' `
                -SkipBuildProject $true

            $plan.ShouldBuildProject | Should Be $false
            $plan.Reason | Should Be 'reuse_existing_build'
            $plan.TargetMarkerPath | Should Be $targetMarker
            $plan.Warning | Should Be $null
        }
        finally {
            Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Describe 'Get-UEAutomationReportSummary' {
    It 'returns the highest warning summary found in nested automation report JSON' {
        $reportRoot = Join-Path $env:TEMP ("bpx-report-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path (Join-Path $reportRoot 'Nested') | Out-Null

        try {
            Set-Content -LiteralPath (Join-Path $reportRoot 'index.json') -Value (@'
{
  "summary": {
    "warningCount": 0
  }
}
'@)
            Set-Content -LiteralPath (Join-Path $reportRoot 'Nested\detail.json') -Value (@'
{
  "run": {
    "succeededWithWarnings": 3
  }
}
'@)

            $summary = Get-UEAutomationReportSummary -ReportPath $reportRoot

            $summary.ReportAvailable | Should Be $true
            $summary.WarningCount | Should Be 3
            $summary.MatchedFile | Should Match 'detail\.json$'
        }
        finally {
            Remove-Item -LiteralPath $reportRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'marks a missing report path as unavailable' {
        $summary = Get-UEAutomationReportSummary -ReportPath (Join-Path $env:TEMP ("missing-report-" + [guid]::NewGuid().ToString('N')))

        $summary.ReportAvailable | Should Be $false
        $summary.WarningCount | Should Be $null
        $summary.MatchedFile | Should Be $null
    }
}
