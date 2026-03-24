import { RemoteCallRequest, RemoteCallResponse } from './types.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 30010;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_CONNECTION_CACHE_TTL_MS = 2_000;
const TIMEOUT_MS = 60_000;
const SUBSYSTEM_PATH_ENV = 'UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH';

export const DEFAULT_SUBSYSTEM_CANDIDATE_PATHS = [
  '/Script/BlueprintExtractor.Default__BlueprintExtractorSubsystem',
  '/Engine/Transient.BlueprintExtractorSubsystem',
  '/Engine/Transient.BlueprintExtractorSubsystem_0',
] as const;

type FetchLike = typeof fetch;
type SubsystemPathSource = 'explicit' | 'discovered';

interface RawCallResult {
  response: RemoteCallResponse | null;
  status?: number;
  error?: string;
  timedOut?: boolean;
}

export interface UEClientOptions {
  host?: string;
  port?: number;
  subsystemPath?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  connectionTimeoutMs?: number;
  connectionCacheTtlMs?: number;
  candidatePaths?: readonly string[];
  now?: () => number;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class UEClient {
  private host: string;
  private port: number;
  private fetchImpl: FetchLike;
  private timeoutMs: number;
  private connectionTimeoutMs: number;
  private connectionCacheTtlMs: number;
  private candidatePaths: readonly string[];
  private now: () => number;
  private subsystemPath: string | null = null;
  private subsystemPathSource: SubsystemPathSource | null = null;
  private lastConnectionStatus: boolean | null = null;
  private lastConnectionCheckAt = 0;
  private pendingConnectionCheck: Promise<boolean> | null = null;

  constructor(options: UEClientOptions = {}) {
    this.host = options.host ?? process.env.UE_REMOTE_CONTROL_HOST ?? DEFAULT_HOST;
    this.port = options.port ?? parsePort(process.env.UE_REMOTE_CONTROL_PORT, DEFAULT_PORT);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
    this.connectionCacheTtlMs = options.connectionCacheTtlMs ?? DEFAULT_CONNECTION_CACHE_TTL_MS;
    this.candidatePaths = options.candidatePaths ?? DEFAULT_SUBSYSTEM_CANDIDATE_PATHS;
    this.now = options.now ?? Date.now;
    this.subsystemPath = options.subsystemPath ?? process.env[SUBSYSTEM_PATH_ENV] ?? null;
    this.subsystemPathSource = this.subsystemPath ? 'explicit' : null;
  }

  private get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  private cacheConnectionStatus(status: boolean) {
    this.lastConnectionStatus = status;
    this.lastConnectionCheckAt = this.now();
  }

  private invalidateConnectionStatus() {
    this.lastConnectionStatus = null;
    this.lastConnectionCheckAt = 0;
  }

  private async performConnectionCheck(): Promise<boolean> {
    // GET /remote/info — if it responds, UE is running with Remote Control
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.connectionTimeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/remote/info`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async checkConnection(): Promise<boolean> {
    const now = this.now();
    if (this.lastConnectionStatus !== null && now - this.lastConnectionCheckAt < this.connectionCacheTtlMs) {
      return this.lastConnectionStatus;
    }

    if (this.pendingConnectionCheck) {
      return this.pendingConnectionCheck;
    }

    const probe = this.performConnectionCheck()
      .then((status) => {
        this.cacheConnectionStatus(status);
        return status;
      })
      .finally(() => {
        this.pendingConnectionCheck = null;
      });

    this.pendingConnectionCheck = probe;
    return probe;
  }

  async discoverSubsystem(): Promise<string> {
    if (this.subsystemPath) return this.subsystemPath;

    // Use /remote/object/call to find the subsystem via GEditor
    // EditorSubsystems are singletons accessible via GEditor->GetEditorSubsystem<T>()
    // The object path for editor subsystems follows the pattern: /Engine/Transient.UnrealEditorSubsystem_0
    // We try to call a method directly — if it works, the path is valid

    // For UEditorSubsystem, the default object path is:
    // /Engine/Transient.BlueprintExtractorSubsystem
    // But the exact path depends on the engine. Let's try the standard pattern.

    for (const path of this.candidatePaths) {
      try {
        // Try calling ListAssets as a health check
        const res = await this.rawCall(path, 'ListAssets', { PackagePath: '/Game', bRecursive: false, ClassFilter: '' });
        if (res.response !== null) {
          this.subsystemPath = path;
          this.subsystemPathSource = 'discovered';
          return path;
        }
      } catch {
        // Try next candidate
      }
    }

    throw new Error(
      `BlueprintExtractor subsystem not found. Ensure the plugin is loaded in the editor or set ${SUBSYSTEM_PATH_ENV}.`,
    );
  }

  private clearDiscoveredSubsystemPath() {
    if (this.subsystemPathSource === 'discovered') {
      this.subsystemPath = null;
      this.subsystemPathSource = null;
    }
  }

  private formatCallFailure(method: string, objectPath: string, result: RawCallResult): string {
    const details: string[] = [
      `${this.host}:${this.port}`,
      `objectPath=${objectPath}`,
    ];
    if (typeof result.status === 'number') {
      details.push(`status=${result.status}`);
    }
    if (result.error) {
      details.push(`detail=${result.error}`);
    }
    if (result.timedOut) {
      details.push(`timeoutMs=${this.timeoutMs}`);
    }

    return `Failed to call ${method} on BlueprintExtractorSubsystem (${details.join(', ')})`;
  }

  private async rawCall(objectPath: string, functionName: string, parameters: Record<string, unknown>): Promise<RawCallResult> {
    const body: RemoteCallRequest = {
      objectPath,
      functionName,
      parameters,
      generateTransaction: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/remote/object/call`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        let errorDetail = res.statusText || `HTTP ${res.status}`;
        try {
          const responseText = await res.text();
          if (responseText.trim().length > 0) {
            errorDetail = responseText;
          }
        } catch {
          // Keep the HTTP status text when the body cannot be read.
        }

        return {
          response: null,
          status: res.status,
          error: errorDetail,
        };
      }

      return {
        response: await res.json() as RemoteCallResponse,
      };
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          response: null,
          error: `Request timed out after ${this.timeoutMs}ms`,
          timedOut: true,
        };
      }

      return {
        response: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async callSubsystem(method: string, params: Record<string, unknown>): Promise<string> {
    const connected = await this.checkConnection();
    if (!connected) {
      throw new Error(`UE Editor not running or Remote Control not available on ${this.host}:${this.port}`);
    }

    let objectPath = await this.discoverSubsystem();
    let res = await this.rawCall(objectPath, method, params);

    if (res.response === null && this.subsystemPathSource === 'discovered') {
      this.clearDiscoveredSubsystemPath();
      objectPath = await this.discoverSubsystem();
      res = await this.rawCall(objectPath, method, params);
    }

    if (res.response === null) {
      this.invalidateConnectionStatus();
      throw new Error(this.formatCallFailure(method, objectPath, res));
    }

    // The subsystem methods return FString, which comes back as ReturnValue
    const returnValue = res.response.ReturnValue ?? JSON.stringify(res.response);
    return typeof returnValue === 'string' ? returnValue : JSON.stringify(returnValue);
  }
}
