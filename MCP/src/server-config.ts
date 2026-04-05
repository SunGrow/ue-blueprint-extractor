const EDITOR_UNAVAILABLE_MESSAGE_FRAGMENT = 'UE Editor not running or Remote Control not available';
const SUBSYSTEM_UNAVAILABLE_MESSAGE_FRAGMENT = 'BlueprintExtractor subsystem not found';

export const EDITOR_POLL_INTERVAL_MS = 1_000;

export const serverInstructions = [
  'Blueprint Extractor MCP uses a v2 public contract with tool profiles, workflow-scoped tool surfaces, snake_case arguments, prompt workflows, and structured JSON results.',
  // Tool discovery
  'Use activate_tool_profile with profile: "default" for the compact scoped surface or profile: "expert" for the full flat tool list. Clients with tool-list change support start in default; fallback clients start in expert.',
  'A compact core tool set is visible in the default profile. Use activate_workflow_scope to load specialized tool families: widget_authoring (or sub-scopes: widget_authoring_structure, widget_authoring_visual, widget_verification), material_authoring, blueprint_authoring, schema_ai_authoring, animation_authoring, data_tables, import, project_control, automation_testing, verification, analysis, and project_intelligence.',
  'Use find_and_extract for search+extract in one call from the default core surface. Use search_assets when you only need to locate assets.',
  'Call get_tool_help before the first use of a complex or polymorphic tool when you need operation-specific payload guidance. Use activate_workflow_scope explicitly when the tool family is not in the current profile.',
  // Deferred tool directory (tools available via activate_workflow_scope)
  'Deferred tool families — widget_authoring_structure: recipe-first widget authoring, tree replacement, diff/patch DSLs, and focused structural edits. widget_authoring_visual: CommonUI styles, widget animations, compile_widget, extraction, and preview capture. widget_verification: captures and comparisons. widget_authoring: activates all three widget sub-scopes. material_authoring: create_material_setup, modify_material DSL/batch authoring, material_graph_operation, and material instances. blueprint_authoring: scaffold_blueprint, modify_blueprint_graphs DSL authoring, member edits, and Live Coding trigger. schema_ai_authoring: structs, enums, blackboards, behavior trees, state trees. animation_authoring: anim sequences, montages, blend spaces, widget animations. data_tables: data assets, input actions, tables, curves. import: import_assets, job tracking. project_control: editor-session binding, launch/wait, project automation context, PIE lifecycle control, host build/restart/sync flows, and apply_window_ui_changes. automation_testing: run/get/list automation tests. verification: widget captures, editor screenshots, runtime screenshots, and comparisons. analysis: deterministic Blueprint review and asset audits. project_intelligence: editor context, project indexing, and metadata-first context search.',
  // Extraction
  'All extract_* tools default to compact: true. Pass compact: false for verbose output.',
  // Search
  'search_assets class_filter and list_assets class_filter accept project asset class names plus empty string for all types.',
  // Widget authoring
  'For UI redesign work, inspect the current HUD, transition widgets, and class defaults before replacing widget trees.',
  'Use execute_widget_recipe, create_menu_screen, apply_widget_patch, apply_widget_diff, or operation-specific widget tools. The deprecated widget aliases were removed.',
  // Material authoring
  'Use material_graph_operation for material settings, node creation, expression wiring, and root-property binding. Use extract_material/create_material/modify_material with asset_kind: "function" for MaterialFunctions.',
  // Design workflows
  'For high-fidelity menu design, first normalize text, image, Figma-export, or HTML/CSS inputs into a shared design_spec_json before authoring Unreal assets.',
  // Mutations and saving
  'Write tools mutate the running editor but do not save automatically. Call save_assets after successful mutations you want to persist.',
  'Each MCP session owns one active editor selection. Use list_running_editors, get_active_editor, select_editor, clear_editor_selection, and launch_editor to control which Unreal Editor instance this session targets.',
  'Multiple simultaneous Unreal Editors must expose distinct Remote Control ports. When the workspace project matches multiple running editors, the server will reject the ambiguity until select_editor chooses one explicitly.',
  'Use wait_for_editor after restart windows or transient Remote Control disconnects before retrying editor-backed tools.',
  'Prefer validate_only=true the first time you author a new asset family or payload shape.',
  // Input authoring
  'Use create_input_action, modify_input_action, create_input_mapping_context, and modify_input_mapping_context for Enhanced Input authoring.',
  // Verification
  'Verify blueprint wiring, layout data, and authored values semantically with the existing extract_* tools before relying on screenshots.',
  'After widget or other user-facing UI mutations, treat the task as incomplete until capture_widget_preview succeeds or you explicitly report partial verification with the blocking reason.',
  'If reference images or motion checkpoint frames exist, compare captures against them. Without references, still capture the result and report lower-confidence or partial verification when fidelity is uncertain.',
  // Motion
  'Motion support includes dedicated widget animation authoring for render_opacity, render_transform translation/scale/angle, and color_and_opacity tracks. Treat broader arbitrary MovieScene track synthesis as deferred_to_future or unsupported when it exceeds that subset.',
  // Testing
  'Use run_automation_tests for gameplay or runtime verification. If no Automation Spec or Functional Test exists for a mechanic, report verification as partial instead of inferring success from structure alone.',
  'Use capture_runtime_screenshot when a runtime verification lane already exports screenshot artifacts through automation. Use capture_editor_screenshot for the active editor viewport when a rendered editor reference is needed.',
  // Results format
  'Successful tool results use structuredContent as the canonical JSON payload. Recoverable execution failures return isError=true with code, message, and recoverable.',
].join('\n');

