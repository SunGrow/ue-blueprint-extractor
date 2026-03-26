import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerWidgetExtractionTools } from '../src/tools/widget-extraction.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const extractWidgetAnimationResultSchema = z.object({}).passthrough();

describe('registerWidgetExtractionTools', () => {
  it('extracts widget blueprints and compacts redundant widget metadata', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      rootWidget: {
        name: 'Root',
        displayLabel: 'Root',
        visibility: 'Visible',
        properties: {},
        children: [{
          name: 'Title',
          displayLabel: 'Custom Title',
          visibility: 'Hidden',
        }],
      },
      compile: {
        messages: [],
      },
      bindings: {},
      animations: [],
    }));

    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Window',
      include_class_defaults: true,
      compact: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ExtractWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Window',
      bIncludeClassDefaults: true,
    });
    expect(parseDirectToolResult(result)).toEqual({
      rootWidget: {
        name: 'Root',
        children: [{
          name: 'Title',
          displayLabel: 'Custom Title',
          visibility: 'Hidden',
        }],
      },
      compile: {},
    });
  });

  it('declares compact default as true on extract_widget_blueprint', () => {
    const registry = createToolRegistry();
    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson: vi.fn(),
      extractWidgetAnimationResultSchema,
    });
    const schema = registry.getTool('extract_widget_blueprint').config.inputSchema as Record<string, z.ZodTypeAny>;
    expect(schema.compact._def.defaultValue()).toBe(true);
  });

  it('returns raw widget blueprint output when compact is false', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      rootWidget: {
        name: 'Root',
        displayLabel: 'Root',
        visibility: 'Visible',
        properties: {},
      },
      compile: {
        messages: [],
      },
      bindings: {},
      animations: [],
    }));

    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Window',
      compact: false,
    });

    const parsed = parseDirectToolResult(result);
    expect(parsed).toMatchObject({
      rootWidget: {
        name: 'Root',
        displayLabel: 'Root',
        visibility: 'Visible',
        properties: {},
      },
      compile: { messages: [] },
      bindings: {},
      animations: [],
    });
  });

  it('declares compact default as true on extract_widget_animation', () => {
    const registry = createToolRegistry();
    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson: vi.fn(),
      extractWidgetAnimationResultSchema,
    });
    const schema = registry.getTool('extract_widget_animation').config.inputSchema as Record<string, z.ZodTypeAny>;
    expect(schema.compact._def.defaultValue()).toBe(true);
  });

  it('returns an error when widget animation extraction fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('animation missing');
    });

    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_animation').handler({
      asset_path: '/Game/UI/WBP_Window',
      animation_name: 'FadeIn',
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'animation missing',
    );
  });

  it('returns raw widget animation output when compact is false', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      animation: {
        name: 'FadeIn',
        trackGuid: 'track-guid-123',
        posX: 100,
      },
    }));

    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_animation').handler({
      asset_path: '/Game/UI/WBP_Window',
      animation_name: 'FadeIn',
      compact: false,
    });

    const parsed = parseDirectToolResult(result);
    expect(parsed).toMatchObject({
      success: true,
      animation: {
        name: 'FadeIn',
        trackGuid: 'track-guid-123',
        posX: 100,
      },
    });
  });

  it('routes extract_widget_animation arguments to the subsystem unchanged', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      animation: {
        name: 'FadeIn',
      },
    }));

    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_animation').handler({
      asset_path: '/Game/UI/WBP_Window',
      animation_name: 'FadeIn',
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ExtractWidgetAnimation', {
      AssetPath: '/Game/UI/WBP_Window',
      AnimationName: 'FadeIn',
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      animation: {
        name: 'FadeIn',
      },
    });
  });
});
