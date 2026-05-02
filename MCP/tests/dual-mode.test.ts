import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionAdapter, ToolCapability, ExecutionMode } from '../src/execution/execution-adapter.js';
import { ALL_CAPABILITIES, COMMANDLET_CAPABILITIES } from '../src/execution/execution-adapter.js';
import { EditorAdapter } from '../src/execution/adapters/editor-adapter.js';
import { CommandletAdapter } from '../src/execution/adapters/commandlet-adapter.js';
import { LazyCommandletAdapter } from '../src/execution/adapters/lazy-commandlet-adapter.js';
import { ExecutionModeDetector } from '../src/execution/execution-mode-detector.js';
import { AdaptiveExecutor, ExecutorError } from '../src/execution/adaptive-executor.js';
import { TOOL_MODE_ANNOTATIONS, classifyRecoverableToolFailure } from '../src/server-config.js';
import { createBlueprintExtractorServer } from '../src/server-factory.js';
import { EventEmitter } from 'node:events';

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

class MockReadable extends EventEmitter {
  private bufferedChunks: Buffer[] = [];

  setEncoding(): this {
    return this;
  }

  override emit(eventName: string | symbol, ...args: any[]): boolean {
    if (eventName === 'data' && this.listenerCount('data') === 0) {
      const [chunk] = args;
      this.bufferedChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    }

    return super.emit(eventName, ...args);
  }

  override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    const result = super.on(eventName, listener);
    if (eventName === 'data') {
      this.flushBufferedChunks();
    }
    return result;
  }

  override addListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return this.on(eventName, listener);
  }

  private flushBufferedChunks(): void {
    if (this.bufferedChunks.length === 0 || this.listenerCount('data') === 0) {
      return;
    }

    const bufferedChunks = [...this.bufferedChunks];
    this.bufferedChunks = [];
    for (const chunk of bufferedChunks) {
      super.emit('data', chunk);
    }
  }
}

class MockWritable extends EventEmitter {
  writes: string[] = [];
  ended = false;

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }

  end(): void {
    this.ended = true;
  }
}

