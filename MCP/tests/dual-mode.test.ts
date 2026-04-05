import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionAdapter, ToolCapability, ExecutionMode } from '../src/execution/execution-adapter.js';
import { ALL_CAPABILITIES, COMMANDLET_CAPABILITIES } from '../src/execution/execution-adapter.js';
import { EditorAdapter } from '../src/execution/adapters/editor-adapter.js';
import { LazyCommandletAdapter } from '../src/execution/adapters/lazy-commandlet-adapter.js';
import { ExecutionModeDetector } from '../src/execution/execution-mode-detector.js';
import { AdaptiveExecutor, ExecutorError } from '../src/execution/adaptive-executor.js';
import { TOOL_MODE_ANNOTATIONS, classifyRecoverableToolFailure } from '../src/server-config.js';
import { createBlueprintExtractorServer } from '../src/server-factory.js';

// ── Mock helpers ──

function createMockAdapter(overrides: Partial<ExecutionAdapter> = {}): ExecutionAdapter {
  return {
    execute: vi.fn().mockResolvedValue({ success: true }),
    isAvailable: vi.fn().mockResolvedValue(true),
    getMode: vi.fn().mockReturnValue('editor' as ExecutionMode),
    getCapabilities: vi.fn().mockReturnValue(ALL_CAPABILITIES),
    ...overrides,
  };
}

function createMockUEClient() {
  return {
    callSubsystem: vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: 'test' })),
    checkConnection: vi.fn().mockResolvedValue(true),
  };
}

// ── 1. EditorAdapter wraps UEClient ──

describe('EditorAdapter', () => {
  it('wraps UEClient.callSubsystem and parses JSON response', async () => {
    const mockClient = createMockUEClient();
    mockClient.callSubsystem.mockResolvedValue(JSON.stringify({ success: true, result: 42 }));

    const adapter = new EditorAdapter(mockClient as any);
    const result = await adapter.execute('subsystem', 'TestMethod', { key: 'value' });

    expect(mockClient.callSubsystem).toHaveBeenCalledWith('TestMethod', { key: 'value' });
    expect(result).toEqual({ success: true, result: 42 });
  });

  it('delegates isAvailable to UEClient.checkConnection', async () => {
    const mockClient = createMockUEClient();
    mockClient.checkConnection.mockResolvedValue(false);

    const adapter = new EditorAdapter(mockClient as any);
    const available = await adapter.isAvailable();

    expect(mockClient.checkConnection).toHaveBeenCalled();
    expect(available).toBe(false);
  });

  it('returns editor mode', () => {
    const adapter = new EditorAdapter(createMockUEClient() as any);
    expect(adapter.getMode()).toBe('editor');
  });

  it('returns all capabilities', () => {
    const adapter = new EditorAdapter(createMockUEClient() as any);
    const caps = adapter.getCapabilities();
    expect(caps).toBe(ALL_CAPABILITIES);
    expect(caps.has('read')).toBe(true);
    expect(caps.has('write_simple')).toBe(true);
    expect(caps.has('write_complex')).toBe(true);
    expect(caps.has('interactive')).toBe(true);
  });
});

describe('LazyCommandletAdapter', () => {
  it('initializes the underlying commandlet adapter once and reuses it', async () => {
    const initialize = vi.fn(async () => undefined);
    const execute = vi.fn(async () => ({ success: true, from: 'commandlet' }));
    const isAvailable = vi.fn(async () => true);
    const createAdapter = vi.fn(() => ({
      initialize,
      execute,
      isAvailable,
      getMode: () => 'commandlet' as const,
      getCapabilities: () => COMMANDLET_CAPABILITIES,
    }));
    const resolveInputs = vi.fn(async () => ({
      engineRoot: 'C:/Program Files/Epic Games/UE_5.6',
      projectPath: 'D:/Development/V2/CyberVolleyball6vs6.uproject',
    }));

    const adapter = new LazyCommandletAdapter({ resolveInputs, createAdapter });

    expect(await adapter.isAvailable()).toBe(true);
    await expect(adapter.execute('BlueprintExtractor', 'SearchAssets', { Query: 'Player' })).resolves.toEqual({
      success: true,
      from: 'commandlet',
    });

    expect(resolveInputs).toHaveBeenCalledTimes(1);
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('BlueprintExtractor', 'SearchAssets', { Query: 'Player' });
  });

  it('reports unavailable when commandlet inputs cannot be resolved', async () => {
    const adapter = new LazyCommandletAdapter({
      resolveInputs: async () => ({ engineRoot: undefined, projectPath: undefined }),
    });

    await expect(adapter.isAvailable()).resolves.toBe(false);
  });
});

