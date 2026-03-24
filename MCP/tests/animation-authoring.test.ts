import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerAnimationAuthoringTools } from '../src/tools/animation-authoring.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const jsonObjectSchema = z.record(z.string(), z.unknown());
const animSequenceMutationOperationSchema = z.enum(['replace_notifies', 'patch_notify']);
const animMontageMutationOperationSchema = z.enum(['replace_notifies', 'patch_notify']);
const animationNotifySelectorSchema = z.object({
  notifyId: z.string().optional(),
  notifyGuid: z.string().optional(),
}).passthrough();
const blendSpaceMutationOperationSchema = z.enum(['replace_samples', 'patch_sample']);
const blendParameterSchema = z.object({}).passthrough();
const blendSpaceSampleSchema = z.object({}).passthrough();

function setupRegistry(callSubsystemJson = vi.fn(async () => ({ success: true }))) {
  const registry = createToolRegistry();
  registerAnimationAuthoringTools({
    server: registry.server,
    callSubsystemJson,
    jsonObjectSchema,
    animSequenceMutationOperationSchema,
    animMontageMutationOperationSchema,
    animationNotifySelectorSchema,
    blendSpaceMutationOperationSchema,
    blendParameterSchema,
    blendSpaceSampleSchema,
  });
  return { registry, callSubsystemJson };
}

describe('registerAnimationAuthoringTools', () => {
  it('serializes create_blend_space payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Anim/BS_Locomotion',
    })));

    const result = await registry.getTool('create_blend_space').handler({
      asset_path: '/Game/Anim/BS_Locomotion',
      payload: {
        skeleton: '/Game/Characters/SK_Player',
        is1D: false,
        samples: [{
          animation: '/Game/Anim/Walk',
          sampleValue: { x: 0, y: 0 },
        }],
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateBlendSpace', {
      AssetPath: '/Game/Anim/BS_Locomotion',
      PayloadJson: JSON.stringify({
        skeleton: '/Game/Characters/SK_Player',
        is1D: false,
        samples: [{
          animation: '/Game/Anim/Walk',
          sampleValue: { x: 0, y: 0 },
        }],
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Anim/BS_Locomotion',
    });
  });

  it('returns an error when montage mutation fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('montage patch rejected');
    }));

    const result = await registry.getTool('modify_anim_montage').handler({
      asset_path: '/Game/Anim/AM_Attack',
      operation: 'patch_notify',
      payload: {
        selector: {
          notifyId: 'HitNotify',
        },
      },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'montage patch rejected',
    );
  });

  it('preserves operation-specific selector payloads for anim-sequence and blend-space mutations', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async (method) => ({
      success: true,
      operation: method,
    })));

    await registry.getTool('modify_anim_sequence').handler({
      asset_path: '/Game/Anim/AS_Attack',
      operation: 'patch_notify',
      payload: {
        selector: {
          notifyId: 'Impact',
        },
        notify: {
          notifyName: 'Impact',
        },
        trackIndex: 1,
      },
      validate_only: true,
    });
    const blendResult = await registry.getTool('modify_blend_space').handler({
      asset_path: '/Game/Anim/BS_Locomotion',
      operation: 'patch_sample',
      payload: {
        selector: {
          sampleIndex: 2,
        },
        sample: {
          animation: '/Game/Anim/Run',
        },
      },
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'ModifyAnimSequence', {
      AssetPath: '/Game/Anim/AS_Attack',
      Operation: 'patch_notify',
      PayloadJson: JSON.stringify({
        selector: {
          notifyId: 'Impact',
        },
        notify: {
          notifyName: 'Impact',
        },
        trackIndex: 1,
      }),
      bValidateOnly: true,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'ModifyBlendSpace', {
      AssetPath: '/Game/Anim/BS_Locomotion',
      Operation: 'patch_sample',
      PayloadJson: JSON.stringify({
        selector: {
          sampleIndex: 2,
        },
        sample: {
          animation: '/Game/Anim/Run',
        },
      }),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(blendResult)).toMatchObject({
      success: true,
      operation: 'ModifyBlendSpace',
    });
  });

  // --- C2: Additional Animation & Tree tool tests ---

  it('serializes create_anim_montage payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Anim/AM_Attack',
    })));

    const result = await registry.getTool('create_anim_montage').handler({
      asset_path: '/Game/Anim/AM_Attack',
      payload: {
        sourceAnimation: '/Game/Anim/AS_Attack',
        skeleton: '/Game/Characters/SK_Player',
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateAnimMontage', {
      AssetPath: '/Game/Anim/AM_Attack',
      PayloadJson: JSON.stringify({
        sourceAnimation: '/Game/Anim/AS_Attack',
        skeleton: '/Game/Characters/SK_Player',
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Anim/AM_Attack',
    });
  });

  it('returns an error when create_anim_montage fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('montage creation failed');
    }));

    const result = await registry.getTool('create_anim_montage').handler({
      asset_path: '/Game/Anim/AM_Bad',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'montage creation failed',
    );
  });

  it('serializes create_anim_sequence payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Anim/AS_Idle',
    })));

    const result = await registry.getTool('create_anim_sequence').handler({
      asset_path: '/Game/Anim/AS_Idle',
      payload: {
        skeleton: '/Game/Characters/SK_Player',
        notifies: [{ notifyName: 'FootStep' }],
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateAnimSequence', {
      AssetPath: '/Game/Anim/AS_Idle',
      PayloadJson: JSON.stringify({
        skeleton: '/Game/Characters/SK_Player',
        notifies: [{ notifyName: 'FootStep' }],
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Anim/AS_Idle',
    });
  });

  it('returns an error when create_anim_sequence fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('sequence creation failed');
    }));

    const result = await registry.getTool('create_anim_sequence').handler({
      asset_path: '/Game/Anim/AS_Bad',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'sequence creation failed',
    );
  });

  it('serializes modify_anim_montage replace_notifies operation', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'ModifyAnimMontage',
    })));

    const result = await registry.getTool('modify_anim_montage').handler({
      asset_path: '/Game/Anim/AM_Attack',
      operation: 'replace_notifies',
      payload: {
        notifies: [{ notifyName: 'Impact', time: 0.5 }],
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyAnimMontage', {
      AssetPath: '/Game/Anim/AM_Attack',
      Operation: 'replace_notifies',
      PayloadJson: JSON.stringify({
        notifies: [{ notifyName: 'Impact', time: 0.5 }],
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'ModifyAnimMontage',
    });
  });

  it('returns an error when modify_anim_sequence fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('sequence modification failed');
    }));

    const result = await registry.getTool('modify_anim_sequence').handler({
      asset_path: '/Game/Anim/AS_Bad',
      operation: 'replace_notifies',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'sequence modification failed',
    );
  });

  it('returns an error when create_blend_space fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('blend space creation failed');
    }));

    const result = await registry.getTool('create_blend_space').handler({
      asset_path: '/Game/Anim/BS_Bad',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'blend space creation failed',
    );
  });

  it('returns an error when modify_blend_space fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('blend space modification failed');
    }));

    const result = await registry.getTool('modify_blend_space').handler({
      asset_path: '/Game/Anim/BS_Locomotion',
      operation: 'replace_samples',
      payload: {},
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'blend space modification failed',
    );
  });
});
