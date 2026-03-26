/**
 * Detects the available execution mode by checking editor and commandlet availability.
 * Caches the result for 5 seconds to avoid repeated probes.
 */

import type { ExecutionAdapter, ModeDetectionResult, ExecutionMode } from './execution-adapter.js';

const CACHE_TTL_MS = 5_000;

export class ExecutionModeDetector {
  private editorAdapter: ExecutionAdapter;
  private commandletAdapter: ExecutionAdapter | null;
  private cachedResult: ModeDetectionResult | null = null;
  private cachedAt = 0;
  private now: () => number;

  constructor(
    editorAdapter: ExecutionAdapter,
    commandletAdapter: ExecutionAdapter | null = null,
    now: () => number = Date.now,
  ) {
    this.editorAdapter = editorAdapter;
    this.commandletAdapter = commandletAdapter;
    this.now = now;
  }

  async detect(): Promise<ModeDetectionResult> {
    const currentTime = this.now();
    if (this.cachedResult && (currentTime - this.cachedAt) < CACHE_TTL_MS) {
      return this.cachedResult;
    }

    // Check editor first (preferred)
    try {
      const editorAvailable = await this.editorAdapter.isAvailable();
      if (editorAvailable) {
        return this.cache({ mode: 'editor', reason: 'Editor Remote Control API is available' });
      }
    } catch {
      // Editor not available
    }

    // Check commandlet fallback
    if (this.commandletAdapter) {
      try {
        const cmdAvailable = await this.commandletAdapter.isAvailable();
        if (cmdAvailable) {
          return this.cache({ mode: 'commandlet', reason: 'Commandlet process is running (editor unavailable)' });
        }
      } catch {
        // Commandlet not available
      }
    }

    return this.cache({ mode: 'unavailable', reason: 'Neither editor nor commandlet is available' });
  }

  invalidateCache(): void {
    this.cachedResult = null;
    this.cachedAt = 0;
  }

  private cache(result: ModeDetectionResult): ModeDetectionResult {
    this.cachedResult = result;
    this.cachedAt = this.now();
    return result;
  }
}
