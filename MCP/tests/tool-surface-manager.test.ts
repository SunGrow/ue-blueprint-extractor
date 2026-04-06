import { describe, expect, it, beforeEach } from 'vitest';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ToolSurfaceManager,
  CORE_TOOLS,
  WORKFLOW_SCOPE_IDS,
  type WorkflowScopeId,
} from '../src/tool-surface-manager.js';
import { createBlueprintExtractorServer } from '../src/server-factory.js';
import { connectInMemoryServer } from './test-helpers.js';

function createMockRegisteredToolMap(toolNames: string[]): Map<string, RegisteredTool> {
  const map = new Map<string, RegisteredTool>();
  for (const name of toolNames) {
    let enabled = true;
    const tool: RegisteredTool = {
      enabled,
      handler: async () => ({ content: [] }),
      enable() {
        this.enabled = true;
      },
      disable() {
        this.enabled = false;
      },
      update() {},
      remove() {},
    };
    map.set(name, tool);
  }
  return map;
}

const ALL_TEST_TOOLS = [
  // core tools (includes check_asset_exists)
  ...CORE_TOOLS,
  // widget authoring structure
  'create_widget_blueprint', 'replace_widget_tree',
  'replace_widget_class', 'insert_widget_child', 'remove_widget',
  'move_widget', 'wrap_widget', 'patch_widget', 'patch_widget_class_defaults',
  'batch_widget_operations',
  'apply_widget_diff', 'create_menu_screen', 'apply_widget_patch', 'execute_widget_recipe',
  // widget authoring visual
  'create_commonui_button_style', 'apply_commonui_button_style',
  'modify_commonui_button_style', 'extract_commonui_button_style',
  'extract_widget_blueprint',
  'create_widget_animation', 'modify_widget_animation', 'extract_widget_animation',
  'compile_widget',
  // widget verification
  'capture_widget_preview', 'capture_widget_motion_checkpoints',
  'compare_capture_to_reference', 'compare_motion_capture_bundle',
  'list_captures', 'cleanup_captures',
  // generic verification captures
  'capture_editor_screenshot', 'capture_runtime_screenshot',
  // tools moved from core to scopes
  'trigger_live_coding',
  // material authoring
  'create_material', 'material_graph_operation', 'modify_material',
  'compile_material_asset',
  'create_material_instance', 'modify_material_instance',
  // blueprint authoring
  'create_blueprint', 'modify_blueprint_members', 'modify_blueprint_graphs',
  // schema & AI
  'create_user_defined_struct', 'modify_user_defined_struct',
  'create_user_defined_enum', 'modify_user_defined_enum',
  'create_blackboard', 'modify_blackboard',
  'create_behavior_tree', 'modify_behavior_tree',
  'create_state_tree', 'modify_state_tree',
  // animation authoring
  'create_anim_sequence', 'modify_anim_sequence',
  'create_anim_montage', 'modify_anim_montage',
  'create_blend_space', 'modify_blend_space',
  // data & input
  'create_data_asset', 'modify_data_asset',
  'create_input_action', 'modify_input_action',
  'create_input_mapping_context', 'modify_input_mapping_context',
  // tables & curves
  'create_data_table', 'modify_data_table',
  'create_curve', 'modify_curve',
  'create_curve_table', 'modify_curve_table',
  // import
  'import_assets', 'get_import_job', 'list_import_jobs',
  // project control
  'list_running_editors', 'get_active_editor', 'select_editor', 'clear_editor_selection',
  'launch_editor', 'wait_for_editor', 'compile_project_code', 'restart_editor', 'sync_project_code',
  'get_project_automation_context', 'read_output_log', 'list_message_log_listings', 'read_message_log', 'apply_window_ui_changes',
  // automation
  'run_automation_tests', 'get_automation_test_run', 'list_automation_test_runs',
  'start_pie', 'stop_pie', 'relaunch_pie',
  // analysis
  'review_blueprint', 'audit_project_assets',
  // project intelligence
  'get_editor_context', 'refresh_project_index', 'get_project_index_status', 'search_project_context',
];

