import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { validateInheritedComponents } from '../helpers/blueprint-validation.js';
import { parseBlueprintDsl, blueprintDslToPayload } from '../helpers/blueprint-dsl-parser.js';
import { checkDenyList } from '../helpers/operation-deny-list.js';
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
          'UE content path for the new asset.',
        ),
        parent_class_path: z.string().describe(
          'Parent class (e.g. /Script/Engine.Actor).',
        ),
        payload: z.object({
          blueprint: jsonObjectSchema.optional(),
          variables: z.array(jsonObjectSchema).optional(),
          rootComponents: z.array(jsonObjectSchema).optional(),
          functionStubs: z.array(jsonObjectSchema).optional(),
          functions: z.array(jsonObjectSchema).optional(),
          classDefaults: jsonObjectSchema.optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped Blueprint member payload.',
        ),
        validate_only: z.boolean().default(false).describe('Dry-run validation only.'),
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
      description: 'Modify Blueprint member authoring surfaces, including reparenting, without synthesizing arbitrary graphs.\n\n'
        + 'Example (reparent):\n'
        + '  {\n'
        + '    "asset_path": "/Game/Blueprints/BP_MyActor",\n'
        + '    "operation": "reparent",\n'
        + '    "payload": {\n'
        + '      "parentClassPath": "/Script/Engine.Pawn"\n'
        + '    }\n'
        + '  }',
      inputSchema: {
        asset_path: z.string().describe('UE content path.'),
        operation: blueprintMemberMutationOperationSchema.describe('Member mutation operation.'),
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
          parentClassPath: z.string().optional(),
          parent_class_path: z.string().optional(),
          classDefaults: jsonObjectSchema.optional(),
          properties: jsonObjectSchema.optional(),
        }).passthrough().default({}).describe(
          'Payload. Selectors: variableName, componentName, functionName.',
        ),
        validate_only: z.boolean().default(false).describe('Dry-run validation only.'),
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

        // Deny-list check
        const denied = checkDenyList('modify_blueprint_members', args as Record<string, unknown>);
        if (denied) {
          return { content: [{ type: 'text' as const, text: denied.message }], structuredContent: denied, isError: true as const };
        }

        // Pre-validate inherited components for component-targeting operations
        const componentOps = ['patch_component', 'delete_component', 'replace_components'];
        if (componentOps.includes(operation)) {
          const componentName = (payload?.componentName ?? payload?.component_name) as string | undefined;
          if (componentName) {
            const validation = await validateInheritedComponents(asset_path, [componentName], callSubsystemJson);
            if (!validation.valid) {
              return { content: [{ type: 'text' as const, text: validation.error.message }], structuredContent: validation.error, isError: true as const };
            }
          }
        }

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
      description: 'Modify explicit Blueprint graph authoring surfaces with rollback-safe apply semantics.\n\n'
        + 'Accepts either a JSON payload or a pseudocode-style DSL via the `dsl` parameter.\n'
        + 'When `dsl` is provided, it is parsed into an `upsert_function_graphs` payload automatically.',
      inputSchema: {
        asset_path: z.string().describe('UE content path.'),
        operation: blueprintGraphMutationOperationSchema.optional().describe(
          'Graph mutation operation. Auto-set to upsert_function_graphs when dsl is provided.',
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
        }).passthrough().optional().default({}).describe(
          'Payload. Graphs keyed by graphName/functionName.',
        ),
        dsl: z.string().optional().describe(
          'Blueprint graph DSL (alternative to payload). Pseudocode-style syntax that is parsed into an upsert_function_graphs payload.',
        ),
        validate_only: z.boolean().default(false).describe('Dry-run validation only.'),
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
        const { asset_path, operation, payload, dsl, validate_only } = args as {
          asset_path: string;
          operation?: string;
          payload?: Record<string, unknown>;
          dsl?: string;
          validate_only: boolean;
        };

        // Deny-list check
        const denied = checkDenyList('modify_blueprint_graphs', args as Record<string, unknown>);
        if (denied) {
          return { content: [{ type: 'text' as const, text: denied.message }], structuredContent: denied, isError: true as const };
        }

        let resolvedOperation = operation;
        let resolvedPayload = payload ?? {};

        // When DSL is provided, parse and convert to upsert_function_graphs payload
        if (dsl) {
          const dslResult = parseBlueprintDsl(dsl);
          const dslWarnings = dslResult.warnings;
          const dslPayload = blueprintDslToPayload(dslResult.graphs);
          resolvedOperation = 'upsert_function_graphs';
          resolvedPayload = dslPayload as unknown as Record<string, unknown>;

          if (dslWarnings.length > 0) {
            // Still proceed, but include warnings in the response later
            (resolvedPayload as Record<string, unknown>)._dslWarnings = dslWarnings;
          }
        }

        if (!resolvedOperation) {
          return { content: [{ type: 'text' as const, text: 'Either operation or dsl must be provided.' }], isError: true as const };
        }

        // Strip internal _dslWarnings before sending to subsystem
        const dslWarnings = (resolvedPayload as Record<string, unknown>)._dslWarnings as string[] | undefined;
        const subsystemPayload = { ...resolvedPayload };
        delete subsystemPayload._dslWarnings;

        const parsed = await callSubsystemJson('ModifyBlueprintGraphs', {
          AssetPath: asset_path,
          Operation: resolvedOperation,
          PayloadJson: JSON.stringify(subsystemPayload),
          bValidateOnly: validate_only,
        });

        const extraContent: Array<{ type: 'text'; text: string }> = [];
        if (dslWarnings && dslWarnings.length > 0) {
          extraContent.push({ type: 'text', text: `DSL warnings:\n${dslWarnings.join('\n')}` });
        }

        return jsonToolSuccess(parsed, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
