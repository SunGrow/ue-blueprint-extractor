import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerImportJobTools } from '../src/tools/import-jobs.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const importPayloadSchema = z.object({
  items: z.array(z.object({}).passthrough()),
}).passthrough();
const importJobSchema = z.object({}).passthrough();
const importJobListSchema = z.object({}).passthrough();
const textureImportPayloadSchema = importPayloadSchema;
const meshImportPayloadSchema = importPayloadSchema;

describe('registerImportJobTools', () => {
  it('passes import_assets payloads through unchanged to the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      jobId: 'job-1',
    }));

    registerImportJobTools({
      server: registry.server,
      callSubsystemJson,
      importPayloadSchema,
      importJobSchema,
      importJobListSchema,
      textureImportPayloadSchema,
      meshImportPayloadSchema,
    });

    const result = await registry.getTool('import_assets').handler({
      payload: {
        items: [{
          file_path: 'C:/Art/Icon.png',
          destination_path: '/Game/UI',
        }],
      },
      validate_only: true,
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
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      jobId: 'job-1',
    });
  });

  it('returns an error when texture imports fail', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('texture import failed');
    });

    registerImportJobTools({
      server: registry.server,
      callSubsystemJson,
      importPayloadSchema,
      importJobSchema,
      importJobListSchema,
      textureImportPayloadSchema,
      meshImportPayloadSchema,
    });

    const result = await registry.getTool('import_textures').handler({
      payload: {
        items: [{
          file_path: 'C:/Art/Icon.png',
          destination_path: '/Game/UI',
        }],
      },
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'texture import failed',
    );
  });

  it('covers import-job polling and listing behavior with their dedicated subsystem routes', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async (method) => ({
      success: true,
      operation: method,
      jobs: method === 'ListImportJobs' ? [{ jobId: 'job-2', status: 'running' }] : undefined,
      jobId: method === 'GetImportJob' ? 'job-2' : undefined,
    }));

    registerImportJobTools({
      server: registry.server,
      callSubsystemJson,
      importPayloadSchema,
      importJobSchema,
      importJobListSchema,
      textureImportPayloadSchema,
      meshImportPayloadSchema,
    });

    await registry.getTool('get_import_job').handler({
      job_id: 'job-2',
    });
    const listResult = await registry.getTool('list_import_jobs').handler({
      include_completed: true,
    });

    expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'GetImportJob', {
      JobId: 'job-2',
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'ListImportJobs', {
      bIncludeCompleted: true,
    });
    expect(parseDirectToolResult(listResult)).toMatchObject({
      success: true,
      operation: 'ListImportJobs',
      jobs: [{ jobId: 'job-2', status: 'running' }],
    });
  });
});
