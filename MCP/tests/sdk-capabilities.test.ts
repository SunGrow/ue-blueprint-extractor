import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { connectInMemoryServer } from './test-helpers.js';

function createTestServer() {
  return new McpServer({
    name: 'sdk-capabilities-test',
    version: '1.0.0',
  });
}

describe('sdk RegisteredTool capabilities', () => {
  it('registerTool returns a RegisteredTool with enable/disable methods', () => {
    const server = createTestServer();
    const registered = server.registerTool('probe_tool', {
      title: 'Probe',
      description: 'SDK probe',
    }, async () => ({ ok: true }));

    expect(registered).toBeDefined();
    expect(typeof registered.enable).toBe('function');
    expect(typeof registered.disable).toBe('function');
    expect(registered.enabled).toBe(true);
  });

  it('disable() hides tool from tools/list', async () => {
    const server = createTestServer();
    const registered = server.registerTool('hidden_tool', {
      title: 'Hidden',
      description: 'Will be disabled',
      inputSchema: { value: z.string() },
    }, async () => ({ ok: true }));

    registered.disable();

    const harness = await connectInMemoryServer(server);
    try {
      const { tools } = await harness.client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('hidden_tool');
    } finally {
      await harness.close();
    }
  });

  it('enable() restores tool to tools/list', async () => {
    const server = createTestServer();
    const registered = server.registerTool('toggle_tool', {
      title: 'Toggle',
      description: 'Will be toggled',
    }, async () => ({ ok: true }));

    registered.disable();
    registered.enable();

    const harness = await connectInMemoryServer(server);
    try {
      const { tools } = await harness.client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('toggle_tool');
    } finally {
      await harness.close();
    }
  });

  it('disabled tool rejects calls', async () => {
    const server = createTestServer();
    const registered = server.registerTool('blocked_tool', {
      title: 'Blocked',
      description: 'Will reject',
    }, async () => ({ ok: true }));

    registered.disable();

    const harness = await connectInMemoryServer(server);
    try {
      const result = await harness.client.callTool({ name: 'blocked_tool', arguments: {} });
      expect(result.isError).toBe(true);
      const text = result.content?.find((e) => e.type === 'text') as { text: string } | undefined;
      expect(text?.text).toMatch(/disabled/i);
    } finally {
      await harness.close();
    }
  });

  it('sendToolListChanged exists on McpServer', () => {
    const server = createTestServer();
    expect(typeof server.sendToolListChanged).toBe('function');
  });

  it('server.server exposes oninitialized and getClientCapabilities', () => {
    const server = createTestServer();
    const lowLevel = server.server;

    expect(lowLevel).toBeDefined();
    // oninitialized is assignable as a callback
    lowLevel.oninitialized = () => {};
    expect(typeof lowLevel.oninitialized).toBe('function');
    // getClientCapabilities is a method
    expect(typeof lowLevel.getClientCapabilities).toBe('function');
  });
});
