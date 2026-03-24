import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { installNormalizedToolRegistration } from '../src/helpers/tool-registration.js';
import type { ToolHelpEntry } from '../src/helpers/tool-help.js';
import { createToolResultNormalizers } from '../src/helpers/tool-results.js';
import {
  EDITOR_POLL_INTERVAL_MS,
  classifyRecoverableToolFailure,
  serverInstructions,
  taskAwareTools,
} from '../src/server-config.js';
import { connectInMemoryServer, getTextContent } from './test-helpers.js';

function parseToolResult(result: { content?: Array<{ text?: string; type: string }> }) {
  return JSON.parse(getTextContent(result));
}

function createWrappedServer(toolHelpRegistry: Map<string, ToolHelpEntry>) {
  const server = new McpServer({
    name: 'bootstrap-test-server',
    version: '1.0.0',
  });
  const defaultOutputSchema = z.object({
    success: z.boolean().optional(),
    operation: z.string().optional(),
  }).passthrough();
  const { normalizeToolError, normalizeToolSuccess } = createToolResultNormalizers({
    taskAwareTools,
    classifyRecoverableToolFailure,
  });

  installNormalizedToolRegistration({
    server,
    toolHelpRegistry,
    defaultOutputSchema,
    normalizeToolError,
    normalizeToolSuccess,
  });

  return { server, defaultOutputSchema };
}

describe('server bootstrap helpers', () => {
  it('exports stable server instructions and task-aware metadata', () => {
    expect(serverInstructions).toContain('get_tool_help');
    expect(serverInstructions).toContain('capture_widget_preview');
    expect(serverInstructions).toContain('run_automation_tests');
    expect(taskAwareTools.has('run_automation_tests')).toBe(true);
    expect(taskAwareTools.has('list_import_jobs')).toBe(true);
    expect(taskAwareTools.has('search_assets')).toBe(false);
  });

  it('classifies recoverable editor and subsystem failures', () => {
    const editorUnavailable = classifyRecoverableToolFailure(
      'extract_blueprint',
      'UE Editor not running or Remote Control not available',
    );
    const subsystemUnavailable = classifyRecoverableToolFailure(
      'extract_blueprint',
      'BlueprintExtractor subsystem not found',
    );
    const unknown = classifyRecoverableToolFailure('extract_blueprint', 'Unexpected failure');

    expect(editorUnavailable).toMatchObject({
      code: 'editor_unavailable',
      recoverable: true,
      retry_after_ms: EDITOR_POLL_INTERVAL_MS,
    });
    expect(editorUnavailable?.next_steps[0]).toContain('wait_for_editor');
    expect(subsystemUnavailable).toMatchObject({
      code: 'subsystem_unavailable',
      recoverable: true,
      retry_after_ms: EDITOR_POLL_INTERVAL_MS,
    });
    expect(subsystemUnavailable?.next_steps[1]).toContain('BlueprintExtractor plugin/subsystem');
    expect(unknown).toBeNull();
  });

  it('installs normalized tool registration with default output schema and help metadata', async () => {
    const toolHelpRegistry = new Map<string, ToolHelpEntry>();
    const { server, defaultOutputSchema } = createWrappedServer(toolHelpRegistry);
    server.registerTool('demo_tool', {
      title: 'Demo Tool',
      description: 'Demo description',
      inputSchema: {
        value: z.string(),
      },
    }, async (args) => ({
      success: true,
      echoed: (args as { value: string }).value,
    }));

    const harness = await connectInMemoryServer(server);

    try {
      const tools = await harness.client.listTools();
      const result = await harness.client.callTool({
        name: 'demo_tool',
        arguments: {
          value: 'hello',
        },
      });

      expect(toolHelpRegistry.get('demo_tool')).toMatchObject({
        title: 'Demo Tool',
        description: 'Demo description',
      });
      expect(toolHelpRegistry.get('demo_tool')?.outputSchema).toBe(defaultOutputSchema);
      expect(tools.tools.find((tool) => tool.name === 'demo_tool')?.outputSchema).toBeTruthy();
      expect(result.isError).not.toBe(true);
      expect(parseToolResult(result)).toMatchObject({
        success: true,
        operation: 'demo_tool',
        echoed: 'hello',
      });
      expect(result.content?.some((entry) => entry.type === 'text')).toBe(false);
      expect((result as { structuredContent?: unknown }).structuredContent).toMatchObject({
        operation: 'demo_tool',
        echoed: 'hello',
      });
    } finally {
      await harness.close();
    }
  });

  it('preserves explicit output schema and normalizes handled and thrown failures', async () => {
    const toolHelpRegistry = new Map<string, ToolHelpEntry>();
    const { server, defaultOutputSchema } = createWrappedServer(toolHelpRegistry);
    const explicitOutputSchema = z.object({
      message: z.string(),
    });

    server.registerTool('handled_failure_tool', {
      title: 'Handled Failure Tool',
      description: 'Returns isError payloads',
      outputSchema: explicitOutputSchema,
    }, async () => ({
      isError: true,
      message: 'UE Editor not running or Remote Control not available',
    }));

    server.registerTool('thrown_failure_tool', {
      title: 'Thrown Failure Tool',
      description: 'Throws errors',
    }, async () => {
      throw new Error('kaboom');
    });

    const harness = await connectInMemoryServer(server);

    try {
      const handledFailure = await harness.client.callTool({
        name: 'handled_failure_tool',
        arguments: {},
      });
      const thrownFailure = await harness.client.callTool({
        name: 'thrown_failure_tool',
        arguments: {},
      });

      expect(toolHelpRegistry.get('handled_failure_tool')?.outputSchema).toBe(explicitOutputSchema);
      expect(toolHelpRegistry.get('thrown_failure_tool')?.outputSchema).toBe(defaultOutputSchema);

      expect(handledFailure.isError).toBe(true);
      expect(parseToolResult(handledFailure)).toMatchObject({
        success: false,
        code: 'editor_unavailable',
        recoverable: true,
        retry_after_ms: EDITOR_POLL_INTERVAL_MS,
      });
      expect(handledFailure.content?.some((entry) => entry.type === 'text')).toBe(false);

      expect(thrownFailure.isError).toBe(true);
      expect(parseToolResult(thrownFailure)).toMatchObject({
        success: false,
        code: 'tool_execution_failed',
        message: 'kaboom',
        recoverable: true,
      });
      expect(thrownFailure.content?.some((entry) => entry.type === 'text')).toBe(false);
    } finally {
      await harness.close();
    }
  });
});
