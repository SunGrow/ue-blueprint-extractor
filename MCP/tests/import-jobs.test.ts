import { describe, expect, it, vi, beforeEach } from 'vitest';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerImportJobTools } from '../src/tools/import-jobs.js';
import { connectInMemoryServer } from './test-helpers.js';
import { aliasMap, rawHandlerRegistry } from '../src/helpers/alias-registration.js';
import { installNormalizedToolRegistration } from '../src/helpers/tool-registration.js';
import { createToolResultNormalizers } from '../src/helpers/tool-results.js';
import type { ToolHelpEntry } from '../src/helpers/tool-help.js';
import { taskAwareTools } from '../src/server-config.js';

const textureImportOptionsSchema = z.object({
  compression_settings: z.string().optional(),
  lod_group: z.string().optional(),
  s_rgb: z.boolean().optional(),
}).passthrough();

const meshImportOptionsSchema = z.object({
  mesh_type: z.string().optional(),
  import_materials: z.boolean().optional(),
  combine_meshes: z.boolean().optional(),
}).passthrough();

const importPayloadSchema = z.object({
  items: z.array(z.object({}).passthrough()),
}).passthrough();
const importJobSchema = z.object({}).passthrough();
const importJobListSchema = z.object({}).passthrough();
const textureImportPayloadSchema = z.object({
  items: z.array(z.object({
    options: textureImportOptionsSchema.optional(),
  }).passthrough()),
}).passthrough();
const meshImportPayloadSchema = z.object({
  items: z.array(z.object({
    options: meshImportOptionsSchema.optional(),
  }).passthrough()),
}).passthrough();

function createFullServerHarness() {
  const server = new McpServer({ name: 'import-test', version: '1.0.0' });
  const toolHelpRegistry = new Map<string, ToolHelpEntry>();
  const registeredToolMap = new Map<string, RegisteredTool>();
  const { normalizeToolError, normalizeToolSuccess } = createToolResultNormalizers({
    taskAwareTools: new Set(),
    classifyRecoverableToolFailure: () => null,
  });

  installNormalizedToolRegistration({
    server,
    toolHelpRegistry,
    registeredToolMap,
    defaultOutputSchema: z.object({}).passthrough(),
    normalizeToolError,
    normalizeToolSuccess,
  });

  return { server, toolHelpRegistry };
}

function registerWithFullServer(callSubsystemJson: ReturnType<typeof vi.fn>) {
  const { server, toolHelpRegistry } = createFullServerHarness();
  registerImportJobTools({
    server,
    callSubsystemJson,
    importPayloadSchema,
    importJobSchema,
    importJobListSchema,
    textureImportPayloadSchema,
    meshImportPayloadSchema,
    textureImportOptionsSchema,
    meshImportOptionsSchema,
    toolHelpRegistry,
  });
  return { server, toolHelpRegistry };
}

