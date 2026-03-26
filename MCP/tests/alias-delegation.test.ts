import { describe, expect, it, beforeEach } from 'vitest';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { aliasMap, rawHandlerRegistry, registerAlias } from '../src/helpers/alias-registration.js';
import { installNormalizedToolRegistration } from '../src/helpers/tool-registration.js';
import { createToolResultNormalizers } from '../src/helpers/tool-results.js';
import type { ToolHelpEntry } from '../src/helpers/tool-help.js';
import { connectInMemoryServer } from './test-helpers.js';

function createTestHarness() {
  const server = new McpServer({ name: 'alias-test', version: '1.0.0' });
  const toolHelpRegistry = new Map<string, ToolHelpEntry>();
  const registeredToolMap = new Map<string, RegisteredTool>();
  const defaultOutputSchema = z.object({
    success: z.boolean(),
    operation: z.string(),
  });

  const { normalizeToolError, normalizeToolSuccess } = createToolResultNormalizers({
    taskAwareTools: new Set(),
    classifyRecoverableToolFailure: () => null,
  });

  installNormalizedToolRegistration({
    server,
    toolHelpRegistry,
    registeredToolMap,
    defaultOutputSchema,
    normalizeToolError,
    normalizeToolSuccess,
  });

  return { server, toolHelpRegistry };
}