// ── 2 & 3. ExecutionModeDetector ──

describe('ExecutionModeDetector', () => {
  it('returns editor mode when editor is available', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(true) });
    const cmdAdapter = createMockAdapter({
      isAvailable: vi.fn().mockResolvedValue(true),
      getMode: vi.fn().mockReturnValue('commandlet'),
    });

    const detector = new ExecutionModeDetector(editorAdapter, cmdAdapter);
    const result = await detector.detect();

    expect(result.mode).toBe('editor');
    expect(result.reason).toContain('Editor');
  });

  it('returns commandlet mode when editor is unavailable', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(false) });
    const cmdAdapter = createMockAdapter({
      isAvailable: vi.fn().mockResolvedValue(true),
      getMode: vi.fn().mockReturnValue('commandlet'),
    });

    const detector = new ExecutionModeDetector(editorAdapter, cmdAdapter);
    const result = await detector.detect();

    expect(result.mode).toBe('commandlet');
    expect(result.reason).toContain('editor unavailable');
  });

  it('returns unavailable when both adapters are down', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(false) });
    const cmdAdapter = createMockAdapter({
      isAvailable: vi.fn().mockResolvedValue(false),
      getMode: vi.fn().mockReturnValue('commandlet'),
    });

    const detector = new ExecutionModeDetector(editorAdapter, cmdAdapter);
    const result = await detector.detect();

    expect(result.mode).toBe('unavailable');
    expect(result.reason).toContain('Neither');
  });

  it('returns unavailable when no commandlet adapter and editor is down', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(false) });

    const detector = new ExecutionModeDetector(editorAdapter, null);
    const result = await detector.detect();

    expect(result.mode).toBe('unavailable');
  });

  it('caches detection results for 5 seconds', async () => {
    let currentTime = 1000;
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(true) });

    const detector = new ExecutionModeDetector(editorAdapter, null, () => currentTime);

    // First call: should probe
    const result1 = await detector.detect();
    expect(result1.mode).toBe('editor');
    expect(editorAdapter.isAvailable).toHaveBeenCalledTimes(1);

    // Second call within cache window: should NOT probe again
    currentTime = 4000; // 3 seconds later
    const result2 = await detector.detect();
    expect(result2.mode).toBe('editor');
    expect(editorAdapter.isAvailable).toHaveBeenCalledTimes(1); // Still 1

    // Third call after cache expires: should probe again
    currentTime = 7000; // 6 seconds after initial
    const result3 = await detector.detect();
    expect(result3.mode).toBe('editor');
    expect(editorAdapter.isAvailable).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache forces re-detection', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(true) });
    const detector = new ExecutionModeDetector(editorAdapter, null);

    await detector.detect();
    expect(editorAdapter.isAvailable).toHaveBeenCalledTimes(1);

    detector.invalidateCache();
    await detector.detect();
    expect(editorAdapter.isAvailable).toHaveBeenCalledTimes(2);
  });
});

// ── 4, 5, 6. AdaptiveExecutor ──

