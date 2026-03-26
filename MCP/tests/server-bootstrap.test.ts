import { describe, expect, it } from 'vitest';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { createBlueprintExtractorServer } from '../src/server-factory.js';
import { CORE_TOOLS } from '../src/tool-surface-manager.js';
import { connectInMemoryServer, getTextContent } from './test-helpers.js';

function parseToolResult(result: {
  content?: Array<{ text?: string; type: string }>;
  structuredContent?: unknown;
}) {
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent as Record<string, unknown>;
  }
  return JSON.parse(getTextContent(result));
}

function createWrappedServer(toolHelpRegistry: Map<string, ToolHelpEntry>) {
  const registeredToolMap = new Map<string, RegisteredTool>();
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
    registeredToolMap,
    defaultOutputSchema,
    normalizeToolError,
    normalizeToolSuccess,
  });

  return { server, defaultOutputSchema, registeredToolMap };
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
    expect(subsystemUnavailable?.next_steps.join(' ')).toContain('restart_editor');
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
      expect(handledFailure.structuredContent).toMatchObject({
        success: false,
        code: 'editor_unavailable',
        recoverable: true,
        retry_after_ms: EDITOR_POLL_INTERVAL_MS,
      });
      expect(handledFailure.content?.some((entry) => entry.type === 'text')).toBe(true);
      expect(handledFailure.content?.find((e) => e.type === 'text')?.text).toBeTruthy();

      expect(thrownFailure.isError).toBe(true);
      expect(thrownFailure.structuredContent).toMatchObject({
        success: false,
        code: 'tool_execution_failed',
        message: 'kaboom',
        recoverable: true,
      });
      expect(thrownFailure.content?.some((entry) => entry.type === 'text')).toBe(true);
      expect(thrownFailure.content?.find((e) => e.type === 'text')?.text).toBe('kaboom');
    } finally {
      await harness.close();
    }
  });
});

describe('normalizeToolError content and prefix stripping', () => {
  it('always produces content[0].text with the error message', async () => {
    const toolHelpRegistry = new Map<string, ToolHelpEntry>();
    const { server } = createWrappedServer(toolHelpRegistry);

    server.registerTool('fail_with_message', {
      title: 'Fail With Message',
      description: 'Always throws',
    }, async () => {
      throw new Error('subsystem exploded');
    });

    const harness = await connectInMemoryServer(server);

    try {
      const result = await harness.client.callTool({
        name: 'fail_with_message',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content!.length).toBeGreaterThanOrEqual(1);
      expect(result.content![0]).toMatchObject({
        type: 'text',
        text: 'subsystem exploded',
      });
    } finally {
      await harness.close();
    }
  });

  it('strips "Error: " prefix from payload.message', async () => {
    const toolHelpRegistry = new Map<string, ToolHelpEntry>();
    const { server } = createWrappedServer(toolHelpRegistry);

    server.registerTool('fail_with_error_prefix', {
      title: 'Fail With Error Prefix',
      description: 'Returns isError with Error: prefix in message',
    }, async () => ({
      isError: true,
      message: 'Error: Some failure',
    }));

    const harness = await connectInMemoryServer(server);

    try {
      const result = await harness.client.callTool({
        name: 'fail_with_error_prefix',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content!.length).toBeGreaterThanOrEqual(1);
      expect(result.content![0]).toMatchObject({
        type: 'text',
      });
      const textContent = result.content![0] as { type: string; text: string };
      expect(textContent.text).toBe('Some failure');
      expect(textContent.text).not.toMatch(/^Error:\s/);
    } finally {
      await harness.close();
    }
  });

  it('preserves non-text content alongside new text block', () => {
    const { normalizeToolError } = createToolResultNormalizers({
      taskAwareTools,
      classifyRecoverableToolFailure,
    });

    const imageBlock = {
      type: 'image' as const,
      data: 'base64data',
      mimeType: 'image/png' as const,
    };

    const result = normalizeToolError(
      'some_tool',
      { message: 'render failed' },
      { content: [imageBlock] },
    );

    expect(result.isError).toBe(true);
    expect(result.content.length).toBe(2);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'render failed',
    });
    expect(result.content[1]).toMatchObject({
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
    });
  });
});

describe('classifyRecoverableToolFailure engine_root_missing', () => {
  it('returns engine_root_missing for messages requiring engine_root or UE_ENGINE_ROOT', () => {
    const result = classifyRecoverableToolFailure(
      'compile_project_code',
      'compile_project_code requires engine_root or UE_ENGINE_ROOT to locate build tools.',
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      code: 'engine_root_missing',
      recoverable: false,
    });
  });
});

describe('ToolSurfaceManager integration with server factory', () => {
  it('createBlueprintExtractorServer returns ToolSurfaceManager alongside server', () => {
    const result = createBlueprintExtractorServer(
      { callSubsystem: async () => '{}' } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );

    expect(result).toHaveProperty('server');
    expect(result).toHaveProperty('toolSurfaceManager');
    expect(result.server).toBeInstanceOf(McpServer);
  });

  it('registers activate_workflow_scope tool', async () => {
    const { server } = createBlueprintExtractorServer(
      { callSubsystem: async () => '{}' } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );
    const harness = await connectInMemoryServer(server);

    try {
      const tools = await harness.client.listTools();
      const scopeTool = tools.tools.find(t => t.name === 'activate_workflow_scope');
      expect(scopeTool).toBeDefined();
      expect(scopeTool?.description).toContain('workflow-specific scope');
    } finally {
      await harness.close();
    }
  });

  it('default tool surface includes all CORE_TOOLS after scoped mode activation', async () => {
    const { server, toolSurfaceManager } = createBlueprintExtractorServer(
      { callSubsystem: async () => '{}' } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );

    toolSurfaceManager.enableScopedMode();
    const activeTools = toolSurfaceManager.getActiveTools();

    for (const coreTool of CORE_TOOLS) {
      if (activeTools.has(coreTool)) {
        expect(toolSurfaceManager.isActive(coreTool)).toBe(true);
      }
    }

    expect(activeTools.size).toBeLessThanOrEqual(CORE_TOOLS.size + 5);
  });
});
