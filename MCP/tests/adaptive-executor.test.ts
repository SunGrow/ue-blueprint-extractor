import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionAdapter, ToolCapability, ExecutionMode } from '../src/execution/execution-adapter.js';
import { ALL_CAPABILITIES, COMMANDLET_CAPABILITIES } from '../src/execution/execution-adapter.js';
import { ExecutionModeDetector } from '../src/execution/execution-mode-detector.js';
import { AdaptiveExecutor, ExecutorError } from '../src/execution/adaptive-executor.js';
import type { EditorFallbackCaller } from '../src/execution/adaptive-executor.js';

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

function createMockDetector(mode: ExecutionMode, reason = 'test'): ExecutionModeDetector {
  const detector = {
    detect: vi.fn().mockResolvedValue({ mode, reason }),
    invalidateCache: vi.fn(),
  } as unknown as ExecutionModeDetector;
  return detector;
}

function createMockEditorFallback(returnValue: Record<string, unknown> = { success: true, from: 'editor' }): EditorFallbackCaller {
  return vi.fn().mockResolvedValue(returnValue);
}

// ── executeRouted() ──

describe('AdaptiveExecutor.executeRouted', () => {
  let editorAdapter: ExecutionAdapter;
  let cmdAdapter: ExecutionAdapter;

  beforeEach(() => {
    editorAdapter = createMockAdapter();
    cmdAdapter = createMockAdapter({
      isAvailable: vi.fn().mockResolvedValue(true),
      getMode: vi.fn().mockReturnValue('commandlet'),
      getCapabilities: vi.fn().mockReturnValue(COMMANDLET_CAPABILITIES),
      execute: vi.fn().mockResolvedValue({ success: true, from: 'commandlet' }),
    });
  });

  it('calls editorFallback directly when detector returns editor mode', async () => {
    const detector = createMockDetector('editor');
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    executor.setActiveToolName('extract_blueprint');
    executor.setToolMode('extract_blueprint', 'both');

    const fallback = createMockEditorFallback({ ok: true, from: 'editor-fallback' });
    const result = await executor.executeRouted(fallback, 'Extract', { path: '/Game/BP' });

    expect(result).toEqual({ ok: true, from: 'editor-fallback' });
    expect(fallback).toHaveBeenCalledWith('Extract', { path: '/Game/BP' }, undefined);
    expect(cmdAdapter.execute).not.toHaveBeenCalled();
  });

  it('calls editorFallback when _activeToolName is null regardless of detected mode', async () => {
    const detector = createMockDetector('commandlet');
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    // Do NOT call setActiveToolName — it defaults to null

    const fallback = createMockEditorFallback({ from: 'fallback-no-tool' });
    const result = await executor.executeRouted(fallback, 'SomeMethod', { key: 'val' });

    expect(result).toEqual({ from: 'fallback-no-tool' });
    expect(fallback).toHaveBeenCalledWith('SomeMethod', { key: 'val' }, undefined);
    expect(cmdAdapter.execute).not.toHaveBeenCalled();
  });

  it('routes to commandlet adapter for both-mode tools in commandlet mode', async () => {
    const detector = createMockDetector('commandlet');
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    executor.setActiveToolName('extract_blueprint');
    executor.setToolMode('extract_blueprint', 'both');

    const fallback = createMockEditorFallback();
    const result = await executor.executeRouted(fallback, 'Extract', { path: '/Game/BP' });

    expect(result).toEqual({ success: true, from: 'commandlet' });
    expect(cmdAdapter.execute).toHaveBeenCalledWith('BlueprintExtractor', 'Extract', { path: '/Game/BP' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('routes to commandlet adapter for read_only tools in commandlet mode', async () => {
    const detector = createMockDetector('commandlet');
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    executor.setActiveToolName('list_assets');
    executor.setToolMode('list_assets', 'read_only');

    const fallback = createMockEditorFallback();
    const result = await executor.executeRouted(fallback, 'ListAssets', {});

    expect(result).toEqual({ success: true, from: 'commandlet' });
    expect(cmdAdapter.execute).toHaveBeenCalledWith('BlueprintExtractor', 'ListAssets', {});
    expect(fallback).not.toHaveBeenCalled();
  });

  it('throws CAPABILITY_MISMATCH for editor_only tool in commandlet mode', async () => {
    const detector = createMockDetector('commandlet', 'editor unavailable');
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    executor.setActiveToolName('modify_widget');
    executor.setToolMode('modify_widget', 'editor_only');

    const fallback = createMockEditorFallback();

    await expect(
      executor.executeRouted(fallback, 'ModifyWidget', {}),
    ).rejects.toThrow(ExecutorError);

    try {
      await executor.executeRouted(fallback, 'ModifyWidget', {});
    } catch (err) {
      const execErr = err as ExecutorError;
      expect(execErr.code).toBe('CAPABILITY_MISMATCH');
      expect(execErr.toolName).toBe('modify_widget');
      expect(execErr.currentMode).toBe('commandlet');
      expect(execErr.requiredCapability).toBe('write_complex');
      expect(execErr.message).toContain('requires the Unreal Editor');
    }

    expect(fallback).not.toHaveBeenCalled();
    expect(cmdAdapter.execute).not.toHaveBeenCalled();
  });

  it('throws MODE_UNAVAILABLE when commandlet mode detected but no commandlet adapter', async () => {
    const detector = createMockDetector('commandlet', 'editor not running');
    const executor = new AdaptiveExecutor(editorAdapter, null, detector);
    executor.setActiveToolName('extract_blueprint');
    executor.setToolMode('extract_blueprint', 'both');

    const fallback = createMockEditorFallback();

    await expect(
      executor.executeRouted(fallback, 'Extract', {}),
    ).rejects.toThrow(ExecutorError);

    try {
      await executor.executeRouted(fallback, 'Extract', {});
    } catch (err) {
      const execErr = err as ExecutorError;
      expect(execErr.code).toBe('MODE_UNAVAILABLE');
      expect(execErr.toolName).toBe('extract_blueprint');
      expect(execErr.currentMode).toBe('commandlet');
      expect(execErr.message).toContain('No execution mode available');
    }

    expect(fallback).not.toHaveBeenCalled();
  });

  it('throws MODE_UNAVAILABLE when mode is unavailable', async () => {
    const detector = createMockDetector('unavailable', 'Neither editor nor commandlet is available');
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    executor.setActiveToolName('extract_blueprint');
    executor.setToolMode('extract_blueprint', 'both');

    const fallback = createMockEditorFallback();

    await expect(
      executor.executeRouted(fallback, 'Extract', {}),
    ).rejects.toThrow(ExecutorError);

    try {
      await executor.executeRouted(fallback, 'Extract', {});
    } catch (err) {
      const execErr = err as ExecutorError;
      expect(execErr.code).toBe('MODE_UNAVAILABLE');
      expect(execErr.currentMode).toBe('unavailable');
    }
  });

  it('passes options through to editorFallback', async () => {
    const detector = createMockDetector('editor');
    const executor = new AdaptiveExecutor(editorAdapter, null, detector);
    executor.setActiveToolName('extract_blueprint');

    const fallback = createMockEditorFallback();
    await executor.executeRouted(fallback, 'Extract', { path: '/Game/BP' }, { timeoutMs: 30000 });

    expect(fallback).toHaveBeenCalledWith('Extract', { path: '/Game/BP' }, { timeoutMs: 30000 });
  });

  it('uses editor_only as default tool mode when tool is unregistered', async () => {
    const detector = createMockDetector('commandlet');
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    executor.setActiveToolName('unknown_tool');
    // Do NOT call setToolMode — should default to editor_only

    const fallback = createMockEditorFallback();

    await expect(
      executor.executeRouted(fallback, 'UnknownMethod', {}),
    ).rejects.toThrow(ExecutorError);

    try {
      await executor.executeRouted(fallback, 'UnknownMethod', {});
    } catch (err) {
      const execErr = err as ExecutorError;
      expect(execErr.code).toBe('CAPABILITY_MISMATCH');
      expect(execErr.toolName).toBe('unknown_tool');
    }
  });
});
