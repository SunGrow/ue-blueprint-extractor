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
    const result = await client.callTool({
      name: 'search_assets',
      arguments: {
        query: 'Player',
        class_filter: 'Blueprint',
        max_results: 5,
      },
    });

    expect(tools.tools.some((tool) => tool.name === 'search_assets')).toBe(true);
    expect(scopes.contents[0]?.text).toContain('Blueprint Extraction Scopes');
    expect(JSON.parse(getTextContent(result))).toEqual([
      {
        path: '/Game/Test/BP_Player',
        name: 'BP_Player',
        class: 'Blueprint',
      },
    ]);
    expect(remoteServer.requests).toHaveLength(1);
    expect(remoteServer.requests[0]?.objectPath).toBe('/Script/Test.OverrideSubsystem');
  });
});
