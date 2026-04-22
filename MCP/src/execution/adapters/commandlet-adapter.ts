/**
 * CommandletAdapter spawns the platform-appropriate UnrealEditor-Cmd binary with -run=blueprintextractor
 * and communicates via stdin/stdout JSON-RPC.
 */

import { spawn, type ChildProcess } from 'child_process';
import type { ExecutionAdapter, ToolCapability } from '../execution-adapter.js';
import { COMMANDLET_CAPABILITIES } from '../execution-adapter.js';
import { resolveEditorExecutable } from '../../project-controller.js';

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;

export interface CommandletAdapterOptions {
  engineRoot: string;
  projectPath: string;
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export class CommandletAdapter implements ExecutionAdapter {
  private static readonly MAX_LOG_TAIL_LINES = 100;
  private options: CommandletAdapterOptions;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
  }>();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private recentLogs: string[] = [];
  private startupPromise: Promise<void> | null = null;
  private startupState: {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly spawnProcess: typeof spawn;
  private readonly platform: NodeJS.Platform;
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: CommandletAdapterOptions) {
    this.options = options;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.platform = options.platform ?? process.platform;
    this.startupTimeoutMs = options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async initialize(): Promise<void> {
    if (this.process && !this.process.killed) {
      if (this.startupPromise) {
        await this.startupPromise;
      }
      return;
    }

    if (this.startupPromise) {
      await this.startupPromise;
      return;
    }

    this.startupPromise = this.spawnAndWaitForReady();
    try {
      await this.startupPromise;
    } finally {
      this.startupPromise = null;
    }
  }

  async execute(
    _subsystem: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.process?.stdin || this.process.killed) {
      await this.initialize();
    }

    if (!this.process?.stdin || this.process.killed) {
      throw new Error(this.withRecentLogs('Commandlet process not running. Call initialize() first.'));
    }

    const id = ++this.requestId;
    const request = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(this.withRecentLogs(`Commandlet request timed out after ${this.requestTimeoutMs}ms`)));
      }, this.requestTimeoutMs);

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
    if (!this.process) {
      return;
    }

    this.process.stdin?.end();
    this.process.kill();
    this.process = null;
  }

  private async spawnAndWaitForReady(): Promise<void> {
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.recentLogs = [];
    const editorCmd = await resolveEditorExecutable(this.options.engineRoot, this.platform, 'commandlet');
    const startupWaiter = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(this.withRecentLogs(`Commandlet startup timed out after ${this.startupTimeoutMs}ms`)));
      }, this.startupTimeoutMs);
      this.startupState = { resolve, reject, timer };
    });

    try {
      this.process = this.spawnProcess(editorCmd, [
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
        this.stdoutBuffer += data.toString();
        this.processStdoutBuffer();
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        this.stderrBuffer += data.toString();
        this.processStderrBuffer();
      });

      this.process.on('exit', (code, signal) => {
        const suffix = code != null
          ? ` with code ${code}`
          : signal
            ? ` with signal ${signal}`
            : '';
        this.handleProcessTermination(`Commandlet process exited${suffix}`);
      });

      this.process.on('error', (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.handleProcessTermination(`Commandlet process error: ${message}`);
      });
    } catch (error) {
      const startupError = error instanceof Error ? error : new Error(String(error));
      this.rejectStartup(startupError);
      throw startupError;
    }

    await startupWaiter;
  }

  private processStdoutBuffer(): void {
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed) as {
          jsonrpc?: string;
          id?: number;
          result?: unknown;
          error?: unknown;
        };

        if (
          response.jsonrpc === '2.0'
          && response.id === 0
          && typeof response.result === 'object'
          && response.result !== null
          && (response.result as Record<string, unknown>).ready === true
        ) {
          this.resolveStartup();
          continue;
        }

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
          continue;
        }
      } catch {
        this.appendLogLine(trimmed);
      }
    }
  }

  private processStderrBuffer(): void {
    const lines = this.stderrBuffer.split('\n');
    this.stderrBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      this.appendLogLine(trimmed);
    }
  }

  private appendLogLine(line: string): void {
    this.recentLogs.push(line);
    if (this.recentLogs.length > CommandletAdapter.MAX_LOG_TAIL_LINES) {
      this.recentLogs.splice(0, this.recentLogs.length - CommandletAdapter.MAX_LOG_TAIL_LINES);
    }
  }

  private withRecentLogs(message: string): string {
    if (this.recentLogs.length === 0) {
      return message;
    }
    return `${message}\nRecent commandlet logs:\n${this.recentLogs.join('\n')}`;
  }

  private resolveStartup(): void {
    if (!this.startupState) {
      return;
    }
    clearTimeout(this.startupState.timer);
    this.startupState.resolve();
    this.startupState = null;
  }

  private rejectStartup(error: Error): void {
    if (!this.startupState) {
      return;
    }
    clearTimeout(this.startupState.timer);
    this.startupState.reject(error);
    this.startupState = null;
  }

  private handleProcessTermination(baseMessage: string): void {
    const error = new Error(this.withRecentLogs(baseMessage));
    this.rejectStartup(error);
    this.process = null;

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
