import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

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
  'widget_authoring_structure',
  'widget_authoring_visual',
  'widget_verification',
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
  'list_assets',
  'check_asset_exists',
  'save_assets',
  'get_tool_help',
  'activate_workflow_scope',
  'wait_for_editor',
  'compile_project_code',
  'restart_editor',
  'sync_project_code',
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
      'create_widget_blueprint', 'build_widget_tree', 'replace_widget_tree',
      'replace_widget_class', 'insert_widget_child', 'remove_widget',
      'move_widget', 'wrap_widget', 'patch_widget', 'patch_widget_class_defaults',
      'modify_widget', 'modify_widget_blueprint', 'batch_widget_operations',
      'find_and_extract',
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
      'compile_widget', 'compile_widget_blueprint',
      'capture_widget_preview',
      'find_and_extract',
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
      'create_material', 'material_graph_operation', 'modify_material',
      'compile_material_asset',
      'create_material_instance', 'modify_material_instance',
      'find_and_extract',
    ],
  },
  blueprint_authoring: {
    id: 'blueprint_authoring',
    description: 'Blueprint authoring and extraction tools',
    prompts: [],
    tools: [
      'create_blueprint', 'modify_blueprint_members', 'modify_blueprint_graphs',
      'trigger_live_coding',
      'find_and_extract',
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
  automation_testing: {
    id: 'automation_testing',
    description: 'Automation test execution and result retrieval',
    prompts: [],
    tools: [
      'run_automation_tests', 'get_automation_test_run', 'list_automation_test_runs',
      'get_project_automation_context', 'start_pie', 'stop_pie', 'relaunch_pie',
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
