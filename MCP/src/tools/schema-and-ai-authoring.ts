import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess, normalizeUStructPath } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<Record<string, unknown>>;

type RegisterSchemaAndAiAuthoringToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  jsonObjectSchema: z.ZodTypeAny;
  userDefinedStructMutationOperationSchema: z.ZodTypeAny;
  userDefinedStructFieldSchema: z.ZodTypeAny;
  userDefinedEnumMutationOperationSchema: z.ZodTypeAny;
  userDefinedEnumEntrySchema: z.ZodTypeAny;
  blackboardMutationOperationSchema: z.ZodTypeAny;
  blackboardKeySchema: z.ZodTypeAny;
  behaviorTreeMutationOperationSchema: z.ZodTypeAny;
  behaviorTreeNodeSelectorSchema: z.ZodTypeAny;
  stateTreeMutationOperationSchema: z.ZodTypeAny;
  stateTreeStateSelectorSchema: z.ZodTypeAny;
  stateTreeEditorNodeSelectorSchema: z.ZodTypeAny;
  stateTreeTransitionSelectorSchema: z.ZodTypeAny;
};

/**
 * Recursively walks a payload object and normalizes all `nodeStructType` values
 * by stripping the C++ F-prefix from USTRUCT script paths.
 * Also validates that nodeStructType paths match the expected `/Script/...` pattern.
 */
function normalizePayloadPaths(obj: unknown, warnings: string[]): unknown {
  if (Array.isArray(obj)) return obj.map(item => normalizePayloadPaths(item, warnings));
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === 'nodeStructType' && typeof value === 'string') {
        const normalized = normalizeUStructPath(value);
        if (normalized !== value) {
          warnings.push(`Auto-normalized F-prefix in nodeStructType: "${value}" → "${normalized}"`);
        }
        result[key] = normalized;
      } else {
        result[key] = normalizePayloadPaths(value, warnings);
      }
    }
    return result;
  }
  return obj;
}

/**
 * Validates that all `nodeStructType` values in the payload use the correct
 * `/Script/Module.ClassName` path format. Collects warnings for paths that
 * look like Blueprint asset paths, raw class names, or other incorrect formats.
 *
 * This runs AFTER normalizePayloadPaths so F-prefix issues are already resolved.
 */
function validateNodeStructTypes(obj: unknown, warnings: string[]): void {
  if (Array.isArray(obj)) {
    for (const item of obj) validateNodeStructTypes(item, warnings);
    return;
  }
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'nodeStructType' && typeof value === 'string') {
        if (!value.startsWith('/Script/')) {
          if (value.startsWith('/Game/') || value.startsWith('/Content/')) {
            warnings.push(
              `Warning: nodeStructType "${value}" looks like a Blueprint asset path. `
              + 'nodeStructType should be a C++ USTRUCT script path (e.g., "/Script/Module.ClassName")',
            );
          } else if (!value.includes('/')) {
            warnings.push(
              `Warning: nodeStructType "${value}" is a bare class name. `
              + 'Use the full script path format: "/Script/ModuleName.ClassName"',
            );
          } else {
            warnings.push(
              `Warning: nodeStructType "${value}" does not match the expected /Script/Module.ClassName pattern`,
            );
          }
        } else if (!value.includes('.')) {
          warnings.push(
            `Warning: nodeStructType "${value}" is missing the class name after the module path. `
            + 'Expected format: "/Script/Module.ClassName"',
          );
        }
      } else {
        validateNodeStructTypes(value, warnings);
      }
    }
  }
}

/**
 * Checks transition targetState.stateName references against the flat list of
 * state names in the payload. Collects warnings for unresolvable targets.
 */
function validateTransitionTargets(payload: Record<string, unknown> | undefined, warnings: string[]): void {
  if (!payload) return;
  const states = (payload.states ?? (payload.stateTree as Record<string, unknown> | undefined)?.states) as
    Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(states) || states.length === 0) return;

  const stateNames = new Set<string>();
  for (const s of states) {
    if (typeof s.stateName === 'string') stateNames.add(s.stateName);
    if (typeof s.name === 'string') stateNames.add(s.name);
  }
  if (stateNames.size === 0) return;

  for (const s of states) {
    const transitions = (s.transitions ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(transitions)) continue;
    for (const t of transitions) {
      const target = t.targetState as Record<string, unknown> | undefined;
      if (!target) continue;
      const targetName = (target.stateName ?? target.name) as string | undefined;
      if (typeof targetName === 'string' && targetName.length > 0 && !stateNames.has(targetName)) {
        warnings.push(`Warning: transition references targetState "${targetName}" which is not in the states list`);
      }
    }
  }
}

