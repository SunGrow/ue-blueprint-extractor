import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterDataAndInputToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  jsonObjectSchema: z.ZodTypeAny;
  enhancedInputValueTypeSchema: z.ZodTypeAny;
  inputMappingSchema: z.ZodTypeAny;
};

export function registerDataAndInputTools({
  server,
  callSubsystemJson,
  jsonObjectSchema,
  enhancedInputValueTypeSchema,
  inputMappingSchema,
}: RegisterDataAndInputToolsOptions): void {
  server.registerTool(
    'create_data_asset',
    {
      title: 'Create DataAsset',
      description: 'Create a concrete UE5 DataAsset asset and optionally initialize top-level editable properties.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new asset.',
        ),
        asset_class_path: z.string().describe(
          'UDataAsset subclass path.',
        ),
        properties: z.record(z.string(), z.unknown()).optional().describe(
          'Initial properties.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Create DataAsset',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, asset_class_path, properties, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateDataAsset', {
          AssetPath: asset_path,
          AssetClassPath: asset_class_path,
          PropertiesJson: JSON.stringify(properties ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_data_asset',
    {
      title: 'Modify DataAsset',
      description: 'Apply a reflected property patch to an existing UE5 DataAsset.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        properties: z.record(z.string(), z.unknown()).describe(
          'Property patch.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Modify DataAsset',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, properties, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ModifyDataAsset', {
          AssetPath: asset_path,
          PropertiesJson: JSON.stringify(properties ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'create_input_action',
    {
      title: 'Create Input Action',
      description: 'Create an Enhanced InputAction asset with a friendly value_type and optional properties.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new asset.',
        ),
        value_type: enhancedInputValueTypeSchema.default('boolean').describe(
          'Input value type.',
        ),
        properties: jsonObjectSchema.optional().describe(
          'InputAction properties.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Create Input Action',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, value_type, properties, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateInputAction', {
          AssetPath: asset_path,
          ValueType: value_type,
          PropertiesJson: JSON.stringify(properties ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_input_action',
    {
      title: 'Modify Input Action',
      description: 'Modify a dedicated Enhanced InputAction asset without using the generic DataAsset reflection path.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        value_type: enhancedInputValueTypeSchema.optional().describe(
          'Input value type override.',
        ),
        properties: jsonObjectSchema.optional().describe(
          'InputAction properties.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Modify Input Action',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, value_type, properties, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ModifyInputAction', {
          AssetPath: asset_path,
          ValueType: value_type ?? '',
          PropertiesJson: JSON.stringify(properties ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'create_input_mapping_context',
    {
      title: 'Create Input Mapping Context',
      description: 'Create an Enhanced InputMappingContext with dedicated mapping authoring.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new asset.',
        ),
        properties: jsonObjectSchema.optional().describe(
          'InputMappingContext properties.',
        ),
        mappings: z.array(inputMappingSchema).default([]).describe(
          'Initial action/key mappings.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Create Input Mapping Context',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, properties, mappings, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateInputMappingContext', {
          AssetPath: asset_path,
          PropertiesJson: JSON.stringify(properties ?? {}),
          MappingsJson: JSON.stringify(mappings),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_input_mapping_context',
    {
      title: 'Modify Input Mapping Context',
      description: 'Modify an Enhanced InputMappingContext with explicit mappings.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        properties: jsonObjectSchema.optional().describe(
          'InputMappingContext properties.',
        ),
        replace_mappings: z.boolean().default(false).describe(
          'Clear existing mappings first.',
        ),
        mappings: z.array(inputMappingSchema).default([]).describe(
          'Mappings to add.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Modify Input Mapping Context',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, properties, replace_mappings, mappings, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ModifyInputMappingContext', {
          AssetPath: asset_path,
          PropertiesJson: JSON.stringify(properties ?? {}),
          bReplaceMappings: replace_mappings,
          MappingsJson: JSON.stringify(mappings),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