describe('ToolSurfaceManager', () => {
  let toolMap: Map<string, RegisteredTool>;
  let manager: ToolSurfaceManager;

  beforeEach(() => {
    toolMap = createMockRegisteredToolMap(ALL_TEST_TOOLS);
    manager = new ToolSurfaceManager(toolMap);
  });

  describe('resetToDefault', () => {
    it('enables only core tools', () => {
      manager.resetToDefault();
      const active = manager.getActiveTools();

      expect(active.size).toBe(CORE_TOOLS.size);
      for (const coreTool of CORE_TOOLS) {
        expect(active.has(coreTool)).toBe(true);
      }
    });

    it('disables non-core tools', () => {
      manager.resetToDefault();

      for (const [name, tool] of toolMap) {
        if (CORE_TOOLS.has(name)) {
          expect(tool.enabled).toBe(true);
        } else {
          expect(tool.enabled).toBe(false);
        }
      }
    });

    it('clears active scope', () => {
      manager.activateScope('widget_authoring');
      expect(manager.getActiveScope()).toBe('widget_authoring');

      manager.resetToDefault();
      expect(manager.getActiveScope()).toBeNull();
    });
  });

  describe('activateScope', () => {
    it('widget_authoring loads all widget sub-scope tools plus core', () => {
      manager.activateScope('widget_authoring');
      const active = manager.getActiveTools();

      // Core tools should be active
      for (const coreTool of CORE_TOOLS) {
        expect(active.has(coreTool)).toBe(true);
      }

      // Structure sub-scope tools
      expect(active.has('execute_widget_recipe')).toBe(true);
      expect(active.has('apply_widget_patch')).toBe(true);
      expect(active.has('create_widget_blueprint')).toBe(true);
      expect(active.has('patch_widget')).toBe(true);
      expect(active.has('batch_widget_operations')).toBe(true);
      // Visual sub-scope tools
      expect(active.has('create_commonui_button_style')).toBe(true);
      expect(active.has('create_widget_animation')).toBe(true);
      expect(active.has('compile_widget')).toBe(true);

      // Verification sub-scope tools
      expect(active.has('capture_widget_preview')).toBe(true);
      expect(active.has('compare_capture_to_reference')).toBe(true);
      expect(active.has('cleanup_captures')).toBe(true);

      // find_and_extract reachable via widget sub-scopes
      expect(active.has('find_and_extract')).toBe(true);

      // Non-widget tools should be disabled
      expect(active.has('create_material')).toBe(false);
      expect(active.has('create_blueprint')).toBe(false);
      expect(active.has('import_assets')).toBe(false);
    });

    it('widget_authoring_structure loads structure tools plus core', () => {
      manager.activateScope('widget_authoring_structure');
      const active = manager.getActiveTools();

      expect(active.has('execute_widget_recipe')).toBe(true);
      expect(active.has('create_menu_screen')).toBe(true);
      expect(active.has('apply_widget_patch')).toBe(true);
      expect(active.has('create_widget_blueprint')).toBe(true);
      expect(active.has('replace_widget_tree')).toBe(true);
      expect(active.has('patch_widget')).toBe(true);
      expect(active.has('find_and_extract')).toBe(true);

      // Visual tools should not be loaded
      expect(active.has('create_commonui_button_style')).toBe(false);
      expect(active.has('compile_widget')).toBe(false);
    });

    it('widget_authoring_visual loads visual tools plus core', () => {
      manager.activateScope('widget_authoring_visual');
      const active = manager.getActiveTools();

      expect(active.has('create_commonui_button_style')).toBe(true);
      expect(active.has('extract_widget_blueprint')).toBe(true);
      expect(active.has('compile_widget')).toBe(true);
      expect(active.has('find_and_extract')).toBe(true);

      // Structure tools should not be loaded
      expect(active.has('replace_widget_tree')).toBe(false);
    });

    it('widget_verification loads verification tools plus core', () => {
      manager.activateScope('widget_verification');
      const active = manager.getActiveTools();

      expect(active.has('capture_widget_preview')).toBe(true);
      expect(active.has('compare_capture_to_reference')).toBe(true);
      expect(active.has('capture_widget_motion_checkpoints')).toBe(true);
      expect(active.has('compare_motion_capture_bundle')).toBe(true);
      expect(active.has('list_captures')).toBe(true);
      expect(active.has('cleanup_captures')).toBe(true);

      // Non-verification widget tools should not be loaded
      expect(active.has('create_widget_blueprint')).toBe(false);
      expect(active.has('create_commonui_button_style')).toBe(false);
    });

    it('material_authoring loads material tools plus core', () => {
      manager.activateScope('material_authoring');
      const active = manager.getActiveTools();

      expect(active.has('create_material_setup')).toBe(true);
      expect(active.has('modify_material')).toBe(true);
      expect(active.has('create_material')).toBe(true);
      expect(active.has('material_graph_operation')).toBe(true);
      expect(active.has('create_material_instance')).toBe(true);
      expect(active.has('compile_material_asset')).toBe(true);
      expect(active.has('find_and_extract')).toBe(true);

      expect(active.has('create_widget_blueprint')).toBe(false);
    });

    it('blueprint_authoring loads blueprint tools plus core', () => {
      manager.activateScope('blueprint_authoring');
      const active = manager.getActiveTools();

      expect(active.has('scaffold_blueprint')).toBe(true);
      expect(active.has('create_blueprint')).toBe(true);
      expect(active.has('modify_blueprint_members')).toBe(true);
      expect(active.has('modify_blueprint_graphs')).toBe(true);
      expect(active.has('trigger_live_coding')).toBe(true);
      expect(active.has('find_and_extract')).toBe(true);

      expect(active.has('create_material')).toBe(false);
    });

    it('data_tables loads data and input tools', () => {
      manager.activateScope('data_tables');
      const active = manager.getActiveTools();

      expect(active.has('create_data_table')).toBe(true);
      expect(active.has('modify_data_table')).toBe(true);
      expect(active.has('create_curve')).toBe(true);
      expect(active.has('create_data_asset')).toBe(true);
      expect(active.has('create_input_action')).toBe(true);
    });

    it('import loads import tools', () => {
      manager.activateScope('import');
      const active = manager.getActiveTools();

      expect(active.has('import_assets')).toBe(true);
      expect(active.has('get_import_job')).toBe(true);
      expect(active.has('list_import_jobs')).toBe(true);
    });

    it('automation_testing loads automation tools', () => {
      manager.activateScope('automation_testing');
      const active = manager.getActiveTools();

      expect(active.has('run_automation_tests')).toBe(true);
      expect(active.has('get_automation_test_run')).toBe(true);
      expect(active.has('list_automation_test_runs')).toBe(true);
      expect(active.has('get_project_automation_context')).toBe(false);
      expect(active.has('start_pie')).toBe(false);
      expect(active.has('stop_pie')).toBe(false);
      expect(active.has('relaunch_pie')).toBe(false);
    });

    it('project_control loads editor-session, PIE, and code-sync tools', () => {
      manager.activateScope('project_control');
      const active = manager.getActiveTools();

      expect(active.has('list_running_editors')).toBe(true);
      expect(active.has('get_active_editor')).toBe(true);
      expect(active.has('select_editor')).toBe(true);
      expect(active.has('clear_editor_selection')).toBe(true);
      expect(active.has('launch_editor')).toBe(true);
      expect(active.has('wait_for_editor')).toBe(true);
      expect(active.has('get_project_automation_context')).toBe(true);
      expect(active.has('read_output_log')).toBe(true);
      expect(active.has('list_message_log_listings')).toBe(true);
      expect(active.has('read_message_log')).toBe(true);
      expect(active.has('start_pie')).toBe(true);
      expect(active.has('stop_pie')).toBe(true);
      expect(active.has('relaunch_pie')).toBe(true);
      expect(active.has('compile_project_code')).toBe(true);
      expect(active.has('restart_editor')).toBe(true);
      expect(active.has('sync_project_code')).toBe(true);
      expect(active.has('apply_window_ui_changes')).toBe(true);
    });

    it('verification loads verification tools', () => {
      manager.activateScope('verification');
      const active = manager.getActiveTools();

      expect(active.has('capture_editor_screenshot')).toBe(true);
      expect(active.has('capture_runtime_screenshot')).toBe(true);
      expect(active.has('capture_widget_preview')).toBe(true);
      expect(active.has('compare_capture_to_reference')).toBe(true);
      expect(active.has('cleanup_captures')).toBe(true);
    });

    it('analysis loads review and audit tools plus core', () => {
      manager.activateScope('analysis');
      const active = manager.getActiveTools();

      expect(active.has('review_blueprint')).toBe(true);
      expect(active.has('audit_project_assets')).toBe(true);
      expect(active.has('create_material')).toBe(false);
    });

    it('project_intelligence loads editor-context and indexing tools plus core', () => {
      manager.activateScope('project_intelligence');
      const active = manager.getActiveTools();

      expect(active.has('get_editor_context')).toBe(true);
      expect(active.has('refresh_project_index')).toBe(true);
      expect(active.has('get_project_index_status')).toBe(true);
      expect(active.has('search_project_context')).toBe(true);
      expect(active.has('import_assets')).toBe(false);
    });

    it('sets the active scope', () => {
      manager.activateScope('material_authoring');
      expect(manager.getActiveScope()).toBe('material_authoring');
    });
  });

  describe('additive mode', () => {
    it('additive=true merges scope with currently active tools', () => {
      manager.activateScope('material_authoring');
      expect(manager.isActive('create_material')).toBe(true);
      expect(manager.isActive('create_blueprint')).toBe(false);

      manager.activateScope('blueprint_authoring', true);

      // Both should be active
      expect(manager.isActive('create_material')).toBe(true);
      expect(manager.isActive('create_blueprint')).toBe(true);
      expect(manager.isActive('modify_blueprint_members')).toBe(true);
    });

    it('additive=false replaces existing scope', () => {
      manager.activateScope('material_authoring');
      expect(manager.isActive('create_material')).toBe(true);

      manager.activateScope('blueprint_authoring', false);

      expect(manager.isActive('create_material')).toBe(false);
      expect(manager.isActive('create_blueprint')).toBe(true);
    });
  });

  describe('isActive', () => {
    it('returns true for active tools', () => {
      manager.resetToDefault();
      expect(manager.isActive('search_assets')).toBe(true);
      expect(manager.isActive('extract_blueprint')).toBe(true);
    });

    it('returns false for inactive tools', () => {
      manager.resetToDefault();
      expect(manager.isActive('create_material')).toBe(false);
      expect(manager.isActive('create_widget_blueprint')).toBe(false);
    });
  });

  describe('enableFlatMode', () => {
    it('enables all registered tools', () => {
      manager.enableFlatMode();
      const active = manager.getActiveTools();

      expect(active.size).toBe(ALL_TEST_TOOLS.length);
      for (const name of ALL_TEST_TOOLS) {
        expect(active.has(name)).toBe(true);
      }
    });

    it('sets mode to flat', () => {
      manager.enableFlatMode();
      expect(manager.getMode()).toBe('flat');
    });

    it('enables every RegisteredTool', () => {
      manager.enableFlatMode();
      for (const [, tool] of toolMap) {
        expect(tool.enabled).toBe(true);
      }
    });
  });

  describe('enableScopedMode', () => {
    it('resets to default core tools', () => {
      manager.enableFlatMode();
      expect(manager.getActiveTools().size).toBe(ALL_TEST_TOOLS.length);

      manager.enableScopedMode();
      expect(manager.getActiveTools().size).toBe(CORE_TOOLS.size);
      expect(manager.getMode()).toBe('scoped');
    });
  });

  describe('scope persistence', () => {
    it('scope persists after activation until reset or replaced', () => {
      manager.activateScope('widget_authoring');
      expect(manager.getActiveScope()).toBe('widget_authoring');
      expect(manager.isActive('create_widget_blueprint')).toBe(true);

      // Access should still be the same
      expect(manager.getActiveScope()).toBe('widget_authoring');
      expect(manager.isActive('create_widget_blueprint')).toBe(true);
    });
  });

  describe('onPromptInvoked', () => {
    it('does nothing for unknown prompt', () => {
      manager.resetToDefault();
      const beforeSize = manager.getActiveTools().size;

      manager.onPromptInvoked('unknown_prompt');
      expect(manager.getActiveTools().size).toBe(beforeSize);
    });
  });

  describe('all workflow scope IDs', () => {
    it('WORKFLOW_SCOPE_IDS contains all expected scopes', () => {
      const expected: WorkflowScopeId[] = [
        'widget_authoring',
        'widget_authoring_structure', 'widget_authoring_visual', 'widget_verification',
        'material_authoring', 'blueprint_authoring',
        'schema_ai_authoring', 'animation_authoring', 'data_tables',
        'import', 'project_control', 'automation_testing', 'verification',
        'analysis', 'project_intelligence',
      ];
      expect(WORKFLOW_SCOPE_IDS).toEqual(expected);
    });

    it('every scope can be activated without error', () => {
      for (const scopeId of WORKFLOW_SCOPE_IDS) {
        expect(() => manager.activateScope(scopeId)).not.toThrow();
      }
    });

    it('getScopeDefinition returns valid definitions for all scopes', () => {
      for (const scopeId of WORKFLOW_SCOPE_IDS) {
        const def = manager.getScopeDefinition(scopeId);
        expect(def.id).toBe(scopeId);
        expect(def.description).toBeTruthy();
        expect(Array.isArray(def.tools)).toBe(true);
        expect(def.tools.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('activate_workflow_scope tool integration', () => {
  it('activate_workflow_scope tool activates scope and returns metadata', async () => {
    const { server } = createBlueprintExtractorServer(
      { callSubsystem: async () => '{}' } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );
    const harness = await connectInMemoryServer(server);

    try {
      const result = await harness.client.callTool({
        name: 'activate_workflow_scope',
        arguments: { scope: 'widget_authoring', additive: false },
      });

      expect(result.isError).not.toBe(true);
      const payload = result.structuredContent as Record<string, unknown>;
      expect(payload.profile).toBe('expert');
      expect(payload.mode).toBe('flat');
      expect(payload.scope).toBe('widget_authoring');
      expect(payload.additive).toBe(false);
      expect(typeof payload.active_tool_count).toBe('number');
      expect((payload.active_tool_count as number)).toBeGreaterThan(CORE_TOOLS.size);
    } finally {
      await harness.close();
    }
  });
});

describe('activate_tool_profile tool integration', () => {
  it('activate_tool_profile switches to the compact default profile', async () => {
    const { server } = createBlueprintExtractorServer(
      { callSubsystem: async () => '{}' } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );
    const harness = await connectInMemoryServer(server);

    try {
      const result = await harness.client.callTool({
        name: 'activate_tool_profile',
        arguments: { profile: 'default' },
      });

      expect(result.isError).not.toBe(true);
      const payload = result.structuredContent as Record<string, unknown>;
      expect(payload.profile).toBe('default');
      expect(payload.mode).toBe('scoped');
      expect(payload.core_tool_count).toBe(CORE_TOOLS.size);
      expect(payload.active_tool_count).toBe(CORE_TOOLS.size);
    } finally {
      await harness.close();
    }
  });
});

describe('non-supporting client gets flat tool list', () => {
  it('all tools are visible when no listChanged capability', async () => {
    const { server, toolSurfaceManager } = createBlueprintExtractorServer(
      { callSubsystem: async () => '{}' } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );

    // Simulate non-supporting client by enabling flat mode directly
    toolSurfaceManager.enableFlatMode();

    const harness = await connectInMemoryServer(server);

    try {
      const tools = await harness.client.listTools();
      // In flat mode all tools should be visible
      expect(tools.tools.length).toBeGreaterThan(CORE_TOOLS.size);
    } finally {
      await harness.close();
    }
  });
});