function createMockChildProcess() {
  const stdout = new MockReadable();
  const stderr = new MockReadable();
  const stdin = new MockWritable();
  const process = new EventEmitter() as EventEmitter & {
    stdout: MockReadable;
    stderr: MockReadable;
    stdin: MockWritable;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  process.stdout = stdout;
  process.stderr = stderr;
  process.stdin = stdin;
  process.killed = false;
  process.kill = vi.fn(() => {
    process.killed = true;
    process.emit('exit', 0);
    return true;
  });
  return process;
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

describe('CommandletAdapter', () => {
  it('waits for the ready JSON-RPC envelope and ignores non-JSON stdout/stderr noise', async () => {
    const child = createMockChildProcess();
    const spawnProcess = vi.fn(() => child as any);

    const adapter = new CommandletAdapter({
      engineRoot: 'C:/Program Files/Epic Games/UE_5.7',
      projectPath: 'D:/Development/V2/CyberVolleyball6vs6.uproject',
      platform: 'win32',
      spawnProcess: spawnProcess as any,
      startupTimeoutMs: 500,
    });

    const initPromise = adapter.initialize();
    child.stdout.emit('data', Buffer.from('LogTemp: Display: booting commandlet\n'));
    child.stderr.emit('data', Buffer.from('LogTemp: Warning: warming up stderr\n'));

    let resolved = false;
    initPromise.then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(resolved).toBe(false);

    child.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","id":0,"result":{"ready":true}}\n'));
    await expect(initPromise).resolves.toBeUndefined();
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it('includes recent stdout/stderr log tail in request timeout errors', async () => {
    const child = createMockChildProcess();
    const spawnProcess = vi.fn(() => child as any);

    const adapter = new CommandletAdapter({
      engineRoot: 'C:/Program Files/Epic Games/UE_5.7',
      projectPath: 'D:/Development/V2/CyberVolleyball6vs6.uproject',
      platform: 'win32',
      spawnProcess: spawnProcess as any,
      startupTimeoutMs: 500,
      requestTimeoutMs: 30,
    });

    const initPromise = adapter.initialize();
    child.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","id":0,"result":{"ready":true}}\n'));
    await initPromise;

    child.stdout.emit('data', Buffer.from('LogBlueprint: Display: compiling widget blueprint\n'));
    child.stderr.emit('data', Buffer.from('LogSavePackage: Warning: package still dirty\n'));

    const executePromise = adapter.execute('BlueprintExtractor', 'CompileWidgetBlueprint', { AssetPath: '/Game/UI/WBP_Menu' });

    await expect(
      executePromise,
    ).rejects.toThrow(/Recent commandlet logs:/);
    await expect(
      executePromise,
    ).rejects.toThrow(/LogBlueprint: Display: compiling widget blueprint/);
    await expect(executePromise).rejects.toThrow(/LogSavePackage: Warning: package still dirty/);
  });

  it('restarts the commandlet process after an unexpected exit before the next execute call', async () => {
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(firstChild as any)
      .mockReturnValueOnce(secondChild as any);

    const adapter = new CommandletAdapter({
      engineRoot: 'C:/Program Files/Epic Games/UE_5.7',
      projectPath: 'D:/Development/V2/CyberVolleyball6vs6.uproject',
      platform: 'win32',
      spawnProcess: spawnProcess as any,
      startupTimeoutMs: 500,
      requestTimeoutMs: 200,
    });

    const firstInit = adapter.initialize();
    firstChild.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","id":0,"result":{"ready":true}}\n'));
    await firstInit;

    firstChild.emit('exit', 1);

    const executePromise = adapter.execute('BlueprintExtractor', 'ExtractBlueprint', { AssetPath: '/Game/BP_Test' });
    secondChild.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","id":0,"result":{"ready":true}}\n'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    secondChild.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"success":true,"from":"restarted-commandlet"}}\n'));

    await expect(executePromise).resolves.toEqual({ success: true, from: 'restarted-commandlet' });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
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

  it('honors per-call routing overrides inside dual-mode composite tools', async () => {
    const editorAdapter = createMockAdapter({ isAvailable: vi.fn().mockResolvedValue(false) });
    const cmdAdapter = createMockAdapter({
      isAvailable: vi.fn().mockResolvedValue(true),
      getMode: vi.fn().mockReturnValue('commandlet'),
      getCapabilities: vi.fn().mockReturnValue(COMMANDLET_CAPABILITIES),
      execute: vi.fn().mockResolvedValue({ success: true, from: 'commandlet' }),
    });
    const detector = new ExecutionModeDetector(editorAdapter, cmdAdapter);
    const executor = new AdaptiveExecutor(editorAdapter, cmdAdapter, detector);
    executor.setToolMode('execute_widget_recipe', 'both');
    executor.setToolMode('capture_widget_preview', 'editor_only');
    executor.setActiveToolName('execute_widget_recipe');

    await expect(
      executor.executeRouted(
        async () => ({ success: true, from: 'editor' }),
        'CaptureWidgetPreview',
        { AssetPath: '/Game/UI/WBP_Menu' },
        { routingToolName: 'capture_widget_preview' },
      ),
    ).rejects.toThrow(/requires the Unreal Editor/);

    expect(cmdAdapter.execute).not.toHaveBeenCalled();
    executor.setActiveToolName(null);
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

  it('marks the explicit headless-safe authoring matrix as both', () => {
    const bothModeTools = [
      'create_widget_blueprint',
      'replace_widget_tree',
      'replace_widget_class',
      'insert_widget_child',
      'remove_widget',
      'move_widget',
      'wrap_widget',
      'patch_widget',
      'patch_widget_class_defaults',
      'batch_widget_operations',
      'apply_widget_diff',
      'compile_widget',
      'create_blueprint',
      'modify_blueprint_members',
      'modify_blueprint_graphs',
      'scaffold_blueprint',
      'create_material',
      'modify_material',
      'material_graph_operation',
      'compile_material_asset',
      'create_material_instance',
      'modify_material_instance',
      'create_data_asset',
      'modify_data_asset',
      'create_data_table',
      'modify_data_table',
      'create_input_action',
      'modify_input_action',
      'create_input_mapping_context',
      'modify_input_mapping_context',
      'create_curve',
      'modify_curve',
      'create_curve_table',
      'modify_curve_table',
      'create_user_defined_struct',
      'modify_user_defined_struct',
      'create_user_defined_enum',
      'modify_user_defined_enum',
      'create_blackboard',
      'modify_blackboard',
      'create_behavior_tree',
      'modify_behavior_tree',
      'create_state_tree',
      'modify_state_tree',
      'create_anim_sequence',
      'modify_anim_sequence',
      'create_anim_montage',
      'modify_anim_montage',
      'create_blend_space',
      'modify_blend_space',
      'create_widget_animation',
      'modify_widget_animation',
      'create_menu_screen',
      'apply_widget_patch',
      'execute_widget_recipe',
      'create_material_setup',
      'save_assets',
      'create_commonui_button_style',
      'apply_commonui_button_style',
      'modify_commonui_button_style',
    ] as const;

    for (const toolName of bothModeTools) {
      expect(TOOL_MODE_ANNOTATIONS.get(toolName), `${toolName} should be dual-mode`).toBe('both');
    }
  });

  it('keeps editor-bound interactive workflows as editor_only', () => {
    const editorOnlyTools = [
      'read_output_log',
      'list_message_log_listings',
      'read_message_log',
      'get_editor_context',
      'start_statetree_debugger',
      'stop_statetree_debugger',
      'read_statetree_debugger',
      'restart_editor',
      'trigger_live_coding',
      'wait_for_editor',
      'start_pie',
      'stop_pie',
      'relaunch_pie',
      'import_assets',
      'capture_widget_preview',
      'capture_editor_screenshot',
      'capture_widget_motion_checkpoints',
      'compare_capture_to_reference',
      'compare_motion_capture_bundle',
      'cleanup_captures',
      'apply_window_ui_changes',
    ] as const;

    for (const toolName of editorOnlyTools) {
      expect(TOOL_MODE_ANNOTATIONS.get(toolName), `${toolName} should remain editor-only`).toBe('editor_only');
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

    // Spot-check: commandlet-safe authoring tools
    expect(executor.getToolMode('patch_widget')).toBe('both');
    expect(executor.getToolMode('create_widget_blueprint')).toBe('both');
    expect(executor.getToolMode('modify_blueprint_members')).toBe('both');

    // Spot-check: editor-only tools
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
