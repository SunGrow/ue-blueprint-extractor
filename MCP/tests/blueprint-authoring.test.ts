import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerBlueprintAuthoringTools } from '../src/tools/blueprint-authoring.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const jsonObjectSchema = z.record(z.string(), z.unknown());
const blueprintMemberMutationOperationSchema = z.enum([
  'replace_variables',
  'patch_variable',
  'add_component',
  'patch_class_defaults',
]);
const blueprintGraphMutationOperationSchema = z.enum([
  'upsert_function_graphs',
  'append_function_call_to_sequence',
  'compile',
]);

describe('registerBlueprintAuthoringTools', () => {
  it('serializes create_blueprint payloads for the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Blueprints/BP_Test',
    }));

    registerBlueprintAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      blueprintMemberMutationOperationSchema,
      blueprintGraphMutationOperationSchema,
    });

    const result = await registry.getTool('create_blueprint').handler({
      asset_path: '/Game/Blueprints/BP_Test',
      parent_class_path: '/Script/Engine.Actor',
      payload: {
        classDefaults: {
          bReplicates: true,
        },
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateBlueprint', {
      AssetPath: '/Game/Blueprints/BP_Test',
      ParentClassPath: '/Script/Engine.Actor',
      PayloadJson: JSON.stringify({
        classDefaults: {
          bReplicates: true,
        },
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Blueprints/BP_Test',
    });
  });

  it('returns an error when member mutation fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('member patch failed');
    });

    registerBlueprintAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      blueprintMemberMutationOperationSchema,
      blueprintGraphMutationOperationSchema,
    });

    const result = await registry.getTool('modify_blueprint_members').handler({
      asset_path: '/Game/Blueprints/BP_Test',
      operation: 'patch_class_defaults',
      payload: {
        classDefaults: {
          bReplicates: true,
        },
      },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'member patch failed',
    );
  });

  it('accepts add_component operation and passes payload to subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'add_component',
    }));

    registerBlueprintAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      blueprintMemberMutationOperationSchema,
      blueprintGraphMutationOperationSchema,
    });

    const result = await registry.getTool('modify_blueprint_members').handler({
      asset_path: '/Game/Blueprints/BP_Test',
      operation: 'add_component',
      payload: {
        componentName: 'NewStaticMesh',
        component: {
          componentClass: '/Script/Engine.StaticMeshComponent',
          properties: {
            StaticMesh: '/Game/Meshes/SM_Cube',
          },
        },
      },
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyBlueprintMembers', {
      AssetPath: '/Game/Blueprints/BP_Test',
      Operation: 'add_component',
      PayloadJson: JSON.stringify({
        componentName: 'NewStaticMesh',
        component: {
          componentClass: '/Script/Engine.StaticMeshComponent',
          properties: {
            StaticMesh: '/Game/Meshes/SM_Cube',
          },
        },
      }),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'add_component',
    });
  });

  it('passes parentComponentName through in add_component payload', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'add_component',
    }));

    registerBlueprintAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      blueprintMemberMutationOperationSchema,
      blueprintGraphMutationOperationSchema,
    });

    const result = await registry.getTool('modify_blueprint_members').handler({
      asset_path: '/Game/Blueprints/BP_Test',
      operation: 'add_component',
      payload: {
        componentName: 'ChildMesh',
        component: {
          componentClass: '/Script/Engine.BoxComponent',
          parentComponentName: 'RootComponent',
          properties: {
            BoxExtent: { X: 50, Y: 50, Z: 50 },
          },
        },
      },
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyBlueprintMembers', {
      AssetPath: '/Game/Blueprints/BP_Test',
      Operation: 'add_component',
      PayloadJson: JSON.stringify({
        componentName: 'ChildMesh',
        component: {
          componentClass: '/Script/Engine.BoxComponent',
          parentComponentName: 'RootComponent',
          properties: {
            BoxExtent: { X: 50, Y: 50, Z: 50 },
          },
        },
      }),
      bValidateOnly: false,
    });
    const payloadJson = callSubsystemJson.mock.calls[0][1].PayloadJson as string;
    const parsedPayload = JSON.parse(payloadJson);
    expect(parsedPayload.component).toHaveProperty('parentComponentName', 'RootComponent');
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'add_component',
    });
  });

  it('returns an error when subsystem fails for add_component', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('component class not found: /Script/Engine.InvalidComponent');
    });

    registerBlueprintAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      blueprintMemberMutationOperationSchema,
      blueprintGraphMutationOperationSchema,
    });

    const result = await registry.getTool('modify_blueprint_members').handler({
      asset_path: '/Game/Blueprints/BP_Test',
      operation: 'add_component',
      payload: {
        componentName: 'BadComponent',
        component: {
          componentClass: '/Script/Engine.InvalidComponent',
        },
      },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'component class not found',
    );
  });

  it('routes member and graph mutations through distinct subsystem methods with their original payload shapes', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async (method) => ({
      success: true,
      operation: method,
    }));

    registerBlueprintAuthoringTools({
      server: registry.server,
      callSubsystemJson,
      jsonObjectSchema,
      blueprintMemberMutationOperationSchema,
      blueprintGraphMutationOperationSchema,
    });

    await registry.getTool('modify_blueprint_members').handler({
      asset_path: '/Game/Blueprints/BP_Test',
      operation: 'patch_variable',
      payload: {
        variableName: 'Damage',
        variable: {
          defaultValue: 12,
        },
      },
      validate_only: true,
    });
    const graphResult = await registry.getTool('modify_blueprint_graphs').handler({
      asset_path: '/Game/Blueprints/BP_Test',
      operation: 'append_function_call_to_sequence',
      payload: {
        graphName: 'EventGraph',
        functionName: 'HandleDamage',
        sequenceNodeTitle: 'Then 0',
        posX: 10,
        posY: 20,
      },
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'ModifyBlueprintMembers', {
      AssetPath: '/Game/Blueprints/BP_Test',
      Operation: 'patch_variable',
      PayloadJson: JSON.stringify({
        variableName: 'Damage',
        variable: {
          defaultValue: 12,
        },
      }),
      bValidateOnly: true,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'ModifyBlueprintGraphs', {
      AssetPath: '/Game/Blueprints/BP_Test',
      Operation: 'append_function_call_to_sequence',
      PayloadJson: JSON.stringify({
        graphName: 'EventGraph',
        functionName: 'HandleDamage',
        sequenceNodeTitle: 'Then 0',
        posX: 10,
        posY: 20,
      }),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(graphResult)).toMatchObject({
      success: true,
      operation: 'ModifyBlueprintGraphs',
    });
  });
});
