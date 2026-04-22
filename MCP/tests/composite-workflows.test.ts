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
    expect(typeof calls[1].params.WidgetTreeJson).toBe('string');
    expect(JSON.parse(calls[1].params.WidgetTreeJson as string)).toMatchObject({ class: 'CanvasPanel', name: 'Root' });
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
    expect(JSON.parse(modifyCall!.params.PayloadJson as string)).toMatchObject({
      classDefaults: { bIsFocusable: true },
    });
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
      if (method === 'ModifyMaterial') return { success: true };
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
    const settingsCall = calls.find(c => c.method === 'ModifyMaterial');
    expect(settingsCall).toBeDefined();
    const payload = JSON.parse(settingsCall!.params.PayloadJson as string);
    expect(payload).toMatchObject({
      operations: [{
        operation: 'set_material_settings',
        settings: {
          materialDomain: 'Surface',
          blendMode: 'Translucent',
          shadingModel: 'Unlit',
        },
      }],
    });
  });

  it('applies graph operations when provided', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const callSubsystemJson = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'CreateMaterial') return { success: true };
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

    const modifyCalls = calls.filter(c => c.method === 'ModifyMaterial');
    expect(modifyCalls).toHaveLength(2);
    expect(JSON.parse(modifyCalls[1].params.PayloadJson as string)).toMatchObject({
      operations: [
        { operation: 'add_node', class: 'MaterialExpressionConstant3Vector' },
      ],
    });
  });

  it('reports partial failure when compile fails', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateMaterial') return { success: true };
      if (method === 'ModifyMaterial') return { success: true };
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
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('scaffold_blueprint').handler({
      asset_path: '/Game/BP_Enemy',
      parent_class: '/Script/Engine.Actor',
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
    expect(parsed.steps[1].message).toBe('Applied 3 member(s) during blueprint creation');
    expect(parsed.steps[2].status).toBe('success');

    // Verify call sequence
    expect(calls[0].method).toBe('CreateBlueprint');
    expect(calls[0].params.AssetPath).toBe('/Game/BP_Enemy');
    expect(calls[0].params.ParentClassPath).toBe('/Script/Engine.Actor');
    const createPayload = JSON.parse(calls[0].params.PayloadJson as string);
    expect(createPayload).toMatchObject({
      variables: [
        {
          name: 'Health',
          pinType: { category: 'real', subCategory: 'float' },
          defaultValue: '100',
        },
        {
          name: 'Speed',
          pinType: { category: 'real', subCategory: 'float' },
        },
      ],
      functionStubs: [
        {
          graphName: 'OnTakeDamage',
          accessSpecifier: 'Public',
        },
      ],
    });

    expect(calls[1].method).toBe('SaveAssets');
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

    expect(calls.map(c => c.method)).toEqual(['CreateBlueprint', 'SaveAssets']);
  });

  it('reports failure before create when short type normalization is unsupported', async () => {
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('should not be called');
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('scaffold_blueprint').handler({
      asset_path: '/Game/BP_Enemy',
      parent_class: '/Script/Engine.Actor',
      variables: [{ name: 'Bad', type: 'InvalidType' }],
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.partial_state?.completed_steps).toEqual([]);
    expect(parsed.partial_state?.failed_step).toBe('create');
    expect(callSubsystemJson).not.toHaveBeenCalled();
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
      parent_class: '/Script/Engine.Actor',
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
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('scaffold_blueprint').handler({
      asset_path: '/Game/BP_Interface',
      parent_class: '/Script/Engine.Actor',
      functions: [{ name: 'Initialize' }, { name: 'Shutdown' }],
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const createPayload = JSON.parse(calls[0].params.PayloadJson as string);
    expect(createPayload).toMatchObject({
      functionStubs: [
        { graphName: 'Initialize' },
        { graphName: 'Shutdown' },
      ],
    });
    expect(calls.map(c => c.method)).toEqual(['CreateBlueprint', 'SaveAssets']);
  });

  it('passes through full pinType objects unchanged', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const callSubsystemJson = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'CreateBlueprint') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);
    const result = await registry.getTool('scaffold_blueprint').handler({
      asset_path: '/Game/BP_Data',
      parent_class: '/Script/Engine.Actor',
      variables: [
        {
          name: 'Ids',
          type: {
            category: 'int',
            containerType: 'Array',
          },
        },
      ],
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const createPayload = JSON.parse(calls[0].params.PayloadJson as string);
    expect(createPayload).toMatchObject({
      variables: [
        {
          name: 'Ids',
          pinType: {
            category: 'int',
            containerType: 'Array',
          },
        },
      ],
    });
  });
});
