import { describe, expect, it, vi } from 'vitest';
import { registerCompositeWorkflowTools } from '../src/tools/composite-workflows.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import type { CompositeToolResult } from '../src/helpers/composite-patterns.js';

function setupRegistry(callSubsystemJson: ReturnType<typeof vi.fn>) {
  const registry = createToolRegistry();
  registerCompositeWorkflowTools({
    server: registry.server,
    callSubsystemJson,
    toolHelpRegistry: registry.toolHelpRegistry,
  });
  return registry;
}

// ---------------------------------------------------------------------------
// create_menu_screen
// ---------------------------------------------------------------------------

describe('create_menu_screen', () => {
  it('runs the full workflow: create -> build_tree -> compile -> save', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const callSubsystemJson = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'CreateWidgetBlueprint') return { success: true, asset_path: '/Game/UI/WBP_Menu' };
      if (method === 'BuildWidgetTree') return { success: true, widgets_created: 2 };
      if (method === 'CompileWidgetBlueprint') return { compile: { success: true, messages: [] } };
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('create_menu_screen').handler({
      asset_path: '/Game/UI/WBP_Menu',
      parent_class: 'CommonActivatableWidget',
      dsl: 'CanvasPanel "Root"\n  TextBlock "Title" {Text: "Hello"}',
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);
    expect(parsed.operation).toBe('create_menu_screen');

    // Verify step sequence
    const stepNames = parsed.steps.map(s => s.step);
    expect(stepNames).toEqual(['create', 'build_tree', 'class_defaults', 'compile', 'save']);
    expect(parsed.steps[0].status).toBe('success');
    expect(parsed.steps[1].status).toBe('success');
    expect(parsed.steps[2].status).toBe('skipped'); // no class defaults
    expect(parsed.steps[3].status).toBe('success');
    expect(parsed.steps[4].status).toBe('success');

    // Verify subsystem call sequence
    expect(calls[0].method).toBe('CreateWidgetBlueprint');
    expect(calls[0].params).toMatchObject({ AssetPath: '/Game/UI/WBP_Menu', ParentClassPath: 'CommonActivatableWidget' });
    expect(calls[1].method).toBe('BuildWidgetTree');
    expect(calls[1].params.AssetPath).toBe('/Game/UI/WBP_Menu');
    expect(calls[2].method).toBe('CompileWidgetBlueprint');
    expect(calls[3].method).toBe('SaveAssets');
  });

  it('includes class_defaults step when provided', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const callSubsystemJson = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'CreateWidgetBlueprint') return { success: true };
      if (method === 'BuildWidgetTree') return { success: true };
      if (method === 'ModifyWidgetBlueprintStructure') return { success: true };
      if (method === 'CompileWidgetBlueprint') return { compile: { success: true, messages: [] } };
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('create_menu_screen').handler({
      asset_path: '/Game/UI/WBP_Menu',
      parent_class: 'CommonActivatableWidget',
      dsl: 'CanvasPanel "Root"',
      class_defaults: { bIsFocusable: true },
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const classDefaultsStep = parsed.steps.find(s => s.step === 'class_defaults');
    expect(classDefaultsStep?.status).toBe('success');

    // Verify ModifyWidgetBlueprintStructure was called
    const modifyCall = calls.find(c => c.method === 'ModifyWidgetBlueprintStructure');
    expect(modifyCall).toBeDefined();
    expect(modifyCall!.params.Operation).toBe('patch_class_defaults');
  });

  it('reports partial failure when build_tree fails', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateWidgetBlueprint') return { success: true };
      if (method === 'BuildWidgetTree') throw new Error('Invalid tree structure');
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('create_menu_screen').handler({
      asset_path: '/Game/UI/WBP_Menu',
      parent_class: 'CommonActivatableWidget',
      dsl: 'Invalid',
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.partial_state?.completed_steps).toEqual(['create']);
    expect(parsed.partial_state?.failed_step).toBe('build_tree');
  });

  it('reports partial failure when create fails', async () => {
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('Asset already exists');
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('create_menu_screen').handler({
      asset_path: '/Game/UI/WBP_Menu',
      parent_class: 'CommonActivatableWidget',
      dsl: 'CanvasPanel "Root"',
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.partial_state?.completed_steps).toEqual([]);
    expect(parsed.partial_state?.failed_step).toBe('create');
  });
});

