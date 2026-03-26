import { describe, expect, it, vi } from 'vitest';
import { registerCompositeTools } from '../src/tools/composite-tools.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import type { CompositeToolResult } from '../src/helpers/composite-patterns.js';

function setupRegistry(callSubsystemJson: ReturnType<typeof vi.fn>) {
  const registry = createToolRegistry();
  registerCompositeTools({
    server: registry.server,
    callSubsystemJson,
    toolHelpRegistry: registry.toolHelpRegistry,
  });
  return registry;
}

describe('find_and_extract', () => {
  it('searches and auto-extracts single result', async () => {
    const callSubsystemJson = vi.fn()
      .mockResolvedValueOnce({
        results: [{ assetPath: '/Game/BP_Player', className: 'Blueprint' }],
      })
      .mockResolvedValueOnce({
        blueprint: { className: 'BP_Player_C' },
      });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('find_and_extract').handler({
      query: 'Player',
      class_filter: 'Blueprint',
      max_search_results: 10,
      extract_type: 'blueprint',
      auto_extract_if_single: true,
      compact: true,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0].step).toBe('search');
    expect(parsed.steps[0].status).toBe('success');
    expect(parsed.steps[1].step).toBe('extract');
    expect(parsed.steps[1].status).toBe('success');
    expect(parsed.steps[1].data).toMatchObject({ blueprint: { className: 'BP_Player_C' } });

    expect(callSubsystemJson).toHaveBeenCalledWith('SearchAssets', {
      Query: 'Player',
      ClassFilter: 'Blueprint',
      MaxResults: 10,
    });
    expect(callSubsystemJson).toHaveBeenCalledWith('ExtractBlueprint', {
      AssetPath: '/Game/BP_Player',
      Scope: 'Variables',
      GraphFilter: '',
      bIncludeClassDefaults: false,
    });
  });

  it('returns search results when multiple matches', async () => {
    const callSubsystemJson = vi.fn().mockResolvedValueOnce({
      results: [
        { assetPath: '/Game/BP_A', className: 'Blueprint' },
        { assetPath: '/Game/BP_B', className: 'Blueprint' },
        { assetPath: '/Game/BP_C', className: 'Blueprint' },
      ],
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('find_and_extract').handler({
      query: 'BP',
      class_filter: 'Blueprint',
      max_search_results: 10,
      extract_type: 'blueprint',
      auto_extract_if_single: true,
      compact: true,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult & { execution: { needs_selection?: boolean } };
    expect(parsed.success).toBe(true);
    expect(parsed.execution.needs_selection).toBe(true);
    expect(parsed.steps[0].status).toBe('success');
    expect(parsed.steps[0].data).toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({ assetPath: '/Game/BP_A' }),
      ]),
    });
    expect(parsed.steps[1].step).toBe('extract');
    expect(parsed.steps[1].status).toBe('skipped');

    // extract should NOT be called
    expect(callSubsystemJson).toHaveBeenCalledTimes(1);
  });

  it('returns error when no matches', async () => {
    const callSubsystemJson = vi.fn().mockResolvedValueOnce({
      results: [],
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('find_and_extract').handler({
      query: 'NonExistent',
      class_filter: 'Blueprint',
      max_search_results: 10,
      extract_type: 'blueprint',
      auto_extract_if_single: true,
      compact: true,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.steps[0].step).toBe('search');
    expect(parsed.steps[0].status).toBe('failure');
    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it('handles extraction failure with partial result', async () => {
    const callSubsystemJson = vi.fn()
      .mockResolvedValueOnce({
        results: [{ assetPath: '/Game/BP_Broken', className: 'Blueprint' }],
      })
      .mockRejectedValueOnce(new Error('Blueprint extraction failed'));

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('find_and_extract').handler({
      query: 'Broken',
      class_filter: 'Blueprint',
      max_search_results: 10,
      extract_type: 'blueprint',
      auto_extract_if_single: true,
      compact: true,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect(parsed.steps[0].status).toBe('success');
    expect(parsed.steps[1].status).toBe('failure');
    expect(parsed.steps[1].message).toContain('Blueprint extraction failed');
    expect(parsed.partial_state).toEqual({
      completed_steps: ['search'],
      failed_step: 'extract',
      editor_state: 'No mutations performed; editor state unchanged',
    });
  });

  it('passes compact/scope options to extraction', async () => {
    const callSubsystemJson = vi.fn()
      .mockResolvedValueOnce({
        results: [{ assetPath: '/Game/BP_Test', className: 'Blueprint' }],
      })
      .mockResolvedValueOnce({
        blueprint: { graphs: [] },
      });

    const registry = setupRegistry(callSubsystemJson);

    await registry.getTool('find_and_extract').handler({
      query: 'Test',
      class_filter: 'Blueprint',
      max_search_results: 10,
      extract_type: 'blueprint',
      auto_extract_if_single: true,
      scope: 'Full',
      compact: false,
      include_class_defaults: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ExtractBlueprint', {
      AssetPath: '/Game/BP_Test',
      Scope: 'Full',
      GraphFilter: '',
      bIncludeClassDefaults: true,
    });
  });

  it('skips search when asset_paths provided', async () => {
    const callSubsystemJson = vi.fn()
      .mockResolvedValueOnce({ blueprint: { className: 'BP_A_C' } })
      .mockResolvedValueOnce({ blueprint: { className: 'BP_B_C' } });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('find_and_extract').handler({
      query: 'Ignored',
      class_filter: 'Blueprint',
      max_search_results: 10,
      extract_type: 'blueprint',
      auto_extract_if_single: true,
      compact: true,
      asset_paths: ['/Game/BP_A', '/Game/BP_B'],
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);
    expect(parsed.steps[0].step).toBe('search');
    expect(parsed.steps[0].status).toBe('skipped');

    // Verify search was NOT called
    expect(callSubsystemJson).not.toHaveBeenCalledWith(
      'SearchAssets',
      expect.anything(),
    );

    // Verify both extractions happened
    expect(callSubsystemJson).toHaveBeenCalledTimes(2);
    expect(parsed.steps[1].data).toMatchObject({ blueprint: { className: 'BP_A_C' } });
    expect(parsed.steps[2].data).toMatchObject({ blueprint: { className: 'BP_B_C' } });
  });

  it('honors auto_extract_if_single=false', async () => {
    const callSubsystemJson = vi.fn().mockResolvedValueOnce({
      results: [{ assetPath: '/Game/BP_Single', className: 'Blueprint' }],
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('find_and_extract').handler({
      query: 'Single',
      class_filter: 'Blueprint',
      max_search_results: 10,
      extract_type: 'blueprint',
      auto_extract_if_single: false,
      compact: true,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult & { execution: { needs_selection?: boolean } };
    expect(parsed.success).toBe(true);
    expect(parsed.execution.needs_selection).toBe(true);
    expect(parsed.steps[1].status).toBe('skipped');

    // extract should NOT be called
    expect(callSubsystemJson).toHaveBeenCalledTimes(1);
  });

  it('returns correct CompositeStepResult structure', async () => {
    const callSubsystemJson = vi.fn()
      .mockResolvedValueOnce({
        results: [{ assetPath: '/Game/BP_Struct', className: 'Blueprint' }],
      })
      .mockResolvedValueOnce({
        blueprint: { name: 'BP_Struct' },
      });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('find_and_extract').handler({
      query: 'Struct',
      class_filter: 'Blueprint',
      max_search_results: 10,
      extract_type: 'blueprint',
      auto_extract_if_single: true,
      compact: true,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;

    // Validate structure
    expect(parsed).toHaveProperty('success');
    expect(parsed).toHaveProperty('operation', 'find_and_extract');
    expect(parsed).toHaveProperty('steps');
    expect(parsed).toHaveProperty('execution');
    expect(Array.isArray(parsed.steps)).toBe(true);

    for (const step of parsed.steps) {
      expect(step).toHaveProperty('step');
      expect(step).toHaveProperty('status');
      expect(['success', 'failure', 'skipped']).toContain(step.status);
    }

    expect(parsed.execution).toMatchObject({
      mode: 'immediate',
      task_support: 'optional',
    });
  });

  it('routes material extract_type to ExtractMaterial', async () => {
    const callSubsystemJson = vi.fn()
      .mockResolvedValueOnce({
        results: [{ assetPath: '/Game/Materials/M_Base', className: 'Material' }],
      })
      .mockResolvedValueOnce({
        materialName: 'M_Base',
      });

    const registry = setupRegistry(callSubsystemJson);

    await registry.getTool('find_and_extract').handler({
      query: 'Base',
      class_filter: 'Material',
      max_search_results: 10,
      extract_type: 'material',
      auto_extract_if_single: true,
      compact: true,
      verbose: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ExtractMaterial', {
      AssetPath: '/Game/Materials/M_Base',
      bVerbose: true,
    });
  });

  it('routes widget_blueprint extract_type to ExtractWidgetBlueprint', async () => {
    const callSubsystemJson = vi.fn()
      .mockResolvedValueOnce({
        results: [{ assetPath: '/Game/UI/WBP_Main', className: 'WidgetBlueprint' }],
      })
      .mockResolvedValueOnce({
        widgetTree: { root: 'CanvasPanel' },
      });

    const registry = setupRegistry(callSubsystemJson);

    await registry.getTool('find_and_extract').handler({
      query: 'Main',
      class_filter: 'WidgetBlueprint',
      max_search_results: 10,
      extract_type: 'widget_blueprint',
      auto_extract_if_single: true,
      compact: true,
      include_class_defaults: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ExtractWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Main',
      bIncludeClassDefaults: true,
    });
  });
});
