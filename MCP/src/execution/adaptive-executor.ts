/**
 * AdaptiveExecutor routes tool calls to the best available adapter.
 * Falls back from editor to commandlet for compatible operations.
 */

import type { ExecutionAdapter, ToolCapability, ExecutionMode } from './execution-adapter.js';
import { ExecutionModeDetector } from './execution-mode-detector.js';

export type ToolModeAnnotation = 'both' | 'editor_only' | 'read_only';

export class AdaptiveExecutor {
  private editorAdapter: ExecutionAdapter;
  private commandletAdapter: ExecutionAdapter | null;
  private detector: ExecutionModeDetector;
  private toolModes = new Map<string, ToolModeAnnotation>();

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

  getCurrentMode(): Promise<ExecutionMode> {
    return this.detector.detect().then((r) => r.mode);
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

    // Try editor first
    if (detection.mode === 'editor') {
      return this.editorAdapter.execute(subsystem, method, params);
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

      return this.commandletAdapter.execute(subsystem, method, params);
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
