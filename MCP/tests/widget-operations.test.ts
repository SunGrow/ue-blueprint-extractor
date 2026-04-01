import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerWidgetStructureTools } from '../src/tools/widget-structure.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const widgetNodeSchema = z.object({
  class: z.string(),
  name: z.string(),
}).passthrough();

const widgetBlueprintMutationOperationSchema = z.enum([
  'replace_tree',
  'compile',
  'patch_widget',
  'patch_class_defaults',
  'insert_child',
  'remove_widget',
  'move_widget',
  'wrap_widget',
  'replace_widget_class',
  'batch',
]);

function setupTools(callSubsystemJson = vi.fn()) {
  const registry = createToolRegistry();
  registerWidgetStructureTools({
    server: registry.server,
    callSubsystemJson,
    widgetNodeSchema,
    widgetBlueprintMutationOperationSchema,
  });
  return { registry, callSubsystemJson };
}

// ---------------------------------------------------------------------------
// replace_widget_tree
// ---------------------------------------------------------------------------
describe('replace_widget_tree', () => {
  it('calls BuildWidgetTree with serialized root_widget', async () => {
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'BuildWidgetTree',
      widgetCount: 2,
    }));
    const { registry } = setupTools(callSubsystemJson);
    const rootWidget = { class: 'CanvasPanel', name: 'Root', children: [{ class: 'TextBlock', name: 'Title' }] };

    const result = await registry.getTool('replace_widget_tree').handler({
      asset_path: '/Game/UI/WBP_HUD',
      root_widget: rootWidget,
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('BuildWidgetTree', {
      AssetPath: '/Game/UI/WBP_HUD',
      WidgetTreeJson: JSON.stringify(rootWidget),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({ success: true, operation: 'BuildWidgetTree' });
  });

  it('performs compile_after when mutation succeeds', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'BuildWidgetTree') return { success: true, operation: 'BuildWidgetTree' };
      return { success: true, compile: { success: true, messages: [] } };
    });
    const { registry } = setupTools(callSubsystemJson);

    const result = await registry.getTool('replace_widget_tree').handler({
      asset_path: '/Game/UI/WBP_HUD',
      root_widget: { class: 'CanvasPanel', name: 'Root' },
      validate_only: false,
      compile_after: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledTimes(2);
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'CompileWidgetBlueprint', { AssetPath: '/Game/UI/WBP_HUD' });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      compile: { success: true, messages: [] },
    });
  });

  it('skips compile_after when validate_only is true', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('replace_widget_tree').handler({
      asset_path: '/Game/UI/WBP_HUD',
      root_widget: { class: 'CanvasPanel', name: 'Root' },
      validate_only: true,
      compile_after: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledTimes(1);
  });

  it('returns error when subsystem fails', async () => {
    const callSubsystemJson = vi.fn(async () => { throw new Error('tree build failed'); });
    const { registry } = setupTools(callSubsystemJson);

    const result = await registry.getTool('replace_widget_tree').handler({
      asset_path: '/Game/UI/WBP_Bad',
      root_widget: { class: 'CanvasPanel', name: 'Root' },
      validate_only: false,
      compile_after: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as any)).toContain('tree build failed');
  });
});

// ---------------------------------------------------------------------------
// patch_widget
// ---------------------------------------------------------------------------
describe('patch_widget', () => {
  it('calls ModifyWidgetBlueprintStructure with patch_widget operation', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true, operation: 'patch_widget' }));
    const { registry } = setupTools(callSubsystemJson);

    const result = await registry.getTool('patch_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_path: 'Root/Title',
      properties: { Text: 'Hello' },
      slot: { Padding: 4 },
      is_variable: true,
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'patch_widget',
      PayloadJson: JSON.stringify({
        widget_path: 'Root/Title',
        properties: { Text: 'Hello' },
        slot: { Padding: 4 },
        is_variable: true,
      }),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({ success: true });
  });

  it('rejects when neither widget_name nor widget_path provided', async () => {
    const { registry } = setupTools();

    const result = await registry.getTool('patch_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      validate_only: false,
      compile_after: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as any)).toContain('widget_name or widget_path is required');
  });

  it('accepts widget_name selector', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('patch_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_name: 'TitleText',
      properties: { Text: 'Hi' },
      validate_only: false,
      compile_after: false,
    });

    const payload = JSON.parse(callSubsystemJson.mock.calls[0][1].PayloadJson as string);
    expect(payload.widget_name).toBe('TitleText');
  });

  it('performs compile_after when mutation succeeds', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'ModifyWidgetBlueprintStructure') return { success: true };
      return { success: true, compile: { success: true, messages: [] } };
    });
    const { registry } = setupTools(callSubsystemJson);

    const result = await registry.getTool('patch_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_name: 'Title',
      properties: { Text: 'X' },
      validate_only: false,
      compile_after: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledTimes(2);
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      compile: { success: true, messages: [] },
    });
  });
});

