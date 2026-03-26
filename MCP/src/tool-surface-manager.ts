import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export type WorkflowScopeId =
  | 'widget_authoring'
  | 'material_authoring'
  | 'blueprint_authoring'
  | 'schema_ai_authoring'
  | 'animation_authoring'
  | 'data_tables'
  | 'import'
  | 'automation_testing'
  | 'verification';

export interface WorkflowScope {
  id: WorkflowScopeId;
  tools: string[];
  prompts: string[];
  description: string;
}

export const WORKFLOW_SCOPE_IDS: readonly WorkflowScopeId[] = [
  'widget_authoring',
  'material_authoring',
  'blueprint_authoring',
  'schema_ai_authoring',
  'animation_authoring',
  'data_tables',
  'import',
  'automation_testing',
  'verification',
] as const;

export const CORE_TOOLS: ReadonlySet<string> = new Set([
  'search_assets',
  'extract_blueprint',
  'extract_asset',
  'extract_material',
  'extract_cascade',
  'extract_widget_blueprint',
  'extract_widget_animation',
  'extract_commonui_button_style',
  'list_assets',
  'find_and_extract',
  'save_assets',
  'get_tool_help',
  'wait_for_editor',
  'activate_workflow_scope',
  'get_project_automation_context',
  'compile_project_code',
  'trigger_live_coding',
  'restart_editor',
  'sync_project_code',
]);

const SCOPE_DEFINITIONS: Record<WorkflowScopeId, WorkflowScope> = {
  widget_authoring: {
    id: 'widget_authoring',
    description: 'Widget authoring, verification, CommonUI, and extraction tools',
    prompts: [],
    tools: [
      // widget structure
      'create_widget_blueprint', 'replace_widget_tree', 'patch_widget',
      'patch_widget_class_defaults', 'insert_widget_child', 'remove_widget',
      'move_widget', 'wrap_widget', 'replace_widget_class',
      'batch_widget_operations', 'compile_widget', 'modify_widget_blueprint',
      'build_widget_tree', 'modify_widget', 'compile_widget_blueprint',
      // widget verification
      'capture_widget_preview', 'capture_widget_motion_checkpoints',
      'compare_capture_to_reference', 'list_captures', 'cleanup_captures',
      'compare_motion_capture_bundle',
      // commonui
      'create_commonui_button_style', 'modify_commonui_button_style',
      'apply_commonui_button_style',
      // widget animation authoring
      'create_widget_animation', 'modify_widget_animation',
      // window UI
      'apply_window_ui_changes',
    ],
  },
  material_authoring: {
    id: 'material_authoring',
    description: 'Material authoring, material instances, and extraction tools',
    prompts: [],
    tools: [
      // material authoring
      'create_material', 'material_graph_operation', 'modify_material',
      'compile_material_asset',
      // material instance
      'create_material_instance', 'modify_material_instance',
    ],
  },
  blueprint_authoring: {
    id: 'blueprint_authoring',
    description: 'Blueprint authoring and extraction tools',
    prompts: [],
    tools: [
      'create_blueprint', 'modify_blueprint_members', 'modify_blueprint_graphs',
    ],
  },
  schema_ai_authoring: {
    id: 'schema_ai_authoring',
    description: 'Schema and AI authoring tools (structs, enums, behavior trees, state trees)',
    prompts: [],
    tools: [
      'create_user_defined_struct', 'modify_user_defined_struct',
      'create_user_defined_enum', 'modify_user_defined_enum',
      'create_blackboard', 'modify_blackboard',
      'create_behavior_tree', 'modify_behavior_tree',
      'create_state_tree', 'modify_state_tree',
    ],
  },
  animation_authoring: {
    id: 'animation_authoring',
    description: 'Animation authoring, widget animation, verification, and extraction tools',
    prompts: [],
    tools: [
      // animation authoring
      'create_anim_sequence', 'modify_anim_sequence',
      'create_anim_montage', 'modify_anim_montage',
      'create_blend_space', 'modify_blend_space',
      // widget animation authoring
      'create_widget_animation', 'modify_widget_animation',
      // widget verification (for animation previews)
      'capture_widget_preview', 'capture_widget_motion_checkpoints',
      'compare_capture_to_reference', 'list_captures', 'cleanup_captures',
      'compare_motion_capture_bundle',
    ],
  },
  data_tables: {
    id: 'data_tables',
    description: 'Data assets, input actions, tables, and curves tools',
    prompts: [],
    tools: [
      // data and input
      'create_data_asset', 'modify_data_asset',
      'create_input_action', 'modify_input_action',
      'create_input_mapping_context', 'modify_input_mapping_context',
      // tables and curves
      'create_data_table', 'modify_data_table',
      'create_curve', 'modify_curve',
      'create_curve_table', 'modify_curve_table',
    ],
  },
  import: {
    id: 'import',
    description: 'Import tools for assets, textures, and meshes',
    prompts: [],
    tools: [
      'import_assets', 'get_import_job', 'list_import_jobs',
    ],
  },
  automation_testing: {
    id: 'automation_testing',
    description: 'Automation test execution and result retrieval',
    prompts: [],
    tools: [
      'run_automation_tests', 'get_automation_test_run', 'list_automation_test_runs',
    ],
  },
  verification: {
    id: 'verification',
    description: 'Widget verification and capture tools',
    prompts: [],
    tools: [
      'capture_widget_preview', 'capture_widget_motion_checkpoints',
      'compare_capture_to_reference', 'list_captures', 'cleanup_captures',
      'compare_motion_capture_bundle',
    ],
  },
};

