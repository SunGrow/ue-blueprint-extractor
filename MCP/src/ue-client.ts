import { RemoteCallRequest, RemoteCallResponse } from './types.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 30010;
const TIMEOUT_MS = 60_000;

export class UEClient {
  private host: string;
  private port: number;
  private subsystemPath: string | null = null;

  constructor() {
    this.host = process.env.UE_REMOTE_CONTROL_HOST ?? DEFAULT_HOST;
    this.port = parseInt(process.env.UE_REMOTE_CONTROL_PORT ?? String(DEFAULT_PORT), 10);
  }

  private get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  async checkConnection(): Promise<boolean> {
    // GET /remote/info — if it responds, UE is running with Remote Control
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/remote/info`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
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

    const candidatePaths = [
      '/Script/BlueprintExtractor.Default__BlueprintExtractorSubsystem',
      '/Engine/Transient.BlueprintExtractorSubsystem',
      '/Engine/Transient.BlueprintExtractorSubsystem_0',
    ];

    for (const path of candidatePaths) {
      try {
        // Try calling ListAssets as a health check
        const res = await this.rawCall(path, 'ListAssets', { PackagePath: '/Game', bRecursive: false, ClassFilter: '' });
        if (res !== null) {
          this.subsystemPath = path;
          return path;
        }
      } catch {
        // Try next candidate
      }
    }

    throw new Error('BlueprintExtractor subsystem not found. Ensure the plugin is loaded in the editor.');
  }

  private async rawCall(objectPath: string, functionName: string, parameters: Record<string, unknown>): Promise<RemoteCallResponse | null> {
    const body: RemoteCallRequest = {
      objectPath,
      functionName,
      parameters,
      generateTransaction: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl}/remote/object/call`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return null;
      return await res.json() as RemoteCallResponse;
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  async callSubsystem(method: string, params: Record<string, unknown>): Promise<string> {
    const connected = await this.checkConnection();
    if (!connected) {
      throw new Error(`UE Editor not running or Remote Control not available on ${this.host}:${this.port}`);
    }

    const objectPath = await this.discoverSubsystem();
    const res = await this.rawCall(objectPath, method, params);

    if (res === null) {
      throw new Error(`Failed to call ${method} on BlueprintExtractorSubsystem`);
    }

    // The subsystem methods return FString, which comes back as ReturnValue
    const returnValue = res.ReturnValue ?? JSON.stringify(res);
    return typeof returnValue === 'string' ? returnValue : JSON.stringify(returnValue);
  }
}
