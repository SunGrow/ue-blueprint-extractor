import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerMaterialInstanceTools } from '../src/tools/material-instance.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const materialScalarParameterSchema = z.object({ name: z.string(), value: z.number() }).passthrough();
const materialVectorParameterSchema = z.object({ name: z.string() }).passthrough();
const materialTextureParameterSchema = z.object({ name: z.string() }).passthrough();
const materialFontParameterSchema = z.object({ name: z.string(), value: z.string() }).passthrough();
const materialStaticSwitchParameterSchema = z.object({ name: z.string(), value: z.boolean() }).passthrough();
const materialLayerStackSchema = z.object({
  layers: z.array(z.object({}).passthrough()),
}).passthrough();

describe('registerMaterialInstanceTools', () => {
  it('serializes create_material_instance requests for the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Materials/MI_Window',
    }));

    registerMaterialInstanceTools({
      server: registry.server,
      callSubsystemJson,
      materialScalarParameterSchema,
      materialVectorParameterSchema,
      materialTextureParameterSchema,
      materialFontParameterSchema,
      materialStaticSwitchParameterSchema,
      materialLayerStackSchema,
    });

    const result = await registry.getTool('create_material_instance').handler({
      asset_path: '/Game/Materials/MI_Window',
      parent_material_path: '/Game/Materials/M_Window',
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateMaterialInstance', {
      AssetPath: '/Game/Materials/MI_Window',
      ParentMaterialPath: '/Game/Materials/M_Window',
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Materials/MI_Window',
    });
  });

  it('returns an error when modify_material_instance fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('parameter patch rejected');
    });

    registerMaterialInstanceTools({
      server: registry.server,
      callSubsystemJson,
      materialScalarParameterSchema,
      materialVectorParameterSchema,
      materialTextureParameterSchema,
      materialFontParameterSchema,
      materialStaticSwitchParameterSchema,
      materialLayerStackSchema,
    });

    const result = await registry.getTool('modify_material_instance').handler({
      asset_path: '/Game/Materials/MI_Window',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'parameter patch rejected',
    );
  });

  it('serializes material instance override payloads without dropping optional fields', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'ModifyMaterialInstance',
    }));

    registerMaterialInstanceTools({
      server: registry.server,
      callSubsystemJson,
      materialScalarParameterSchema,
      materialVectorParameterSchema,
      materialTextureParameterSchema,
      materialFontParameterSchema,
      materialStaticSwitchParameterSchema,
      materialLayerStackSchema,
    });

    const result = await registry.getTool('modify_material_instance').handler({
      asset_path: '/Game/Materials/MI_Window',
      parentMaterial: '/Game/Materials/M_Alt',
      scalarParameters: [{ name: 'Glow', value: 2 }],
      runtimeVirtualTextureParameters: [{ name: 'RVT', value: '/Game/Textures/T_RVT' }],
      staticSwitchParameters: [{ name: 'UseOverlay', value: true }],
      layerStack: {
        layers: [{ name: 'TopLayer', layerPath: '/Game/Materials/ML_Top' }],
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyMaterialInstance', {
      AssetPath: '/Game/Materials/MI_Window',
      PayloadJson: JSON.stringify({
        parentMaterial: '/Game/Materials/M_Alt',
        scalarParameters: [{ name: 'Glow', value: 2 }],
        runtimeVirtualTextureParameters: [{ name: 'RVT', value: '/Game/Textures/T_RVT' }],
        staticSwitchParameters: [{ name: 'UseOverlay', value: true }],
        layerStack: {
          layers: [{ name: 'TopLayer', layerPath: '/Game/Materials/ML_Top' }],
        },
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'ModifyMaterialInstance',
    });
  });
});