// ---------------------------------------------------------------------------
// patch_widget_class_defaults
// ---------------------------------------------------------------------------
describe('patch_widget_class_defaults', () => {
  it('calls ModifyWidgetBlueprintStructure with patch_class_defaults operation', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('patch_widget_class_defaults').handler({
      asset_path: '/Game/UI/WBP_Window',
      class_defaults: { bIsActive: true, Opacity: 0.8 },
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'patch_class_defaults',
      PayloadJson: JSON.stringify({ classDefaults: { bIsActive: true, Opacity: 0.8 } }),
      bValidateOnly: false,
    });
  });
});

// ---------------------------------------------------------------------------
// insert_widget_child
// ---------------------------------------------------------------------------
describe('insert_widget_child', () => {
  it('calls ModifyWidgetBlueprintStructure with insert_child operation', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);
    const child = { class: 'TextBlock', name: 'NewLabel' };

    await registry.getTool('insert_widget_child').handler({
      asset_path: '/Game/UI/WBP_Window',
      parent_widget_name: 'RootPanel',
      child_widget: child,
      index: 2,
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'insert_child',
      PayloadJson: JSON.stringify({
        parent_widget_name: 'RootPanel',
        child_widget: child,
        index: 2,
      }),
      bValidateOnly: false,
    });
  });

  it('accepts parent_widget_path selector', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('insert_widget_child').handler({
      asset_path: '/Game/UI/WBP_Window',
      parent_widget_path: 'Root/Content',
      child_widget: { class: 'Button', name: 'Btn' },
      validate_only: false,
      compile_after: false,
    });

    const payload = JSON.parse(callSubsystemJson.mock.calls[0][1].PayloadJson as string);
    expect(payload.parent_widget_path).toBe('Root/Content');
  });

  it('rejects when neither parent selector provided', async () => {
    const { registry } = setupTools();

    const result = await registry.getTool('insert_widget_child').handler({
      asset_path: '/Game/UI/WBP_Window',
      child_widget: { class: 'TextBlock', name: 'T' },
      validate_only: false,
      compile_after: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as any)).toContain('parent_widget_name or parent_widget_path is required');
  });
});

// ---------------------------------------------------------------------------
// remove_widget
// ---------------------------------------------------------------------------
describe('remove_widget', () => {
  it('calls ModifyWidgetBlueprintStructure with remove_widget operation', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('remove_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_name: 'OldLabel',
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'remove_widget',
      PayloadJson: JSON.stringify({ widget_name: 'OldLabel' }),
      bValidateOnly: false,
    });
  });

  it('rejects when neither widget_name nor widget_path provided', async () => {
    const { registry } = setupTools();

    const result = await registry.getTool('remove_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      validate_only: false,
      compile_after: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as any)).toContain('widget_name or widget_path is required');
  });
});

// ---------------------------------------------------------------------------
// move_widget
// ---------------------------------------------------------------------------
describe('move_widget', () => {
  it('calls ModifyWidgetBlueprintStructure with move_widget operation', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('move_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_path: 'Root/Title',
      new_parent_widget_name: 'ContentPanel',
      index: 0,
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'move_widget',
      PayloadJson: JSON.stringify({
        widget_path: 'Root/Title',
        new_parent_widget_name: 'ContentPanel',
        index: 0,
      }),
      bValidateOnly: false,
    });
  });
});

// ---------------------------------------------------------------------------
// wrap_widget
// ---------------------------------------------------------------------------
describe('wrap_widget', () => {
  it('calls ModifyWidgetBlueprintStructure with wrap_widget operation', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);
    const wrapper = { class: 'SizeBox', name: 'WrapperSizeBox' };

    await registry.getTool('wrap_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_name: 'Title',
      wrapper_widget: wrapper,
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'wrap_widget',
      PayloadJson: JSON.stringify({
        widget_name: 'Title',
        wrapper_widget: wrapper,
      }),
      bValidateOnly: false,
    });
  });
});

