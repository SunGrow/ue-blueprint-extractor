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
          'UE content path for the new DataAsset (e.g. /Game/Data/DA_NewItem)',
        ),
        asset_class_path: z.string().describe(
          'Concrete UDataAsset subclass path or class object path (e.g. /Script/MyModule.MyDataAssetClass or /Game/Blueprints/BP_MyDataAssetClass.BP_MyDataAssetClass_C).',
        ),
        properties: z.record(z.string(), z.unknown()).optional().describe(
          'Optional top-level editable property payload to apply after creation.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
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
          'UE content path to the DataAsset to modify.',
        ),
        properties: z.record(z.string(), z.unknown()).describe(
          'Top-level editable property patch payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without mutating the asset.',
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
          'UE content path for the new InputAction asset.',
        ),
        value_type: enhancedInputValueTypeSchema.default('boolean').describe(
          'Human-friendly input value type.',
        ),
        properties: jsonObjectSchema.optional().describe(
          'Optional editable InputAction properties such as action_description, consume_input, trigger_when_paused, or reserve_all_mappings.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
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
          'UE content path to the InputAction asset.',
        ),
        value_type: enhancedInputValueTypeSchema.optional().describe(
          'Optional human-friendly input value type override.',
        ),
        properties: jsonObjectSchema.optional().describe(
          'Optional editable InputAction properties such as action_description, consume_input, trigger_when_paused, or reserve_all_mappings.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without mutating the asset.',
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
          'UE content path for the new InputMappingContext asset.',
        ),
        properties: jsonObjectSchema.optional().describe(
          'Optional editable InputMappingContext properties such as context_description or registration_tracking_mode.',
        ),
        mappings: z.array(inputMappingSchema).default([]).describe(
          'Optional initial action/key mappings.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
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
          'UE content path to the InputMappingContext asset.',
        ),
        properties: jsonObjectSchema.optional().describe(
          'Optional editable InputMappingContext properties such as context_description or registration_tracking_mode.',
        ),
        replace_mappings: z.boolean().default(false).describe(
          'When true, clear existing mappings before applying the provided mappings.',
        ),
        mappings: z.array(inputMappingSchema).default([]).describe(
          'Mappings to add to the context.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without mutating the asset.',
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
