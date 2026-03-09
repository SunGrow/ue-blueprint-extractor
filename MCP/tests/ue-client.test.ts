import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SUBSYSTEM_CANDIDATE_PATHS, UEClient } from '../src/ue-client.js';
import { startMockRemoteControlServer } from './test-helpers.js';

describe('UEClient', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    delete process.env.UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH;

    while (servers.length > 0) {
      await servers.pop()?.close();
    }
  });

  it('reports Remote Control as unavailable when the editor endpoint is offline', async () => {
    const client = new UEClient({
      host: '127.0.0.1',
      port: 1,
      connectionTimeoutMs: 50,
      timeoutMs: 50,
    });

    await expect(client.checkConnection()).resolves.toBe(false);
    await expect(client.callSubsystem('SearchAssets', { Query: 'Player' })).rejects.toThrow(
      'UE Editor not running or Remote Control not available',
    );
  });

  it('uses an explicit subsystem path override without probing fallback paths', async () => {
    const server = await startMockRemoteControlServer({
      onCall: (request) => ({
        body: { ReturnValue: JSON.stringify({ ok: true, objectPath: request.objectPath }) },
      }),
    });
    servers.push(server);

    const client = new UEClient({
      host: server.host,
      port: server.port,
      subsystemPath: '/Script/Test.OverrideSubsystem',
      timeoutMs: 200,
    });

    const result = await client.callSubsystem('SearchAssets', { Query: 'Player' });

    expect(JSON.parse(result)).toEqual({ ok: true, objectPath: '/Script/Test.OverrideSubsystem' });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.objectPath).toBe('/Script/Test.OverrideSubsystem');
    expect(server.requests[0]?.functionName).toBe('SearchAssets');
  });

  it('falls back across subsystem probe paths until one responds', async () => {
    const server = await startMockRemoteControlServer({
      onCall: (request) => {
        if (request.functionName === 'ListAssets' && request.objectPath === '/Script/Test.BadPath') {
          return { status: 404, body: { error: 'missing' } };
        }

        if (request.functionName === 'ListAssets' && request.objectPath === '/Script/Test.GoodPath') {
          return { body: { ReturnValue: '[]' } };
        }

        if (request.functionName === 'SearchAssets' && request.objectPath === '/Script/Test.GoodPath') {
          return { body: { ReturnValue: JSON.stringify([{ path: '/Game/Test/BP_Player' }]) } };
        }

        return { status: 404, body: { error: 'unexpected' } };
      },
    });
    servers.push(server);

    const client = new UEClient({
      host: server.host,
      port: server.port,
      candidatePaths: ['/Script/Test.BadPath', '/Script/Test.GoodPath'],
      timeoutMs: 200,
    });

    const result = await client.callSubsystem('SearchAssets', { Query: 'Player' });

    expect(JSON.parse(result)).toEqual([{ path: '/Game/Test/BP_Player' }]);
    expect(server.requests.map((request) => [request.objectPath, request.functionName])).toEqual([
      ['/Script/Test.BadPath', 'ListAssets'],
      ['/Script/Test.GoodPath', 'ListAssets'],
      ['/Script/Test.GoodPath', 'SearchAssets'],
    ]);
  });

  it('honors the subsystem path environment override when options do not supply one', async () => {
    process.env.UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH = '/Script/Test.EnvSubsystem';

    const server = await startMockRemoteControlServer({
      onCall: (request) => ({
        body: { ReturnValue: JSON.stringify({ objectPath: request.objectPath }) },
      }),
    });
    servers.push(server);

    const client = new UEClient({
      host: server.host,
      port: server.port,
      timeoutMs: 200,
    });

    const result = await client.callSubsystem('SearchAssets', { Query: 'Player' });

    expect(JSON.parse(result)).toEqual({ objectPath: '/Script/Test.EnvSubsystem' });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.objectPath).toBe('/Script/Test.EnvSubsystem');
  });

  it('fails with a subsystem discovery error when no candidate path responds', async () => {
    const server = await startMockRemoteControlServer({
      onCall: () => ({
        status: 404,
        body: { error: 'missing' },
      }),
    });
    servers.push(server);

    const client = new UEClient({
      host: server.host,
      port: server.port,
      candidatePaths: [...DEFAULT_SUBSYSTEM_CANDIDATE_PATHS],
      timeoutMs: 200,
    });

    await expect(client.callSubsystem('SearchAssets', { Query: 'Player' })).rejects.toThrow(
      'BlueprintExtractor subsystem not found',
    );
  });

  it('fails cleanly when the subsystem call returns a non-200 response', async () => {
    const server = await startMockRemoteControlServer({
      onCall: () => ({
        status: 500,
        body: { error: 'boom' },
      }),
    });
    servers.push(server);

    const client = new UEClient({
      host: server.host,
      port: server.port,
      subsystemPath: '/Script/Test.OverrideSubsystem',
      timeoutMs: 200,
    });

    await expect(client.callSubsystem('SearchAssets', { Query: 'Player' })).rejects.toThrow(
      'Failed to call SearchAssets on BlueprintExtractorSubsystem',
    );
  });

  it('times out hung subsystem calls', async () => {
    const server = await startMockRemoteControlServer({
      onCall: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { body: { ReturnValue: JSON.stringify({ ok: true }) } };
      },
    });
    servers.push(server);

    const client = new UEClient({
      host: server.host,
      port: server.port,
      subsystemPath: '/Script/Test.OverrideSubsystem',
      timeoutMs: 50,
    });

    await expect(client.callSubsystem('SearchAssets', { Query: 'Player' })).rejects.toThrow(
      'Failed to call SearchAssets on BlueprintExtractorSubsystem',
    );
  });
});
