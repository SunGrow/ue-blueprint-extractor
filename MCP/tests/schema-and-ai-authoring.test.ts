import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerSchemaAndAiAuthoringTools } from '../src/tools/schema-and-ai-authoring.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const jsonObjectSchema = z.record(z.string(), z.unknown());
const userDefinedStructMutationOperationSchema = z.enum(['patch_field', 'replace_fields']);
const userDefinedStructFieldSchema = z.object({}).passthrough();
const userDefinedEnumMutationOperationSchema = z.enum(['rename_entry', 'replace_entries']);
const userDefinedEnumEntrySchema = z.object({}).passthrough();
const blackboardMutationOperationSchema = z.enum(['patch_key', 'replace_keys']);
const blackboardKeySchema = z.object({}).passthrough();
const behaviorTreeMutationOperationSchema = z.enum(['patch_node', 'set_blackboard', 'replace_tree']);
const behaviorTreeNodeSelectorSchema = z.object({}).passthrough();
const stateTreeMutationOperationSchema = z.enum(['patch_state', 'patch_transition', 'replace_tree', 'patch_editor_node', 'set_schema', 'set_bindings', 'add_binding', 'remove_binding']);
const stateTreeStateSelectorSchema = z.object({}).passthrough();
const stateTreeEditorNodeSelectorSchema = z.object({}).passthrough();
const stateTreeTransitionSelectorSchema = z.object({}).passthrough();
const propertyPathSegmentSchema = z.object({
  name: z.string(),
  arrayIndex: z.number().int().optional(),
  instanceStruct: z.string().optional(),
}).passthrough();
const propertyPathSchema = z.object({
  structId: z.string().optional(),
  segments: z.array(propertyPathSegmentSchema).min(1),
}).passthrough();
const propertyPathBindingSchema = z.object({
  sourcePath: propertyPathSchema,
  targetPath: propertyPathSchema,
}).passthrough();
const stateTreeBindingsObjectSchema = z.object({
  propertyBindings: z.array(propertyPathBindingSchema),
}).passthrough();

function setupRegistry(callSubsystemJson = vi.fn(async () => ({ success: true }))) {
  const registry = createToolRegistry();
  registerSchemaAndAiAuthoringTools({
    server: registry.server,
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
  });
  return { registry, callSubsystemJson };
}

