import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerUtilityTools } from '../src/tools/utility-tools.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

describe('registerUtilityTools', () => {
  it('serializes save_assets requests for the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      saved: true,
      changedObjects: ['/Game/UI/WBP_Window'],
    }));

    registerUtilityTools({
      server: registry.server,
      callSubsystemJson,
      getToolHelpEntry: vi.fn(),
      summarizeSchemaFields: vi.fn(),
      summarizeOutputSchema: vi.fn(),
      collectRelatedResources: vi.fn(),
      collectToolExampleFamilies: vi.fn(),
      getToolExecutionCompatibility: vi.fn(),
    });

    const result = await registry.getTool('save_assets').handler({
      asset_paths: ['/Game/UI/WBP_Window', '/Game/Data/DA_Items'],
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('SaveAssets', {
      AssetPathsJson: JSON.stringify(['/Game/UI/WBP_Window', '/Game/Data/DA_Items']),
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      saved: true,
    });
  });

  it('returns an error for unknown get_tool_help requests', async () => {
    const registry = createToolRegistry();

    registerUtilityTools({
      server: registry.server,
      callSubsystemJson: vi.fn(),
      getToolHelpEntry: vi.fn(() => undefined),
      summarizeSchemaFields: vi.fn(),
      summarizeOutputSchema: vi.fn(),
      collectRelatedResources: vi.fn(),
      collectToolExampleFamilies: vi.fn(),
      getToolExecutionCompatibility: vi.fn(),
    });

    const result = await registry.getTool('get_tool_help').handler({
      tool_name: 'missing_tool',
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      "Unknown tool 'missing_tool'.",
    );
  });

  it('normalizes get_tool_help payloads with summarized schemas and examples', async () => {
    const registry = createToolRegistry();
    const summarizeSchemaFields = vi.fn(() => [{ name: 'asset_paths', required: true }]);
    const summarizeOutputSchema = vi.fn(() => ({ type: 'object', properties: ['saved'] }));
    const collectRelatedResources = vi.fn(() => ['resource://save-assets']);
    const collectToolExampleFamilies = vi.fn(() => [{ family: 'basic-save' }]);
    const getToolExecutionCompatibility = vi.fn(() => ({
      tool_mode: 'both',
      supported_modes: ['editor', 'commandlet'],
      requires_live_editor: false,
      headless_safe: true,
    }));

    registerUtilityTools({
      server: registry.server,
      callSubsystemJson: vi.fn(),
      getToolHelpEntry: vi.fn(() => ({
        title: 'Save Assets',
        description: 'Persist dirty packages.',
        inputSchema: {
          asset_paths: z.array(z.string()),
        },
        outputSchema: z.object({ success: z.boolean() }).passthrough(),
        annotations: { readOnlyHint: false },
      })),
      summarizeSchemaFields,
      summarizeOutputSchema,
      collectRelatedResources,
      collectToolExampleFamilies,
      getToolExecutionCompatibility,
    });

    const result = await registry.getTool('get_tool_help').handler({
      tool_name: 'save_assets',
    });

    expect(summarizeSchemaFields).toHaveBeenCalledTimes(1);
    expect(summarizeOutputSchema).toHaveBeenCalledTimes(1);
    expect(collectRelatedResources).toHaveBeenCalledWith('save_assets');
    expect(collectToolExampleFamilies).toHaveBeenCalledWith('save_assets');
    expect(getToolExecutionCompatibility).toHaveBeenCalledWith('save_assets');
    expect(parseDirectToolResult(result)).toEqual({
      success: true,
      operation: 'get_tool_help',
      tool: {
        name: 'save_assets',
        title: 'Save Assets',
        description: 'Persist dirty packages.',
        annotations: { readOnlyHint: false },
        executionCompatibility: {
          tool_mode: 'both',
          supported_modes: ['editor', 'commandlet'],
          requires_live_editor: false,
          headless_safe: true,
        },
        parameters: [{ name: 'asset_paths', required: true }],
        output: { type: 'object', properties: ['saved'] },
        relatedResources: ['resource://save-assets'],
        exampleFamilies: [{ family: 'basic-save' }],
      },
    });
  });
});
