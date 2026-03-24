import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterImportJobToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  importPayloadSchema: z.ZodTypeAny;
  importJobSchema: z.ZodTypeAny;
  importJobListSchema: z.ZodTypeAny;
  textureImportPayloadSchema: z.ZodTypeAny;
  meshImportPayloadSchema: z.ZodTypeAny;
};

export function registerImportJobTools({
  server,
  callSubsystemJson,
  importPayloadSchema,
  importJobSchema,
  importJobListSchema,
  textureImportPayloadSchema,
  meshImportPayloadSchema,
}: RegisterImportJobToolsOptions): void {
  server.registerTool(
    'import_assets',
    {
      title: 'Import Assets',
      description: 'Enqueue an async asset import job using subsystem JSON passthrough payloads.',
      inputSchema: {
        payload: importPayloadSchema.describe(
          'Subsystem passthrough payload object. Requires an items array and preserves snake_case import fields.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without importing.',
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
    async ({ payload, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ImportAssets', {
          PayloadJson: JSON.stringify(payload),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'reimport_assets',
    {
      title: 'Reimport Assets',
      description: 'Enqueue an async reimport job using subsystem JSON passthrough payloads.',
      inputSchema: {
        payload: importPayloadSchema.describe(
          'Subsystem passthrough payload object for reimport jobs. Requires an items array and preserves snake_case import fields.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without reimporting.',
        ),
      },
      outputSchema: importJobSchema,
      annotations: {
        title: 'Reimport Assets',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ payload, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ReimportAssets', {
          PayloadJson: JSON.stringify(payload),
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

  server.registerTool(
    'import_textures',
    {
      title: 'Import Textures',
      description: 'Enqueue an async texture import job with texture-specific option passthrough.',
      inputSchema: {
        payload: textureImportPayloadSchema.describe(
          'Subsystem passthrough payload object for texture imports. Requires an items array and preserves snake_case texture option keys.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without importing.',
        ),
      },
      outputSchema: importJobSchema,
      annotations: {
        title: 'Import Textures',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ payload, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ImportTextures', {
          PayloadJson: JSON.stringify(payload),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'import_meshes',
    {
      title: 'Import Meshes',
      description: 'Enqueue an async mesh import job with mesh-specific option passthrough.',
      inputSchema: {
        payload: meshImportPayloadSchema.describe(
          'Subsystem passthrough payload object for mesh imports. Requires an items array and preserves snake_case mesh option keys.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without importing.',
        ),
      },
      outputSchema: importJobSchema,
      annotations: {
        title: 'Import Meshes',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ payload, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ImportMeshes', {
          PayloadJson: JSON.stringify(payload),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
