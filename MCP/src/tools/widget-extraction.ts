import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { compactGenericExtraction, compactWidgetBlueprint } from '../compactor.js';
import {
  jsonToolError,
  jsonToolSuccess,
} from '../helpers/subsystem.js';
import { formatAsRecipe } from '../helpers/widget-recipe-formatter.js';
import { limitWidgetTreeDepth } from '../helpers/widget-utils.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterWidgetExtractionToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  extractWidgetAnimationResultSchema: z.ZodTypeAny;
};

function readOnlyAnnotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

export function registerWidgetExtractionTools({
  server,
  callSubsystemJson,
  extractWidgetAnimationResultSchema,
}: RegisterWidgetExtractionToolsOptions): void {
  server.registerTool(
    'extract_widget_blueprint',
    {
      title: 'Extract Widget Blueprint',
      description: 'Read a compact widget snapshot with tree, bindings, animations, compile status, and optional class defaults.',
      inputSchema: {
        asset_path: z.string().describe('UE content path.'),
        include_class_defaults: z.boolean().default(false).describe('Include class defaults.'),
        compact: z.boolean().default(true).describe('Compact output.'),
        fields: z.array(z.string()).optional().describe('Return only these top-level keys.'),
        depth: z.number().int().min(1).optional().describe('Max tree depth.'),
        format: z.enum(['json', 'recipe']).default('json').describe('Output format.'),
      },
      annotations: readOnlyAnnotations('Extract Widget Blueprint'),
    },
    async ({ asset_path, include_class_defaults, compact, fields, depth, format }) => {
      try {
        let parsed = await callSubsystemJson('ExtractWidgetBlueprint', {
          AssetPath: asset_path,
          bIncludeClassDefaults: include_class_defaults,
        });
        if (compact) {
          parsed = compactWidgetBlueprint(parsed) as Record<string, unknown>;
        }
        if (fields && fields.length > 0) {
          const filtered: Record<string, unknown> = {};
          for (const key of fields) {
            if (key in parsed) filtered[key] = parsed[key];
          }
          if ('success' in parsed) filtered.success = parsed.success;
          parsed = filtered as Record<string, unknown>;
        }
        if (depth !== undefined) {
          limitWidgetTreeDepth(parsed, depth);
        }
        if (format === 'recipe') {
          const recipeText = formatAsRecipe(asset_path, parsed, {
            includeClassDefaults: include_class_defaults,
          });
          return { content: [{ type: 'text' as const, text: recipeText }] };
        }
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'extract_widget_animation',
    {
      title: 'Extract Widget Animation',
      description: 'Return one authored widget animation timeline, bindings, supported tracks, checkpoints, duration, and playback metadata.',
      inputSchema: {
        asset_path: z.string().describe('UE content path.'),
        animation_name: z.string().describe('Animation name or display label.'),
        compact: z.boolean().default(true).describe('Compact output.'),
      },
      outputSchema: extractWidgetAnimationResultSchema,
      annotations: readOnlyAnnotations('Extract Widget Animation'),
    },
    async ({ asset_path, animation_name, compact }) => {
      try {
        let parsed = await callSubsystemJson('ExtractWidgetAnimation', {
          AssetPath: asset_path,
          AnimationName: animation_name,
        });
        if (compact) {
          parsed = compactGenericExtraction(parsed) as Record<string, unknown>;
        }
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