describe('AdaptiveExecutor', () => {
  it('routes to editor adapter when editor is available', async () => {
    const editorAdapter = createMockAdapter({
      execute: vi.fn().mockResolvedValue({ success: true, from: 'editor' }),
    });
    const detector = new ExecutionModeDetector(editorAdapter, null);
    const executor = new AdaptiveExecutor(editorAdapter, null, detector);

    const result = await executor.execute('extract_blueprint', 'sub', 'Extract', { path: '/Game/BP' });

    expect(result).toEqual({ success: true, from: 'editor' });
    expect(editorAdapter.execute).toHaveBeenCalledWith('sub', 'Extract', { path: '/Game/BP' });
  });

  it('throws CAPABILITY_MISMATCH for editor_only tools in commandlet mode', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(false) });
    const cmdAdapter = createMockAdapter({
      isAvailable: vi.fn().mockResolvedValue(true),
      getMode: vi.fn().mockReturnValue('commandlet'),
      getCapabilities: vi.fn().mockReturnValue(COMMANDLET_CAPABILITIES),
    });
    const detector = new ExecutionModeDetector(editorAdapter, cmdAdapter);
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    executor.setToolMode('patch_widget', 'editor_only');

    await expect(
      executor.execute('patch_widget', 'sub', 'ModifyWidgetBlueprintStructure', {}),
    ).rejects.toThrow(ExecutorError);

    try {
      await executor.execute('patch_widget', 'sub', 'ModifyWidgetBlueprintStructure', {});
    } catch (err) {
      const execErr = err as ExecutorError;
      expect(execErr.code).toBe('CAPABILITY_MISMATCH');
      expect(execErr.toolName).toBe('patch_widget');
      expect(execErr.currentMode).toBe('commandlet');
      expect(execErr.message).toContain('requires the Unreal Editor');
    }
  });

  it('allows both-mode tools in commandlet mode', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(false) });
    const cmdAdapter = createMockAdapter({
      isAvailable: vi.fn().mockResolvedValue(true),
      getMode: vi.fn().mockReturnValue('commandlet'),
      getCapabilities: vi.fn().mockReturnValue(COMMANDLET_CAPABILITIES),
      execute: vi.fn().mockResolvedValue({ success: true, from: 'commandlet' }),
    });
    const detector = new ExecutionModeDetector(editorAdapter, cmdAdapter);
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    executor.setToolMode('extract_blueprint', 'both');

    const result = await executor.execute('extract_blueprint', 'sub', 'Extract', {});
    expect(result).toEqual({ success: true, from: 'commandlet' });
  });

  it('throws MODE_UNAVAILABLE when no adapter is available', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(false) });
    const detector = new ExecutionModeDetector(editorAdapter, null);
    const executor = new AdaptiveExecutor(editorAdapter, null, detector);

    await expect(
      executor.execute('extract_blueprint', 'sub', 'Extract', {}),
    ).rejects.toThrow(ExecutorError);

    try {
      await executor.execute('extract_blueprint', 'sub', 'Extract', {});
    } catch (err) {
      const execErr = err as ExecutorError;
      expect(execErr.code).toBe('MODE_UNAVAILABLE');
      expect(execErr.toolName).toBe('extract_blueprint');
      expect(execErr.currentMode).toBe('unavailable');
    }
  });

  it('defaults to editor_only for unknown tools', () => {
    const editorAdapter = createMockAdapter();
    const detector = new ExecutionModeDetector(editorAdapter, null);
    const executor = new AdaptiveExecutor(editorAdapter, null, detector);

    expect(executor.getToolMode('unknown_tool_xyz')).toBe('editor_only');
  });

  it('getCurrentMode returns the detected mode', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(true) });
    const detector = new ExecutionModeDetector(editorAdapter, null);
    const executor = new AdaptiveExecutor(editorAdapter, null, detector);

    const mode = await executor.getCurrentMode();
    expect(mode).toBe('editor');
  });
});

// ── 7. Tool mode annotations cover all registered tools ──

