import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterBlueprintAuthoringToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  jsonObjectSchema: z.ZodTypeAny;
  blueprintMemberMutationOperationSchema: z.ZodTypeAny;
  blueprintGraphMutationOperationSchema: z.ZodTypeAny;
};

export function registerBlueprintAuthoringTools({
  server,
  callSubsystemJson,
  jsonObjectSchema,
  blueprintMemberMutationOperationSchema,
  blueprintGraphMutationOperationSchema,
}: RegisterBlueprintAuthoringToolsOptions): void {
  server.registerTool(
    'create_blueprint',
    {
      title: 'Create Blueprint',
      description: 'Create a UE5 Blueprint asset with optional variables, component templates, function stubs, class defaults, and compile.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new Blueprint asset.',
        ),
        parent_class_path: z.string().describe(
          'Parent class path for the new Blueprint (e.g. /Script/Engine.Actor or /Game/Blueprints/BP_BaseActor.BP_BaseActor_C).',
        ),
        payload: z.object({
          blueprint: jsonObjectSchema.optional(),
          variables: z.array(jsonObjectSchema).optional(),
          rootComponents: z.array(jsonObjectSchema).optional(),
          functionStubs: z.array(jsonObjectSchema).optional(),
          functions: z.array(jsonObjectSchema).optional(),
          classDefaults: jsonObjectSchema.optional(),
        }).passthrough().default({}).describe(
          'Optional extractor-shaped Blueprint member payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create Blueprint',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { asset_path, parent_class_path, payload, validate_only } = args as {
          asset_path: string;
          parent_class_path: string;
          payload?: Record<string, unknown>;
          validate_only: boolean;
        };
        const parsed = await callSubsystemJson('CreateBlueprint', {
          AssetPath: asset_path,
          ParentClassPath: parent_class_path,
          PayloadJson: JSON.stringify(payload ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_blueprint_members',
    {
      title: 'Modify Blueprint Members',
      description: 'Modify Blueprint member authoring surfaces without synthesizing arbitrary graphs.\n\n'
        + 'Example (add_variable):\n'
        + '  {\n'
        + '    "asset_path": "/Game/Blueprints/BP_MyActor",\n'
        + '    "operation": "add_variable",\n'
        + '    "payload": {\n'
        + '      "variable": {\n'
        + '        "name": "Health",\n'
        + '        "type": "float",\n'
        + '        "defaultValue": "100.0"\n'
        + '      }\n'
        + '    }\n'
        + '  }',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the Blueprint asset to modify.',
        ),
        operation: blueprintMemberMutationOperationSchema.describe(
          'Blueprint member mutation operation to apply.',
        ),
        payload: z.object({
          blueprint: jsonObjectSchema.optional(),
          variables: z.array(jsonObjectSchema).optional(),
          variable: jsonObjectSchema.optional(),
          variableName: z.string().optional(),
          rootComponents: z.array(jsonObjectSchema).optional(),
          components: jsonObjectSchema.optional(),
          component: jsonObjectSchema.optional(),
          componentName: z.string().optional(),
          functionStubs: z.array(jsonObjectSchema).optional(),
          functions: z.array(jsonObjectSchema).optional(),
          functionName: z.string().optional(),
          classDefaults: jsonObjectSchema.optional(),
          properties: jsonObjectSchema.optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Selectors use variableName, componentName, and functionName.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify Blueprint Members',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { asset_path, operation, payload, validate_only } = args as {
          asset_path: string;
          operation: string;
          payload?: Record<string, unknown>;
          validate_only: boolean;
        };

        const extraContent: Array<{ type: 'text'; text: string }> = [];

        if (operation === 'patch_class_defaults' && payload?.classDefaults) {
          const classDefaults = payload.classDefaults as Record<string, unknown>;
          const warnings: string[] = [];
          for (const [key, value] of Object.entries(classDefaults)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              warnings.push(
                `Property '${key}': value is a nested object. If setting a component reference ` +
                `or asset path, use a string path (e.g., "/Game/Path/Asset.Asset") instead.`,
              );
            }
          }
          if (warnings.length > 0) {
            extraContent.push({ type: 'text', text: `Warnings:\n${warnings.join('\n')}` });
          }
        }

        const parsed = await callSubsystemJson('ModifyBlueprintMembers', {
          AssetPath: asset_path,
          Operation: operation,
          PayloadJson: JSON.stringify(payload ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_blueprint_graphs',
    {
      title: 'Modify Blueprint Graphs',
      description: 'Modify explicit Blueprint graph authoring surfaces with rollback-safe apply semantics.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the Blueprint asset to modify.',
        ),
        operation: blueprintGraphMutationOperationSchema.describe(
          'Blueprint graph mutation operation to apply.',
        ),
        payload: z.object({
          functionGraphs: z.array(jsonObjectSchema).optional(),
          functions: z.array(jsonObjectSchema).optional(),
          graphName: z.string().optional(),
          functionName: z.string().optional(),
          ownerClass: z.string().optional(),
          sequenceNodeTitle: z.string().optional(),
          posX: z.number().optional(),
          posY: z.number().optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Function-graph upserts accept extractor-adjacent graph objects keyed by graphName/functionName/name.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify Blueprint Graphs',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { asset_path, operation, payload, validate_only } = args as {
          asset_path: string;
          operation: string;
          payload?: Record<string, unknown>;
          validate_only: boolean;
        };
        const parsed = await callSubsystemJson('ModifyBlueprintGraphs', {
          AssetPath: asset_path,
          Operation: operation,
          PayloadJson: JSON.stringify(payload ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
