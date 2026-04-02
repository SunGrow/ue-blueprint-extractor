import type { ExecutionAdapter } from '../execution-adapter.js';
import { COMMANDLET_CAPABILITIES } from '../execution-adapter.js';
import { CommandletAdapter, type CommandletAdapterOptions } from './commandlet-adapter.js';

type ResolvedCommandletInputs = {
  engineRoot?: string;
  projectPath?: string;
};

type CommandletAdapterFactory = (options: CommandletAdapterOptions) => ExecutionAdapter;

export type LazyCommandletAdapterOptions = {
  resolveInputs: () => Promise<ResolvedCommandletInputs>;
  createAdapter?: CommandletAdapterFactory;
  platform?: NodeJS.Platform;
};

export class LazyCommandletAdapter implements ExecutionAdapter {
  private adapter: ExecutionAdapter | null = null;
  private adapterPromise: Promise<ExecutionAdapter> | null = null;
  private readonly resolveInputs: LazyCommandletAdapterOptions['resolveInputs'];
  private readonly createAdapter: CommandletAdapterFactory;
  private readonly platform: NodeJS.Platform | undefined;

  constructor(options: LazyCommandletAdapterOptions) {
    this.resolveInputs = options.resolveInputs;
    this.createAdapter = options.createAdapter ?? ((adapterOptions) => new CommandletAdapter(adapterOptions));
    this.platform = options.platform;
  }

  async execute(
    subsystem: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const adapter = await this.getOrCreateAdapter();
    return adapter.execute(subsystem, method, params);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const adapter = await this.getOrCreateAdapter();
      return await adapter.isAvailable();
    } catch {
      return false;
    }
  }

  getMode(): 'commandlet' {
    return 'commandlet';
  }

  getCapabilities() {
    return COMMANDLET_CAPABILITIES;
  }

  async shutdown(): Promise<void> {
    if (this.adapter && typeof this.adapter.shutdown === 'function') {
      await this.adapter.shutdown();
    }

    this.adapter = null;
    this.adapterPromise = null;
  }

  private async getOrCreateAdapter(): Promise<ExecutionAdapter> {
    if (this.adapter) {
      return this.adapter;
    }

    if (!this.adapterPromise) {
      this.adapterPromise = this.createAndInitializeAdapter();
    }

    try {
      const adapter = await this.adapterPromise;
      this.adapter = adapter;
      return adapter;
    } finally {
      this.adapterPromise = null;
    }
  }

  private async createAndInitializeAdapter(): Promise<ExecutionAdapter> {
    const resolved = await this.resolveInputs();
    if (!resolved.engineRoot || !resolved.projectPath) {
      throw new Error('Commandlet fallback requires both engineRoot and projectPath to be resolved.');
    }

    const adapter = this.createAdapter({
      engineRoot: resolved.engineRoot,
      projectPath: resolved.projectPath,
      ...(this.platform ? { platform: this.platform } : {}),
    });

    if (typeof adapter.initialize === 'function') {
      await adapter.initialize();
    }

    return adapter;
  }
}
