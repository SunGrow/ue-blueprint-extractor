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
  'batch',
]);

describe('registerWidgetStructureTools', () => {
  it('returns an error when modify_widget has no widget selector', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn();

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('modify_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      validate_only: false,
    });

    expect(callSubsystemJson).not.toHaveBeenCalled();
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'widget_name or widget_path is required',
    );
  });

  it('serializes modify_widget payloads with widget_path selectors and variable flags', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'ModifyWidget',
    }));

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('modify_widget').handler({
      asset_path: '/Game/UI/WBP_Window',
      widget_path: 'WindowRoot/TitleText',
      properties: { Text: 'Updated' },
      slot: { Padding: 8 },
      is_variable: true,
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidget', {
      AssetPath: '/Game/UI/WBP_Window',
      WidgetName: 'WindowRoot/TitleText',
      PropertiesJson: JSON.stringify({ Text: 'Updated' }),
      SlotJson: JSON.stringify({ Padding: 8 }),
      WidgetOptionsJson: JSON.stringify({ is_variable: true }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'ModifyWidget',
    });
  });

  it('requires root_widget for replace_tree operations', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn();

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('modify_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Window',
      operation: 'replace_tree',
      validate_only: false,
      compile_after: false,
    });

    expect(callSubsystemJson).not.toHaveBeenCalled();
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'root_widget or dsl is required for operation="replace_tree"',
    );
  });

  it('serializes structural widget mutations and performs optional compile_after', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async (method) => {
      if (method === 'ModifyWidgetBlueprintStructure') {
        return {
          success: true,
          operation: method,
        };
      }

      return {
        success: true,
        operation: method,
        compile: {
          success: true,
          messages: [],
        },
      };
    });

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('modify_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Window',
      operation: 'patch_widget',
      widget_path: 'WindowRoot/TitleText',
      properties: { Text: 'Patched' },
      class_defaults: { Active: true },
      is_variable: true,
      operations: [{ operation: 'nested' }],
      validate_only: false,
      compile_after: true,
    });

    expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'patch_widget',
      PayloadJson: JSON.stringify({
        widget_path: 'WindowRoot/TitleText',
        properties: { Text: 'Patched' },
        classDefaults: { Active: true },
        is_variable: true,
        operations: [{ operation: 'nested' }],
      }),
      bValidateOnly: false,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'CompileWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Window',
    });
    expect(parseDirectToolResult(result)).toEqual({
      success: true,
      operation: 'ModifyWidgetBlueprintStructure',
      compile: {
        success: true,
        messages: [],
      },
    });
  });

  it('routes compile operations directly to CompileWidgetBlueprint', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'CompileWidgetBlueprint',
    }));

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('modify_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Window',
      operation: 'compile',
      validate_only: false,
      compile_after: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledTimes(1);
    expect(callSubsystemJson).toHaveBeenCalledWith('CompileWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Window',
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'CompileWidgetBlueprint',
    });
  });

  it('serializes create_widget_blueprint payloads for the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      assetPath: '/Game/UI/WBP_NewWidget',
    }));

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('create_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_NewWidget',
      parent_class_path: 'UserWidget',
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_NewWidget',
      ParentClass: 'UserWidget',
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/UI/WBP_NewWidget',
    });
  });

  it('returns an error when create_widget_blueprint fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('widget blueprint creation failed');
    });

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('create_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Bad',
      parent_class_path: 'UserWidget',
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'widget blueprint creation failed',
    );
  });

  it('serializes build_widget_tree payloads for the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'BuildWidgetTree',
      widgetCount: 3,
    }));

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const rootWidget = {
      class: 'CanvasPanel',
      name: 'RootPanel',
      children: [
        { class: 'TextBlock', name: 'Title' },
      ],
    };

    const result = await registry.getTool('build_widget_tree').handler({
      asset_path: '/Game/UI/WBP_Window',
      root_widget: rootWidget,
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('BuildWidgetTree', {
      AssetPath: '/Game/UI/WBP_Window',
      WidgetTreeJson: JSON.stringify(rootWidget),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'BuildWidgetTree',
    });
  });

  it('returns an error when build_widget_tree fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('widget tree build failed');
    });

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('build_widget_tree').handler({
      asset_path: '/Game/UI/WBP_Bad',
      root_widget: { class: 'CanvasPanel', name: 'Root' },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'widget tree build failed',
    );
  });

  it('serializes compile_widget_blueprint payloads for the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'CompileWidgetBlueprint',
      compile: { success: true, messages: [] },
    }));

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('compile_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Window',
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CompileWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Window',
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'CompileWidgetBlueprint',
    });
  });

  it('returns an error when compile_widget_blueprint fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('compile failed');
    });

    registerWidgetStructureTools({
      server: registry.server,
      callSubsystemJson,
      widgetNodeSchema,
      widgetBlueprintMutationOperationSchema,
    });

    const result = await registry.getTool('compile_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Bad',
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain('compile failed');
  });
});