describe('registerImportJobTools', () => {
  beforeEach(() => {
    aliasMap.clear();
    rawHandlerRegistry.clear();
  });

  it('routes generic import_assets to ImportAssets subsystem method', async () => {
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      jobId: 'job-1',
    }));
    const { server } = registerWithFullServer(callSubsystemJson);
    const harness = await connectInMemoryServer(server);

    try {
      const result = await harness.client.callTool({
        name: 'import_assets',
        arguments: {
          payload: {
            items: [{
              file_path: 'C:/Art/Icon.png',
              destination_path: '/Game/UI',
            }],
          },
          validate_only: true,
          reimport: false,
        },
      });

      expect(callSubsystemJson).toHaveBeenCalledWith('ImportAssets', {
        PayloadJson: JSON.stringify({
          items: [{
            file_path: 'C:/Art/Icon.png',
            destination_path: '/Game/UI',
          }],
        }),
        bValidateOnly: true,
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.jobId).toBe('job-1');
    } finally {
      await harness.close();
    }
  });

  it('routes import_assets with texture_options to ImportTextures and transforms items', async () => {
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      jobId: 'texture-1',
    }));
    const { server } = registerWithFullServer(callSubsystemJson);
    const harness = await connectInMemoryServer(server);

    try {
      await harness.client.callTool({
        name: 'import_assets',
        arguments: {
          payload: {
            items: [{
              file_path: 'C:/Art/Icon.png',
              destination_path: '/Game/UI',
              texture_options: { compression_settings: 'UserInterface2D', s_rgb: true },
            }],
          },
          validate_only: false,
          reimport: false,
        },
      });

      expect(callSubsystemJson).toHaveBeenCalledWith('ImportTextures', {
        PayloadJson: JSON.stringify({
          items: [{
            file_path: 'C:/Art/Icon.png',
            destination_path: '/Game/UI',
            options: { compression_settings: 'UserInterface2D', s_rgb: true },
          }],
        }),
        bValidateOnly: false,
      });
    } finally {
      await harness.close();
    }
  });

  it('routes import_assets with mesh_options to ImportMeshes and transforms items', async () => {
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      jobId: 'mesh-1',
    }));
    const { server } = registerWithFullServer(callSubsystemJson);
    const harness = await connectInMemoryServer(server);

    try {
      await harness.client.callTool({
        name: 'import_assets',
        arguments: {
          payload: {
            items: [{
              file_path: 'C:/Models/Character.fbx',
              destination_path: '/Game/Meshes',
              mesh_options: { mesh_type: 'StaticMesh', combine_meshes: true },
            }],
          },
          validate_only: true,
          reimport: false,
        },
      });

      expect(callSubsystemJson).toHaveBeenCalledWith('ImportMeshes', {
        PayloadJson: JSON.stringify({
          items: [{
            file_path: 'C:/Models/Character.fbx',
            destination_path: '/Game/Meshes',
            options: { mesh_type: 'StaticMesh', combine_meshes: true },
          }],
        }),
        bValidateOnly: true,
      });
    } finally {
      await harness.close();
    }
  });

  it('routes import_assets with reimport=true to ReimportAssets', async () => {
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      jobId: 'reimport-1',
    }));
    const { server } = registerWithFullServer(callSubsystemJson);
    const harness = await connectInMemoryServer(server);

    try {
      await harness.client.callTool({
        name: 'import_assets',
        arguments: {
          payload: {
            items: [{
              asset_path: '/Game/Textures/T_Icon',
            }],
          },
          validate_only: true,
          reimport: true,
        },
      });

      expect(callSubsystemJson).toHaveBeenCalledWith('ReimportAssets', {
        PayloadJson: JSON.stringify({
          items: [{
            asset_path: '/Game/Textures/T_Icon',
          }],
        }),
        bValidateOnly: true,
      });
    } finally {
      await harness.close();
    }
  });

  it('returns an error when import_assets fails', async () => {
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('import failed');
    });
    const { server } = registerWithFullServer(callSubsystemJson);
    const harness = await connectInMemoryServer(server);

    try {
      const result = await harness.client.callTool({
        name: 'import_assets',
        arguments: {
          payload: { items: [{ file_path: 'C:/Art/Icon.png' }] },
          validate_only: false,
          reimport: false,
        },
      });

      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('covers import-job polling and listing behavior with their dedicated subsystem routes', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => ({
      success: true,
      operation: method,
      jobs: method === 'ListImportJobs' ? [{ jobId: 'job-2', status: 'running' }] : undefined,
      jobId: method === 'GetImportJob' ? 'job-2' : undefined,
    }));
    const { server } = registerWithFullServer(callSubsystemJson);
    const harness = await connectInMemoryServer(server);

    try {
      await harness.client.callTool({
        name: 'get_import_job',
        arguments: { job_id: 'job-2' },
      });
      const listResult = await harness.client.callTool({
        name: 'list_import_jobs',
        arguments: { include_completed: true },
      });

      expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'GetImportJob', {
        JobId: 'job-2',
      });
      expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'ListImportJobs', {
        bIncludeCompleted: true,
      });
      const structured = listResult.structuredContent as Record<string, unknown>;
      expect(structured.operation).toBe('ListImportJobs');
    } finally {
      await harness.close();
    }
  });
});

describe('import_assets consolidated routing — refine validation', () => {
  it('rejects items that have both texture_options and mesh_options', async () => {
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const { server, toolHelpRegistry } = createFullServerHarness();

    registerImportJobTools({
      server,
      callSubsystemJson,
      importPayloadSchema,
      importJobSchema,
      importJobListSchema,
      textureImportPayloadSchema,
      meshImportPayloadSchema,
      textureImportOptionsSchema,
      meshImportOptionsSchema,
      toolHelpRegistry,
    });

    const harness = await connectInMemoryServer(server);
    try {
      const result = await harness.client.callTool({
        name: 'import_assets',
        arguments: {
          payload: {
            items: [{
              file_path: 'C:/Art/Mixed.png',
              texture_options: { s_rgb: true },
              mesh_options: { combine_meshes: true },
            }],
          },
          validate_only: false,
          reimport: false,
        },
      });

      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

describe('taskAwareTools', () => {
  it('contains import_assets', () => {
    expect(taskAwareTools.has('import_assets')).toBe(true);
  });
});
