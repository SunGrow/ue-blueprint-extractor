import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ToolProfileId = 'default' | 'expert';

export type WorkflowScopeId =
  | 'widget_authoring'
  | 'widget_authoring_structure'
  | 'widget_authoring_visual'
  | 'widget_verification'
  | 'material_authoring'
  | 'blueprint_authoring'
  | 'schema_ai_authoring'
  | 'animation_authoring'
  | 'data_tables'
  | 'import'
  | 'project_control'
  | 'automation_testing'
  | 'verification'
  | 'analysis'
  | 'project_intelligence';

export interface WorkflowScope {
  id: WorkflowScopeId;
  tools: string[];
  prompts: string[];
  description: string;
}

export const WORKFLOW_SCOPE_IDS: readonly WorkflowScopeId[] = [
  'widget_authoring',
  'widget_authoring_structure',
  'widget_authoring_visual',
  'widget_verification',
  'material_authoring',
  'blueprint_authoring',
  'schema_ai_authoring',
  'animation_authoring',
  'data_tables',
  'import',
  'project_control',
  'automation_testing',
  'verification',
  'analysis',
  'project_intelligence',
] as const;

/**
 * Keep the always-visible default surface small so weaker models can route
 * through search, routed extraction, and explicit help before expanding.
 */
export const CORE_TOOLS: ReadonlySet<string> = new Set([
  'search_assets',
  'find_and_extract',
  'extract_blueprint',
  'extract_asset',
  'check_asset_exists',
  'save_assets',
  'get_tool_help',
  'activate_tool_profile',
  'activate_workflow_scope',
]);

/**
 * Parent scopes expand to the union of their sub-scopes when activated.
 * This provides backward compatibility: activating 'widget_authoring' loads
 * all three widget sub-scopes automatically.
 */
const PARENT_SCOPE_CHILDREN: Partial<Record<WorkflowScopeId, WorkflowScopeId[]>> = {
  widget_authoring: ['widget_authoring_structure', 'widget_authoring_visual', 'widget_verification'],
};

