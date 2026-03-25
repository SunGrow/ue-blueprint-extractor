import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerMaterialAuthoringTools } from '../src/tools/material-authoring.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const jsonObjectSchema = z.record(z.string(), z.unknown());
const materialGraphPayloadSchema = z.object({}).passthrough();
const materialNodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
const materialConnectionSelectorFieldsSchema = z.object({
  from_expression_guid: z.string().optional(),
  from_temp_id: z.string().optional(),
  to_expression_guid: z.string().optional(),
  to_temp_id: z.string().optional(),
  from_output_name: z.string().optional(),
  from_output_index: z.number().optional(),
  to_input_name: z.string().optional(),
  to_input_index: z.number().optional(),
});
const materialGraphOperationKindSchema = z.enum([
  'set_material_settings',
  'add_expression',
  'connect_expressions',
  'connect_material_property',
]);
const materialGraphOperationSchema = z.object({
  operation: z.string(),
}).passthrough();
const materialFunctionAssetKindSchema = z.enum(['function', 'layer', 'layer_blend']);

describe('registerMaterialAuthoringTools', () => {
  it('serializes create_material payloads for the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Materials/M_Test',
    }));

    registerMaterialAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      materialGraphPayloadSchema,
      materialNodePositionSchema,
      materialConnectionSelectorFieldsSchema,
      materialGraphOperationKindSchema,
      materialGraphOperationSchema,
      materialFunctionAssetKindSchema,
    });

    const result = await registry.getTool('create_material').handler({
      asset_path: '/Game/Materials/M_Test',
      initial_texture_path: '/Game/Textures/T_Base',
      settings: { two_sided: true },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateMaterial', {
      AssetPath: '/Game/Materials/M_Test',
      InitialTexturePath: '/Game/Textures/T_Base',
      SettingsJson: JSON.stringify({ two_sided: true }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Materials/M_Test',
    });
  });

  it('maps add_expression operations into the routed ModifyMaterial payload', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'modify_material',
    }));

    registerMaterialAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      materialGraphPayloadSchema,
      materialNodePositionSchema,
      materialConnectionSelectorFieldsSchema,
      materialGraphOperationKindSchema,
      materialGraphOperationSchema,
      materialFunctionAssetKindSchema,
    });

    await registry.getTool('material_graph_operation').handler({
      asset_path: '/Game/Materials/M_Test',
      operation: 'add_expression',
      expression_class: '/Script/Engine.MaterialExpressionScalarParameter',
      expression_name: 'baseColor',
      expression_properties: { ParameterName: 'BaseColorTint' },
      node_position: { x: -200, y: 32 },
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyMaterial', {
      AssetPath: '/Game/Materials/M_Test',
      PayloadJson: JSON.stringify({
        operations: [{
          operation: 'add_expression',
          expression_class: '/Script/Engine.MaterialExpressionScalarParameter',
          temp_id: 'baseColor',
          properties: { ParameterName: 'BaseColorTint' },
          node_pos_x: -200,
          node_pos_y: 32,
        }],
      }),
      bValidateOnly: false,
    });
  });

  it('returns structured validation errors for invalid routed operations', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn();

    registerMaterialAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      materialGraphPayloadSchema,
      materialNodePositionSchema,
      materialConnectionSelectorFieldsSchema,
      materialGraphOperationKindSchema,
      materialGraphOperationSchema,
      materialFunctionAssetKindSchema,
    });

    const missingSettings = await registry.getTool('material_graph_operation').handler({
      asset_path: '/Game/Materials/M_Test',
      operation: 'set_material_settings',
      validate_only: false,
    });
    const unsupported = await registry.getTool('material_graph_operation').handler({
      asset_path: '/Game/Materials/M_Test',
      operation: 'unknown_operation',
      validate_only: false,
    });

    expect(callSubsystemJson).not.toHaveBeenCalled();
    expect(parseDirectToolResult(missingSettings)).toEqual({
      code: 'invalid_arguments',
      recoverable: false,
      message: 'settings is required for material_graph_operation with operation set_material_settings.',
    });
    expect(getTextContent(unsupported as { content?: Array<{ text?: string; type: string }> })).toContain(
      "Unsupported material_graph_operation 'unknown_operation'.",
    );
  });

  it('serializes modify_material_function payloads and compile_material_asset requests', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async (method) => ({
      success: true,
      operation: method,
    }));

    registerMaterialAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      materialGraphPayloadSchema,
      materialNodePositionSchema,
      materialConnectionSelectorFieldsSchema,
      materialGraphOperationKindSchema,
      materialGraphOperationSchema,
      materialFunctionAssetKindSchema,
    });

    await registry.getTool('modify_material_function').handler({
      asset_path: '/Game/Materials/MF_Test',
      settings: { description: 'Blend' },
      operations: [{ operation: 'noop' }],
      validate_only: true,
    });
    const compileResult = await registry.getTool('compile_material_asset').handler({
      asset_path: '/Game/Materials/MF_Test',
    });

    expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'ModifyMaterialFunction', {
      AssetPath: '/Game/Materials/MF_Test',
      PayloadJson: JSON.stringify({
        settings: { description: 'Blend' },
        operations: [{ operation: 'noop' }],
      }),
      bValidateOnly: true,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'CompileMaterialAsset', {
      AssetPath: '/Game/Materials/MF_Test',
    });
    expect(parseDirectToolResult(compileResult)).toMatchObject({
      success: true,
      operation: 'CompileMaterialAsset',
    });
  });

  it('serializes modify_material payloads with settings and operations', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'ModifyMaterial',
    }));

    registerMaterialAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      materialGraphPayloadSchema,
      materialNodePositionSchema,
      materialConnectionSelectorFieldsSchema,
      materialGraphOperationKindSchema,
      materialGraphOperationSchema,
      materialFunctionAssetKindSchema,
    });

    const result = await registry.getTool('modify_material').handler({
      asset_path: '/Game/Materials/M_Base',
      settings: { two_sided: true },
      compile_after: true,
      layout_after: false,
      operations: [{ operation: 'add_expression', expression_class: 'Scalar' }],
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyMaterial', {
      AssetPath: '/Game/Materials/M_Base',
      PayloadJson: JSON.stringify({
        settings: { two_sided: true },
        compile_after: true,
        layout_after: false,
        operations: [{ operation: 'add_expression', expression_class: 'Scalar' }],
      }),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'ModifyMaterial',
    });
  });

  it('returns an error when modify_material fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('material modification failed');
    });

    registerMaterialAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      materialGraphPayloadSchema,
      materialNodePositionSchema,
      materialConnectionSelectorFieldsSchema,
      materialGraphOperationKindSchema,
      materialGraphOperationSchema,
      materialFunctionAssetKindSchema,
    });

    const result = await registry.getTool('modify_material').handler({
      asset_path: '/Game/Materials/M_Bad',
      operations: [],
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'material modification failed',
    );
  });

  it('serializes create_material_function payloads with asset_kind', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Materials/MF_Blend',
    }));

    registerMaterialAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      materialGraphPayloadSchema,
      materialNodePositionSchema,
      materialConnectionSelectorFieldsSchema,
      materialGraphOperationKindSchema,
      materialGraphOperationSchema,
      materialFunctionAssetKindSchema,
    });

    const result = await registry.getTool('create_material_function').handler({
      asset_path: '/Game/Materials/MF_Blend',
      asset_kind: 'layer_blend',
      settings: { description: 'Blend heights' },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateMaterialFunction', {
      AssetPath: '/Game/Materials/MF_Blend',
      AssetKind: 'layer_blend',
      SettingsJson: JSON.stringify({ description: 'Blend heights' }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Materials/MF_Blend',
    });
  });

  it('returns an error when create_material_function fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('function creation failed');
    });

    registerMaterialAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      materialGraphPayloadSchema,
      materialNodePositionSchema,
      materialConnectionSelectorFieldsSchema,
      materialGraphOperationKindSchema,
      materialGraphOperationSchema,
      materialFunctionAssetKindSchema,
    });

    const result = await registry.getTool('create_material_function').handler({
      asset_path: '/Game/Materials/MF_Bad',
      asset_kind: 'function',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'function creation failed',
    );
  });
});