// ---------------------------------------------------------------------------
// replace_widget_class
// ---------------------------------------------------------------------------
describe('replace_widget_class', () => {
  it('calls ModifyWidgetBlueprintStructure with replace_widget_class operation', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('replace_widget_class').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_name: 'OldButton',
      replacement_class: 'CommonButton',
      preserve_properties: true,
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'replace_widget_class',
      PayloadJson: JSON.stringify({
        widget_name: 'OldButton',
        replacement_class: 'CommonButton',
        preserve_properties: true,
      }),
      bValidateOnly: false,
    });
  });

  it('omits preserve_properties when not provided', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('replace_widget_class').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_path: 'Root/Btn',
      replacement_class: 'NewButton',
      validate_only: false,
      compile_after: false,
    });

    const payload = JSON.parse(callSubsystemJson.mock.calls[0][1].PayloadJson as string);
    expect(payload).not.toHaveProperty('preserve_properties');
  });
});

// ---------------------------------------------------------------------------
// batch_widget_operations
// ---------------------------------------------------------------------------
describe('batch_widget_operations', () => {
  it('calls ModifyWidgetBlueprintStructure with batch operation', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);
    const ops = [
      { operation: 'patch_widget', widget_name: 'Title', properties: { Text: 'A' } },
      { operation: 'remove_widget', widget_name: 'OldLabel' },
    ];

    await registry.getTool('batch_widget_operations').handler({
      asset_path: '/Game/UI/WBP_Window',
      operations: ops,
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'batch',
      PayloadJson: JSON.stringify({ operations: ops }),
      bValidateOnly: false,
    });
  });

  it('performs compile_after when mutation succeeds', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'ModifyWidgetBlueprintStructure') return { success: true };
      return { success: true, compile: { success: true, messages: [] } };
    });
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('batch_widget_operations').handler({
      asset_path: '/Game/UI/WBP_Window',
      operations: [{ operation: 'patch_widget', widget_name: 'X', properties: {} }],
      validate_only: false,
      compile_after: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledTimes(2);
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'CompileWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Window',
    });
  });
});

// ---------------------------------------------------------------------------
// compile_widget
// ---------------------------------------------------------------------------
describe('compile_widget', () => {
  it('calls CompileWidgetBlueprint directly', async () => {
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'CompileWidgetBlueprint',
      compile: { success: true, messages: [] },
    }));
    const { registry } = setupTools(callSubsystemJson);

    const result = await registry.getTool('compile_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CompileWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Window',
    });
    expect(parseDirectToolResult(result)).toMatchObject({ success: true });
  });

  it('returns error when compile fails', async () => {
    const callSubsystemJson = vi.fn(async () => { throw new Error('compile failed'); });
    const { registry } = setupTools(callSubsystemJson);

    const result = await registry.getTool('compile_widget').handler({
      asset_path: '/Game/UI/WBP_Bad',
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as any)).toContain('compile failed');
  });
});