export const taskAwareTools = new Set([
  'compile_project_code',
  'trigger_live_coding',
  'restart_editor',
  'sync_project_code',
  'import_assets',
  'get_import_job',
  'list_import_jobs',
  'run_automation_tests',
  'capture_runtime_screenshot',
  'get_automation_test_run',
  'list_automation_test_runs',
]);

/**
 * Tool mode annotations for dual-mode (editor / commandlet) execution.
 *
 * 'both'        — Tool works in editor and commandlet modes (read-only extraction + simple writes).
 * 'editor_only' — Tool requires the live editor (complex writes, interactive, verification).
 * 'read_only'   — Tool is purely read-only (subset of 'both', used by executor for capability checks).
 */
import type { ToolModeAnnotation } from './execution/adaptive-executor.js';

export const TOOL_MODE_ANNOTATIONS: ReadonlyMap<string, ToolModeAnnotation> = new Map<string, ToolModeAnnotation>([
  // ── Read-only extraction & search (both) ──
  ['search_assets', 'both'],
  ['list_assets', 'both'],
  ['check_asset_exists', 'both'],
  ['extract_blueprint', 'both'],
  ['extract_asset', 'both'],
  ['extract_material', 'both'],
  ['extract_cascade', 'both'],
  ['extract_widget_blueprint', 'both'],
  ['extract_widget_animation', 'both'],
  ['extract_commonui_button_style', 'both'],
  ['find_and_extract', 'both'],
  ['get_tool_help', 'both'],
  ['list_running_editors', 'both'],
  ['get_active_editor', 'both'],
  ['select_editor', 'both'],
  ['clear_editor_selection', 'both'],
  ['launch_editor', 'both'],
  ['review_blueprint', 'both'],
  ['refresh_project_index', 'both'],
  ['get_project_index_status', 'both'],
  ['search_project_context', 'both'],
  ['audit_project_assets', 'both'],
  ['get_project_automation_context', 'both'],
  ['get_import_job', 'both'],
  ['list_import_jobs', 'both'],
  ['get_automation_test_run', 'both'],
  ['list_automation_test_runs', 'both'],
  ['list_captures', 'both'],
  ['get_editor_context', 'editor_only'],

  // ── Simple writes that work in both modes ──
  ['save_assets', 'both'],
  ['create_blueprint', 'both'],
  ['create_material', 'both'],
  ['create_data_asset', 'both'],
  ['create_data_table', 'both'],

  // ── Widget mutation tools (editor_only) ──
  ['create_widget_blueprint', 'editor_only'],
  ['replace_widget_tree', 'editor_only'],
  ['replace_widget_class', 'editor_only'],
  ['insert_widget_child', 'editor_only'],
  ['remove_widget', 'editor_only'],
  ['move_widget', 'editor_only'],
  ['wrap_widget', 'editor_only'],
  ['patch_widget', 'editor_only'],
  ['patch_widget_class_defaults', 'editor_only'],
  ['batch_widget_operations', 'editor_only'],
  ['apply_widget_diff', 'editor_only'],
  ['compile_widget', 'editor_only'],
  ['create_menu_screen', 'editor_only'],
  ['apply_widget_patch', 'editor_only'],
  ['execute_widget_recipe', 'editor_only'],

  // ── CommonUI style mutation (editor_only) ──
  ['create_commonui_button_style', 'editor_only'],
  ['apply_commonui_button_style', 'editor_only'],
  ['modify_commonui_button_style', 'editor_only'],

  // ── Widget animation authoring (editor_only) ──
  ['create_widget_animation', 'editor_only'],
  ['modify_widget_animation', 'editor_only'],

  // ── Material mutation tools (editor_only) ──
  ['modify_material', 'editor_only'],
  ['material_graph_operation', 'editor_only'],
  ['compile_material_asset', 'editor_only'],
  ['create_material_instance', 'editor_only'],
  ['modify_material_instance', 'editor_only'],
  ['create_material_setup', 'editor_only'],

  // ── Blueprint mutation tools (editor_only) ──
  ['modify_blueprint_members', 'editor_only'],
  ['modify_blueprint_graphs', 'editor_only'],
  ['scaffold_blueprint', 'editor_only'],

  // ── Schema & AI authoring mutation (editor_only) ──
  ['create_user_defined_struct', 'editor_only'],
  ['modify_user_defined_struct', 'editor_only'],
  ['create_user_defined_enum', 'editor_only'],
  ['modify_user_defined_enum', 'editor_only'],
  ['create_blackboard', 'editor_only'],
  ['modify_blackboard', 'editor_only'],
  ['create_behavior_tree', 'editor_only'],
  ['modify_behavior_tree', 'editor_only'],
  ['create_state_tree', 'editor_only'],
  ['modify_state_tree', 'editor_only'],

  // ── Animation authoring (editor_only) ──
  ['create_anim_sequence', 'editor_only'],
  ['modify_anim_sequence', 'editor_only'],
  ['create_anim_montage', 'editor_only'],
  ['modify_anim_montage', 'editor_only'],
  ['create_blend_space', 'editor_only'],
  ['modify_blend_space', 'editor_only'],

  // ── Data & input mutation (editor_only) ──
  ['modify_data_asset', 'editor_only'],
  ['create_input_action', 'editor_only'],
  ['modify_input_action', 'editor_only'],
  ['create_input_mapping_context', 'editor_only'],
  ['modify_input_mapping_context', 'editor_only'],
  ['modify_data_table', 'editor_only'],
  ['create_curve', 'editor_only'],
  ['modify_curve', 'editor_only'],
  ['create_curve_table', 'editor_only'],
  ['modify_curve_table', 'editor_only'],

  // ── Project control (editor_only) ──
  ['compile_project_code', 'both'],
  ['restart_editor', 'editor_only'],
  ['trigger_live_coding', 'editor_only'],
  ['sync_project_code', 'both'],
  ['wait_for_editor', 'editor_only'],
  ['start_pie', 'editor_only'],
  ['stop_pie', 'editor_only'],
  ['relaunch_pie', 'editor_only'],

  // ── Import (editor_only) ──
  ['import_assets', 'editor_only'],

  // ── Automation tests (editor_only) ──
  ['run_automation_tests', 'both'],

  // ── Verification / captures (editor_only) ──
  ['capture_widget_preview', 'editor_only'],
  ['capture_editor_screenshot', 'editor_only'],
  ['capture_runtime_screenshot', 'both'],
  ['capture_widget_motion_checkpoints', 'editor_only'],
  ['compare_capture_to_reference', 'editor_only'],
  ['compare_motion_capture_bundle', 'editor_only'],
  ['cleanup_captures', 'editor_only'],

  // ── Window UI (editor_only) ──
  ['apply_window_ui_changes', 'editor_only'],

  // ── Meta tools (both — no subsystem call needed) ──
  ['activate_tool_profile', 'both'],
  ['activate_workflow_scope', 'both'],
]);

