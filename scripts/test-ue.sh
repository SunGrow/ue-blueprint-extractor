#!/usr/bin/env bash
set -euo pipefail

engine_root="${UE_ENGINE_ROOT:-}"
project_path=""
stage_root="${UE_FIXTURE_STAGE_ROOT:-}"
automation_filter="BlueprintExtractor"
build_plugin=0
skip_build_project=0
use_null_rhi=1
cleanup_patterns=()

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

get_python_bin() {
  if command -v python3 >/dev/null 2>&1; then
    printf '%s\n' python3
    return 0
  fi
  if command -v python >/dev/null 2>&1; then
    printf '%s\n' python
    return 0
  fi
  return 1
}

get_free_tcp_port() {
  local py
  py="$(get_python_bin)" || {
    echo "python3 or python is required to allocate a free TCP port." >&2
    exit 1
  }

  "$py" - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}

set_remote_control_port() {
  local config_path="$1"
  local port="$2"
  local py
  py="$(get_python_bin)" || {
    echo "python3 or python is required to patch the staged DefaultRemoteControl.ini." >&2
    exit 1
  }

  "$py" - "$config_path" "$port" <<'PY'
from pathlib import Path
import sys

config_path = Path(sys.argv[1])
port_line = f"RemoteControlHttpServerPort={sys.argv[2]}"
section_header = "[/Script/RemoteControlCommon.RemoteControlSettings]"

lines = config_path.read_text(encoding="utf-8").splitlines() if config_path.exists() else []

try:
    section_index = lines.index(section_header)
except ValueError:
    if lines and lines[-1] != "":
        lines.append("")
    lines.extend([section_header, port_line])
else:
    insert_index = section_index + 1
    port_updated = False
    while insert_index < len(lines) and not lines[insert_index].startswith("["):
        if lines[insert_index].startswith("RemoteControlHttpServerPort="):
            lines[insert_index] = port_line
            port_updated = True
            break
        insert_index += 1
    if not port_updated:
        lines.insert(insert_index, port_line)

config_path.parent.mkdir(parents=True, exist_ok=True)
config_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
}

run_step() {
  local label="$1"
  shift

  echo "==> $label"
  local exit_code=0
  if ! "$@"; then
    exit_code=$?
  fi

  stop_bpx_fixture_processes
  return "$exit_code"
}

stop_bpx_fixture_processes() {
  local deadline=$((SECONDS + 30))

  while (( SECONDS < deadline )); do
    local matched=0
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue

      local cmdline
      cmdline="$(ps -o command= -p "$pid" 2>/dev/null || true)"
      [[ -z "$cmdline" ]] && continue

      local process_name
      process_name="$(ps -o comm= -p "$pid" 2>/dev/null || true)"
      case "$process_name" in
        UnrealEditor|UnrealEditor-Cmd|dotnet|UnrealBuildTool)
          ;;
        *)
          continue
          ;;
      esac

      local should_stop=0
      for pattern in "${cleanup_patterns[@]}"; do
        if [[ -n "$pattern" && "$cmdline" == *"$pattern"* ]]; then
          should_stop=1
          break
        fi
      done

      if (( should_stop == 1 )); then
        kill -TERM "$pid" 2>/dev/null || true
        matched=1
      fi
    done < <(pgrep -f 'UnrealEditor|UnrealBuildTool|dotnet' 2>/dev/null || true)

    if (( matched == 0 )); then
      return 0
    fi

    sleep 1
  done

  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
  done < <(pgrep -f 'UnrealEditor|UnrealBuildTool|dotnet' 2>/dev/null || true)
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

cleanup_patterns=(
  "$project_path"
  "$stage_root"
  "BPXFixture"
  "BlueprintExtractorFixture"
  "UnrealBuildTool"
)
trap 'stop_bpx_fixture_processes' EXIT

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
fixture_config_path="$fixture_root/Config/DefaultRemoteControl.ini"
remote_control_port="${UE_REMOTE_CONTROL_PORT:-}"
if [[ -z "$remote_control_port" ]]; then
  remote_control_port="$(get_free_tcp_port)"
fi
export UE_REMOTE_CONTROL_PORT="$remote_control_port"

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

echo "==> Using staged Remote Control port $remote_control_port"
set_remote_control_port "$fixture_config_path" "$remote_control_port"

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
