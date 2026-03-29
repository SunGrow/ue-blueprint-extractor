/**
 * EditorAdapter wraps the existing UEClient with the ExecutionAdapter interface.
 * This is a thin wrapper — all existing behavior is preserved.
 */

import type { ExecutionAdapter, ToolCapability } from '../execution-adapter.js';
import { ALL_CAPABILITIES } from '../execution-adapter.js';

type EditorClientLike = {
  callSubsystem(method: string, params: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<string>;
  checkConnection?(): Promise<boolean>;
  editorModeAvailable?(): Promise<boolean>;
};

export class EditorAdapter implements ExecutionAdapter {
  private client: EditorClientLike;

  constructor(client: EditorClientLike) {
    this.client = client;
  }

  async execute(
    _subsystem: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const rawResult = await this.client.callSubsystem(method, params);
    return JSON.parse(rawResult) as Record<string, unknown>;
  }

  async isAvailable(): Promise<boolean> {
    if (typeof this.client.editorModeAvailable === 'function') {
      return this.client.editorModeAvailable();
    }
    if (typeof this.client.checkConnection === 'function') {
      return this.client.checkConnection();
    }
    return false;
  }

  getMode(): 'editor' {
    return 'editor';
  }

  getCapabilities(): ReadonlySet<ToolCapability> {
    return ALL_CAPABILITIES;
  }
}