// ---------------------------------------------------------------------------
// modify_widget_blueprint dispatch alias
// ---------------------------------------------------------------------------
describe('modify_widget_blueprint dispatch alias', () => {
  it('dispatches replace_tree to BuildWidgetTree', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true, operation: 'BuildWidgetTree' }));
    const { registry } = setupTools(callSubsystemJson);
    const rootWidget = { class: 'CanvasPanel', name: 'Root' };

    const result = await registry.getTool('modify_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_HUD',
      operation: 'replace_tree',
      root_widget: rootWidget,
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('BuildWidgetTree', {
      AssetPath: '/Game/UI/WBP_HUD',
      WidgetTreeJson: JSON.stringify(rootWidget),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({ success: true });
  });

  it('dispatches compile to CompileWidgetBlueprint', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('modify_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_HUD',
      operation: 'compile',
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CompileWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_HUD',
    });
  });

  it('dispatches patch_widget to ModifyWidgetBlueprintStructure', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('modify_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_HUD',
      operation: 'patch_widget',
      widget_name: 'Title',
      properties: { Text: 'Hi' },
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_HUD',
      Operation: 'patch_widget',
      PayloadJson: JSON.stringify({
        widget_name: 'Title',
        properties: { Text: 'Hi' },
      }),
      bValidateOnly: false,
    });
  });

  it('dispatches batch to ModifyWidgetBlueprintStructure', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);
    const ops = [{ operation: 'remove_widget', widget_name: 'X' }];

    await registry.getTool('modify_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_HUD',
      operation: 'batch',
      operations: ops,
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_HUD',
      Operation: 'batch',
      PayloadJson: JSON.stringify({ operations: ops }),
      bValidateOnly: false,
    });
  });

  it('performs compile_after for non-compile operations', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'ModifyWidgetBlueprintStructure') return { success: true, operation: method };
      return { success: true, compile: { success: true, messages: [] } };
    });
    const { registry } = setupTools(callSubsystemJson);

    const result = await registry.getTool('modify_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_HUD',
      operation: 'patch_widget',
      widget_path: 'Root/Title',
      properties: { Text: 'X' },
      validate_only: false,
      compile_after: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledTimes(2);
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      compile: { success: true, messages: [] },
    });
  });

  it('returns error when root_widget missing for replace_tree', async () => {
    const { registry } = setupTools();

    const result = await registry.getTool('modify_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_HUD',
      operation: 'replace_tree',
      validate_only: false,
      compile_after: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as any)).toContain('root_widget or dsl is required');
  });
});

// ---------------------------------------------------------------------------
// validate_only behavior across tools
// ---------------------------------------------------------------------------
describe('validate_only behavior', () => {
  it('passes bValidateOnly=true to ModifyWidgetBlueprintStructure', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('remove_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_name: 'X',
      validate_only: true,
      compile_after: false,
    });

    expect(callSubsystemJson.mock.calls[0][1].bValidateOnly).toBe(true);
  });

  it('skips compile_after when validate_only is true even if compile_after is true', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { registry } = setupTools(callSubsystemJson);

    await registry.getTool('patch_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_name: 'X',
      properties: {},
      validate_only: true,
      compile_after: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Error handling across tools
// ---------------------------------------------------------------------------
describe('error handling', () => {
  const errorTools = [
    { name: 'patch_widget', args: { widget_name: 'X', properties: {} } },
    { name: 'patch_widget_class_defaults', args: { class_defaults: {} } },
    { name: 'insert_widget_child', args: { parent_widget_name: 'P', child_widget: { class: 'TextBlock', name: 'T' } } },
    { name: 'remove_widget', args: { widget_name: 'X' } },
    { name: 'move_widget', args: { widget_name: 'X', new_parent_widget_name: 'Y' } },
    { name: 'wrap_widget', args: { widget_name: 'X', wrapper_widget: { class: 'SizeBox', name: 'W' } } },
    { name: 'replace_widget_class', args: { widget_name: 'X', replacement_class: 'NewClass' } },
    { name: 'batch_widget_operations', args: { operations: [] } },
  ];

  for (const { name, args } of errorTools) {
    it(`${name} returns error when subsystem throws`, async () => {
      const callSubsystemJson = vi.fn(async () => { throw new Error(`${name} subsystem error`); });
      const { registry } = setupTools(callSubsystemJson);

      const result = await registry.getTool(name).handler({
        asset_path: '/Game/UI/WBP_Window',
        ...args,
        validate_only: false,
        compile_after: false,
      });

      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(getTextContent(result as any)).toContain(`${name} subsystem error`);
    });
  }
});

// ---------------------------------------------------------------------------
// Tool registration completeness
// ---------------------------------------------------------------------------
describe('tool registration', () => {
  it('registers all 10 new operation-specific tools plus legacy tools', () => {
    const { registry } = setupTools();

    const expectedTools = [
      'create_widget_blueprint',
      'replace_widget_tree',
      'patch_widget',
      'patch_widget_class_defaults',
      'insert_widget_child',
      'remove_widget',
      'move_widget',
      'wrap_widget',
      'replace_widget_class',
      'batch_widget_operations',
      'compile_widget',
      'modify_widget_blueprint',
      'build_widget_tree',
      'modify_widget',
      'compile_widget_blueprint',
    ];

    for (const name of expectedTools) {
      expect(() => registry.getTool(name)).not.toThrow();
    }
  });
});
