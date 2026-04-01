import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  extractCommonUIButtonStyle,
  normalizeCommonUIButtonStyleInput,
} from '../helpers/commonui-button-style.js';
import { buildGeneratedBlueprintClassPath } from '../helpers/widget-utils.js';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterCommonUIButtonStyleToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  jsonObjectSchema: z.ZodTypeAny;
};

export function registerCommonUIButtonStyleTools({
  server,
  callSubsystemJson,
  jsonObjectSchema,
}: RegisterCommonUIButtonStyleToolsOptions): void {
  server.registerTool(
    'create_commonui_button_style',
    {
      title: 'Create CommonUI Button Style',
      description: 'Create a Blueprint-based CommonUI button style asset from a normalized style payload.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new asset.',
        ),
        asset_class_path: z.string().describe(
          'Parent class (must inherit UCommonButtonStyle).',
        ),
        style: jsonObjectSchema.optional().default({}).describe(
          'Normalized style payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Create CommonUI Button Style',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, asset_class_path, style, validate_only }) => {
      try {
        const classDefaults = normalizeCommonUIButtonStyleInput(style);
        const parsed = await callSubsystemJson('CreateBlueprint', {
          AssetPath: asset_path,
          ParentClassPath: asset_class_path,
          PayloadJson: JSON.stringify({
            classDefaults,
          }),
          bValidateOnly: validate_only,
        });

        return jsonToolSuccess({
          ...parsed,
          operation: 'create_commonui_button_style',
          style: extractCommonUIButtonStyle(classDefaults),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'extract_commonui_button_style',
    {
      title: 'Extract CommonUI Button Style',
      description: 'Extract a Blueprint-based CommonUI button style into the normalized public schema.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
      },
      annotations: {
        title: 'Extract CommonUI Button Style',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path }) => {
      try {
        const parsed = await callSubsystemJson('ExtractBlueprint', {
          AssetPath: asset_path,
          Scope: 'ClassLevel',
          GraphFilter: '',
          bIncludeClassDefaults: true,
        });

        return jsonToolSuccess({
          ...parsed,
          operation: 'extract_commonui_button_style',
          style: extractCommonUIButtonStyle(parsed.classDefaults),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_commonui_button_style',
    {
      title: 'Modify CommonUI Button Style',
      description: 'Patch a Blueprint-based CommonUI button style via a normalized style payload.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        style: jsonObjectSchema.describe(
          'Normalized style payload.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Modify CommonUI Button Style',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, style, validate_only }) => {
      try {
        const classDefaults = normalizeCommonUIButtonStyleInput(style);
        const parsed = await callSubsystemJson('ModifyBlueprintMembers', {
          AssetPath: asset_path,
          Operation: 'patch_class_defaults',
          PayloadJson: JSON.stringify({
            classDefaults,
          }),
          bValidateOnly: validate_only,
        });

        return jsonToolSuccess({
          ...parsed,
          operation: 'modify_commonui_button_style',
          style: extractCommonUIButtonStyle(classDefaults),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'apply_commonui_button_style',
    {
      title: 'Apply CommonUI Button Style',
      description: 'Apply a CommonUI button style to a CommonButtonBase-derived WidgetBlueprint.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the CommonButtonBase widget.',
        ),
        style_asset_path: z.string().describe(
          'Style asset path or generated class path.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Apply CommonUI Button Style',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, style_asset_path, validate_only }) => {
      try {
        const styleClassPath = buildGeneratedBlueprintClassPath(style_asset_path);
        const parsed = await callSubsystemJson('ModifyWidgetBlueprintStructure', {
          AssetPath: asset_path,
          Operation: 'patch_class_defaults',
          PayloadJson: JSON.stringify({
            classDefaults: {
              Style: styleClassPath,
            },
          }),
          bValidateOnly: validate_only,
        });

        return jsonToolSuccess({
          ...parsed,
          operation: 'apply_commonui_button_style',
          styleClassPath,
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
