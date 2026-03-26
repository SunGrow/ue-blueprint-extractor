import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { compactGenericExtraction, compactWidgetBlueprint } from '../compactor.js';
import {
  jsonToolError,
  jsonToolSuccess,
} from '../helpers/subsystem.js';

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
        asset_path: z.string().describe(
          'UE content path to the WidgetBlueprint.',
        ),
        include_class_defaults: z.boolean().default(false).describe(
          'When true, also include Blueprint generated-class defaults so widget-template state and class defaults can be distinguished.',
        ),
        compact: z.boolean().default(true).describe(
          'Return compact output (set false for raw).',
        ),
      },
      annotations: readOnlyAnnotations('Extract Widget Blueprint'),
    },
    async ({ asset_path, include_class_defaults, compact }) => {
      try {
        let parsed = await callSubsystemJson('ExtractWidgetBlueprint', {
          AssetPath: asset_path,
          bIncludeClassDefaults: include_class_defaults,
        });
        if (compact) {
          parsed = compactWidgetBlueprint(parsed) as Record<string, unknown>;
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
        asset_path: z.string().describe(
          'UE content path to the WidgetBlueprint.',
        ),
        animation_name: z.string().describe(
          'Animation name or display label to extract.',
        ),
        compact: z.boolean().default(true).describe(
          'Return compact output (set false for raw).',
        ),
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
