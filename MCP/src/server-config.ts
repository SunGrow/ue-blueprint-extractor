const EDITOR_UNAVAILABLE_MESSAGE_FRAGMENT = 'UE Editor not running or Remote Control not available';
const SUBSYSTEM_UNAVAILABLE_MESSAGE_FRAGMENT = 'BlueprintExtractor subsystem not found';

export const EDITOR_POLL_INTERVAL_MS = 1_000;

export const serverInstructions = [
  'Blueprint Extractor MCP v3 exposes explicit snake_case tool arguments, prompt workflows, and structured JSON tool results.',
  'Use search_assets before extract_* tools when the exact asset path is not already known.',
  'Call get_tool_help before the first use of a complex or polymorphic tool when you need operation-specific payload guidance.',
  'search_assets class_filter and list_assets class_filter accept project asset class names plus empty string for all types.',
  'For UI redesign work, inspect the current HUD, transition widgets, and class defaults before replacing widget trees.',
  'For high-fidelity menu design, first normalize text, image, Figma-export, or HTML/CSS inputs into a shared design_spec_json before authoring Unreal assets.',
  'Write tools mutate the running editor but do not save automatically. Call save_assets after successful mutations you want to persist.',
  'Use wait_for_editor after restart windows or transient Remote Control disconnects before retrying editor-backed tools.',
  'Prefer validate_only=true the first time you author a new asset family or payload shape.',
  'Use material_graph_operation for material settings, node creation, expression wiring, and root-property binding. Treat modify_material and modify_material_function as advanced escape hatches.',
  'Use create_input_action, modify_input_action, create_input_mapping_context, and modify_input_mapping_context for Enhanced Input authoring. Generic data asset mutation is intentionally rejected for those asset classes.',
  'Verify blueprint wiring, layout data, and authored values semantically with the existing extract_* tools before relying on screenshots.',
  'After widget or other user-facing UI mutations, treat the task as incomplete until capture_widget_preview succeeds or you explicitly report partial verification with the blocking reason.',
  'If reference images or motion checkpoint frames exist, compare captures against them. Without references, still capture the result and report lower-confidence or partial verification when fidelity is uncertain.',
  'Treat text+image and PNG/Figma inputs as first-class visual references. HTML/CSS can reach near parity when you extract design tokens and compare against rendered reference frames instead of assuming direct DOM-to-UMG translation.',
  'Motion support includes dedicated widget animation authoring for render_opacity, render_transform translation/scale/angle, and color_and_opacity tracks. Treat broader arbitrary MovieScene track synthesis as deferred_to_future or unsupported when it exceeds that subset.',
  'Use run_automation_tests for gameplay or runtime verification. If no Automation Spec or Functional Test exists for a mechanic, report verification as partial instead of inferring success from structure alone.',
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

export function classifyRecoverableToolFailure(toolName: string, message: string) {
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

  return null;
}
