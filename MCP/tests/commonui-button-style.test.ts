import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerCommonUIButtonStyleTools } from '../src/tools/commonui-button-style.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const jsonObjectSchema = z.record(z.string(), z.unknown());

describe('registerCommonUIButtonStyleTools', () => {
  it('creates CommonUI button styles by normalizing style input into class defaults', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      assetPath: '/Game/UI/Styles/BP_ButtonStyle',
    }));

    registerCommonUIButtonStyleTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
    });

    const result = await registry.getTool('create_commonui_button_style').handler({
      asset_path: '/Game/UI/Styles/BP_ButtonStyle',
      asset_class_path: '/Script/CommonUI.CommonButtonStyle',
      style: {
        normal: { TintColor: 'White' },
        text_styles: {
          selected: '/Game/UI/TS_Selected',
        },
        padding: {
          button: { Left: 4, Right: 4 },
        },
        single_material: {
          enabled: true,
          brush: { TintColor: 'Blue' },
        },
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateBlueprint', {
      AssetPath: '/Game/UI/Styles/BP_ButtonStyle',
      ParentClassPath: '/Script/CommonUI.CommonButtonStyle',
      PayloadJson: JSON.stringify({
        classDefaults: {
          NormalBase: { TintColor: 'White' },
          SelectedTextStyle: '/Game/UI/TS_Selected',
          ButtonPadding: { Left: 4, Right: 4 },
          bSingleMaterial: true,
          SingleMaterialBrush: { TintColor: 'Blue' },
        },
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'create_commonui_button_style',
      style: {
        normal: { TintColor: 'White' },
        text_styles: {
          selected: '/Game/UI/TS_Selected',
        },
        padding: {
          button: { Left: 4, Right: 4 },
        },
        single_material: {
          enabled: true,
          brush: { TintColor: 'Blue' },
        },
      },
    });
  });

  it('returns an error when CommonUI style extraction fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('style blueprint unreadable');
    });

    registerCommonUIButtonStyleTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
    });

    const result = await registry.getTool('extract_commonui_button_style').handler({
      asset_path: '/Game/UI/Styles/BP_ButtonStyle',
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'style blueprint unreadable',
    );
  });

  it('normalizes style blueprint asset paths into generated class paths when applying styles', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'ModifyWidgetBlueprintStructure',
    }));

    registerCommonUIButtonStyleTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
    });

    const result = await registry.getTool('apply_commonui_button_style').handler({
      asset_path: '/Game/UI/WBP_MenuButton',
      style_asset_path: '/Game/UI/Styles/BP_ButtonStyle',
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_MenuButton',
      Operation: 'patch_class_defaults',
      PayloadJson: JSON.stringify({
        classDefaults: {
          Style: '/Game/UI/Styles/BP_ButtonStyle.BP_ButtonStyle_C',
        },
      }),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'apply_commonui_button_style',
      styleClassPath: '/Game/UI/Styles/BP_ButtonStyle.BP_ButtonStyle_C',
    });
  });
});
