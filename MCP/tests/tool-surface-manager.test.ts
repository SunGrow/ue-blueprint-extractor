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
  // core tools
  ...CORE_TOOLS,
  // widget authoring tools
  'create_widget_blueprint', 'replace_widget_tree', 'patch_widget',
  'patch_widget_class_defaults', 'insert_widget_child', 'remove_widget',
  'move_widget', 'wrap_widget', 'replace_widget_class',
  'batch_widget_operations', 'compile_widget', 'modify_widget_blueprint',
  'build_widget_tree', 'modify_widget', 'compile_widget_blueprint',
  'capture_widget_preview', 'capture_widget_motion_checkpoints',
  'compare_capture_to_reference', 'list_captures', 'cleanup_captures',
  'compare_motion_capture_bundle',
  'create_commonui_button_style', 'modify_commonui_button_style',
  'apply_commonui_button_style',
  'create_widget_animation', 'modify_widget_animation',
  'apply_window_ui_changes',
  // material authoring
  'create_material', 'material_graph_operation', 'modify_material',
  'compile_material_asset',
  'create_material_function', 'modify_material_function',
  'create_material_instance', 'modify_material_instance',
  'extract_material_function',
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
  'import_textures', 'import_meshes', 'reimport_assets',
  // automation
  'run_automation_tests', 'get_automation_test_run', 'list_automation_test_runs',
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
    it('widget_authoring loads widget tools plus core', () => {
      manager.activateScope('widget_authoring');
      const active = manager.getActiveTools();

      // Core tools should be active
      for (const coreTool of CORE_TOOLS) {
        expect(active.has(coreTool)).toBe(true);
      }

      // Widget-specific tools should be active
      expect(active.has('create_widget_blueprint')).toBe(true);
      expect(active.has('patch_widget')).toBe(true);
      expect(active.has('capture_widget_preview')).toBe(true);
      expect(active.has('create_commonui_button_style')).toBe(true);
      expect(active.has('create_widget_animation')).toBe(true);
      expect(active.has('apply_window_ui_changes')).toBe(true);

      // Non-widget tools should be disabled
      expect(active.has('create_material')).toBe(false);
      expect(active.has('create_blueprint')).toBe(false);
      expect(active.has('import_assets')).toBe(false);
    });

    it('material_authoring loads material tools plus core', () => {
      manager.activateScope('material_authoring');
      const active = manager.getActiveTools();

      expect(active.has('create_material')).toBe(true);
      expect(active.has('material_graph_operation')).toBe(true);
      expect(active.has('create_material_instance')).toBe(true);
      expect(active.has('extract_material_function')).toBe(true);
      expect(active.has('compile_material_asset')).toBe(true);

      expect(active.has('create_widget_blueprint')).toBe(false);
    });

    it('blueprint_authoring loads blueprint tools plus core', () => {
      manager.activateScope('blueprint_authoring');
      const active = manager.getActiveTools();

      expect(active.has('create_blueprint')).toBe(true);
      expect(active.has('modify_blueprint_members')).toBe(true);
      expect(active.has('modify_blueprint_graphs')).toBe(true);

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
      expect(active.has('import_textures')).toBe(true);
      expect(active.has('reimport_assets')).toBe(true);
    });

    it('automation_testing loads automation tools', () => {
      manager.activateScope('automation_testing');
      const active = manager.getActiveTools();

      expect(active.has('run_automation_tests')).toBe(true);
      expect(active.has('get_automation_test_run')).toBe(true);
      expect(active.has('list_automation_test_runs')).toBe(true);
    });

    it('verification loads verification tools', () => {
      manager.activateScope('verification');
      const active = manager.getActiveTools();

      expect(active.has('capture_widget_preview')).toBe(true);
      expect(active.has('compare_capture_to_reference')).toBe(true);
      expect(active.has('cleanup_captures')).toBe(true);
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
        'widget_authoring', 'material_authoring', 'blueprint_authoring',
        'schema_ai_authoring', 'animation_authoring', 'data_tables',
        'import', 'automation_testing', 'verification',
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
      expect(payload.scope).toBe('widget_authoring');
      expect(payload.additive).toBe(false);
      expect(typeof payload.active_tool_count).toBe('number');
      expect((payload.active_tool_count as number)).toBeGreaterThan(CORE_TOOLS.size);
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