export function classifyRecoverableToolFailure(toolName: string, message: string, payload?: unknown) {
  // ── Dual-mode execution errors ──
  if (message.includes('MODE_UNAVAILABLE')) {
    return {
      code: 'mode_unavailable',
      recoverable: true,
      retry_after_ms: EDITOR_POLL_INTERVAL_MS,
      next_steps: [
        'Start the Unreal Editor and ensure Remote Control is enabled.',
        'Call wait_for_editor to wait for the editor to come online.',
        `Retry ${toolName} after the editor is available.`,
      ],
    };
  }

  if (message.includes('CAPABILITY_MISMATCH')) {
    return {
      code: 'capability_mismatch',
      recoverable: true,
      retry_after_ms: EDITOR_POLL_INTERVAL_MS,
      next_steps: [
        `Tool '${toolName}' requires the Unreal Editor for full functionality.`,
        'Start the editor and call wait_for_editor before retrying.',
        'Commandlet mode only supports read-only extraction and simple write operations.',
      ],
    };
  }

  if (message.includes('COMMANDLET_TIMEOUT') || (message.includes('Commandlet') && message.includes('timeout'))) {
    return {
      code: 'commandlet_timeout',
      recoverable: true,
      retry_after_ms: 10_000,
      next_steps: [
        'The commandlet process timed out. It may be loading a large project.',
        'Retry the operation — the commandlet may have finished initializing.',
        'Consider starting the editor for faster interactive operations.',
      ],
    };
  }

  if (message.includes(EDITOR_UNAVAILABLE_MESSAGE_FRAGMENT)) {
    return {
      code: 'editor_unavailable',
      recoverable: true,
      retry_after_ms: EDITOR_POLL_INTERVAL_MS,
      next_steps: [
        'Call wait_for_editor to wait for the UE editor and Remote Control to come back online.',
        `Retry ${toolName} after wait_for_editor returns connected=true.`,
      ],
    };
  }

  if (message.includes('No active editor is selected for this MCP session')) {
    return {
      code: 'no_active_editor',
      recoverable: true,
      next_steps: [
        'Call list_running_editors to inspect the running Unreal Editor instances.',
        'Call select_editor to bind this MCP session to the intended editor, or call launch_editor to start one.',
      ],
    };
  }

  if (message.includes('Multiple running editors match the workspace project')) {
    return {
      code: 'ambiguous_active_editor',
      recoverable: true,
      next_steps: [
        'Call list_running_editors to inspect the matching editor instances.',
        'Call select_editor with the intended instance_id to bind this session explicitly.',
      ],
    };
  }

  if (message.includes('Active editor mismatch')) {
    return {
      code: 'active_editor_mismatch',
      recoverable: true,
      next_steps: [
        'Call get_active_editor to inspect the current session binding.',
        'Call clear_editor_selection or select_editor before retrying with a different project or engine.',
      ],
    };
  }

  if (message.includes('previously selected active editor')) {
    return {
      code: 'active_editor_drift',
      recoverable: true,
      next_steps: [
        'Call list_running_editors to inspect the currently reachable editor instances.',
        'Call select_editor to rebind the session to the intended editor.',
      ],
    };
  }

  if (message.includes(SUBSYSTEM_UNAVAILABLE_MESSAGE_FRAGMENT)) {
    return {
      code: 'subsystem_unavailable',
      recoverable: true,
      retry_after_ms: EDITOR_POLL_INTERVAL_MS,
      next_steps: [
        'Call wait_for_editor to confirm the editor has fully reconnected.',
        'If a write operation (patch_class_defaults, modify_blueprint_members, etc.) was in progress, the editor may have crashed. Check the editor log and consider `git checkout` to recover modified assets.',
        'Use restart_editor with force_kill: true if the editor process is unresponsive.',
      ],
    };
  }

  if (message.includes('requires engine_root or UE_ENGINE_ROOT')) {
    return {
      code: 'engine_root_missing',
      recoverable: false,
      next_steps: [
        'Pass engine_root explicitly: { "engine_root": "C:/Program Files/Epic Games/UE_5.6" }',
        'Or set the UE_ENGINE_ROOT environment variable to your Unreal Engine root directory.',
      ],
    };
  }

  if (message.includes('timed out') || message.includes('timeout') || message.includes('ETIMEDOUT') || message.includes('ESOCKETTIMEDOUT')) {
    return {
      code: 'timeout',
      recoverable: true,
      retry_after_ms: 5000,
      next_steps: [
        'Retry with simpler payload or increase timeout',
        'Check if UE editor is responding (call wait_for_editor)',
        'For StateTree tools, try splitting complex payloads into multiple calls',
      ],
    };
  }

  if (message.includes('JSON') || message.includes('Unexpected token') || message.includes('SyntaxError')) {
    return {
      code: 'invalid_response',
      recoverable: true,
      next_steps: [
        'Check UE editor output log for errors',
        'The editor may have returned an HTML error page instead of JSON',
        'Retry the operation — this may be a transient serialization issue',
      ],
    };
  }

  if (message.includes('locked by another process') || message.includes('locked file') || message.includes('cannot access the file')) {
    return {
      code: 'locked_file',
      recoverable: true,
      next_steps: [
        'Close UE editor to release DLL locks',
        'Call restart_editor, then retry the build',
        'If editor was just restarted, the cached build may apply automatically',
      ],
    };
  }

  if (message.includes('Empty response') || message.includes('empty response') || message === '') {
    return {
      code: 'empty_response',
      recoverable: true,
      next_steps: [
        'Verify the asset path exists',
        'Check editor connection with wait_for_editor',
        'The UE subsystem may have crashed — check editor logs',
      ],
    };
  }

  if (message.includes('composite') || (typeof payload === 'object' && payload && Array.isArray((payload as any).steps) && (payload as any).steps.some((s: any) => s.status === 'failure'))) {
    return {
      code: 'composite_partial_failure',
      recoverable: true,
      next_steps: [
        'Review the steps array to identify which step failed',
        'Retry the failed step individually',
        'Check partial_state for what was completed',
      ],
    };
  }

  return null;
}