export function registerSchemaAndAiAuthoringTools({
  server,
  callSubsystemJson,
  jsonObjectSchema,
  userDefinedStructMutationOperationSchema,
  userDefinedStructFieldSchema,
  userDefinedEnumMutationOperationSchema,
  userDefinedEnumEntrySchema,
  blackboardMutationOperationSchema,
  blackboardKeySchema,
  behaviorTreeMutationOperationSchema,
  behaviorTreeNodeSelectorSchema,
  stateTreeMutationOperationSchema,
  stateTreeStateSelectorSchema,
  stateTreeEditorNodeSelectorSchema,
  stateTreeTransitionSelectorSchema,
}: RegisterSchemaAndAiAuthoringToolsOptions): void {
  server.registerTool(
    'create_user_defined_struct',
    {
      title: 'Create UserDefinedStruct',
      description: 'Create a UE5 UserDefinedStruct asset from extractor-shaped field definitions.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new UserDefinedStruct asset.',
        ),
        payload: jsonObjectSchema.default({}).describe(
          'Extractor-shaped UserDefinedStruct payload. Accepts either { fields: [...] } or { userDefinedStruct: { fields: [...] } }.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create UserDefinedStruct',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { asset_path, payload, validate_only } = args as {
          asset_path: string;
          payload?: Record<string, unknown>;
          validate_only: boolean;
        };
        const parsed = await callSubsystemJson('CreateUserDefinedStruct', {
          AssetPath: asset_path,
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
    'modify_user_defined_struct',
    {
      title: 'Modify UserDefinedStruct',
      description: 'Modify a UE5 UserDefinedStruct with field-level authoring operations.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the UserDefinedStruct to modify.',
        ),
        operation: userDefinedStructMutationOperationSchema.describe(
          'Field-level mutation operation to apply.',
        ),
        payload: z.object({
          userDefinedStruct: z.object({
            fields: z.array(userDefinedStructFieldSchema).optional(),
          }).passthrough().optional(),
          fields: z.array(userDefinedStructFieldSchema).optional(),
          field: userDefinedStructFieldSchema.optional(),
          guid: z.string().optional(),
          name: z.string().optional(),
          fieldName: z.string().optional(),
          newName: z.string().optional(),
          fieldOrder: z.array(z.string()).optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Field selectors accept guid or name.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify UserDefinedStruct',
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
        const parsed = await callSubsystemJson('ModifyUserDefinedStruct', {
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

  server.registerTool(
    'create_user_defined_enum',
    {
      title: 'Create UserDefinedEnum',
      description: 'Create a UE5 UserDefinedEnum asset from extractor-shaped entry payloads.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new UserDefinedEnum asset.',
        ),
        payload: z.object({
          userDefinedEnum: z.object({
            entries: z.array(userDefinedEnumEntrySchema).optional(),
          }).passthrough().optional(),
          entries: z.array(userDefinedEnumEntrySchema).optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped UserDefinedEnum payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create UserDefinedEnum',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { asset_path, payload, validate_only } = args as {
          asset_path: string;
          payload?: Record<string, unknown>;
          validate_only: boolean;
        };
        const parsed = await callSubsystemJson('CreateUserDefinedEnum', {
          AssetPath: asset_path,
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
    'modify_user_defined_enum',
    {
      title: 'Modify UserDefinedEnum',
      description: 'Modify a UE5 UserDefinedEnum with entry-level authoring operations.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the UserDefinedEnum to modify.',
        ),
        operation: userDefinedEnumMutationOperationSchema.describe(
          'Entry-level mutation operation to apply.',
        ),
        payload: z.object({
          userDefinedEnum: z.object({
            entries: z.array(userDefinedEnumEntrySchema).optional(),
          }).passthrough().optional(),
          entries: z.array(userDefinedEnumEntrySchema).optional(),
          name: z.string().optional(),
          entryName: z.string().optional(),
          newName: z.string().optional(),
          displayName: z.string().optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Entry selectors use name.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify UserDefinedEnum',
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
        const parsed = await callSubsystemJson('ModifyUserDefinedEnum', {
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

  server.registerTool(
    'create_blackboard',
    {
      title: 'Create Blackboard',
      description: 'Create a UE5 BlackboardData asset from extractor-shaped key payloads.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new BlackboardData asset.',
        ),
        payload: z.object({
          blackboard: z.object({
            parentBlackboard: z.string().optional(),
            keys: z.array(blackboardKeySchema).optional(),
          }).passthrough().optional(),
          parentBlackboard: z.string().optional(),
          keys: z.array(blackboardKeySchema).optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped Blackboard payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create Blackboard',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { asset_path, payload, validate_only } = args as {
          asset_path: string;
          payload?: Record<string, unknown>;
          validate_only: boolean;
        };
        const parsed = await callSubsystemJson('CreateBlackboard', {
          AssetPath: asset_path,
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
    'modify_blackboard',
    {
      title: 'Modify Blackboard',
      description: 'Modify a UE5 BlackboardData asset with declarative key operations.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the BlackboardData asset to modify.',
        ),
        operation: blackboardMutationOperationSchema.describe(
          'Blackboard mutation operation to apply.',
        ),
        payload: z.object({
          blackboard: z.object({
            parentBlackboard: z.string().optional(),
            keys: z.array(blackboardKeySchema).optional(),
          }).passthrough().optional(),
          parentBlackboard: z.string().optional(),
          keys: z.array(blackboardKeySchema).optional(),
          entryName: z.string().optional(),
          name: z.string().optional(),
          key: blackboardKeySchema.optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Key selectors use entryName.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify Blackboard',
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
        const parsed = await callSubsystemJson('ModifyBlackboard', {
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

  server.registerTool(
    'create_behavior_tree',
    {
      title: 'Create BehaviorTree',
      description: 'Create a UE5 BehaviorTree asset from extractor-shaped tree payloads.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new BehaviorTree asset.',
        ),
        payload: z.object({
          behaviorTree: jsonObjectSchema.optional(),
          blackboardAsset: z.string().optional(),
          rootNode: jsonObjectSchema.optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped BehaviorTree payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create BehaviorTree',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { asset_path, payload, validate_only } = args as {
          asset_path: string;
          payload?: Record<string, unknown>;
          validate_only: boolean;
        };
        const parsed = await callSubsystemJson('CreateBehaviorTree', {
          AssetPath: asset_path,
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
    'modify_behavior_tree',
    {
      title: 'Modify BehaviorTree',
      description: 'Modify a UE5 BehaviorTree with declarative subtree and attachment operations.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the BehaviorTree asset to modify.',
        ),
        operation: behaviorTreeMutationOperationSchema.describe(
          'BehaviorTree mutation operation to apply.',
        ),
        payload: z.object({
          behaviorTree: jsonObjectSchema.optional(),
          selector: behaviorTreeNodeSelectorSchema.optional(),
          nodePath: z.string().optional(),
          blackboardAsset: z.string().optional(),
          rootNode: jsonObjectSchema.optional(),
          node: jsonObjectSchema.optional(),
          attachment: jsonObjectSchema.optional(),
          properties: jsonObjectSchema.optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Targeted edits use nodePath.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify BehaviorTree',
        readOnlyHint: false,
        destructiveHint: true,
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
        const parsed = await callSubsystemJson('ModifyBehaviorTree', {
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

  server.registerTool(
    'create_state_tree',
    {
      title: 'Create StateTree',
      description: 'Create a UE5 StateTree asset from extractor-shaped editor data.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new StateTree asset.',
        ),
        payload: z.object({
          stateTree: jsonObjectSchema.optional(),
          schema: z.string().optional().describe(
            'UE class path of the StateTree schema. Required by the editor. E.g. /Script/GameplayStateTreeModule.StateTreeComponentSchema',
          ),
          states: z.array(jsonObjectSchema).optional(),
          evaluators: z.array(jsonObjectSchema).optional(),
          globalTasks: z.array(jsonObjectSchema).optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped StateTree payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate and compile without creating the asset.',
        ),
        timeout_seconds: z.number().positive().optional().describe(
          'Timeout in seconds for the subsystem call. Default 120. Complex payloads may need more time.',
        ),
      },
      annotations: {
        title: 'Create StateTree',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { asset_path, payload, validate_only, timeout_seconds } = args as {
          asset_path: string;
          payload?: Record<string, unknown>;
          validate_only: boolean;
          timeout_seconds?: number;
        };

        // Validate schema is present
        if (!payload?.schema && !(payload?.stateTree as Record<string, unknown> | undefined)?.schema) {
          return jsonToolError(new Error(
            'schema is required for create_state_tree. Provide it at payload.schema or payload.stateTree.schema '
            + '(e.g., "/Script/GameplayStateTreeModule.StateTreeComponentSchema")',
          ));
        }

        const warnings: string[] = [];

        // Lightweight payload validation (non-blocking)
        const schema = (payload?.schema ?? (payload?.stateTree as Record<string, unknown> | undefined)?.schema) as string | undefined;
        if (typeof schema === 'string' && !schema.startsWith('/Script/')) {
          warnings.push(`Warning: schema path "${schema}" does not match expected /Script/... pattern`);
        }
        validateTransitionTargets(payload, warnings);

        const normWarnings: string[] = [];
        const normalizedPayload = normalizePayloadPaths(payload ?? {}, normWarnings);
        warnings.push(...normWarnings);

        // Validate nodeStructType path formats after normalization
        validateNodeStructTypes(normalizedPayload, warnings);

        const timeoutMs = (timeout_seconds ?? 120) * 1000;
        const parsed = await callSubsystemJson('CreateStateTree', {
          AssetPath: asset_path,
          PayloadJson: JSON.stringify(normalizedPayload),
          bValidateOnly: validate_only,
        }, { timeoutMs });
        const result = warnings.length > 0
          ? { ...parsed as Record<string, unknown>, warnings }
          : parsed;
        const allWarnings = [...normWarnings, ...warnings.filter(w => !normWarnings.includes(w))];
        const extraContent = allWarnings.length > 0
          ? [{ type: 'text' as const, text: allWarnings.join('\n') }]
          : undefined;
        return jsonToolSuccess(result, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_state_tree',
    {
      title: 'Modify StateTree',
      description: 'Modify a UE5 StateTree with declarative tree, state, editor-node, and transition operations.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the StateTree asset to modify.',
        ),
        operation: stateTreeMutationOperationSchema.describe(
          'StateTree mutation operation to apply.',
        ),
        payload: z.object({
          stateTree: jsonObjectSchema.optional(),
          schema: z.string().optional(),
          state: jsonObjectSchema.optional(),
          editorNode: jsonObjectSchema.optional(),
          transition: jsonObjectSchema.optional(),
          selector: z.union([
            stateTreeStateSelectorSchema,
            stateTreeEditorNodeSelectorSchema,
            stateTreeTransitionSelectorSchema,
          ] as [z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny]).optional(),
          stateId: z.string().optional(),
          statePath: z.string().optional(),
          editorNodeId: z.string().optional(),
          transitionId: z.string().optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Selectors support stateId/statePath, editorNodeId, and transitionId.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate and compile without changing the asset.',
        ),
        timeout_seconds: z.number().positive().optional().describe(
          'Timeout in seconds for the subsystem call. Default 90. Complex payloads may need more time.',
        ),
      },
      annotations: {
        title: 'Modify StateTree',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { asset_path, operation, payload, validate_only, timeout_seconds } = args as {
          asset_path: string;
          operation: string;
          payload?: Record<string, unknown>;
          validate_only: boolean;
          timeout_seconds?: number;
        };

        const warnings: string[] = [];
        validateTransitionTargets(payload, warnings);

        const normWarnings: string[] = [];
        const normalizedPayload = normalizePayloadPaths(payload ?? {}, normWarnings);
        warnings.push(...normWarnings);

        // Validate nodeStructType path formats after normalization
        validateNodeStructTypes(normalizedPayload, warnings);

        const timeoutMs = (timeout_seconds ?? 90) * 1000;
        const parsed = await callSubsystemJson('ModifyStateTree', {
          AssetPath: asset_path,
          Operation: operation,
          PayloadJson: JSON.stringify(normalizedPayload),
          bValidateOnly: validate_only,
        }, { timeoutMs });
        const result = warnings.length > 0
          ? { ...parsed as Record<string, unknown>, warnings }
          : parsed;
        const allWarnings = [...normWarnings, ...warnings.filter(w => !normWarnings.includes(w))];
        const extraContent = allWarnings.length > 0
          ? [{ type: 'text' as const, text: allWarnings.join('\n') }]
          : undefined;
        return jsonToolSuccess(result, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
