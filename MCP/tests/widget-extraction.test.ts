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
