import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterMaterialInstanceToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  materialScalarParameterSchema: z.ZodTypeAny;
  materialVectorParameterSchema: z.ZodTypeAny;
  materialTextureParameterSchema: z.ZodTypeAny;
  materialFontParameterSchema: z.ZodTypeAny;
  materialStaticSwitchParameterSchema: z.ZodTypeAny;
  materialLayerStackSchema: z.ZodTypeAny;
};

export function registerMaterialInstanceTools({
  server,
  callSubsystemJson,
  materialScalarParameterSchema,
  materialVectorParameterSchema,
  materialTextureParameterSchema,
  materialFontParameterSchema,
  materialStaticSwitchParameterSchema,
  materialLayerStackSchema,
}: RegisterMaterialInstanceToolsOptions): void {
  server.registerTool(
    'create_material_instance',
    {
      title: 'Create MaterialInstance',
      description: 'Create a UE5 MaterialInstanceConstant from a parent material or material instance.',
      inputSchema: {
        asset_path: z.string().describe('UE content path for the new asset.'),
        parent_material_path: z.string().describe('Parent material path.'),
        validate_only: z.boolean().default(false).describe('Dry-run validation only.'),
      },
      annotations: {
        title: 'Create MaterialInstance',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, parent_material_path, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateMaterialInstance', {
          AssetPath: asset_path,
          ParentMaterialPath: parent_material_path,
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_material_instance',
    {
      title: 'Modify MaterialInstance',
      description: 'Modify a MaterialInstanceConstant by reparenting or applying parameter overrides.\n\n'
        + 'Example:\n'
        + '  {\n'
        + '    "asset_path": "/Game/Materials/MI_Surface",\n'
        + '    "scalarParameters": [{ "name": "Roughness", "value": 0.6 }],\n'
        + '    "vectorParameters": [{ "name": "BaseColor", "value": { "r": 0.8, "g": 0.2, "b": 0.1, "a": 1.0 } }],\n'
        + '    "textureParameters": [{ "name": "Albedo", "value": "/Game/Textures/T_Albedo" }]\n'
        + '  }',
      inputSchema: {
        asset_path: z.string().describe('UE content path.'),
        parentMaterial: z.string().optional().describe('New parent material path.'),
        scalarParameters: z.array(materialScalarParameterSchema).optional().describe('Scalar overrides.'),
        vectorParameters: z.array(materialVectorParameterSchema).optional().describe('Vector overrides.'),
        textureParameters: z.array(materialTextureParameterSchema).optional().describe('Texture overrides. Null clears.'),
        runtimeVirtualTextureParameters: z.array(materialTextureParameterSchema).optional().describe('RVT overrides.'),
        sparseVolumeTextureParameters: z.array(materialTextureParameterSchema).optional().describe('SVT overrides.'),
        fontParameters: z.array(materialFontParameterSchema).optional().describe('Font overrides. Null clears.'),
        staticSwitchParameters: z.array(materialStaticSwitchParameterSchema).optional().describe('Static switch overrides.'),
        layerStack: materialLayerStackSchema.optional().describe('Full layer stack replacement.'),
        validate_only: z.boolean().default(false).describe('Dry-run validation only.'),
      },
      annotations: {
        title: 'Modify MaterialInstance',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, validate_only, ...payload }) => {
      try {
        const parsed = await callSubsystemJson('ModifyMaterialInstance', {
          AssetPath: asset_path,
          PayloadJson: JSON.stringify(payload),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
