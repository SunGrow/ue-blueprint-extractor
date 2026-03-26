const EDITOR_UNAVAILABLE_MESSAGE_FRAGMENT = 'UE Editor not running or Remote Control not available';
const SUBSYSTEM_UNAVAILABLE_MESSAGE_FRAGMENT = 'BlueprintExtractor subsystem not found';

export const EDITOR_POLL_INTERVAL_MS = 1_000;

export const serverInstructions = [
  'Blueprint Extractor MCP v4 uses workflow-scoped tool surfaces, snake_case arguments, prompt workflows, and structured JSON results.',
  // Tool discovery
  'Only ~19 core tools are visible by default. Use activate_workflow_scope to load specialized tool families: widget_authoring, material_authoring, blueprint_authoring, schema_ai_authoring, animation_authoring, data_tables, import, automation_testing, verification.',
  'Use find_and_extract for search+extract in one call when you know the search criteria and extraction type. Use search_assets when you only need to locate assets.',
  'Call get_tool_help before the first use of a complex or polymorphic tool when you need operation-specific payload guidance. This may also auto-activate the relevant workflow scope.',
  // Deferred tool directory (tools available via activate_workflow_scope)
  'Deferred tool families — widget_authoring: create/replace/patch/insert/remove/move/wrap widgets, compile_widget, captures, CommonUI styles, widget animations. material_authoring: create/modify material, material_graph_operation, material instances. blueprint_authoring: create/modify blueprint members and graphs. schema_ai_authoring: structs, enums, blackboards, behavior trees, state trees. animation_authoring: anim sequences, montages, blend spaces, widget animations. data_tables: data assets, input actions, tables, curves. import: import_assets, job tracking. automation_testing: run/get/list automation tests. verification: widget captures and comparisons.',
  // Extraction
  'All extract_* tools default to compact: true. Pass compact: false for verbose output.',
  // Search
  'search_assets class_filter and list_assets class_filter accept project asset class names plus empty string for all types.',
  // Widget authoring
  'For UI redesign work, inspect the current HUD, transition widgets, and class defaults before replacing widget trees.',
  'Use operation-specific widget tools (patch_widget, replace_widget_tree, insert_widget_child, etc.) instead of the deprecated modify_widget_blueprint.',
  // Material authoring
  'Use material_graph_operation for material settings, node creation, expression wiring, and root-property binding. Use extract_material/create_material/modify_material with asset_kind: "function" for MaterialFunctions.',
  // Design workflows
  'For high-fidelity menu design, first normalize text, image, Figma-export, or HTML/CSS inputs into a shared design_spec_json before authoring Unreal assets.',
  // Mutations and saving
  'Write tools mutate the running editor but do not save automatically. Call save_assets after successful mutations you want to persist.',
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
  // Results format
  'Successful tool results use structuredContent as the canonical JSON payload. Recoverable execution failures return isError=true with code, message, recoverable, and next_steps.',
].join('\n');

export const taskAwareTools = new Set([
  'compile_project_code',
  'trigger_live_coding',
  'restart_editor',
  'sync_project_code',
  'import_assets',
  'reimport_assets',
  'get_import_job',
  'list_import_jobs',
  'import_textures',
  'import_meshes',
  'run_automation_tests',
  'get_automation_test_run',
  'list_automation_test_runs',
]);

export function classifyRecoverableToolFailure(toolName: string, message: string, payload?: unknown) {
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

  if (message.includes(SUBSYSTEM_UNAVAILABLE_MESSAGE_FRAGMENT)) {
    return {
      code: 'subsystem_unavailable',
      recoverable: true,
      retry_after_ms: EDITOR_POLL_INTERVAL_MS,
      next_steps: [
        'Call wait_for_editor to confirm the editor has fully reconnected after the restart window.',
        'If the editor is connected but this persists, verify the BlueprintExtractor plugin/subsystem loaded successfully and retry the same tool.',
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
