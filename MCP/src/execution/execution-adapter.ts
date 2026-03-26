/**
 * Core execution adapter interface for dual-mode architecture.
 * Adapters abstract the underlying execution mechanism (editor or commandlet).
 */

export type ExecutionMode = 'editor' | 'commandlet' | 'unavailable';

export type ToolCapability = 'read' | 'write_simple' | 'write_complex' | 'interactive';

export interface ExecutionAdapter {
  /** Execute a subsystem method with parameters */
  execute(
    subsystem: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /** Check if this adapter is currently available */
  isAvailable(): Promise<boolean>;

  /** Get the execution mode this adapter provides */
  getMode(): ExecutionMode;

  /** Get the capabilities this adapter supports */
  getCapabilities(): ReadonlySet<ToolCapability>;

  /** Optional initialization */
  initialize?(): Promise<void>;

  /** Optional shutdown */
  shutdown?(): Promise<void>;
}

export interface ModeDetectionResult {
  mode: ExecutionMode;
  reason: string;
}

export const ALL_CAPABILITIES: ReadonlySet<ToolCapability> = new Set([
  'read', 'write_simple', 'write_complex', 'interactive',
]);

export const COMMANDLET_CAPABILITIES: ReadonlySet<ToolCapability> = new Set([
  'read', 'write_simple',
]);
