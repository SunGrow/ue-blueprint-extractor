import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterImportJobToolsOptions = {
  server: McpServer;
  callSubsystemJson: JsonSubsystemCaller;
  importJobSchema: z.ZodTypeAny;
  importJobListSchema: z.ZodTypeAny;
  textureImportOptionsSchema: z.ZodTypeAny;
  meshImportOptionsSchema: z.ZodTypeAny;
};

export function registerImportJobTools({
  server,
  callSubsystemJson,
  importJobSchema,
  importJobListSchema,
  textureImportOptionsSchema,
  meshImportOptionsSchema,
}: RegisterImportJobToolsOptions): void {
  const importItemWithOptionsSchema = z.object({}).passthrough().extend({
    texture_options: textureImportOptionsSchema.optional().describe('Texture-specific import options'),
    mesh_options: meshImportOptionsSchema.optional().describe('Mesh-specific import options'),
  });

  const consolidatedPayloadSchema = z.object({
    items: z.array(importItemWithOptionsSchema),
  }).passthrough().refine(
    (val) => {
      return !val.items.some(
        (item: Record<string, unknown>) => item.texture_options && item.mesh_options,
      );
    },
    { message: 'Items cannot have both texture_options and mesh_options' },
  );

  server.registerTool(
    'import_assets',
    {
      title: 'Import Assets',
      description: 'Enqueue an async asset import job. Supports generic, texture, mesh, and reimport modes via optional fields. Set reimport=true to reimport existing assets. Add texture_options or mesh_options to items for type-specific imports.',
      inputSchema: {
        payload: consolidatedPayloadSchema.describe(
          'Subsystem passthrough payload object. Requires an items array. Add texture_options or mesh_options to items for type-specific imports.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without importing.',
        ),
        reimport: z.boolean().default(false).describe(
          'Re-import existing assets instead of importing new ones.',
        ),
      },
      outputSchema: importJobSchema,
      annotations: {
        title: 'Import Assets',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ payload, validate_only, reimport }: {
      payload: { items: Array<Record<string, unknown>> };
      validate_only: boolean;
      reimport: boolean;
    }) => {
      try {
        const items = payload.items as Array<Record<string, unknown>>;
        const hasTextureOptions = items.some((item) => item.texture_options);
        const hasMeshOptions = items.some((item) => item.mesh_options);

        let method: string;
        let transformedPayload: unknown;

        if (reimport) {
          method = 'ReimportAssets';
          transformedPayload = payload;
        } else if (hasTextureOptions) {
          method = 'ImportTextures';
          transformedPayload = {
            ...payload,
            items: items.map((item) => {
              const { texture_options, ...rest } = item;
              return texture_options ? { ...rest, options: texture_options } : rest;
            }),
          };
        } else if (hasMeshOptions) {
          method = 'ImportMeshes';
          transformedPayload = {
            ...payload,
            items: items.map((item) => {
              const { mesh_options, ...rest } = item;
              return mesh_options ? { ...rest, options: mesh_options } : rest;
            }),
          };
        } else {
          method = 'ImportAssets';
          transformedPayload = payload;
        }

        const parsed = await callSubsystemJson(method, {
          PayloadJson: JSON.stringify(transformedPayload),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'get_import_job',
    {
      title: 'Get Import Job',
      description: 'Retrieve the current status for one async import job by id.',
      inputSchema: {
        job_id: z.string().describe(
          'Job id returned by an import tool.',
        ),
      },
      outputSchema: importJobSchema,
      annotations: {
        title: 'Get Import Job',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ job_id }) => {
      try {
        const parsed = await callSubsystemJson('GetImportJob', {
          JobId: job_id,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'list_import_jobs',
    {
      title: 'List Import Jobs',
      description: 'List async import jobs known to the subsystem.',
      inputSchema: {
        include_completed: z.boolean().default(false).describe(
          'When true, include completed terminal jobs in the listing.',
        ),
      },
      outputSchema: importJobListSchema,
      annotations: {
        title: 'List Import Jobs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ include_completed }) => {
      try {
        const parsed = await callSubsystemJson('ListImportJobs', {
          bIncludeCompleted: include_completed,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

}