const SCOPE_DEFINITIONS: Record<WorkflowScopeId, WorkflowScope> = {
  // -- Parent scope: tools list is the union of its children (computed at activation) --
  widget_authoring: {
    id: 'widget_authoring',
    description: 'All widget authoring tools (structure, visual, and verification sub-scopes)',
    prompts: [],
    tools: [], // Populated dynamically from sub-scopes at activation time
  },
  // -- Widget sub-scopes --
  widget_authoring_structure: {
    id: 'widget_authoring_structure',
    description: 'Widget tree structure and mutation tools',
    prompts: [],
    tools: [
      'execute_widget_recipe', 'create_menu_screen', 'apply_widget_patch',
      'replace_widget_tree', 'apply_widget_diff',
      'create_widget_blueprint',
      'replace_widget_class', 'insert_widget_child', 'remove_widget',
      'move_widget', 'wrap_widget', 'patch_widget', 'patch_widget_class_defaults',
      'batch_widget_operations',
    ],
  },
  widget_authoring_visual: {
    id: 'widget_authoring_visual',
    description: 'Widget visual authoring, CommonUI styles, animations, and compilation tools',
    prompts: [],
    tools: [
      'create_commonui_button_style', 'apply_commonui_button_style',
      'modify_commonui_button_style', 'extract_commonui_button_style',
      'extract_widget_blueprint',
      'create_widget_animation', 'modify_widget_animation', 'extract_widget_animation',
      'compile_widget',
      'capture_widget_preview',
    ],
  },
  widget_verification: {
    id: 'widget_verification',
    description: 'Widget capture, comparison, and verification tools',
    prompts: [],
    tools: [
      'capture_widget_preview', 'compare_capture_to_reference',
      'capture_widget_motion_checkpoints', 'compare_motion_capture_bundle',
      'list_captures', 'cleanup_captures',
    ],
  },
  // -- Other scopes --
  material_authoring: {
    id: 'material_authoring',
    description: 'Material authoring, material instances, and extraction tools',
    prompts: [],
    tools: [
      'create_material_setup', 'modify_material', 'material_graph_operation',
      'create_material',
      'compile_material_asset',
      'create_material_instance', 'modify_material_instance',
    ],
  },
  blueprint_authoring: {
    id: 'blueprint_authoring',
    description: 'Blueprint authoring and extraction tools',
    prompts: [],
    tools: [
      'scaffold_blueprint', 'modify_blueprint_graphs', 'modify_blueprint_members',
      'create_blueprint',
      'trigger_live_coding',
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
    description: 'Animation authoring and widget animation tools',
    prompts: [],
    tools: [
      'create_anim_sequence', 'modify_anim_sequence',
      'create_anim_montage', 'modify_anim_montage',
      'create_blend_space', 'modify_blend_space',
      'create_widget_animation', 'modify_widget_animation',
    ],
  },
  data_tables: {
    id: 'data_tables',
    description: 'Data assets, input actions, tables, and curves tools',
    prompts: [],
    tools: [
      'create_data_asset', 'modify_data_asset',
      'create_input_action', 'modify_input_action',
      'create_input_mapping_context', 'modify_input_mapping_context',
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
  project_control: {
    id: 'project_control',
    description: 'Editor-session, build, restart, PIE, and project automation tools',
    prompts: [],
    tools: [
      'list_running_editors', 'get_active_editor', 'select_editor', 'clear_editor_selection',
      'launch_editor', 'wait_for_editor',
      'get_project_automation_context', 'read_output_log', 'list_message_log_listings', 'read_message_log',
      'start_pie', 'stop_pie', 'relaunch_pie',
      'compile_project_code', 'restart_editor', 'sync_project_code',
      'apply_window_ui_changes',
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
      'capture_editor_screenshot', 'capture_runtime_screenshot',
      'capture_widget_preview', 'capture_widget_motion_checkpoints',
      'compare_capture_to_reference', 'list_captures', 'cleanup_captures',
      'compare_motion_capture_bundle',
    ],
  },
  analysis: {
    id: 'analysis',
    description: 'Read-only Blueprint review and asset-audit tools',
    prompts: [
      'review_blueprint_asset',
      'audit_blueprint_project',
    ],
    tools: [
      'review_blueprint',
      'audit_project_assets',
    ],
  },
  project_intelligence: {
    id: 'project_intelligence',
    description: 'Read-only editor context and project intelligence tools',
    prompts: [
      'understand_blueprint_project',
      'snapshot_editor_context',
    ],
    tools: [
      'get_editor_context',
      'refresh_project_index',
      'get_project_index_status',
      'search_project_context',
    ],
  },
};

export class ToolSurfaceManager {
  private registeredToolMap: Map<string, RegisteredTool>;
  private activeProfile: ToolProfileId = 'default';
  private activeScope: WorkflowScopeId | null = null;
  private activeTools = new Set<string>();
  private mode: 'scoped' | 'flat' = 'scoped';

  constructor(registeredToolMap: Map<string, RegisteredTool>) {
    this.registeredToolMap = registeredToolMap;
  }

  activateProfile(profileId: ToolProfileId): void {
    if (profileId === 'expert') {
      this.enableFlatMode();
      return;
    }

    this.enableScopedMode();
  }

  activateScope(scopeId: WorkflowScopeId, additive = false): void {
    const scope = SCOPE_DEFINITIONS[scopeId];
    if (!scope) {
      throw new Error(`Unknown workflow scope: ${scopeId}`);
    }

    const targetTools = new Set<string>([...CORE_TOOLS]);

    // If this is a parent scope, collect tools from all child sub-scopes
    const children = PARENT_SCOPE_CHILDREN[scopeId];
    if (children && children.length > 0) {
      for (const childId of children) {
        const childScope = SCOPE_DEFINITIONS[childId];
        for (const tool of childScope.tools) {
          targetTools.add(tool);
        }
      }
    } else {
      for (const tool of scope.tools) {
        targetTools.add(tool);
      }
    }

    if (additive) {
      // Merge with currently active tools
      for (const tool of this.activeTools) {
        targetTools.add(tool);
      }
    }

    if (this.mode === 'flat') {
      this.activeScope = scopeId;
      return;
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
    this.activeProfile = 'expert';
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
    this.activeProfile = 'default';
    this.resetToDefault();
  }

  getMode(): 'scoped' | 'flat' {
    return this.mode;
  }

  getProfile(): ToolProfileId {
    return this.activeProfile;
  }

  getScopeDefinition(scopeId: WorkflowScopeId): WorkflowScope {
    const scope = SCOPE_DEFINITIONS[scopeId];
    const children = PARENT_SCOPE_CHILDREN[scopeId];
    if (children && children.length > 0) {
      // Return a computed scope with tools merged from all children
      const mergedTools = new Set<string>();
      for (const childId of children) {
        for (const tool of SCOPE_DEFINITIONS[childId].tools) {
          mergedTools.add(tool);
        }
      }
      return { ...scope, tools: [...mergedTools] };
    }
    return scope;
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
