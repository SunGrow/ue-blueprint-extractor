import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  jsonToolError,
  jsonToolSuccess,
} from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterWidgetAnimationAuthoringToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  jsonObjectSchema: z.ZodTypeAny;
  createModifyWidgetAnimationResultSchema: z.ZodTypeAny;
};

export function registerWidgetAnimationAuthoringTools({
  server,
  callSubsystemJson,
  jsonObjectSchema,
  createModifyWidgetAnimationResultSchema,
}: RegisterWidgetAnimationAuthoringToolsOptions): void {
  server.registerTool(
    'create_widget_animation',
    {
      title: 'Create Widget Animation',
      description: 'Create a named widget animation on an existing WidgetBlueprint.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        animation_name: z.string().describe(
          'Animation name.',
        ),
        payload: jsonObjectSchema.optional().describe(
          'Initial animation payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      outputSchema: createModifyWidgetAnimationResultSchema,
      annotations: {
        title: 'Create Widget Animation',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, animation_name, payload, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateWidgetAnimation', {
          AssetPath: asset_path,
          AnimationName: animation_name,
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
    'modify_widget_animation',
    {
      title: 'Modify Widget Animation',
      description: 'Modify widget animation timelines or metadata with replace-oriented payloads.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        animation_name: z.string().describe(
          'Animation name or display label.',
        ),
        operation: z.enum(['replace_timeline', 'patch_metadata', 'rename_animation', 'remove_animation', 'compile']).describe(
          'Animation mutation operation.',
        ),
        payload: jsonObjectSchema.optional().describe(
          'Operation payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      outputSchema: createModifyWidgetAnimationResultSchema,
      annotations: {
        title: 'Modify Widget Animation',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, animation_name, operation, payload, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ModifyWidgetAnimation', {
          AssetPath: asset_path,
          AnimationName: animation_name,
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
