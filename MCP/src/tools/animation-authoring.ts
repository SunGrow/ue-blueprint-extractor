import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterAnimationAuthoringToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  jsonObjectSchema: z.ZodTypeAny;
  animSequenceMutationOperationSchema: z.ZodTypeAny;
  animMontageMutationOperationSchema: z.ZodTypeAny;
  animationNotifySelectorSchema: z.ZodTypeAny;
  blendSpaceMutationOperationSchema: z.ZodTypeAny;
  blendParameterSchema: z.ZodTypeAny;
  blendSpaceSampleSchema: z.ZodTypeAny;
};

export function registerAnimationAuthoringTools({
  server,
  callSubsystemJson,
  jsonObjectSchema,
  animSequenceMutationOperationSchema,
  animMontageMutationOperationSchema,
  animationNotifySelectorSchema,
  blendSpaceMutationOperationSchema,
  blendParameterSchema,
  blendSpaceSampleSchema,
}: RegisterAnimationAuthoringToolsOptions): void {
  server.registerTool(
    'create_anim_sequence',
    {
      title: 'Create AnimSequence',
      description: 'Create a UE5 AnimSequence asset from extractor-shaped metadata payloads.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new AnimSequence asset.',
        ),
        payload: z.object({
          animSequence: jsonObjectSchema.optional(),
          skeleton: z.string().optional(),
          skeletonPath: z.string().optional(),
          previewMesh: z.string().optional(),
          previewSkeletalMesh: z.string().optional(),
          notifies: z.array(jsonObjectSchema).optional(),
          syncMarkers: z.array(jsonObjectSchema).optional(),
          curves: z.array(jsonObjectSchema).optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped AnimSequence payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create AnimSequence',
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
        const parsed = await callSubsystemJson('CreateAnimSequence', {
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
    'modify_anim_sequence',
    {
      title: 'Modify AnimSequence',
      description: 'Modify a UE5 AnimSequence by replacing or patching notifies, sync markers, and curve metadata.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the AnimSequence asset to modify.',
        ),
        operation: animSequenceMutationOperationSchema.describe(
          'AnimSequence mutation operation to apply.',
        ),
        payload: z.object({
          animSequence: jsonObjectSchema.optional(),
          selector: animationNotifySelectorSchema.optional(),
          notify: jsonObjectSchema.optional(),
          notifies: z.array(jsonObjectSchema).optional(),
          syncMarkers: z.array(jsonObjectSchema).optional(),
          curves: z.array(jsonObjectSchema).optional(),
          notifyId: z.string().optional(),
          notifyGuid: z.string().optional(),
          notifyIndex: z.number().int().min(0).optional(),
          trackIndex: z.number().int().min(0).optional(),
          trackName: z.string().optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Notify selectors prefer notifyId or notifyGuid and fall back to notifyIndex/track metadata.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify AnimSequence',
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
        const parsed = await callSubsystemJson('ModifyAnimSequence', {
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
    'create_anim_montage',
    {
      title: 'Create AnimMontage',
      description: 'Create a UE5 AnimMontage asset from extractor-shaped metadata payloads.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new AnimMontage asset.',
        ),
        payload: z.object({
          animMontage: jsonObjectSchema.optional(),
          sourceAnimation: z.string().optional(),
          sourceAnimSequence: z.string().optional(),
          skeleton: z.string().optional(),
          skeletonPath: z.string().optional(),
          previewMesh: z.string().optional(),
          previewSkeletalMesh: z.string().optional(),
          notifies: z.array(jsonObjectSchema).optional(),
          sections: z.array(jsonObjectSchema).optional(),
          slots: z.array(jsonObjectSchema).optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped AnimMontage payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create AnimMontage',
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
        const parsed = await callSubsystemJson('CreateAnimMontage', {
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
    'modify_anim_montage',
    {
      title: 'Modify AnimMontage',
      description: 'Modify a UE5 AnimMontage by replacing or patching notifies, sections, and slot tracks.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the AnimMontage asset to modify.',
        ),
        operation: animMontageMutationOperationSchema.describe(
          'AnimMontage mutation operation to apply.',
        ),
        payload: z.object({
          animMontage: jsonObjectSchema.optional(),
          selector: animationNotifySelectorSchema.optional(),
          notify: jsonObjectSchema.optional(),
          notifies: z.array(jsonObjectSchema).optional(),
          sections: z.array(jsonObjectSchema).optional(),
          slots: z.array(jsonObjectSchema).optional(),
          notifyId: z.string().optional(),
          notifyGuid: z.string().optional(),
          notifyIndex: z.number().int().min(0).optional(),
          trackIndex: z.number().int().min(0).optional(),
          trackName: z.string().optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Notify selectors prefer notifyId or notifyGuid and fall back to notifyIndex/track metadata.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify AnimMontage',
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
        const parsed = await callSubsystemJson('ModifyAnimMontage', {
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
    'create_blend_space',
    {
      title: 'Create BlendSpace',
      description: 'Create a UE5 BlendSpace or BlendSpace1D asset from extractor-shaped sample and axis payloads.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new BlendSpace asset.',
        ),
        payload: z.object({
          blendSpace: jsonObjectSchema.optional(),
          skeleton: z.string().optional(),
          skeletonPath: z.string().optional(),
          previewMesh: z.string().optional(),
          previewSkeletalMesh: z.string().optional(),
          is1D: z.boolean().optional(),
          axisX: blendParameterSchema.optional(),
          axisY: blendParameterSchema.optional(),
          samples: z.array(blendSpaceSampleSchema).optional(),
        }).passthrough().default({}).describe(
          'Extractor-shaped BlendSpace payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without creating the asset.',
        ),
      },
      annotations: {
        title: 'Create BlendSpace',
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
        const parsed = await callSubsystemJson('CreateBlendSpace', {
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
    'modify_blend_space',
    {
      title: 'Modify BlendSpace',
      description: 'Modify a UE5 BlendSpace by replacing or patching samples and axis definitions.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the BlendSpace asset to modify.',
        ),
        operation: blendSpaceMutationOperationSchema.describe(
          'BlendSpace mutation operation to apply.',
        ),
        payload: z.object({
          blendSpace: jsonObjectSchema.optional(),
          selector: z.object({
            sampleIndex: z.number().int().min(0).optional(),
          }).passthrough().optional(),
          sample: blendSpaceSampleSchema.optional(),
          sampleIndex: z.number().int().min(0).optional(),
          samples: z.array(blendSpaceSampleSchema).optional(),
          axisX: blendParameterSchema.optional(),
          axisY: blendParameterSchema.optional(),
        }).passthrough().default({}).describe(
          'Operation payload. Sample selectors use sampleIndex.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify BlendSpace',
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
        const parsed = await callSubsystemJson('ModifyBlendSpace', {
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
