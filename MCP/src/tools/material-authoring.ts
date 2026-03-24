import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterMaterialAuthoringToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  jsonObjectSchema: z.ZodTypeAny;
  materialGraphPayloadSchema: z.ZodTypeAny;
  materialNodePositionSchema: z.ZodTypeAny;
  materialConnectionSelectorFieldsSchema: z.AnyZodObject;
  materialGraphOperationKindSchema: z.ZodTypeAny;
  materialGraphOperationSchema: z.ZodTypeAny;
  materialFunctionAssetKindSchema: z.ZodTypeAny;
};

function serializeSchemaPayload<T extends z.ZodTypeAny>(
  schema: T,
  payload: z.output<T>,
): string {
  void schema;
  return JSON.stringify(payload);
}

function structuredToolError(
  message: string,
  options: {
    code?: string;
    recoverable?: boolean;
  } = {},
) {
  const payload = {
    code: options.code ?? 'invalid_arguments',
    recoverable: options.recoverable ?? false,
    message,
  };
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload),
    }],
    structuredContent: payload,
    isError: true as const,
  };
}

export function registerMaterialAuthoringTools({
  server,
  callSubsystemJson,
  jsonObjectSchema,
  materialGraphPayloadSchema,
  materialNodePositionSchema,
  materialConnectionSelectorFieldsSchema,
  materialGraphOperationKindSchema,
  materialGraphOperationSchema,
  materialFunctionAssetKindSchema,
}: RegisterMaterialAuthoringToolsOptions): void {
  server.registerTool(
    'create_material',
    {
      title: 'Create Material',
      description: 'Create a classic UMaterial asset with optional initial texture and settings.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new Material asset.',
        ),
        initial_texture_path: z.string().optional().describe(
          'Optional texture path for the factory’s initial texture slot.',
        ),
        settings: jsonObjectSchema.optional().describe(
          'Optional material settings payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create Material',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, initial_texture_path, settings, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateMaterial', {
          AssetPath: asset_path,
          InitialTexturePath: initial_texture_path ?? '',
          SettingsJson: JSON.stringify(settings ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'material_graph_operation',
    {
      title: 'Material Graph Operation',
      description: 'Run one routed material graph operation without exposing the full batch DSL.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the Material asset.',
        ),
        operation: materialGraphOperationKindSchema.describe(
          'Operation to execute.',
        ),
        settings: jsonObjectSchema.optional().describe(
          'Top-level settings for set_material_settings.',
        ),
        expression_class: z.string().optional().describe(
          'Loaded class path for add_expression.',
        ),
        expression_name: z.string().optional().describe(
          'Temporary id for the created expression within this authoring session.',
        ),
        expression_properties: jsonObjectSchema.optional().describe(
          'Optional reflected property patch for add_expression.',
        ),
        node_position: materialNodePositionSchema.optional().describe(
          'Editor graph position for add_expression.',
        ),
        ...materialConnectionSelectorFieldsSchema.shape,
        material_property: z.string().optional().describe(
          'Material property enum name for connect_material_property.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without mutating the material.',
        ),
      },
      annotations: {
        title: 'Material Graph Operation',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: unknown) => {
      try {
        const {
          asset_path,
          operation,
          validate_only,
          settings,
          expression_class,
          expression_name,
          expression_properties,
          node_position,
          from_expression_guid,
          from_temp_id,
          to_expression_guid,
          to_temp_id,
          from_output_name,
          from_output_index,
          to_input_name,
          to_input_index,
          material_property,
        } = args as Record<string, unknown> & {
          asset_path: string;
          operation: string;
          validate_only: boolean;
        };

        let payload: Record<string, unknown>;

        switch (operation) {
          case 'set_material_settings': {
            if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
              return structuredToolError(
                'settings is required for material_graph_operation with operation set_material_settings.',
              );
            }
            payload = {
              settings,
              operations: [{
                operation: 'set_material_settings',
                settings,
              }],
            };
            break;
          }
          case 'add_expression': {
            if (typeof expression_class !== 'string' || expression_class.length === 0) {
              return structuredToolError(
                'expression_class is required for material_graph_operation with operation add_expression.',
              );
            }

            const addExpressionOperation = {
              operation: 'add_expression' as const,
              expression_class,
            } as Record<string, unknown> & { operation: 'add_expression' };

            if (typeof expression_name === 'string' && expression_name.length > 0) {
              addExpressionOperation.temp_id = expression_name;
            }
            if (expression_properties && typeof expression_properties === 'object' && !Array.isArray(expression_properties)) {
              addExpressionOperation.properties = expression_properties;
            }
            if (node_position && typeof node_position === 'object' && !Array.isArray(node_position)) {
              const typedNodePosition = node_position as { x?: unknown; y?: unknown };
              if (typeof typedNodePosition.x === 'number') {
                addExpressionOperation.node_pos_x = typedNodePosition.x;
              }
              if (typeof typedNodePosition.y === 'number') {
                addExpressionOperation.node_pos_y = typedNodePosition.y;
              }
            }

            payload = {
              operations: [addExpressionOperation],
            };
            break;
          }
          case 'connect_expressions':
            payload = {
              operations: [{
                operation: 'connect_expressions',
                from_expression_guid,
                from_temp_id,
                to_expression_guid,
                to_temp_id,
                from_output_name,
                from_output_index,
                to_input_name,
                to_input_index,
              }],
            };
            break;
          case 'connect_material_property':
            if (typeof material_property !== 'string' || material_property.length === 0) {
              return structuredToolError(
                'material_property is required for material_graph_operation with operation connect_material_property.',
              );
            }
            payload = {
              operations: [{
                operation: 'connect_material_property',
                from_expression_guid,
                from_temp_id,
                from_output_name,
                from_output_index,
                material_property,
              }],
            };
            break;
          default:
            return structuredToolError(
              `Unsupported material_graph_operation '${operation}'.`,
            );
        }

        const parsed = await callSubsystemJson('ModifyMaterial', {
          AssetPath: asset_path,
          PayloadJson: serializeSchemaPayload(materialGraphPayloadSchema, payload),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_material',
    {
      title: 'Modify Material',
      description: 'Apply compact graph and settings operations to a classic UMaterial asset.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the Material asset.',
        ),
        settings: jsonObjectSchema.optional().describe(
          'Optional settings applied before operations.',
        ),
        compile_after: z.boolean().optional().describe(
          'Override the default compile-after-mutate behavior.',
        ),
        layout_after: z.boolean().optional().describe(
          'When true, run the editor layout pass after mutations.',
        ),
        operations: z.array(materialGraphOperationSchema).default([]).describe(
          'Ordered material graph operations.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without mutating the asset.',
        ),
      },
      annotations: {
        title: 'Modify Material',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, validate_only, ...payload }) => {
      try {
        const parsed = await callSubsystemJson('ModifyMaterial', {
          AssetPath: asset_path,
          PayloadJson: serializeSchemaPayload(materialGraphPayloadSchema, payload),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'create_material_function',
    {
      title: 'Create Material Function',
      description: 'Create a material function, material layer, or material layer blend asset.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new MaterialFunction-family asset.',
        ),
        asset_kind: materialFunctionAssetKindSchema.default('function').describe(
          'Choose function, layer, or layer_blend.',
        ),
        settings: jsonObjectSchema.optional().describe(
          'Optional function settings payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create Material Function',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, asset_kind, settings, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateMaterialFunction', {
          AssetPath: asset_path,
          AssetKind: asset_kind,
          SettingsJson: JSON.stringify(settings ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_material_function',
    {
      title: 'Modify Material Function',
      description: 'Apply compact graph and settings operations to a material function, layer, or layer blend asset.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the MaterialFunction-family asset.',
        ),
        settings: jsonObjectSchema.optional().describe(
          'Optional settings applied before operations.',
        ),
        compile_after: z.boolean().optional().describe(
          'Override the default compile-after-mutate behavior.',
        ),
        layout_after: z.boolean().optional().describe(
          'When true, run the editor layout pass after mutations.',
        ),
        operations: z.array(materialGraphOperationSchema).default([]).describe(
          'Ordered material graph operations.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without mutating the asset.',
        ),
      },
      annotations: {
        title: 'Modify Material Function',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, validate_only, ...payload }) => {
      try {
        const parsed = await callSubsystemJson('ModifyMaterialFunction', {
          AssetPath: asset_path,
          PayloadJson: serializeSchemaPayload(materialGraphPayloadSchema, payload),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'compile_material_asset',
    {
      title: 'Compile Material Asset',
      description: 'Recompile or refresh a material, material function-family asset, or material instance without saving it.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the material-family asset.',
        ),
      },
      annotations: {
        title: 'Compile Material Asset',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path }) => {
      try {
        const parsed = await callSubsystemJson('CompileMaterialAsset', {
          AssetPath: asset_path,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
