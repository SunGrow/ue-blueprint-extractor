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
  stateTreeBindingsObjectSchema: z.ZodTypeAny;
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
 * Walks the payload tree and warns when Blueprint-wrapped StateTree nodes
 * (StateTreeBlueprintTaskWrapper / StateTreeBlueprintConditionWrapper)
 * are missing the `instanceObjectClass` field, which is required for the
 * backing Blueprint instance to exist at runtime.
 */
function warnMissingInstanceObjectClass(obj: unknown, warnings: string[]): void {
  if (Array.isArray(obj)) {
    for (const item of obj) warnMissingInstanceObjectClass(item, warnings);
    return;
  }
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const nodeStructType = typeof record.nodeStructType === 'string' ? record.nodeStructType : '';
    if (
      (nodeStructType.includes('StateTreeBlueprintTaskWrapper')
        || nodeStructType.includes('StateTreeBlueprintConditionWrapper'))
      && !record.instanceObjectClass
    ) {
      const nodeName = typeof record.name === 'string' ? record.name : '<unnamed>';
      warnings.push(
        `Blueprint-wrapped node "${nodeName}" is missing instanceObjectClass. `
        + 'Without it, the node will compile but have no backing instance at runtime. '
        + 'Use extract_asset to get the correct instanceObjectClass path.',
      );
    }
    for (const value of Object.values(record)) {
      warnMissingInstanceObjectClass(value, warnings);
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

/**
 * Validates that binding property paths have at least one segment each.
 * Works with the new { bindings: { propertyBindings: [...] } } structure.
 */
function validateBindingPropertyPaths(payload: Record<string, unknown> | undefined, warnings: string[]): void {
  if (!payload) return;
  const bindingsObj = (payload.bindings ?? (payload.stateTree as Record<string, unknown> | undefined)?.bindings) as
    { propertyBindings?: unknown[] } | undefined;
  if (!bindingsObj?.propertyBindings || !Array.isArray(bindingsObj.propertyBindings)) return;

  for (const [i, binding] of bindingsObj.propertyBindings.entries()) {
    const b = binding as Record<string, unknown>;
    // Skip validation for string paths — they'll be parsed by normalizeBindingPaths
    if (typeof b.sourcePath === 'string' || typeof b.targetPath === 'string') continue;
    const sourcePath = b.sourcePath as { segments?: unknown[] } | undefined;
    const targetPath = b.targetPath as { segments?: unknown[] } | undefined;

    if (!sourcePath?.segments?.length) {
      warnings.push(`Binding [${i}]: sourcePath requires at least one segment`);
    }
    if (!targetPath?.segments?.length) {
      warnings.push(`Binding [${i}]: targetPath requires at least one segment`);
    }
  }
}

/**
 * Converts shorthand string binding paths ("structGuid:Prop.Sub[0]") to the
 * JSON-object format that the C++ ApplyBindingsFromJson expects.
 * Mutates the payload in place.
 */
function normalizeBindingPaths(payload: Record<string, unknown> | undefined): void {
  if (!payload) return;

  const convert = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    // Format: "GUID:Property.SubProperty[Index]" or just "Property"
    const colonIdx = value.indexOf(':');
    const structId = colonIdx >= 0 ? value.slice(0, colonIdx) : undefined;
    const pathStr = colonIdx >= 0 ? value.slice(colonIdx + 1) : value;
    if (!pathStr) return value;

    // Parse segments: split by "." and handle optional [Index]
    const parts = pathStr.split('.');
    const segments: Array<{ name: string; arrayIndex?: number }> = [];
    for (const part of parts) {
      const bracketMatch = part.match(/^(.+)\[(\d+)]$/);
      if (bracketMatch) {
        segments.push({ name: bracketMatch[1], arrayIndex: parseInt(bracketMatch[2], 10) });
      } else {
        segments.push({ name: part });
      }
    }

    const result: Record<string, unknown> = { segments };
    if (structId) result.structId = structId;
    return result;
  };

  // Process bindings at payload level
  const processBindings = (obj: Record<string, unknown>) => {
    const bindingsObj = obj.bindings as { propertyBindings?: unknown[] } | undefined;
    if (!bindingsObj?.propertyBindings || !Array.isArray(bindingsObj.propertyBindings)) return;
    for (const binding of bindingsObj.propertyBindings) {
      const b = binding as Record<string, unknown>;
      b.sourcePath = convert(b.sourcePath);
      b.targetPath = convert(b.targetPath);
    }
  };

  processBindings(payload);
  // Also check inside stateTree envelope
  if (payload.stateTree && typeof payload.stateTree === 'object') {
    processBindings(payload.stateTree as Record<string, unknown>);
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
  stateTreeBindingsObjectSchema,
}: RegisterSchemaAndAiAuthoringToolsOptions): void {
  server.registerTool(
    'create_user_defined_struct',
    {
      title: 'Create UserDefinedStruct',
      description: 'Create a UE5 UserDefinedStruct asset from extractor-shaped field definitions.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new asset.',
        ),
        payload: jsonObjectSchema.default({}).describe(
          'Extractor-shaped struct payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
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
          'UE content path.',
        ),
        operation: userDefinedStructMutationOperationSchema.describe(
          'Field-level mutation operation.',
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
          'Payload. Selectors: guid or name.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
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
          'UE content path for the new asset.',
        ),
        payload: z.object({
          userDefinedEnum: z.object({
            entries: z.array(userDefinedEnumEntrySchema).optional(),
          }).passthrough().optional(),
          entries: z.array(userDefinedEnumEntrySchema).optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped enum payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
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
          'UE content path.',
        ),
        operation: userDefinedEnumMutationOperationSchema.describe(
          'Entry-level mutation operation.',
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
          'Payload. Selectors: name.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
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
          'UE content path for the new asset.',
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
          'Dry-run validation only.',
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
          'UE content path.',
        ),
        operation: blackboardMutationOperationSchema.describe(
          'Blackboard mutation operation.',
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
          'Payload. Selectors: entryName.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
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
          'UE content path for the new asset.',
        ),
        payload: z.object({
          behaviorTree: jsonObjectSchema.optional(),
          blackboardAsset: z.string().optional(),
          rootNode: jsonObjectSchema.optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped BehaviorTree payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
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
      description: 'Modify a UE5 BehaviorTree with declarative subtree and attachment operations.\n\n'
        + 'Example (patch_node):\n'
        + '  {\n'
        + '    "asset_path": "/Game/AI/BT_Enemy",\n'
        + '    "operation": "patch_node",\n'
        + '    "payload": {\n'
        + '      "nodePath": "Root/Selector_0/Sequence_Combat",\n'
        + '      "properties": { "CooldownTime": 2.5 }\n'
        + '    }\n'
        + '  }',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        operation: behaviorTreeMutationOperationSchema.describe(
          'BehaviorTree mutation operation.',
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
          'Payload. Targeted edits use nodePath.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
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
      description: 'Create a UE5 StateTree asset from extractor-shaped editor data.\n\n'
        + 'Example:\n'
        + '  {\n'
        + '    "asset_path": "/Game/AI/ST_NewTree",\n'
        + '    "payload": {\n'
        + '      "schema": "/Script/GameplayStateTreeModule.StateTreeComponentSchema",\n'
        + '      "states": [{\n'
        + '        "name": "Root",\n'
        + '        "type": "State",\n'
        + '        "tasks": [{ "nodeStructType": "/Script/MyMod.STCSelectGesture", "name": "SelectGesture" }]\n'
        + '      }]\n'
        + '    }\n'
        + '  }',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new asset.',
        ),
        payload: z.object({
          stateTree: jsonObjectSchema.optional(),
          schema: z.string().optional().describe(
            'StateTree schema class path (required).',
          ),
          states: z.array(jsonObjectSchema).optional(),
          evaluators: z.array(jsonObjectSchema).optional(),
          globalTasks: z.array(jsonObjectSchema).optional(),
          bindings: stateTreeBindingsObjectSchema.optional().describe(
            'Task property bindings.',
          ),
        }).passthrough().default({}).describe(
          'Extractor-shaped StateTree payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        timeout_seconds: z.number().positive().optional().describe(
          'Subsystem call timeout. Default 120.',
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
        validateBindingPropertyPaths(payload, warnings);

        const normWarnings: string[] = [];
        const normalizedPayload = normalizePayloadPaths(payload ?? {}, normWarnings);
        warnings.push(...normWarnings);

        // Validate nodeStructType path formats after normalization
        validateNodeStructTypes(normalizedPayload, warnings);
        warnMissingInstanceObjectClass(normalizedPayload, warnings);

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
      description: 'Modify a UE5 StateTree with declarative operations: replace_tree, patch_state, patch_editor_node, patch_transition, set_schema, set_bindings (replace all property bindings), add_binding (append bindings), remove_binding (remove by targetPath).\n\n'
        + 'State selectors and transition targets accept stateId/id, statePath/path, and unique stateName/name. Paths extracted by extract_asset use slash syntax (for example "Root/Combat") and are the canonical round-trip format; dotted paths remain accepted for compatibility.\n\n'
        + 'Example (add_binding):\n'
        + '  {\n'
        + '    "asset_path": "/Game/AI/ST_Character",\n'
        + '    "operation": "add_binding",\n'
        + '    "payload": {\n'
        + '      "sourcePath": { "structId": "EAB9...", "segments": [{ "name": "SelectedGestureTag" }] },\n'
        + '      "targetPath": { "structId": "F2A3...", "segments": [{ "name": "MontageTag" }] }\n'
        + '    }\n'
        + '  }',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        operation: stateTreeMutationOperationSchema.describe(
          'StateTree mutation operation.',
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
          bindings: stateTreeBindingsObjectSchema.optional().describe(
            'Task property bindings.',
          ),
          propertyBindings: z.array(jsonObjectSchema).optional().describe(
            'Bindings array shorthand for set/add_binding.',
          ),
          sourcePath: jsonObjectSchema.optional().describe(
            'Source path for add_binding.',
          ),
          targetPath: jsonObjectSchema.optional().describe(
            'Target path for add/remove_binding.',
          ),
        }).passthrough().default({}).describe(
          'Payload. State selectors: stateId/statePath/stateName. Binding: propertyBindings or sourcePath/targetPath.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        timeout_seconds: z.number().positive().optional().describe(
          'Subsystem call timeout. Default 90.',
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
        validateBindingPropertyPaths(payload, warnings);

        const normWarnings: string[] = [];
        const normalizedPayload = normalizePayloadPaths(payload ?? {}, normWarnings);
        warnings.push(...normWarnings);

        // Validate nodeStructType path formats after normalization
        validateNodeStructTypes(normalizedPayload, warnings);
        warnMissingInstanceObjectClass(normalizedPayload, warnings);

        // Convert string binding paths to JSON-object format for C++
        normalizeBindingPaths(normalizedPayload as Record<string, unknown>);

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
