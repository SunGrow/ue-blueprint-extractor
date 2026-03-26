/**
 * CommandletAdapter spawns UnrealEditor-Cmd.exe with -run=blueprintextractor
 * and communicates via stdin/stdout JSON-RPC.
 */

import { spawn, type ChildProcess } from 'child_process';
import type { ExecutionAdapter, ToolCapability } from '../execution-adapter.js';
import { COMMANDLET_CAPABILITIES } from '../execution-adapter.js';

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;

export interface CommandletAdapterOptions {
  engineRoot: string;
  projectPath: string;
}

export class CommandletAdapter implements ExecutionAdapter {
  private options: CommandletAdapterOptions;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private buffer = '';

  constructor(options: CommandletAdapterOptions) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    if (this.process) return;

    const editorCmd = `${this.options.engineRoot}/Binaries/Win64/UnrealEditor-Cmd.exe`;
    this.process = spawn(editorCmd, [
      this.options.projectPath,
      '-run=blueprintextractor',
      '-stdin',
      '-unattended',
      '-nosplash',
      '-nullrhi',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.on('exit', () => {
      this.process = null;
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Commandlet process exited'));
      }
      this.pendingRequests.clear();
    });

    // Wait for startup
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Commandlet startup timed out after ${STARTUP_TIMEOUT_MS}ms`));
      }, STARTUP_TIMEOUT_MS);

      const onData = () => {
        clearTimeout(timer);
        this.process?.stdout?.off('data', onData);
        resolve();
      };

      // Resolve on first stdout output (indicating process is ready)
      this.process?.stdout?.on('data', onData);

      this.process?.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async execute(
    _subsystem: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.process?.stdin) {
      throw new Error('Commandlet process not running. Call initialize() first.');
    }

    const id = ++this.requestId;
    const request = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Commandlet request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.process!.stdin!.write(request + '\n');
    });
  }

  async isAvailable(): Promise<boolean> {
    return this.process !== null && !this.process.killed;
  }

  getMode(): 'commandlet' {
    return 'commandlet';
  }

  getCapabilities(): ReadonlySet<ToolCapability> {
    return COMMANDLET_CAPABILITIES;
  }

  async shutdown(): Promise<void> {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: unknown };
        if (response.id != null && this.pendingRequests.has(response.id)) {
          const pending = this.pendingRequests.get(response.id)!;
          this.pendingRequests.delete(response.id);
          clearTimeout(pending.timer);

          if (response.error) {
            pending.reject(new Error(
              typeof response.error === 'string'
                ? response.error
                : JSON.stringify(response.error),
            ));
          } else {
            pending.resolve(
              (typeof response.result === 'object' && response.result !== null)
                ? response.result as Record<string, unknown>
                : { result: response.result },
            );
          }
        }
      } catch {
        // Non-JSON output — skip (may be engine log lines)
      }
    }
  }
}
