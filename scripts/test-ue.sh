#!/usr/bin/env bash
set -euo pipefail

engine_root="${UE_ENGINE_ROOT:-}"
project_path=""
stage_root="${UE_FIXTURE_STAGE_ROOT:-}"
automation_filter="BlueprintExtractor"
build_plugin=0
skip_build_project=0
use_null_rhi=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --engine-root)
      engine_root="$2"
      shift 2
      ;;
    --project)
      project_path="$2"
      shift 2
      ;;
    --stage-root)
      stage_root="$2"
      shift 2
      ;;
    --automation-filter)
      automation_filter="$2"
      shift 2
      ;;
    --build-plugin)
      build_plugin=1
      shift
      ;;
    --skip-build-project)
      skip_build_project=1
      shift
      ;;
    --no-null-rhi)
      use_null_rhi=0
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ -z "$project_path" ]]; then
  project_path="$repo_root/tests/fixtures/BlueprintExtractorFixture/BPXFixture.uproject"
fi

if [[ -z "$engine_root" ]]; then
  echo "Set UE_ENGINE_ROOT or pass --engine-root." >&2
  exit 1
fi

assert_path() {
  local path="$1"
  local description="$2"

  if [[ ! -e "$path" ]]; then
    echo "$description not found: $path" >&2
    exit 1
  fi
}

run_step() {
  local label="$1"
  shift

  echo "==> $label"
  "$@"
}

plugin_source="$repo_root/BlueprintExtractor"
fixture_source_root="$(cd "$(dirname "$project_path")" && pwd)"
plugin_descriptor="$plugin_source/BlueprintExtractor.uplugin"
engine_label="$(basename "$engine_root")"
build_plugin_output="$repo_root/.artifacts/BuildPlugin/$engine_label"
editor_cmd="$engine_root/Engine/Binaries/Linux/UnrealEditor-Cmd"
build_sh="$engine_root/Engine/Build/BatchFiles/Linux/Build.sh"
run_uat="$engine_root/Engine/Build/BatchFiles/RunUAT.sh"
host_platform="Linux"

if [[ ! -x "$editor_cmd" ]]; then
  editor_cmd="$engine_root/Engine/Binaries/Mac/UnrealEditor-Cmd"
  host_platform="Mac"
fi

if [[ ! -x "$build_sh" ]]; then
  build_sh="$engine_root/Engine/Build/BatchFiles/Mac/Build.sh"
fi

if [[ ! -x "$run_uat" ]]; then
  run_uat="$engine_root/Engine/Build/BatchFiles/RunUAT.command"
fi

assert_path "$plugin_source" "Plugin source"
assert_path "$project_path" "Fixture project"
assert_path "$plugin_descriptor" "BlueprintExtractor.uplugin"
assert_path "$editor_cmd" "UnrealEditor-Cmd"
assert_path "$build_sh" "Build.sh"
assert_path "$run_uat" "RunUAT"

if [[ -z "$stage_root" ]]; then
  stage_root="$(mktemp -d "${TMPDIR:-/tmp}/BPXFixture-$engine_label-XXXXXX")"
fi

echo "==> Staging fixture project into $stage_root"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude Binaries \
    --exclude DerivedDataCache \
    --exclude Intermediate \
    --exclude Saved \
    --exclude .vs \
    --exclude Plugins/BlueprintExtractor \
    "$fixture_source_root/" "$stage_root/"
else
  rm -rf "$stage_root"
  mkdir -p "$stage_root"
  cp -R "$fixture_source_root/." "$stage_root/"
  rm -rf "$stage_root/Binaries" "$stage_root/DerivedDataCache" "$stage_root/Intermediate" "$stage_root/Saved" "$stage_root/.vs" "$stage_root/Plugins/BlueprintExtractor"
fi

fixture_root="$stage_root"
project_path="$fixture_root/$(basename "$project_path")"
plugin_destination="$fixture_root/Plugins/BlueprintExtractor"
automation_report_path="$fixture_root/Saved/AutomationReports"

mkdir -p "$(dirname "$plugin_destination")"

echo "==> Syncing plugin into staged fixture project"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude Binaries \
    --exclude Intermediate \
    --exclude Saved \
    --exclude .vs \
    "$plugin_source/" "$plugin_destination/"
else
  rm -rf "$plugin_destination"
  mkdir -p "$plugin_destination"
  cp -R "$plugin_source/." "$plugin_destination/"
  rm -rf "$plugin_destination/Binaries" "$plugin_destination/Intermediate" "$plugin_destination/Saved" "$plugin_destination/.vs"
fi

if [[ "$build_plugin" -eq 1 ]]; then
  mkdir -p "$build_plugin_output"
  run_step "RunUAT BuildPlugin" \
    "$run_uat" \
    BuildPlugin \
    "-Plugin=$plugin_descriptor" \
    "-Package=$build_plugin_output" \
    -Rocket
fi

project_name="$(basename "$project_path" .uproject)"
target_marker="$fixture_root/Binaries/$host_platform/${project_name}Editor.target"

if [[ "$skip_build_project" -eq 1 && ! -f "$target_marker" ]]; then
  echo "warning: --skip-build-project requested but no staged editor build marker was found at $target_marker. Building the fixture editor target instead." >&2
  skip_build_project=0
fi

if [[ "$skip_build_project" -eq 0 ]]; then
  run_step "Build fixture editor target" \
    "$build_sh" \
    BPXFixtureEditor \
    "$host_platform" \
    Development \
    "-Project=$project_path" \
    -WaitMutex \
    -NoHotReloadFromIDE
fi

mkdir -p "$automation_report_path"

automation_args=(
  "$project_path"
  -unattended
  -nop4
  -nosplash
)

if [[ "$use_null_rhi" -eq 1 ]]; then
  automation_args+=(-NullRHI)
fi

automation_args+=(
  -RCWebControlEnable
  -RCWebInterfaceEnable
  "-ReportExportPath=$automation_report_path"
  "-ExecCmds=Automation RunTests $automation_filter;Quit"
)

run_step "Run BlueprintExtractor automation tests" \
  "$editor_cmd" \
  "${automation_args[@]}"