export class ToolSurfaceManager {
  private registeredToolMap: Map<string, RegisteredTool>;
  private activeScope: WorkflowScopeId | null = null;
  private activeTools = new Set<string>();
  private mode: 'scoped' | 'flat' = 'scoped';

  constructor(registeredToolMap: Map<string, RegisteredTool>) {
    this.registeredToolMap = registeredToolMap;
  }

  activateScope(scopeId: WorkflowScopeId, additive = false): void {
    const scope = SCOPE_DEFINITIONS[scopeId];
    if (!scope) {
      throw new Error(`Unknown workflow scope: ${scopeId}`);
    }

    const targetTools = new Set<string>([
      ...CORE_TOOLS,
      ...scope.tools,
    ]);

    if (additive) {
      // Merge with currently active tools
      for (const tool of this.activeTools) {
        targetTools.add(tool);
      }
    }

    this.applyToolSet(targetTools);
    this.activeScope = scopeId;
    this.activeTools = targetTools;
  }

  resetToDefault(): void {
    this.applyToolSet(new Set(CORE_TOOLS));
    this.activeScope = null;
    this.activeTools = new Set(CORE_TOOLS);
  }

  isActive(toolName: string): boolean {
    return this.activeTools.has(toolName);
  }

  getActiveTools(): Set<string> {
    return new Set(this.activeTools);
  }

  getActiveScope(): WorkflowScopeId | null {
    return this.activeScope;
  }

  onPromptInvoked(promptName: string): void {
    for (const scope of Object.values(SCOPE_DEFINITIONS)) {
      if (scope.prompts.includes(promptName)) {
        this.activateScope(scope.id);
        return;
      }
    }
  }

  enableFlatMode(): void {
    this.mode = 'flat';
    const allTools = new Set<string>();
    for (const name of this.registeredToolMap.keys()) {
      allTools.add(name);
    }
    this.applyToolSet(allTools);
    this.activeScope = null;
    this.activeTools = allTools;
  }

  enableScopedMode(): void {
    this.mode = 'scoped';
    this.resetToDefault();
  }

  getMode(): 'scoped' | 'flat' {
    return this.mode;
  }

  getScopeDefinition(scopeId: WorkflowScopeId): WorkflowScope {
    return SCOPE_DEFINITIONS[scopeId];
  }

  private applyToolSet(targetTools: Set<string>): void {
    for (const [name, registeredTool] of this.registeredToolMap) {
      if (targetTools.has(name)) {
        registeredTool.enable();
      } else {
        registeredTool.disable();
      }
    }
  }
}