describe('alias-delegation', () => {
  beforeEach(() => {
    aliasMap.clear();
    rawHandlerRegistry.clear();
  });

  it('registers an alias as a callable tool', async () => {
    const { server, toolHelpRegistry } = createTestHarness();

    server.registerTool('new_tool', {
      description: 'The new tool',
      inputSchema: { value: z.string() },
    }, async (args: { value: string }) => ({ result: args.value }));

    registerAlias(
      server,
      'old_tool',
      'new_tool',
      (args) => args,
      'Use new_tool instead.',
      toolHelpRegistry,
    );

    const harness = await connectInMemoryServer(server);
    try {
      const { tools } = await harness.client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('old_tool');
      expect(names).toContain('new_tool');
    } finally {
      await harness.close();
    }
  });

  it('alias handler delegates to target with mapped parameters', async () => {
    const { server, toolHelpRegistry } = createTestHarness();
    const receivedArgs: unknown[] = [];

    server.registerTool('target_tool', {
      description: 'Target tool',
      inputSchema: { name: z.string(), count: z.number() },
    }, async (args: { name: string; count: number }) => {
      receivedArgs.push(args);
      return { greeting: `Hello ${args.name} x${args.count}` };
    });

    registerAlias(
      server,
      'legacy_tool',
      'target_tool',
      (args) => ({ name: args.label as string, count: args.times as number }),
      'Use target_tool instead.',
      toolHelpRegistry,
      { label: z.string(), times: z.number() },
    );

    const harness = await connectInMemoryServer(server);
    try {
      const result = await harness.client.callTool({
        name: 'legacy_tool',
        arguments: { label: 'World', times: 3 },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.success).toBe(true);
      expect(structured.greeting).toBe('Hello World x3');
      expect(receivedArgs).toHaveLength(1);
      expect(receivedArgs[0]).toEqual({ name: 'World', count: 3 });
    } finally {
      await harness.close();
    }
  });

  it('result envelope uses the alias tool name, not the target name', async () => {
    const { server, toolHelpRegistry } = createTestHarness();

    server.registerTool('real_tool', {
      description: 'Real tool',
      inputSchema: {},
    }, async () => ({ data: 42 }));

    registerAlias(
      server,
      'alias_tool',
      'real_tool',
      (args) => args,
      'Deprecated.',
      toolHelpRegistry,
    );

    const harness = await connectInMemoryServer(server);
    try {
      const result = await harness.client.callTool({
        name: 'alias_tool',
        arguments: {},
      });

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.operation).toBe('alias_tool');
    } finally {
      await harness.close();
    }
  });

  it('deprecation notice appears in alias description', () => {
    const { server, toolHelpRegistry } = createTestHarness();

    server.registerTool('modern_tool', {
      description: 'A modern tool',
      inputSchema: {},
    }, async () => ({}));

    registerAlias(
      server,
      'ancient_tool',
      'modern_tool',
      (args) => args,
      'Use modern_tool instead.',
      toolHelpRegistry,
    );

    const entry = toolHelpRegistry.get('ancient_tool');
    expect(entry).toBeDefined();
    expect(entry!.description).toContain('Alias for modern_tool');
    expect(entry!.description).toContain('Use modern_tool instead.');
  });

  it('toolHelpRegistry has entry for alias referencing target', () => {
    const { server, toolHelpRegistry } = createTestHarness();

    server.registerTool('base_tool', {
      description: 'Base description',
      inputSchema: { x: z.number() },
    }, async () => ({}));

    registerAlias(
      server,
      'compat_tool',
      'base_tool',
      (args) => args,
      'Migrated to base_tool.',
      toolHelpRegistry,
    );

    const aliasEntry = toolHelpRegistry.get('compat_tool');
    const targetEntry = toolHelpRegistry.get('base_tool');
    expect(aliasEntry).toBeDefined();
    expect(targetEntry).toBeDefined();
    expect(aliasEntry!.description).toContain('base_tool');
  });

  it('aliasMap contains the alias mapping', () => {
    const { server, toolHelpRegistry } = createTestHarness();

    server.registerTool('new_name', {
      description: 'New name tool',
      inputSchema: {},
    }, async () => ({}));

    registerAlias(
      server,
      'old_name',
      'new_name',
      (args) => args,
      'Renamed.',
      toolHelpRegistry,
    );

    expect(aliasMap.get('old_name')).toBe('new_name');
  });

  it('defaultNextSteps resolves alias to target', () => {
    const { normalizeToolError } = createToolResultNormalizers({
      taskAwareTools: new Set(['run_automation_tests']),
      classifyRecoverableToolFailure: () => null,
    });

    // Set up an alias mapping: 'wait_for_ue' -> 'wait_for_editor'
    aliasMap.set('wait_for_ue', 'wait_for_editor');

    const result = normalizeToolError('wait_for_ue', new Error('timeout'));
    const structured = result.structuredContent as Record<string, unknown>;
    const nextSteps = structured.next_steps as string[];

    // Should resolve to wait_for_editor's next_steps
    expect(nextSteps).toContain('Retry wait_for_editor if the editor is still restarting.');
  });

  it('throws when target tool is not in toolHelpRegistry', () => {
    const { server, toolHelpRegistry } = createTestHarness();

    expect(() => {
      registerAlias(
        server,
        'orphan_alias',
        'nonexistent_tool',
        (args) => args,
        'Should fail.',
        toolHelpRegistry,
      );
    }).toThrow("Cannot register alias 'orphan_alias': target tool 'nonexistent_tool' not found in registry");
  });

  it('throws when target tool has no raw handler', () => {
    const { server, toolHelpRegistry } = createTestHarness();

    // Manually add a toolHelpRegistry entry without a corresponding raw handler
    toolHelpRegistry.set('ghost_tool', {
      title: 'Ghost',
      description: 'No handler',
      inputSchema: {},
      outputSchema: z.object({}),
    });

    expect(() => {
      registerAlias(
        server,
        'ghost_alias',
        'ghost_tool',
        (args) => args,
        'Should fail.',
        toolHelpRegistry,
      );
    }).toThrow("Cannot register alias 'ghost_alias': no raw handler found for target tool 'ghost_tool'");
  });

  it('alias handler propagates errors through normalizer', async () => {
    const { server, toolHelpRegistry } = createTestHarness();

    server.registerTool('failing_tool', {
      description: 'Will fail',
      inputSchema: {},
    }, async () => { throw new Error('intentional failure'); });

    registerAlias(
      server,
      'failing_alias',
      'failing_tool',
      (args) => args,
      'Deprecated.',
      toolHelpRegistry,
    );

    const harness = await connectInMemoryServer(server);
    try {
      const result = await harness.client.callTool({
        name: 'failing_alias',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.success).toBe(false);
      expect(structured.operation).toBe('failing_alias');
      expect(structured.message).toBe('intentional failure');
    } finally {
      await harness.close();
    }
  });
});
