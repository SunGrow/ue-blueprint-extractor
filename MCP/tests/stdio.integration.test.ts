import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getTextContent, startMockRemoteControlServer } from './test-helpers.js';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const serverEntry = resolve(currentDir, '../dist/index.js');

describe('stdio integration', () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
  });

  it('serves the MCP contract over stdio against a mock Remote Control endpoint', async () => {
    const remoteServer = await startMockRemoteControlServer({
      onCall: (request) => {
        if (request.functionName === 'SearchAssets') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                results: [
                  {
                    path: '/Game/Test/BP_Player',
                    name: 'BP_Player',
                    class: 'Blueprint',
                  },
                ],
              }),
            },
          };
        }

        if (request.functionName === 'ListImportJobs') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'list_import_jobs',
                jobCount: 1,
                jobs: [
                  {
                    success: true,
                    operation: 'import_assets',
                    status: 'running',
                    terminal: false,
                    validateOnly: false,
                    createdAt: '2026-03-09T10:00:00Z',
                    startedAt: '2026-03-09T10:00:01Z',
                    jobId: 'job-123',
                    itemCount: 1,
                    acceptedItemCount: 1,
                    failedItemCount: 0,
                    items: [
                      {
                        index: 0,
                        status: 'importing',
                        filePath: 'C:/Temp/Test.png',
                        destinationPath: '/Game/Imported',
                        importedObjects: [],
                        dirtyPackages: [],
                        diagnostics: [],
                      },
                    ],
                    importedObjects: [],
                    dirtyPackages: [],
                    diagnostics: [],
                  },
                ],
                includeCompleted: true,
              }),
            },
          };
        }

        return {
          status: 404,
          body: { error: `Unexpected method ${request.functionName}` },
        };
      },
    });
    cleanup.push(() => remoteServer.close());

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        ...process.env,
        UE_REMOTE_CONTROL_HOST: remoteServer.host,
        UE_REMOTE_CONTROL_PORT: String(remoteServer.port),
        UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH: '/Script/Test.OverrideSubsystem',
      },
      stderr: 'pipe',
    });

    const client = new Client({
      name: 'blueprint-extractor-stdio-tests',
      version: '1.0.0',
    });

    await client.connect(transport);
    cleanup.push(() => client.close());

    const tools = await client.listTools();
    const scopes = await client.readResource({ uri: 'blueprint://scopes' });
    const importCapabilities = await client.readResource({ uri: 'blueprint://import-capabilities' });
    const result = await client.callTool({
      name: 'search_assets',
      arguments: {
        query: 'Player',
        class_filter: 'Blueprint',
        max_results: 5,
      },
    });
    const importJobs = await client.callTool({
      name: 'list_import_jobs',
      arguments: {
        include_completed: true,
      },
    });

    expect(tools.tools.some((tool) => tool.name === 'search_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'import_assets')).toBe(true);
    expect(scopes.contents[0]?.text).toContain('Blueprint Extraction Scopes');
    expect(importCapabilities.contents[0]?.text).toContain('Blueprint Extractor Import Capabilities');
    expect(JSON.parse(getTextContent(result))).toEqual([
      {
        path: '/Game/Test/BP_Player',
        name: 'BP_Player',
        class: 'Blueprint',
      },
    ]);
    expect(JSON.parse(getTextContent(importJobs))).toMatchObject({
      includeCompleted: true,
      jobs: [
        {
          jobId: 'job-123',
          status: 'running',
        },
      ],
    });
    expect(remoteServer.requests).toHaveLength(2);
    expect(remoteServer.requests[0]?.objectPath).toBe('/Script/Test.OverrideSubsystem');
    expect(remoteServer.requests[1]).toMatchObject({
      objectPath: '/Script/Test.OverrideSubsystem',
      functionName: 'ListImportJobs',
      parameters: {
        bIncludeCompleted: true,
      },
    });
  });
});