describe('registerSchemaAndAiAuthoringTools', () => {
  it('serializes create_blackboard payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/BB_Main',
    })));

    const result = await registry.getTool('create_blackboard').handler({
      asset_path: '/Game/AI/BB_Main',
      payload: {
        parentBlackboard: '/Game/AI/BB_Base',
        keys: [{
          entryName: 'TargetActor',
        }],
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateBlackboard', {
      AssetPath: '/Game/AI/BB_Main',
      PayloadJson: JSON.stringify({
        parentBlackboard: '/Game/AI/BB_Base',
        keys: [{
          entryName: 'TargetActor',
        }],
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/AI/BB_Main',
    });
  });

  it('returns an error when behavior-tree mutation fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('behavior-tree patch failed');
    }));

    const result = await registry.getTool('modify_behavior_tree').handler({
      asset_path: '/Game/AI/BT_Main',
      operation: 'patch_node',
      payload: {
        nodePath: 'Root/Chase',
      },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'behavior-tree patch failed',
    );
  });

  it('routes enum, struct, blackboard, and state-tree mutations with their selector payload variants intact', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async (method) => ({
      success: true,
      operation: method,
    })));

    await registry.getTool('modify_user_defined_enum').handler({
      asset_path: '/Game/Data/E_Rarity',
      operation: 'rename_entry',
      payload: {
        entryName: 'Rare',
        newName: 'Epic',
      },
      validate_only: true,
    });
    await registry.getTool('modify_user_defined_struct').handler({
      asset_path: '/Game/Data/S_Item',
      operation: 'patch_field',
      payload: {
        fieldName: 'Damage',
        field: {
          defaultValue: '12',
        },
      },
      validate_only: false,
    });
    await registry.getTool('modify_blackboard').handler({
      asset_path: '/Game/AI/BB_Main',
      operation: 'patch_key',
      payload: {
        entryName: 'TargetActor',
        key: {
          keyTypePath: '/Script/AIModule.BlackboardKeyType_Object',
        },
      },
      validate_only: true,
    });
    const stateTreeResult = await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'patch_transition',
      payload: {
        selector: {
          transitionId: 'transition-1',
        },
        transitionId: 'transition-1',
        transition: {
          delay: 0.2,
        },
      },
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'ModifyUserDefinedEnum', {
      AssetPath: '/Game/Data/E_Rarity',
      Operation: 'rename_entry',
      PayloadJson: JSON.stringify({
        entryName: 'Rare',
        newName: 'Epic',
      }),
      bValidateOnly: true,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'ModifyUserDefinedStruct', {
      AssetPath: '/Game/Data/S_Item',
      Operation: 'patch_field',
      PayloadJson: JSON.stringify({
        fieldName: 'Damage',
        field: {
          defaultValue: '12',
        },
      }),
      bValidateOnly: false,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(3, 'ModifyBlackboard', {
      AssetPath: '/Game/AI/BB_Main',
      Operation: 'patch_key',
      PayloadJson: JSON.stringify({
        entryName: 'TargetActor',
        key: {
          keyTypePath: '/Script/AIModule.BlackboardKeyType_Object',
        },
      }),
      bValidateOnly: true,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(4, 'ModifyStateTree', {
      AssetPath: '/Game/AI/ST_Main',
      Operation: 'patch_transition',
      PayloadJson: JSON.stringify({
        selector: {
          transitionId: 'transition-1',
        },
        transitionId: 'transition-1',
        transition: {
          delay: 0.2,
        },
      }),
      bValidateOnly: false,
    }, { timeoutMs: 90000 });
    expect(parseDirectToolResult(stateTreeResult)).toMatchObject({
      success: true,
      operation: 'ModifyStateTree',
    });
  });

  // --- C2: Additional AI & Schema authoring tests ---

  it('serializes create_user_defined_struct payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Data/S_Item',
    })));

    const result = await registry.getTool('create_user_defined_struct').handler({
      asset_path: '/Game/Data/S_Item',
      payload: {
        fields: [{ name: 'Damage', pinType: { category: 'int' } }],
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateUserDefinedStruct', {
      AssetPath: '/Game/Data/S_Item',
      PayloadJson: JSON.stringify({
        fields: [{ name: 'Damage', pinType: { category: 'int' } }],
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Data/S_Item',
    });
  });

  it('returns an error when create_user_defined_struct fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('struct creation failed');
    }));

    const result = await registry.getTool('create_user_defined_struct').handler({
      asset_path: '/Game/Data/S_Bad',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'struct creation failed',
    );
  });

  it('serializes create_user_defined_enum payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Data/E_Rarity',
    })));

    const result = await registry.getTool('create_user_defined_enum').handler({
      asset_path: '/Game/Data/E_Rarity',
      payload: {
        entries: [{ name: 'Common' }, { name: 'Rare' }],
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateUserDefinedEnum', {
      AssetPath: '/Game/Data/E_Rarity',
      PayloadJson: JSON.stringify({
        entries: [{ name: 'Common' }, { name: 'Rare' }],
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Data/E_Rarity',
    });
  });

  it('returns an error when create_user_defined_enum fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('enum creation failed');
    }));

    const result = await registry.getTool('create_user_defined_enum').handler({
      asset_path: '/Game/Data/E_Bad',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'enum creation failed',
    );
  });

  it('returns an error when modify_user_defined_struct fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('struct modification failed');
    }));

    const result = await registry.getTool('modify_user_defined_struct').handler({
      asset_path: '/Game/Data/S_Item',
      operation: 'patch_field',
      payload: { fieldName: 'Bad' },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'struct modification failed',
    );
  });

  it('returns an error when modify_user_defined_enum fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('enum modification failed');
    }));

    const result = await registry.getTool('modify_user_defined_enum').handler({
      asset_path: '/Game/Data/E_Rarity',
      operation: 'rename_entry',
      payload: { entryName: 'Bad' },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'enum modification failed',
    );
  });

  it('returns an error when create_blackboard fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('blackboard creation failed');
    }));

    const result = await registry.getTool('create_blackboard').handler({
      asset_path: '/Game/AI/BB_Bad',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'blackboard creation failed',
    );
  });

  it('returns an error when modify_blackboard fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('blackboard modification failed');
    }));

    const result = await registry.getTool('modify_blackboard').handler({
      asset_path: '/Game/AI/BB_Main',
      operation: 'patch_key',
      payload: { entryName: 'Bad' },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'blackboard modification failed',
    );
  });

  it('serializes create_behavior_tree payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/BT_Patrol',
    })));

    const result = await registry.getTool('create_behavior_tree').handler({
      asset_path: '/Game/AI/BT_Patrol',
      payload: {
        blackboardAsset: '/Game/AI/BB_Main',
        rootNode: { nodeClass: 'Selector', children: [] },
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateBehaviorTree', {
      AssetPath: '/Game/AI/BT_Patrol',
      PayloadJson: JSON.stringify({
        blackboardAsset: '/Game/AI/BB_Main',
        rootNode: { nodeClass: 'Selector', children: [] },
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/AI/BT_Patrol',
    });
  });

  it('returns an error when create_behavior_tree fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('behavior tree creation failed');
    }));

    const result = await registry.getTool('create_behavior_tree').handler({
      asset_path: '/Game/AI/BT_Bad',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'behavior tree creation failed',
    );
  });

  it('serializes modify_behavior_tree set_blackboard operation', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'ModifyBehaviorTree',
    })));

    const result = await registry.getTool('modify_behavior_tree').handler({
      asset_path: '/Game/AI/BT_Main',
      operation: 'set_blackboard',
      payload: {
        blackboardAsset: '/Game/AI/BB_New',
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyBehaviorTree', {
      AssetPath: '/Game/AI/BT_Main',
      Operation: 'set_blackboard',
      PayloadJson: JSON.stringify({
        blackboardAsset: '/Game/AI/BB_New',
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'ModifyBehaviorTree',
    });
  });

  it('serializes create_state_tree payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Main',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      payload: {
        schema: '/Script/GameplayStateTreeModule.GameplayStateTreeSchema',
        states: [{ name: 'Idle' }],
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateStateTree', {
      AssetPath: '/Game/AI/ST_Main',
      PayloadJson: JSON.stringify({
        schema: '/Script/GameplayStateTreeModule.GameplayStateTreeSchema',
        states: [{ name: 'Idle' }],
      }),
      bValidateOnly: true,
    }, { timeoutMs: 120000 });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/AI/ST_Main',
    });
  });

  it('returns an error when create_state_tree fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('state tree creation failed');
    }));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Bad',
      payload: { schema: '/Script/GameplayStateTreeModule.GameplayStateTreeSchema' },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'state tree creation failed',
    );
  });

  it('create_state_tree error has non-empty content[0].text when schema is missing', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Bad',
      payload: {},
      validate_only: false,
    });

    const typed = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
    expect(typed.isError).toBe(true);
    expect(typed.content).toBeDefined();
    expect(typed.content!.length).toBeGreaterThan(0);
    expect(typed.content![0].type).toBe('text');
    expect(typed.content![0].text).toBeTruthy();
    expect(typed.content![0].text).not.toBe('Unknown error');
    expect(typed.content![0].text).toContain('schema is required');
  });

  it('returns an error when modify_state_tree fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('state tree modification failed');
    }));

    const result = await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'patch_state',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'state tree modification failed',
    );
  });

  it('create_state_tree serializes a complex multi-state payload', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Complex',
      compilationResult: 'ok',
    })));

    const complexPayload = {
      schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
      states: [
        {
          name: 'Idle',
          nodeStructType: '/Script/MyModule.STCIdleState',
          transitions: [{ targetState: { stateName: 'Chase' }, delay: 0.5 }],
        },
        {
          name: 'Chase',
          nodeStructType: '/Script/MyModule.STCChaseState',
        },
      ],
      evaluators: [{ evaluatorClass: '/Script/MyModule.MyEvaluator' }],
    };

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Complex',
      payload: complexPayload,
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateStateTree', {
      AssetPath: '/Game/AI/ST_Complex',
      PayloadJson: JSON.stringify(complexPayload),
      bValidateOnly: false,
    }, { timeoutMs: 120000 });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/AI/ST_Complex',
      compilationResult: 'ok',
    });
  });

  it('modify_state_tree replace_tree operation passes full payload', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'replace_tree',
    })));

    const payload = {
      stateTree: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [{ name: 'Root' }],
      },
    };

    const result = await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'replace_tree',
      payload,
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyStateTree', {
      AssetPath: '/Game/AI/ST_Main',
      Operation: 'replace_tree',
      PayloadJson: JSON.stringify(payload),
      bValidateOnly: true,
    }, { timeoutMs: 90000 });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'replace_tree',
    });
  });

  it('create_state_tree passes custom timeout_seconds to subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Slow',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [{ name: 'Init' }],
      },
      validate_only: false,
      timeout_seconds: 300,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateStateTree', expect.any(Object), { timeoutMs: 300000 });
  });

  it('modify_state_tree passes custom timeout_seconds to subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'patch_state',
      payload: { stateId: 'state-1', state: { name: 'Updated' } },
      validate_only: false,
      timeout_seconds: 180,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyStateTree', expect.any(Object), { timeoutMs: 180000 });
  });

  it('create_state_tree normalizes F-prefix in nodeStructType paths', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Norm',
    })));

    await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Norm',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Active',
            nodeStructType: '/Script/CyberVolleyball6vs6.FSTCCoachIsRallyActive',
          },
        ],
      },
      validate_only: false,
    });

    const payloadArg = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sentPayload = JSON.parse(payloadArg.PayloadJson as string) as Record<string, unknown>;
    const states = sentPayload.states as Array<Record<string, unknown>>;
    expect(states[0].nodeStructType).toBe('/Script/CyberVolleyball6vs6.STCCoachIsRallyActive');
  });

  it('modify_state_tree normalizes nested nodeStructType in payload', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'replace_tree',
      payload: {
        stateTree: {
          states: [
            { name: 'A', nodeStructType: '/Script/Mod.FSTCAlpha' },
            { name: 'B', nodeStructType: '/Script/Mod.BetaTask' },
          ],
        },
      },
      validate_only: false,
    });

    const payloadArg = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sentPayload = JSON.parse(payloadArg.PayloadJson as string) as Record<string, unknown>;
    const stateTree = sentPayload.stateTree as Record<string, unknown>;
    const states = stateTree.states as Array<Record<string, unknown>>;
    expect(states[0].nodeStructType).toBe('/Script/Mod.STCAlpha');
    expect(states[1].nodeStructType).toBe('/Script/Mod.BetaTask');
  });

  it('create_state_tree surfaces normalization warnings in response content', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Warn',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Warn',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          { name: 'S1', nodeStructType: '/Script/Mod.FSTCFoo' },
        ],
      },
      validate_only: false,
    }) as { content?: Array<{ type: string; text?: string }> };

    const textContent = result.content?.find(c => c.type === 'text')?.text ?? '';
    expect(textContent).toContain('Auto-normalized F-prefix');
    expect(textContent).toContain('FSTCFoo');
  });

  it('create_state_tree includes transition target validation warnings for unresolvable targets', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Trans',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Trans',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Idle',
            transitions: [{ targetState: { stateName: 'NonExistentState' } }],
          },
          { name: 'Chase' },
        ],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) => w.includes('NonExistentState') && w.includes('not in the states list'))).toBe(true);
  });

  it('create_state_tree does not warn when transition target exists in states list', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Valid',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Valid',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Idle',
            transitions: [{ targetState: { stateName: 'Chase' } }],
          },
          { name: 'Chase' },
        ],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.warnings).toBeUndefined();
  });

  // --- Task 12: Extended validation tests ---

  it('create_state_tree warns when nodeStructType uses Blueprint asset path format', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_BadPath',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_BadPath',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Active',
            nodeStructType: '/Game/Blueprints/BP_MyTask.BP_MyTask_C',
          },
        ],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) =>
      w.includes('/Game/Blueprints/BP_MyTask.BP_MyTask_C')
      && w.includes('Blueprint asset path'),
    )).toBe(true);
  });

  it('create_state_tree warns when nodeStructType is a bare class name', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Bare',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Bare',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Active',
            nodeStructType: 'STCMyTask',
          },
        ],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) =>
      w.includes('STCMyTask')
      && w.includes('bare class name'),
    )).toBe(true);
  });

  it('create_state_tree warns when nodeStructType is missing class name after module', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_NoDot',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_NoDot',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Active',
            nodeStructType: '/Script/MyModule',
          },
        ],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) =>
      w.includes('/Script/MyModule')
      && w.includes('missing the class name'),
    )).toBe(true);
  });

  it('create_state_tree warns for unrecognized nodeStructType path format', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Odd',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Odd',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Active',
            nodeStructType: '/Content/Custom/MyTask',
          },
        ],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) =>
      w.includes('/Content/Custom/MyTask')
      && w.includes('Blueprint asset path'),
    )).toBe(true);
  });

  it('create_state_tree does not warn for valid /Script/Module.ClassName nodeStructType', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Good',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Good',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Active',
            nodeStructType: '/Script/MyModule.STCMyTask',
          },
        ],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.warnings).toBeUndefined();
  });

  it('create_state_tree normalizes F-prefix in deeply nested tasks and conditions', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Deep',
    })));

    await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Deep',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Root',
            type: 'State',
            children: [
              {
                name: 'Combat',
                type: 'State',
                tasks: [
                  { nodeStructType: '/Script/MyMod.FSTCAttack', name: 'AttackTask' },
                  { nodeStructType: '/Script/MyMod.FSTCDefend', name: 'DefendTask' },
                ],
                enterConditions: [
                  { nodeStructType: '/Script/MyMod.FSTCHasTarget' },
                ],
                transitions: [
                  {
                    targetState: { stateName: 'Root' },
                    conditions: [
                      { nodeStructType: '/Script/MyMod.FSTCHealthLow' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        globalTasks: [
          { nodeStructType: '/Script/MyMod.FSTCGlobalEval', name: 'GlobalEval' },
        ],
      },
      validate_only: false,
    });

    const payloadArg = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sentPayload = JSON.parse(payloadArg.PayloadJson as string) as Record<string, unknown>;

    // Check nested task normalization
    const states = sentPayload.states as Array<Record<string, unknown>>;
    const rootChildren = states[0].children as Array<Record<string, unknown>>;
    const combatTasks = rootChildren[0].tasks as Array<Record<string, unknown>>;
    expect(combatTasks[0].nodeStructType).toBe('/Script/MyMod.STCAttack');
    expect(combatTasks[1].nodeStructType).toBe('/Script/MyMod.STCDefend');

    // Check nested condition normalization
    const enterConditions = rootChildren[0].enterConditions as Array<Record<string, unknown>>;
    expect(enterConditions[0].nodeStructType).toBe('/Script/MyMod.STCHasTarget');

    // Check transition condition normalization
    const transitions = rootChildren[0].transitions as Array<Record<string, unknown>>;
    const transConditions = transitions[0].conditions as Array<Record<string, unknown>>;
    expect(transConditions[0].nodeStructType).toBe('/Script/MyMod.STCHealthLow');

    // Check globalTasks normalization
    const globalTasks = sentPayload.globalTasks as Array<Record<string, unknown>>;
    expect(globalTasks[0].nodeStructType).toBe('/Script/MyMod.STCGlobalEval');
  });

  it('modify_state_tree validates nodeStructType paths in replace_tree payload', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    const result = await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'replace_tree',
      payload: {
        stateTree: {
          states: [
            {
              name: 'A',
              nodeStructType: '/Game/BadPath/BP_Task.BP_Task_C',
            },
          ],
        },
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) => w.includes('Blueprint asset path'))).toBe(true);
  });

  it('create_state_tree schema validation error has actionable message', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_NoSchema',
      payload: { states: [{ name: 'Idle' }] },
      validate_only: false,
    });

    const typed = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
    expect(typed.isError).toBe(true);
    expect(typed.content![0].text).toContain('schema is required');
    expect(typed.content![0].text).toContain('payload.schema');
    expect(typed.content![0].text).toContain('/Script/');
  });

  it('create_state_tree warns for schema path that does not start with /Script/', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_BadSchema',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_BadSchema',
      payload: {
        schema: 'GameplayStateTreeModule.StateTreeComponentSchema',
        states: [{ name: 'Idle' }],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) => w.includes('does not match expected /Script/'))).toBe(true);
  });

  // --- StateTree property path binding tests ---

  it('accepts property path bindings in create_state_tree payload', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Bound',
    })));

    const payload = {
      schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
      states: [{ name: 'Root', type: 'State', tasks: [
        { nodeStructType: '/Script/Test.TaskA', name: 'SelectGesture' },
        { nodeStructType: '/Script/Test.TaskB', name: 'PlayMontage' },
      ]}],
      bindings: {
        propertyBindings: [{
          sourcePath: { segments: [{ name: 'SelectedGestureTag' }] },
          targetPath: { segments: [{ name: 'MontageTag' }] },
        }],
      },
    };

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Bound',
      payload,
      validate_only: false,
    });

    const payloadArg = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sent = JSON.parse(payloadArg.PayloadJson as string) as Record<string, unknown>;
    const bindings = sent.bindings as { propertyBindings: Array<Record<string, unknown>> };
    expect(bindings.propertyBindings[0].sourcePath).toEqual({ segments: [{ name: 'SelectedGestureTag' }] });
    expect(bindings.propertyBindings[0].targetPath).toEqual({ segments: [{ name: 'MontageTag' }] });
    expect(parseDirectToolResult(result)).toMatchObject({ success: true });
    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.warnings).toBeUndefined();
  });

  it('accepts property path with structId and arrayIndex', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_Complex',
    })));

    const payload = {
      schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
      states: [{ name: 'Root', type: 'State' }],
      bindings: {
        propertyBindings: [{
          sourcePath: {
            structId: 'EAB9611F4B07D7E2C25A948AFC790A50',
            segments: [
              { name: 'Items', arrayIndex: 0 },
              { name: 'Value', instanceStruct: '/Script/Test.FItemData' },
            ],
          },
          targetPath: { segments: [{ name: 'InputValue' }] },
        }],
      },
    };

    await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_Complex',
      payload,
      validate_only: false,
    });

    const payloadArg = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sent = JSON.parse(payloadArg.PayloadJson as string) as Record<string, unknown>;
    const bindings = sent.bindings as { propertyBindings: Array<Record<string, unknown>> };
    const source = bindings.propertyBindings[0].sourcePath as Record<string, unknown>;
    expect(source.structId).toBe('EAB9611F4B07D7E2C25A948AFC790A50');
    expect((source.segments as unknown[]).length).toBe(2);
    expect((source.segments as Array<Record<string, unknown>>)[0].arrayIndex).toBe(0);
  });

  it('accepts bindings in modify_state_tree replace_tree payload', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'replace_tree',
    })));

    const payload = {
      stateTree: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [{ name: 'Main', tasks: [
          { name: 'SensorTask', nodeStructType: '/Script/MyMod.STCSensor' },
          { name: 'ActuatorTask', nodeStructType: '/Script/MyMod.STCActuator' },
        ]}],
        bindings: {
          propertyBindings: [{
            sourcePath: { segments: [{ name: 'DetectedTarget' }] },
            targetPath: { segments: [{ name: 'TargetActor' }] },
          }],
        },
      },
    };

    const result = await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'replace_tree',
      payload,
      validate_only: false,
    });

    const payloadArg = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sent = JSON.parse(payloadArg.PayloadJson as string) as Record<string, unknown>;
    const stateTree = sent.stateTree as Record<string, unknown>;
    const bindings = stateTree.bindings as { propertyBindings: Array<Record<string, unknown>> };
    expect(bindings.propertyBindings[0].sourcePath).toEqual({ segments: [{ name: 'DetectedTarget' }] });
    expect(parseDirectToolResult(result)).toMatchObject({ success: true });
  });

  it('set_bindings passes propertyBindings to ModifyStateTree', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'set_bindings',
    })));

    await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/Test/ST',
      operation: 'set_bindings',
      payload: {
        propertyBindings: [{
          sourcePath: { segments: [{ name: 'Output' }] },
          targetPath: { segments: [{ name: 'Input' }] },
        }],
      },
      validate_only: false,
    });

    const call = callSubsystemJson.mock.calls[0] as unknown[];
    expect(call[0]).toBe('ModifyStateTree');
    expect((call[1] as Record<string, unknown>).Operation).toBe('set_bindings');
    const sent = JSON.parse((call[1] as Record<string, unknown>).PayloadJson as string) as Record<string, unknown>;
    expect(sent.propertyBindings).toBeDefined();
    const bindings = sent.propertyBindings as Array<Record<string, unknown>>;
    expect((bindings[0].sourcePath as Record<string, unknown>).segments).toEqual([{ name: 'Output' }]);
  });

  it('add_binding passes single binding to ModifyStateTree', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'add_binding',
    })));

    await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/Test/ST',
      operation: 'add_binding',
      payload: {
        sourcePath: { segments: [{ name: 'Tag' }] },
        targetPath: { segments: [{ name: 'MontageTag' }] },
      },
      validate_only: false,
    });

    const call = callSubsystemJson.mock.calls[0] as unknown[];
    expect((call[1] as Record<string, unknown>).Operation).toBe('add_binding');
    const sent = JSON.parse((call[1] as Record<string, unknown>).PayloadJson as string) as Record<string, unknown>;
    expect((sent.sourcePath as Record<string, unknown>).segments).toEqual([{ name: 'Tag' }]);
  });

  it('remove_binding passes targetPath to ModifyStateTree', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'remove_binding',
    })));

    await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/Test/ST',
      operation: 'remove_binding',
      payload: {
        targetPath: { segments: [{ name: 'MontageTag' }] },
      },
      validate_only: false,
    });

    const call = callSubsystemJson.mock.calls[0] as unknown[];
    expect((call[1] as Record<string, unknown>).Operation).toBe('remove_binding');
    const sent = JSON.parse((call[1] as Record<string, unknown>).PayloadJson as string) as Record<string, unknown>;
    expect((sent.targetPath as Record<string, unknown>).segments).toEqual([{ name: 'MontageTag' }]);
  });

  it('warns when binding sourcePath has empty segments', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_BadPath',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_BadPath',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [{ name: 'Root', type: 'State' }],
        bindings: {
          propertyBindings: [{
            sourcePath: { segments: [] },
            targetPath: { segments: [{ name: 'Input' }] },
          }],
        },
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) => w.includes('sourcePath') && w.includes('segment'))).toBe(true);
  });

  it('warns when binding targetPath has empty segments', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_BadTarget',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_BadTarget',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [{ name: 'Root', type: 'State' }],
        bindings: {
          propertyBindings: [{
            sourcePath: { segments: [{ name: 'Out' }] },
            targetPath: { segments: [] },
          }],
        },
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) => w.includes('targetPath') && w.includes('segment'))).toBe(true);
  });

  it('does not warn for valid property path bindings', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/AI/ST_ValidBind',
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_ValidBind',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [{ name: 'Root', type: 'State', tasks: [
          { name: 'TaskA', nodeStructType: '/Script/MyMod.STCTaskA' },
          { name: 'TaskB', nodeStructType: '/Script/MyMod.STCTaskB' },
        ]}],
        bindings: {
          propertyBindings: [{
            sourcePath: { segments: [{ name: 'Output' }] },
            targetPath: { segments: [{ name: 'Input' }] },
          }],
        },
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.warnings).toBeUndefined();
  });

  it('patch_state passes selector.statePath in PayloadJson', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'patch_state',
      payload: {
        selector: { statePath: 'Root.Combat' },
        state: { name: 'CombatRenamed' },
      },
      validate_only: false,
    });

    const callArgs = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sentPayload = JSON.parse(callArgs.PayloadJson as string) as Record<string, unknown>;
    expect(callArgs.Operation).toBe('patch_state');
    expect(sentPayload.selector).toEqual({ statePath: 'Root.Combat' });
    expect((sentPayload.state as Record<string, unknown>).name).toBe('CombatRenamed');
  });

  it('patch_state passes top-level stateId in PayloadJson', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'patch_state',
      payload: {
        stateId: 'abc-123',
        state: { name: 'Patched' },
      },
      validate_only: false,
    });

    const callArgs = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sentPayload = JSON.parse(callArgs.PayloadJson as string) as Record<string, unknown>;
    expect(sentPayload.stateId).toBe('abc-123');
    expect((sentPayload.state as Record<string, unknown>).name).toBe('Patched');
  });

  it('patch_state passes top-level statePath in PayloadJson', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'patch_state',
      payload: {
        statePath: 'Root.Idle',
        state: { name: 'IdleRenamed' },
      },
      validate_only: false,
    });

    const callArgs = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sentPayload = JSON.parse(callArgs.PayloadJson as string) as Record<string, unknown>;
    expect(sentPayload.statePath).toBe('Root.Idle');
    expect((sentPayload.state as Record<string, unknown>).name).toBe('IdleRenamed');
  });

  // --- instanceObjectClass validation warnings ---

  it('create_state_tree warns when Blueprint wrapper node is missing instanceObjectClass', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_BPWrapper',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Root',
            tasks: [
              {
                name: 'MyBPTask',
                nodeStructType: '/Script/StateTreeModule.StateTreeBlueprintTaskWrapper',
              },
            ],
          },
        ],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) => w.includes('instanceObjectClass'))).toBe(true);
    expect(warnings.some((w: string) => w.includes('MyBPTask'))).toBe(true);
  });

  it('create_state_tree does not warn when Blueprint wrapper node has instanceObjectClass', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    const result = await registry.getTool('create_state_tree').handler({
      asset_path: '/Game/AI/ST_BPWrapper',
      payload: {
        schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
        states: [
          {
            name: 'Root',
            tasks: [
              {
                name: 'MyBPTask',
                nodeStructType: '/Script/StateTreeModule.StateTreeBlueprintTaskWrapper',
                instanceObjectClass: '/Game/AI/BP_MyTask.BP_MyTask_C',
              },
            ],
          },
        ],
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[] | undefined;
    if (warnings) {
      expect(warnings.some((w: string) => w.includes('instanceObjectClass'))).toBe(false);
    }
  });

  it('modify_state_tree replace_tree warns for Blueprint condition wrapper missing instanceObjectClass', async () => {
    const { registry } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    const result = await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'replace_tree',
      payload: {
        stateTree: {
          states: [
            {
              name: 'Root',
              conditions: [
                {
                  name: 'BPCondition',
                  nodeStructType: '/Script/StateTreeModule.StateTreeBlueprintConditionWrapper',
                },
              ],
            },
          ],
        },
      },
      validate_only: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const warnings = parsed.warnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.some((w: string) => w.includes('instanceObjectClass'))).toBe(true);
    expect(warnings.some((w: string) => w.includes('BPCondition'))).toBe(true);
  });

  it('instanceObjectClass is preserved in serialized PayloadJson for replace_tree', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
    })));

    const payload = {
      stateTree: {
        states: [
          {
            name: 'Root',
            tasks: [
              {
                name: 'MyBPTask',
                nodeStructType: '/Script/StateTreeModule.StateTreeBlueprintTaskWrapper',
                instanceObjectClass: '/Game/AI/BP_MyTask.BP_MyTask_C',
              },
            ],
          },
        ],
      },
    };

    await registry.getTool('modify_state_tree').handler({
      asset_path: '/Game/AI/ST_Main',
      operation: 'replace_tree',
      payload,
      validate_only: true,
    });

    const callArgs = (callSubsystemJson.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const sentPayload = JSON.parse(callArgs.PayloadJson as string) as Record<string, unknown>;
    const stateTree = sentPayload.stateTree as Record<string, unknown>;
    const states = stateTree.states as Array<Record<string, unknown>>;
    const tasks = states[0].tasks as Array<Record<string, unknown>>;
    expect(tasks[0].instanceObjectClass).toBe('/Game/AI/BP_MyTask.BP_MyTask_C');
  });
});