describe('TOOL_MODE_ANNOTATIONS', () => {
  it('contains entries for all registered tools', () => {
    const { server, toolSurfaceManager, executor } = createBlueprintExtractorServer(
      { callSubsystem: async () => '{}' } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );

    // Enable flat mode to get all tools visible
    toolSurfaceManager.enableFlatMode();
    const allTools = toolSurfaceManager.getActiveTools();

    // Every registered tool should have a mode annotation
    const missingAnnotations: string[] = [];
    for (const toolName of allTools) {
      if (!TOOL_MODE_ANNOTATIONS.has(toolName)) {
        missingAnnotations.push(toolName);
      }
    }

    expect(missingAnnotations).toEqual([]);
  });

  it('has no annotations for non-existent tools', () => {
    const { toolSurfaceManager } = createBlueprintExtractorServer(
      { callSubsystem: async () => '{}' } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );

    toolSurfaceManager.enableFlatMode();
    const allTools = toolSurfaceManager.getActiveTools();

    const orphanedAnnotations: string[] = [];
    for (const [toolName] of TOOL_MODE_ANNOTATIONS) {
      if (!allTools.has(toolName)) {
        orphanedAnnotations.push(toolName);
      }
    }

    expect(orphanedAnnotations).toEqual([]);
  });

  it('marks all extract_* tools as both', () => {
    for (const [toolName, mode] of TOOL_MODE_ANNOTATIONS) {
      if (toolName.startsWith('extract_')) {
        expect(mode).toBe('both');
      }
    }
  });

  it('marks all modify_* tools as editor_only', () => {
    for (const [toolName, mode] of TOOL_MODE_ANNOTATIONS) {
      if (toolName.startsWith('modify_')) {
        expect(mode).toBe('editor_only');
      }
    }
  });

  it('executor has all tool modes applied after server creation', () => {
    const { executor } = createBlueprintExtractorServer(
      { callSubsystem: async () => '{}' } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );

    // Spot-check: both-mode tools
    expect(executor.getToolMode('search_assets')).toBe('both');
    expect(executor.getToolMode('extract_blueprint')).toBe('both');
    expect(executor.getToolMode('list_assets')).toBe('both');

    // Spot-check: editor_only tools
    expect(executor.getToolMode('patch_widget')).toBe('editor_only');
    expect(executor.getToolMode('restart_editor')).toBe('editor_only');
    expect(executor.getToolMode('capture_widget_preview')).toBe('editor_only');
    expect(executor.getToolMode('start_pie')).toBe('editor_only');
    expect(executor.getToolMode('capture_runtime_screenshot')).toBe('both');
  });
});

// ── Dual-mode error classification ──

describe('dual-mode error classification', () => {
  it('classifies MODE_UNAVAILABLE errors', () => {
    const result = classifyRecoverableToolFailure(
      'extract_blueprint',
      "MODE_UNAVAILABLE: No execution mode available for tool 'extract_blueprint'.",
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      code: 'mode_unavailable',
      recoverable: true,
    });
    expect(result!.next_steps.some((s: string) => s.includes('Start the Unreal Editor'))).toBe(true);
    expect(result!.next_steps.some((s: string) => s.includes('extract_blueprint'))).toBe(true);
  });

  it('classifies CAPABILITY_MISMATCH errors', () => {
    const result = classifyRecoverableToolFailure(
      'patch_widget',
      "CAPABILITY_MISMATCH: Tool 'patch_widget' requires the Unreal Editor but only commandlet mode is available.",
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      code: 'capability_mismatch',
      recoverable: true,
    });
    expect(result!.next_steps.some((s: string) => s.includes('patch_widget'))).toBe(true);
    expect(result!.next_steps.some((s: string) => s.includes('Commandlet mode'))).toBe(true);
  });

  it('classifies COMMANDLET_TIMEOUT errors', () => {
    const result = classifyRecoverableToolFailure(
      'extract_asset',
      'COMMANDLET_TIMEOUT: Request took too long',
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      code: 'commandlet_timeout',
      recoverable: true,
      retry_after_ms: 10_000,
    });
    expect(result!.next_steps.some((s: string) => s.includes('commandlet'))).toBe(true);
  });

  it('classifies Commandlet timeout errors', () => {
    const result = classifyRecoverableToolFailure(
      'extract_asset',
      'Commandlet process timed out — timeout waiting for response',
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      code: 'commandlet_timeout',
      recoverable: true,
    });
  });

  it('does not interfere with existing editor_unavailable classification', () => {
    const result = classifyRecoverableToolFailure(
      'extract_blueprint',
      'UE Editor not running or Remote Control not available',
    );

    expect(result).toMatchObject({
      code: 'editor_unavailable',
      recoverable: true,
    });
  });

  it('does not interfere with existing timeout classification', () => {
    const result = classifyRecoverableToolFailure(
      'extract_blueprint',
      'Request timed out after 60000ms',
    );

    expect(result).toMatchObject({
      code: 'timeout',
      recoverable: true,
    });
  });
});
