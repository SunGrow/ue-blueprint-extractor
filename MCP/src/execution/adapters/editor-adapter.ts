/**
 * EditorAdapter wraps the existing UEClient with the ExecutionAdapter interface.
 * This is a thin wrapper — all existing behavior is preserved.
 */

import type { UEClient } from '../../ue-client.js';
import type { ExecutionAdapter, ToolCapability } from '../execution-adapter.js';
import { ALL_CAPABILITIES } from '../execution-adapter.js';

export class EditorAdapter implements ExecutionAdapter {
  private client: UEClient;

  constructor(client: UEClient) {
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
    return this.client.checkConnection();
  }

  getMode(): 'editor' {
    return 'editor';
  }

  getCapabilities(): ReadonlySet<ToolCapability> {
    return ALL_CAPABILITIES;
  }
}
