import { describe, it, expect } from 'vitest';
import { isInheritedComponent } from '../src/helpers/blueprint-validation.js';
import { checkDenyList } from '../src/helpers/operation-deny-list.js';
import { filterPhantomAssets } from '../src/helpers/phantom-filter.js';
import { CORE_TOOLS, WORKFLOW_SCOPE_IDS } from '../src/tool-surface-manager.js';

// -- Scope definitions can't be exported directly, so we test via the ToolSurfaceManager
import { ToolSurfaceManager } from '../src/tool-surface-manager.js';

const REMOVED_ALIASES = [
  'extract_material_function',
  'create_material_function',
  'modify_material_function',
  'import_textures',
  'import_meshes',
  'reimport_assets',
];

describe('inherited component detection', () => {
  it('detects inherited component in blueprint data', () => {
    const blueprintData = {
      components: [
        { name: 'MyMesh', inherited: true },
        { name: 'OwnedComponent', inherited: false },
      ],
    };
    expect(isInheritedComponent('MyMesh', blueprintData)).toBe(true);
    expect(isInheritedComponent('OwnedComponent', blueprintData)).toBe(false);
    expect(isInheritedComponent('NonExistent', blueprintData)).toBe(false);
  });

  it('handles PascalCase field names from C++ subsystem', () => {
    const blueprintData = {
      Components: [
        { Name: 'InheritedMesh', bInherited: true },
        { Name: 'LocalComp', bInherited: false },
      ],
    };
    expect(isInheritedComponent('InheritedMesh', blueprintData)).toBe(true);
    expect(isInheritedComponent('LocalComp', blueprintData)).toBe(false);
  });

  it('returns false when no components exist', () => {
    expect(isInheritedComponent('Anything', {})).toBe(false);
    expect(isInheritedComponent('Anything', { components: [] })).toBe(false);
  });
});

describe('operation deny-list', () => {
  it('blocks delete_component operations on modify_blueprint_members', () => {
    const result = checkDenyList('modify_blueprint_members', {
      operations: [{ operation: 'delete_component', component: 'SomeMesh' }],
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('OPERATION_DENIED');
    expect(result!.recoverable).toBe(true);
    expect(result!.next_steps.length).toBeGreaterThan(0);
  });

  it('blocks ConstructionScript graph deletion', () => {
    const result = checkDenyList('modify_blueprint_graphs', {
      operations: [{ operation: 'delete_graph', graph: 'ConstructionScript' }],
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('OPERATION_DENIED');
  });

  it('allows safe operations', () => {
    const result = checkDenyList('modify_blueprint_members', {
      operations: [{ operation: 'add_variable', variable: { name: 'Health', type: 'float' } }],
    });
    expect(result).toBeNull();
  });

  it('allows unregistered tools', () => {
    const result = checkDenyList('extract_blueprint', { asset_path: '/Game/Test' });
    expect(result).toBeNull();
  });
});

describe('phantom asset filtering', () => {
  it('removes assets not confirmed by listing', async () => {
    const mockCallSubsystem = async (method: string, params: Record<string, unknown>) => {
      if (method === 'ListAssets') {
        // Only return one of two assets as existing
        return {
          assets: [
            { asset_path: '/Game/Blueprints/BP_Exists' },
          ],
        };
      }
      return {};
    };

    const results = [
      { asset_path: '/Game/Blueprints/BP_Exists', class_name: 'Blueprint' },
      { asset_path: '/Game/Blueprints/BP_Phantom', class_name: 'Blueprint' },
    ];

    const { filtered, removedCount } = await filterPhantomAssets(results, mockCallSubsystem);
    expect(removedCount).toBe(1);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].asset_path).toBe('/Game/Blueprints/BP_Exists');
  });

  it('returns all results when listing fails', async () => {
    const mockCallSubsystem = async () => {
      throw new Error('Subsystem unavailable');
    };

    const results = [
      { asset_path: '/Game/BP_One' },
      { asset_path: '/Game/BP_Two' },
    ];

    const { filtered, removedCount } = await filterPhantomAssets(results, mockCallSubsystem);
    expect(removedCount).toBe(0);
    expect(filtered).toHaveLength(2);
  });

  it('handles empty results', async () => {
    const mockCallSubsystem = async () => ({});
    const { filtered, removedCount } = await filterPhantomAssets([], mockCallSubsystem);
    expect(removedCount).toBe(0);
    expect(filtered).toHaveLength(0);
  });
});

describe('alias removal verification', () => {
  it('CORE_TOOLS contains no removed alias names', () => {
    for (const alias of REMOVED_ALIASES) {
      expect(CORE_TOOLS.has(alias)).toBe(false);
    }
  });

  it('scope definitions contain no removed alias names', () => {
    // We can't directly access SCOPE_DEFINITIONS, but we can verify through ToolSurfaceManager
    // by checking that activating each scope doesn't include alias names
    const registeredToolMap = new Map();
    // Create fake registered tools for all known tools
    for (const alias of REMOVED_ALIASES) {
      registeredToolMap.set(alias, { enable: () => {}, disable: () => {} });
    }

    const manager = new ToolSurfaceManager(registeredToolMap as any);
    for (const scopeId of WORKFLOW_SCOPE_IDS) {
      manager.activateScope(scopeId);
      const activeTools = manager.getActiveTools();
      for (const alias of REMOVED_ALIASES) {
        expect(activeTools.has(alias)).toBe(false);
      }
    }
  });
});
