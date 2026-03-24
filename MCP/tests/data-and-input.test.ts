import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerDataAndInputTools } from '../src/tools/data-and-input.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const jsonObjectSchema = z.record(z.string(), z.unknown());
const enhancedInputValueTypeSchema = z.enum(['boolean', 'axis1d', 'axis2d', 'axis3d']);
const inputMappingSchema = z.object({
  action: z.string(),
  key: z.string(),
}).passthrough();

function setupRegistry(callSubsystemJson = vi.fn(async () => ({ success: true }))) {
  const registry = createToolRegistry();
  registerDataAndInputTools({
    server: registry.server,
    callSubsystemJson,
    jsonObjectSchema,
    enhancedInputValueTypeSchema,
    inputMappingSchema,
  });
  return { registry, callSubsystemJson };
}

describe('registerDataAndInputTools', () => {
  it('routes create_input_action through the dedicated Enhanced Input subsystem method', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Input/IA_Jump',
    })));

    const result = await registry.getTool('create_input_action').handler({
      asset_path: '/Game/Input/IA_Jump',
      value_type: 'axis2d',
      properties: {
        action_description: 'Jump axis',
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateInputAction', {
      AssetPath: '/Game/Input/IA_Jump',
      ValueType: 'axis2d',
      PropertiesJson: JSON.stringify({
        action_description: 'Jump axis',
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Input/IA_Jump',
    });
  });

  it('returns an error when data asset modification fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('property patch rejected');
    }));

    const result = await registry.getTool('modify_data_asset').handler({
      asset_path: '/Game/Data/DA_Item',
      properties: {
        Power: 10,
      },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'property patch rejected',
    );
  });

  it('normalizes omitted modify_input_action value types to the empty-string passthrough expected by the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'ModifyInputAction',
    })));

    const result = await registry.getTool('modify_input_action').handler({
      asset_path: '/Game/Input/IA_Jump',
      properties: {
        consume_input: false,
      },
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyInputAction', {
      AssetPath: '/Game/Input/IA_Jump',
      ValueType: '',
      PropertiesJson: JSON.stringify({
        consume_input: false,
      }),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'ModifyInputAction',
    });
  });

  it('routes replace_mappings through the subsystem bool parameter name expected by Remote Control', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'ModifyInputMappingContext',
      mappingCount: 1,
    })));

    const result = await registry.getTool('modify_input_mapping_context').handler({
      asset_path: '/Game/Input/IMC_Gameplay',
      replace_mappings: true,
      properties: {
        context_description: 'Updated gameplay context',
      },
      mappings: [
        {
          action: '/Game/Input/IA_Jump.IA_Jump',
          key: 'Gamepad_FaceButton_Bottom',
        },
      ],
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyInputMappingContext', {
      AssetPath: '/Game/Input/IMC_Gameplay',
      PropertiesJson: JSON.stringify({
        context_description: 'Updated gameplay context',
      }),
      bReplaceMappings: true,
      MappingsJson: JSON.stringify([
        {
          action: '/Game/Input/IA_Jump.IA_Jump',
          key: 'Gamepad_FaceButton_Bottom',
        },
      ]),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'ModifyInputMappingContext',
      mappingCount: 1,
    });
  });

  // --- C1: Additional Data & Input tool tests ---

  it('serializes create_data_asset payloads with asset_class_path for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Data/DA_NewItem',
    })));

    const result = await registry.getTool('create_data_asset').handler({
      asset_path: '/Game/Data/DA_NewItem',
      asset_class_path: '/Script/MyModule.MyDataAssetClass',
      properties: { Power: 42 },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateDataAsset', {
      AssetPath: '/Game/Data/DA_NewItem',
      AssetClassPath: '/Script/MyModule.MyDataAssetClass',
      PropertiesJson: JSON.stringify({ Power: 42 }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Data/DA_NewItem',
    });
  });

  it('returns an error when create_data_asset fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('class not found');
    }));

    const result = await registry.getTool('create_data_asset').handler({
      asset_path: '/Game/Data/DA_Bad',
      asset_class_path: '/Script/Missing.Class',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'class not found',
    );
  });

  it('serializes modify_data_asset payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'ModifyDataAsset',
    })));

    const result = await registry.getTool('modify_data_asset').handler({
      asset_path: '/Game/Data/DA_Item',
      properties: { Power: 99, Name: 'Excalibur' },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyDataAsset', {
      AssetPath: '/Game/Data/DA_Item',
      PropertiesJson: JSON.stringify({ Power: 99, Name: 'Excalibur' }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'ModifyDataAsset',
    });
  });

  it('returns an error when create_input_action fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('input action creation failed');
    }));

    const result = await registry.getTool('create_input_action').handler({
      asset_path: '/Game/Input/IA_Bad',
      value_type: 'boolean',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'input action creation failed',
    );
  });

  it('returns an error when modify_input_action fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('input action modification failed');
    }));

    const result = await registry.getTool('modify_input_action').handler({
      asset_path: '/Game/Input/IA_Jump',
      properties: { consume_input: true },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'input action modification failed',
    );
  });

  it('serializes create_input_mapping_context payloads with initial mappings', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Input/IMC_Default',
    })));

    const result = await registry.getTool('create_input_mapping_context').handler({
      asset_path: '/Game/Input/IMC_Default',
      properties: { context_description: 'Default context' },
      mappings: [
        { action: '/Game/Input/IA_Move.IA_Move', key: 'W' },
      ],
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateInputMappingContext', {
      AssetPath: '/Game/Input/IMC_Default',
      PropertiesJson: JSON.stringify({ context_description: 'Default context' }),
      MappingsJson: JSON.stringify([
        { action: '/Game/Input/IA_Move.IA_Move', key: 'W' },
      ]),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Input/IMC_Default',
    });
  });

  it('returns an error when create_input_mapping_context fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('mapping context creation failed');
    }));

    const result = await registry.getTool('create_input_mapping_context').handler({
      asset_path: '/Game/Input/IMC_Bad',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'mapping context creation failed',
    );
  });

  it('returns an error when modify_input_mapping_context fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('mapping context modification failed');
    }));

    const result = await registry.getTool('modify_input_mapping_context').handler({
      asset_path: '/Game/Input/IMC_Gameplay',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'mapping context modification failed',
    );
  });
});
