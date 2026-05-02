/**
 * AdaptiveExecutor routes tool calls to the best available adapter.
 * Falls back from editor to commandlet for compatible operations.
 */

import type { ExecutionAdapter, ToolCapability, ExecutionMode } from './execution-adapter.js';
import { ExecutionModeDetector } from './execution-mode-detector.js';

export type ToolModeAnnotation = 'both' | 'editor_only' | 'read_only';
export type ExecutionLane = 'editor' | 'commandlet';

const EDITOR_FALLBACK_ERROR_FRAGMENTS = [
  'UE Editor not running or Remote Control not available',
  'BlueprintExtractor subsystem not found',
  'No active editor is selected for this MCP session',
  'Multiple running editors match the workspace project',
  'Active editor mismatch',
  'previously selected active editor',
  'The selected active editor is currently unavailable on its registered Remote Control endpoint.',
] as const;

const COMMANDLET_LOCK_ERROR_FRAGMENTS = [
  'locked by another process',
  'locked file',
  'cannot access the file',
  'asset lock conflict',
  'save_failed',
  'Failed to save one or more packages',
] as const;

const EDITOR_PREFERRED_WHILE_RUNNING_TOOLS = new Set([
  'save_assets',
]);

export type EditorFallbackCaller = (
  method: string,
  params: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<Record<string, unknown>>;

type RoutedSubsystemCallOptions = {
  timeoutMs?: number;
  routingToolName?: string;
};

export class AdaptiveExecutor {
  private editorAdapter: ExecutionAdapter;
  private commandletAdapter: ExecutionAdapter | null;
  private detector: ExecutionModeDetector;
  private toolModes = new Map<string, ToolModeAnnotation>();
  /**
   * Active tool name set by the tool registration wrapper before a handler runs.
   * ASSUMPTION: The MCP SDK processes tool calls sequentially per transport
   * connection (single Node.js event loop, SDK awaits each handler). If the SDK
   * ever supports concurrent tool execution, this shared state must be replaced
   * with per-request context (e.g., AsyncLocalStorage or passing toolName as a
   * parameter to executeRouted).
   */
  private _activeToolName: string | null = null;
  private _activeToolExecutionMetadata: {
    mode?: ExecutionLane;
    supportedModes: ExecutionLane[];
    fallbackUsed?: boolean;
  } | null = null;

  constructor(
    editorAdapter: ExecutionAdapter,
    commandletAdapter: ExecutionAdapter | null,
    detector: ExecutionModeDetector,
  ) {
    this.editorAdapter = editorAdapter;
    this.commandletAdapter = commandletAdapter;
    this.detector = detector;
  }

  setToolMode(toolName: string, mode: ToolModeAnnotation): void {
    this.toolModes.set(toolName, mode);
  }

  getToolMode(toolName: string): ToolModeAnnotation {
    return this.toolModes.get(toolName) ?? 'editor_only';
  }

  getSupportedExecutionModes(toolName: string): ExecutionLane[] {
    return this.getToolMode(toolName) === 'editor_only'
      ? ['editor']
      : ['editor', 'commandlet'];
  }

  getCurrentMode(): Promise<ExecutionMode> {
    return this.detector.detect().then((r) => r.mode);
  }

  /** Set the active tool name before a handler runs. Cleared after handler completes. */
  setActiveToolName(name: string | null): void {
    this._activeToolName = name;
    this._activeToolExecutionMetadata = name
      ? { supportedModes: this.getSupportedExecutionModes(name) }
      : null;
  }

  getActiveToolName(): string | null {
    return this._activeToolName;
  }

  getActiveToolExecutionMetadata(): {
    runtime_mode?: ExecutionLane;
    supported_modes: ExecutionLane[];
    fallback_used?: boolean;
  } | null {
    if (!this._activeToolExecutionMetadata) {
      return null;
    }

    return {
      runtime_mode: this._activeToolExecutionMetadata.mode,
      supported_modes: [...this._activeToolExecutionMetadata.supportedModes],
      ...(typeof this._activeToolExecutionMetadata.fallbackUsed === 'boolean'
        ? { fallback_used: this._activeToolExecutionMetadata.fallbackUsed }
        : {}),
    };
  }

  private recordToolExecution(toolName: string, mode: ExecutionLane, fallbackUsed: boolean): void {
    if (this._activeToolName !== toolName) {
      return;
    }

    const current = this._activeToolExecutionMetadata ?? {
      supportedModes: this.getSupportedExecutionModes(toolName),
    };
    current.mode = mode;
    current.fallbackUsed = current.fallbackUsed === true ? true : fallbackUsed;
    this._activeToolExecutionMetadata = current;
  }

  /**
   * Route a callSubsystemJson-shaped call through the executor.
   * For editor mode, delegates to the provided editorFallback (the original
   * callSubsystemJson with its error-checking layer intact).
   * For commandlet mode, routes through the commandlet adapter.
   * This allows transparent interception without changing tool call sites.
   */
  async executeRouted(
    editorFallback: EditorFallbackCaller,
    method: string,
    params: Record<string, unknown>,
    options?: RoutedSubsystemCallOptions,
  ): Promise<Record<string, unknown>> {
    const activeToolName = this._activeToolName;
    const { routingToolName, ...transportOptions } = options ?? {};
    const toolName = routingToolName ?? activeToolName;
    const detection = await this.detector.detect();

    if (!toolName) {
      return editorFallback(method, params, Object.keys(transportOptions).length > 0 ? transportOptions : undefined);
    }

    const recordExecution = (mode: ExecutionLane, fallbackUsed: boolean): void => {
      if (activeToolName) {
        this.recordToolExecution(activeToolName, mode, fallbackUsed);
      }
    };

    const toolMode = this.getToolMode(toolName);
    const requiredCapability: ToolCapability = toolMode === 'read_only'
      ? 'read'
      : toolMode === 'both'
        ? 'write_simple'
        : 'write_complex';

    const tryCommandletFallback = async (
      error: unknown,
    ): Promise<Record<string, unknown>> => {
      if (!toolName || !this.commandletAdapter || !shouldFallbackToCommandlet(error)) {
        throw error;
      }

      const commandletCapabilities = this.commandletAdapter.getCapabilities();
      if (!commandletCapabilities.has(requiredCapability) && requiredCapability !== 'write_simple') {
        throw error;
      }

      const available = await this.commandletAdapter.isAvailable();
      if (!available) {
        throw error;
      }

      this.detector.invalidateCache();
      try {
        const result = await this.commandletAdapter.execute('BlueprintExtractor', method, params);
        recordExecution('commandlet', true);
        return result;
      } catch (fallbackError) {
        recordExecution('commandlet', true);
        throw fallbackError;
      }
    };

    // Editor mode keeps the existing direct path, with commandlet fallback for
    // compatible tools when the editor call fails.
    if (detection.mode === 'editor') {
      try {
        const result = await editorFallback(
          method,
          params,
          Object.keys(transportOptions).length > 0 ? transportOptions : undefined,
        );
        recordExecution('editor', false);
        return result;
      } catch (error) {
        recordExecution('editor', false);
        if (toolMode === 'editor_only') {
          throw error;
        }
        return tryCommandletFallback(error);
      }
    }

    // Try commandlet for compatible tools
    if (detection.mode === 'commandlet' && this.commandletAdapter) {
      if (toolMode === 'editor_only') {
        throw new ExecutorError(
          'CAPABILITY_MISMATCH',
          `Tool '${toolName}' requires the Unreal Editor but only commandlet mode is available. ${detection.reason}`,
          toolName,
          detection.mode,
          requiredCapability,
        );
      }

      const capabilities = this.commandletAdapter.getCapabilities();
      if (!capabilities.has(requiredCapability) && requiredCapability !== 'write_simple') {
        throw new ExecutorError(
          'CAPABILITY_MISMATCH',
          `Tool '${toolName}' requires '${requiredCapability}' capability which commandlet mode does not support.`,
          toolName,
          detection.mode,
          requiredCapability,
        );
      }

      if (shouldPreferEditorWhileRunning(toolName)) {
        try {
          const editorAvailable = await this.editorAdapter.isAvailable();
          if (editorAvailable) {
            this.detector.invalidateCache();
            const result = await editorFallback(
              method,
              params,
              Object.keys(transportOptions).length > 0 ? transportOptions : undefined,
            );
            recordExecution('editor', true);
            return result;
          }
        } catch {
          // Fall back to the commandlet path below.
        }
      }

      try {
        const result = await this.commandletAdapter.execute('BlueprintExtractor', method, params);
        recordExecution('commandlet', false);
        return result;
      } catch (error) {
        recordExecution('commandlet', false);
        if (toolMode !== 'read_only' && shouldFallbackToEditorOnLock(error)) {
          try {
            const editorAvailable = await this.editorAdapter.isAvailable();
            if (editorAvailable) {
              this.detector.invalidateCache();
              const result = await editorFallback(
                method,
                params,
                Object.keys(transportOptions).length > 0 ? transportOptions : undefined,
              );
              recordExecution('editor', true);
              return result;
            }
          } catch {
            // If the editor is not actually reachable, preserve the commandlet error.
          }
        }

        throw error;
      }
    }

    // No adapter available
    throw new ExecutorError(
      'MODE_UNAVAILABLE',
      `No execution mode available for tool '${toolName}'. ${detection.reason}`,
      toolName,
      detection.mode,
      requiredCapability,
    );
  }

  async execute(
    toolName: string,
    subsystem: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const detection = await this.detector.detect();
    const toolMode = this.getToolMode(toolName);

    // Determine required capability from tool mode
    const requiredCapability: ToolCapability = toolMode === 'read_only'
      ? 'read'
      : toolMode === 'both'
        ? 'write_simple'
        : 'write_complex';

    if (detection.mode === 'editor') {
      try {
        const result = await this.editorAdapter.execute(subsystem, method, params);
        this.recordToolExecution(toolName, 'editor', false);
        return result;
      } catch (error) {
        this.recordToolExecution(toolName, 'editor', false);
        throw error;
      }
    }

    // Try commandlet for compatible tools
    if (detection.mode === 'commandlet' && this.commandletAdapter) {
      if (toolMode === 'editor_only') {
        throw new ExecutorError(
          'CAPABILITY_MISMATCH',
          `Tool '${toolName}' requires the Unreal Editor but only commandlet mode is available. ${detection.reason}`,
          toolName,
          detection.mode,
          requiredCapability,
        );
      }

      const capabilities = this.commandletAdapter.getCapabilities();
      if (!capabilities.has(requiredCapability) && requiredCapability !== 'write_simple') {
        throw new ExecutorError(
          'CAPABILITY_MISMATCH',
          `Tool '${toolName}' requires '${requiredCapability}' capability which commandlet mode does not support.`,
          toolName,
          detection.mode,
          requiredCapability,
        );
      }

      if (shouldPreferEditorWhileRunning(toolName)) {
        try {
          const editorAvailable = await this.editorAdapter.isAvailable();
          if (editorAvailable) {
            this.detector.invalidateCache();
            const result = await this.editorAdapter.execute(subsystem, method, params);
            this.recordToolExecution(toolName, 'editor', true);
            return result;
          }
        } catch {
          // Keep the commandlet path below.
        }
      }

      try {
        const result = await this.commandletAdapter.execute(subsystem, method, params);
        this.recordToolExecution(toolName, 'commandlet', false);
        return result;
      } catch (error) {
        this.recordToolExecution(toolName, 'commandlet', false);
        if (toolMode !== 'read_only' && shouldFallbackToEditorOnLock(error)) {
          try {
            const editorAvailable = await this.editorAdapter.isAvailable();
            if (editorAvailable) {
              this.detector.invalidateCache();
              const result = await this.editorAdapter.execute(subsystem, method, params);
              this.recordToolExecution(toolName, 'editor', true);
              return result;
            }
          } catch {
            // Preserve the original commandlet failure below.
          }
        }

        throw error;
      }
    }

    // No adapter available
    throw new ExecutorError(
      'MODE_UNAVAILABLE',
      `No execution mode available for tool '${toolName}'. ${detection.reason}`,
      toolName,
      detection.mode,
      requiredCapability,
    );
  }
}

function shouldFallbackToCommandlet(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('Failed to call ')) {
    return true;
  }

  return EDITOR_FALLBACK_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment));
}

function shouldFallbackToEditorOnLock(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return COMMANDLET_LOCK_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment));
}

function shouldPreferEditorWhileRunning(toolName: string): boolean {
  return EDITOR_PREFERRED_WHILE_RUNNING_TOOLS.has(toolName);
}

export class ExecutorError extends Error {
  code: string;
  toolName: string;
  currentMode: ExecutionMode;
  requiredCapability: ToolCapability;

  constructor(
    code: string,
    message: string,
    toolName: string,
    currentMode: ExecutionMode,
    requiredCapability: ToolCapability,
  ) {
    super(message);
    this.name = 'ExecutorError';
    this.code = code;
    this.toolName = toolName;
    this.currentMode = currentMode;
    this.requiredCapability = requiredCapability;
  }
}
