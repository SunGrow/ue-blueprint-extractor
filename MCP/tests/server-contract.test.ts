import { afterEach, describe, expect, it } from 'vitest';
import { createBlueprintExtractorServer, type UEClientLike } from '../src/index.js';
import { connectInMemoryServer, getTextContent } from './test-helpers.js';

class FakeUEClient implements UEClientLike {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  constructor(
    private readonly handler: (method: string, params: Record<string, unknown>) => Promise<string> | string = (
      method,
      params,
    ) => JSON.stringify({ ok: true, method, params }),
  ) {}

  async callSubsystem(method: string, params: Record<string, unknown>): Promise<string> {
    this.calls.push({ method, params });
    return await this.handler(method, params);
  }
}

function makeImportJobResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    operation: 'import_assets',
    status: 'queued',
    terminal: false,
    validateOnly: false,
    createdAt: '2026-03-09T10:00:00Z',
    jobId: 'job-123',
    itemCount: 1,
    acceptedItemCount: 1,
    failedItemCount: 0,
    items: [{
      index: 0,
      status: 'queued',
      filePath: 'C:/Temp/Test.png',
      destinationPath: '/Game/Imported',
      importedObjects: [],
      dirtyPackages: [],
      diagnostics: [],
    }],
    importedObjects: [],
    dirtyPackages: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('createBlueprintExtractorServer', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it('registers the expected resources and tools', async () => {
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient()));
    cleanups.push(harness.close);

    const resources = await harness.client.listResources();
    const resourceUris = resources.resources.map((resource) => resource.uri);
    const tools = await harness.client.listTools();
    const extractBlueprint = tools.tools.find((tool) => tool.name === 'extract_blueprint');
    const createBlueprint = tools.tools.find((tool) => tool.name === 'create_blueprint');
    const importAssets = tools.tools.find((tool) => tool.name === 'import_assets');
    const getImportJob = tools.tools.find((tool) => tool.name === 'get_import_job');
    const saveAssets = tools.tools.find((tool) => tool.name === 'save_assets');

    expect(resourceUris).toContain('blueprint://scopes');
    expect(resourceUris).toContain('blueprint://write-capabilities');
    expect(resourceUris).toContain('blueprint://import-capabilities');
    expect(tools.tools.some((tool) => tool.name === 'search_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'reimport_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'list_import_jobs')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'import_textures')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'import_meshes')).toBe(true);
    expect(extractBlueprint?.annotations?.readOnlyHint).toBe(true);
    expect(createBlueprint?.annotations?.readOnlyHint).toBe(false);
    expect(importAssets?.annotations?.readOnlyHint).toBe(false);
    expect(getImportJob?.annotations?.readOnlyHint).toBe(true);
    expect(saveAssets?.annotations?.idempotentHint).toBe(true);
  });

  it('serves the static reference resources', async () => {
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient()));
    cleanups.push(harness.close);

    const scopes = await harness.client.readResource({ uri: 'blueprint://scopes' });
    const writeCapabilities = await harness.client.readResource({ uri: 'blueprint://write-capabilities' });
    const importCapabilities = await harness.client.readResource({ uri: 'blueprint://import-capabilities' });

    expect(scopes.contents[0]?.mimeType).toBe('text/plain');
    expect(scopes.contents[0]?.text).toContain('Blueprint Extraction Scopes');
    expect(writeCapabilities.contents[0]?.text).toContain('Current write-capable families:');
    expect(writeCapabilities.contents[0]?.text).toContain('save_assets');
    expect(importCapabilities.contents[0]?.text).toContain('Blueprint Extractor Import Capabilities');
    expect(importCapabilities.contents[0]?.text).toContain('get_import_job');
    expect(importCapabilities.contents[0]?.text).toContain('mesh_type');
  });

  it('serializes arguments to subsystem calls and returns parsed JSON', async () => {
    const fakeClient = new FakeUEClient((method, params) => JSON.stringify({
      results: [{ method, params }],
    }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'search_assets',
      arguments: {
        query: 'Player',
        class_filter: 'Blueprint',
        max_results: 7,
      },
    });

    expect(JSON.parse(getTextContent(result))).toEqual([
      {
        method: 'SearchAssets',
        params: {
          Query: 'Player',
          ClassFilter: 'Blueprint',
          MaxResults: 7,
        },
      },
    ]);
    expect(fakeClient.calls).toEqual([
      {
        method: 'SearchAssets',
        params: {
          Query: 'Player',
          ClassFilter: 'Blueprint',
          MaxResults: 7,
        },
      },
    ]);
  });

  it('serializes import payloads to subsystem JSON passthrough parameters', async () => {
    const fakeClient = new FakeUEClient(() => JSON.stringify(makeImportJobResult()));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const payload = {
      items: [{
        file_path: 'C:/Temp/Test.png',
        destination_path: '/Game/Imported',
        options: {
          compression_settings: 'TC_Default',
        },
      }],
    };

    const result = await harness.client.callTool({
      name: 'import_textures',
      arguments: {
        payload,
        validate_only: true,
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      jobId: 'job-123',
      operation: 'import_assets',
      terminal: false,
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'ImportTextures',
        params: {
          PayloadJson: JSON.stringify(payload),
          bValidateOnly: true,
        },
      },
    ]);
  });

  it('passes through import job polling and listing responses', async () => {
    const fakeClient = new FakeUEClient((method, params) => {
      if (method === 'GetImportJob') {
        return JSON.stringify(makeImportJobResult({
          status: 'running',
          startedAt: '2026-03-09T10:00:01Z',
          jobId: params.JobId,
        }));
      }

      if (method === 'ListImportJobs') {
        return JSON.stringify({
          success: true,
          operation: 'list_import_jobs',
          jobCount: 2,
          jobs: [
            makeImportJobResult({
              status: 'running',
              startedAt: '2026-03-09T10:00:01Z',
            }),
            makeImportJobResult({
              success: false,
              operation: 'import_meshes',
              status: 'failed',
              terminal: true,
              completedAt: '2026-03-09T10:02:00Z',
              jobId: 'job-456',
            }),
          ],
          includeCompleted: params.bIncludeCompleted,
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const getResult = await harness.client.callTool({
      name: 'get_import_job',
      arguments: {
        job_id: 'job-123',
      },
    });
    const listResult = await harness.client.callTool({
      name: 'list_import_jobs',
      arguments: {
        include_completed: true,
      },
    });

    expect(JSON.parse(getTextContent(getResult))).toMatchObject({
      jobId: 'job-123',
      status: 'running',
      terminal: false,
    });
    expect(JSON.parse(getTextContent(listResult))).toMatchObject({
      includeCompleted: true,
      jobs: [
        { jobId: 'job-123', status: 'running' },
        { jobId: 'job-456', status: 'failed', terminal: true },
      ],
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'GetImportJob',
        params: {
          JobId: 'job-123',
        },
      },
      {
        method: 'ListImportJobs',
        params: {
          bIncludeCompleted: true,
        },
      },
    ]);
  });

  it('compacts extract_blueprint responses when requested', async () => {
    const fakeClient = new FakeUEClient(() => JSON.stringify({
      blueprint: {
        functions: [{
          graphGuid: 'graph-guid',
          nodes: [{
            nodeGuid: 'guid-a',
            posX: 10,
            posY: 20,
            nodeComment: '',
            pins: [{
              pinId: 'pin-guid',
              autogeneratedDefaultValue: '',
              defaultValue: '',
              type: {
                category: 'exec',
                sub_category: '',
              },
              connections: [],
            }],
          }],
        }],
      },
    }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'extract_blueprint',
      arguments: {
        asset_path: '/Game/Test/BP_Test',
        compact: true,
      },
    });

    const parsed = JSON.parse(getTextContent(result));
    const node = parsed.blueprint.functions[0].nodes[0];

    expect(parsed.blueprint.functions[0].graphGuid).toBeUndefined();
    expect(node.id).toBe('n0');
    expect(node.posX).toBeUndefined();
    expect(node.posY).toBeUndefined();
    expect(node.pins[0].type).toBe('exec');
    expect(node.pins[0].connections).toBeUndefined();
  });

  it('truncates oversized extract_blueprint responses', async () => {
    const fakeClient = new FakeUEClient(() => JSON.stringify({
      blueprint: {
        summary: 'x'.repeat(220_000),
      },
    }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'extract_blueprint',
      arguments: {
        asset_path: '/Game/Test/BP_Large',
      },
    });

    const text = getTextContent(result);
    expect(text).toContain('Warning: Response is');
    expect(text).toContain('[TRUNCATED]');
  });

  it('returns tool errors with structured text when the subsystem returns an error JSON payload', async () => {
    const fakeClient = new FakeUEClient(() => JSON.stringify({ error: 'validation failed' }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'create_blueprint',
      arguments: {
        asset_path: '/Game/Test/BP_Invalid',
        parent_class_path: '/Script/Engine.Actor',
      },
    });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain('validation failed');
  });

  it('surfaces schema validation failures through the MCP tool contract', async () => {
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient()));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'extract_blueprint',
      arguments: {
        asset_path: 123,
      } as never,
    });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain('Input validation error');
  });

  it('validates import payload structure before calling the subsystem', async () => {
    const fakeClient = new FakeUEClient();
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'import_assets',
      arguments: {
        payload: {
          items: 'not-an-array',
        },
      } as never,
    });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain('Input validation error');
    expect(fakeClient.calls).toHaveLength(0);
  });
});