// ---------------------------------------------------------------------------
// apply_widget_patch
// ---------------------------------------------------------------------------

describe('apply_widget_patch', () => {
  it('runs the full workflow: extract -> apply_diff -> compile -> extract_result', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const callSubsystemJson = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'ExtractWidgetBlueprint') return { widget_tree: { name: 'Root' } };
      if (method === 'ModifyWidgetBlueprintStructure') return { success: true, operations_applied: 1 };
      if (method === 'CompileWidgetBlueprint') return { compile: { success: true, messages: [] } };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('apply_widget_patch').handler({
      asset_path: '/Game/UI/WBP_Menu',
      diff: 'CanvasPanel "Root"\n-  TextBlock "OldTitle" {Text: "Old"}\n+  TextBlock "NewTitle" {Text: "New"}',
      save: false,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const stepNames = parsed.steps.map(s => s.step);
    expect(stepNames).toEqual(['extract', 'apply_diff', 'compile', 'save', 'extract_result']);
    expect(parsed.steps[0].status).toBe('success'); // extract
    expect(parsed.steps[1].status).toBe('success'); // apply_diff
    expect(parsed.steps[2].status).toBe('success'); // compile
    expect(parsed.steps[3].status).toBe('skipped'); // save=false
    expect(parsed.steps[4].status).toBe('success'); // extract_result

    // Verify call sequence
    expect(calls[0].method).toBe('ExtractWidgetBlueprint');
    expect(calls[1].method).toBe('ModifyWidgetBlueprintStructure');
    expect(calls[1].params.Operation).toBe('batch');
    expect(calls[2].method).toBe('CompileWidgetBlueprint');
    expect(calls[3].method).toBe('ExtractWidgetBlueprint'); // final extraction
  });

  it('saves when save=true and compile succeeds', async () => {
    const calls: Array<{ method: string }> = [];
    const callSubsystemJson = vi.fn(async (method: string) => {
      calls.push({ method });
      if (method === 'ExtractWidgetBlueprint') return { widget_tree: {} };
      if (method === 'ModifyWidgetBlueprintStructure') return { success: true };
      if (method === 'CompileWidgetBlueprint') return { compile: { success: true } };
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('apply_widget_patch').handler({
      asset_path: '/Game/UI/WBP_Menu',
      diff: 'CanvasPanel "Root"\n-  TextBlock "Old"\n+  TextBlock "New"',
      save: true,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const saveStep = parsed.steps.find(s => s.step === 'save');
    expect(saveStep?.status).toBe('success');

    const saveCalls = calls.filter(c => c.method === 'SaveAssets');
    expect(saveCalls).toHaveLength(1);
  });

  it('reports partial failure when diff apply fails', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'ExtractWidgetBlueprint') return { widget_tree: {} };
      if (method === 'ModifyWidgetBlueprintStructure') throw new Error('Widget not found');
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('apply_widget_patch').handler({
      asset_path: '/Game/UI/WBP_Menu',
      diff: 'CanvasPanel "Root"\n-  TextBlock "Old"\n+  TextBlock "New"',
      save: false,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.partial_state?.completed_steps).toEqual(['extract']);
    expect(parsed.partial_state?.failed_step).toBe('apply_diff');
  });

  it('handles empty diff with no changes', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'ExtractWidgetBlueprint') return { widget_tree: { name: 'Root' } };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('apply_widget_patch').handler({
      asset_path: '/Game/UI/WBP_Menu',
      diff: 'CanvasPanel "Root"\n  TextBlock "Title"',
      save: false,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const applyStep = parsed.steps.find(s => s.step === 'apply_diff');
    expect(applyStep?.status).toBe('success');
    expect(applyStep?.message).toBe('No changes detected in diff');
  });
});

// ---------------------------------------------------------------------------
// create_material_setup
// ---------------------------------------------------------------------------

describe('create_material_setup', () => {
  it('runs the full workflow: create -> settings -> compile -> save', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const callSubsystemJson = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'CreateMaterial') return { success: true, asset_path: '/Game/Materials/M_Test' };
      if (method === 'MaterialGraphOperation') return { success: true };
      if (method === 'CompileMaterialAsset') return { compile: { success: true } };
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('create_material_setup').handler({
      asset_path: '/Game/Materials/M_Test',
      domain: 'Surface',
      blend_mode: 'Translucent',
      shading_model: 'Unlit',
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);
    expect(parsed.operation).toBe('create_material_setup');

    const stepNames = parsed.steps.map(s => s.step);
    expect(stepNames).toEqual(['create', 'settings', 'graph_ops', 'compile', 'save']);
    expect(parsed.steps[0].status).toBe('success');
    expect(parsed.steps[1].status).toBe('success');
    expect(parsed.steps[2].status).toBe('skipped'); // no graph ops
    expect(parsed.steps[3].status).toBe('success');
    expect(parsed.steps[4].status).toBe('success');

    // Verify settings call
    const settingsCall = calls.find(c => c.method === 'MaterialGraphOperation');
    expect(settingsCall).toBeDefined();
    expect(settingsCall!.params.Operation).toBe('set_material_properties');
    const payload = JSON.parse(settingsCall!.params.PayloadJson as string);
    expect(payload).toMatchObject({ MaterialDomain: 'Surface', BlendMode: 'Translucent', ShadingModel: 'Unlit' });
  });

  it('applies graph operations when provided', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const callSubsystemJson = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'CreateMaterial') return { success: true };
      if (method === 'MaterialGraphOperation') return { success: true };
      if (method === 'ModifyMaterial') return { success: true };
      if (method === 'CompileMaterialAsset') return { compile: { success: true } };
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('create_material_setup').handler({
      asset_path: '/Game/Materials/M_Test',
      domain: 'Surface',
      blend_mode: 'Opaque',
      shading_model: 'DefaultLit',
      operations: [
        { operation: 'add_node', class: 'MaterialExpressionConstant3Vector' },
      ],
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const graphOpsStep = parsed.steps.find(s => s.step === 'graph_ops');
    expect(graphOpsStep?.status).toBe('success');
    expect(graphOpsStep?.message).toBe('Applied 1 operation(s)');

    const modifyCall = calls.find(c => c.method === 'ModifyMaterial');
    expect(modifyCall).toBeDefined();
  });

  it('reports partial failure when compile fails', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateMaterial') return { success: true };
      if (method === 'MaterialGraphOperation') return { success: true };
      if (method === 'CompileMaterialAsset') throw new Error('Shader compile error');
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('create_material_setup').handler({
      asset_path: '/Game/Materials/M_Test',
      domain: 'Surface',
      blend_mode: 'Opaque',
      shading_model: 'DefaultLit',
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.partial_state?.completed_steps).toEqual(['create', 'settings']);
    expect(parsed.partial_state?.failed_step).toBe('compile');
  });

  it('reports failure when create fails', async () => {
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('Path already in use');
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('create_material_setup').handler({
      asset_path: '/Game/Materials/M_Test',
      domain: 'Surface',
      blend_mode: 'Opaque',
      shading_model: 'DefaultLit',
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.partial_state?.completed_steps).toEqual([]);
    expect(parsed.partial_state?.failed_step).toBe('create');
  });
});

// ---------------------------------------------------------------------------
// scaffold_blueprint
// ---------------------------------------------------------------------------

describe('scaffold_blueprint', () => {
  it('runs the full workflow: create -> add_members -> save', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const callSubsystemJson = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'CreateBlueprint') return { success: true, asset_path: '/Game/BP_Enemy' };
      if (method === 'ModifyBlueprintMembers') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('scaffold_blueprint').handler({
      asset_path: '/Game/BP_Enemy',
      parent_class: 'Actor',
      variables: [
        { name: 'Health', type: 'float', default_value: 100.0 },
        { name: 'Speed', type: 'float' },
      ],
      functions: [
        { name: 'OnTakeDamage', access: 'Public' },
      ],
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);
    expect(parsed.operation).toBe('scaffold_blueprint');

    const stepNames = parsed.steps.map(s => s.step);
    expect(stepNames).toEqual(['create', 'add_members', 'save']);
    expect(parsed.steps[0].status).toBe('success');
    expect(parsed.steps[1].status).toBe('success');
    expect(parsed.steps[1].message).toBe('Added 3 member(s)');
    expect(parsed.steps[2].status).toBe('success');

    // Verify call sequence
    expect(calls[0].method).toBe('CreateBlueprint');
    expect(calls[0].params.AssetPath).toBe('/Game/BP_Enemy');
    expect(calls[0].params.ParentClassPath).toBe('Actor');

    expect(calls[1].method).toBe('ModifyBlueprintMembers');
    const memberOps = JSON.parse(calls[1].params.OperationsJson as string);
    expect(memberOps).toHaveLength(3);
    expect(memberOps[0]).toMatchObject({ operation: 'add_variable', name: 'Health', type: 'float', default_value: 100.0 });
    expect(memberOps[1]).toMatchObject({ operation: 'add_variable', name: 'Speed', type: 'float' });
    expect(memberOps[2]).toMatchObject({ operation: 'add_function', name: 'OnTakeDamage', access: 'Public' });

    expect(calls[2].method).toBe('SaveAssets');
  });

  it('skips add_members when no variables or functions provided', async () => {
    const calls: Array<{ method: string }> = [];
    const callSubsystemJson = vi.fn(async (method: string) => {
      calls.push({ method });
      if (method === 'CreateBlueprint') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('scaffold_blueprint').handler({
      asset_path: '/Game/BP_Empty',
      parent_class: 'Actor',
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const memberStep = parsed.steps.find(s => s.step === 'add_members');
    expect(memberStep?.status).toBe('skipped');

    // Should not call ModifyBlueprintMembers
    expect(calls.map(c => c.method)).toEqual(['CreateBlueprint', 'SaveAssets']);
  });

  it('reports partial failure when add_members fails', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateBlueprint') return { success: true };
      if (method === 'ModifyBlueprintMembers') throw new Error('Invalid variable type');
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('scaffold_blueprint').handler({
      asset_path: '/Game/BP_Enemy',
      parent_class: 'Actor',
      variables: [{ name: 'Bad', type: 'InvalidType' }],
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.partial_state?.completed_steps).toEqual(['create']);
    expect(parsed.partial_state?.failed_step).toBe('add_members');
  });

  it('reports failure when save fails', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateBlueprint') return { success: true };
      if (method === 'SaveAssets') throw new Error('Disk full');
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('scaffold_blueprint').handler({
      asset_path: '/Game/BP_Enemy',
      parent_class: 'Actor',
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.partial_state?.completed_steps).toEqual(['create']);
    expect(parsed.partial_state?.failed_step).toBe('save');
  });

  it('handles functions-only (no variables)', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const callSubsystemJson = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'CreateBlueprint') return { success: true };
      if (method === 'ModifyBlueprintMembers') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('scaffold_blueprint').handler({
      asset_path: '/Game/BP_Interface',
      parent_class: 'Actor',
      functions: [{ name: 'Initialize' }, { name: 'Shutdown' }],
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const memberOps = JSON.parse(
      (calls.find(c => c.method === 'ModifyBlueprintMembers')!.params.OperationsJson as string),
    );
    expect(memberOps).toHaveLength(2);
    expect(memberOps[0]).toMatchObject({ operation: 'add_function', name: 'Initialize' });
    expect(memberOps[1]).toMatchObject({ operation: 'add_function', name: 'Shutdown' });
  });
});
