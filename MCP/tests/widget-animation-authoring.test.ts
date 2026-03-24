import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerWidgetAnimationAuthoringTools } from '../src/tools/widget-animation-authoring.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const jsonObjectSchema = z.record(z.string(), z.unknown());
const createModifyWidgetAnimationResultSchema = z.object({}).passthrough();

describe('registerWidgetAnimationAuthoringTools', () => {
  it('serializes create_widget_animation payloads for the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      animationName: 'FadeIn',
    }));

    registerWidgetAnimationAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      createModifyWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('create_widget_animation').handler({
      asset_path: '/Game/UI/WBP_Window',
      animation_name: 'FadeIn',
      payload: {
        timeline: {
          tracks: [{ widget_path: 'Root/Title' }],
        },
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateWidgetAnimation', {
      AssetPath: '/Game/UI/WBP_Window',
      AnimationName: 'FadeIn',
      PayloadJson: JSON.stringify({
        timeline: {
          tracks: [{ widget_path: 'Root/Title' }],
        },
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      animationName: 'FadeIn',
    });
  });

  it('returns an error when modify_widget_animation fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('compile failed');
    });

    registerWidgetAnimationAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      createModifyWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('modify_widget_animation').handler({
      asset_path: '/Game/UI/WBP_Window',
      animation_name: 'FadeIn',
      operation: 'compile',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'compile failed',
    );
  });

  it('normalizes empty modify_widget_animation payloads to an empty object', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'compile',
    }));

    registerWidgetAnimationAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      createModifyWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('modify_widget_animation').handler({
      asset_path: '/Game/UI/WBP_Window',
      animation_name: 'FadeIn',
      operation: 'compile',
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetAnimation', {
      AssetPath: '/Game/UI/WBP_Window',
      AnimationName: 'FadeIn',
      Operation: 'compile',
      PayloadJson: JSON.stringify({}),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'compile',
    });
  });
});
