import { spawn } from 'node:child_process';
import { access, readdir, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type BuildPlatform = 'Win64' | 'Mac' | 'Linux';
export type BuildConfiguration = 'Debug' | 'DebugGame' | 'Development' | 'Shipping' | 'Test';
export type SyncStrategy = 'live_coding' | 'build_and_restart';

const DEFAULT_BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_DISCONNECT_TIMEOUT_MS = 60 * 1000;
const DEFAULT_RECONNECT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export interface CompileProjectCodeRequest {
  engineRoot?: string;
  projectPath?: string;
  target?: string;
  platform?: BuildPlatform;
  configuration?: BuildConfiguration;
  buildTimeoutMs?: number;
  includeOutput?: boolean;
  clearUhtCache?: boolean;
}

export interface SyncProjectCodeRequest extends CompileProjectCodeRequest {
  changedPaths: string[];
  forceRebuild?: boolean;
  disconnectTimeoutMs?: number;
  reconnectTimeoutMs?: number;
}

export interface SyncStrategyPlan {
  strategy: SyncStrategy;
  restartRequired: boolean;
  reasons: string[];
}

export interface CompileProjectCodeResult {
  success: boolean;
  operation: 'compile_project_code';
  strategy: 'external_build';
  engineRoot: string;
  projectPath: string;
  projectDir: string;
  target: string;
  platform: BuildPlatform;
  configuration: BuildConfiguration;
  command: {
    executable: string;
    args: string[];
  };
  durationMs: number;
  exitCode: number;
  restartRequired: boolean;
  restartReasons: string[];
  outputIncluded: boolean;
  stdout?: string;
  stderr?: string;
  uhtCacheFilesDeleted?: string[];
}

export interface RestartReconnectResult {
  success: boolean;
  operation: 'restart_editor';
  disconnected: boolean;
  reconnected: boolean;
  disconnectTimeoutMs: number;
  reconnectTimeoutMs: number;
  diagnostics: string[];
}

export type ProbeConnection = (() => Promise<boolean>) | null;

export interface CommandInvocation {
  executable: string;
  args: string[];
}

export interface CommandRunner {
  (
    executable: string,
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      timeoutMs: number;
    },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface ProjectControllerOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  runCommand?: CommandRunner;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProjectControllerLike {
  readonly liveCodingSupported: boolean;
  classifyChangedPaths(changedPaths: string[], forceRebuild?: boolean): SyncStrategyPlan;
  compileProjectCode(request: CompileProjectCodeRequest): Promise<CompileProjectCodeResult>;
  waitForEditorRestart(
    probeConnection: ProbeConnection,
    options?: {
      disconnectTimeoutMs?: number;
      reconnectTimeoutMs?: number;
    },
  ): Promise<RestartReconnectResult>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isWindowsBatchScript(executable: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && /\.(bat|cmd)$/iu.test(executable);
}

function quoteWindowsCommandArg(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '""')}"`;
}

export function resolveCommandInvocation(
  executable: string,
  args: string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): CommandInvocation {
  if (!isWindowsBatchScript(executable, platform)) {
    return {
      executable,
      args,
    };
  }

  const commandLine = [
    'call',
    quoteWindowsCommandArg(executable),
    ...args.map(quoteWindowsCommandArg),
  ].join(' ');

  return {
    executable: env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', commandLine],
  };
}

async function defaultRunCommand(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolveRun, rejectRun) => {
    const invocation = resolveCommandInvocation(
      executable,
      args,
      process.platform,
      options.env ?? process.env,
    );
    const child = spawn(invocation.executable, invocation.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsVerbatimArguments: isWindowsBatchScript(executable, process.platform),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGTERM');
      rejectRun(new Error(`Command timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      rejectRun(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolveRun({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function parsePlatform(value: string | undefined, fallback: NodeJS.Platform): NodeJS.Platform {
  return (value as NodeJS.Platform | undefined) ?? fallback;
}

function parseBuildPlatform(value: string | undefined, platform: NodeJS.Platform): BuildPlatform {
  if (value === 'Win64' || value === 'Mac' || value === 'Linux') {
    return value;
  }

  if (platform === 'win32') {
    return 'Win64';
  }

  if (platform === 'darwin') {
    return 'Mac';
  }

  return 'Linux';
}

function parseConfiguration(value: string | undefined): BuildConfiguration {
  if (value === 'Debug' || value === 'DebugGame' || value === 'Development' || value === 'Shipping' || value === 'Test') {
    return value;
  }

  return 'Development';
}

function trimOutput(text: string, includeOutput: boolean): string | undefined {
  if (!includeOutput || text.length === 0) {
    return undefined;
  }

  return text;
}

function fileName(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

export function classifyChangedPaths(changedPaths: string[], forceRebuild = false): SyncStrategyPlan {
  const reasons = new Set<string>();

  if (forceRebuild) {
    reasons.add('force_rebuild');
  }

  for (const changedPath of changedPaths) {
    const normalized = changedPath.replaceAll('\\', '/').toLowerCase();
    const name = fileName(normalized);

    if (
      normalized.endsWith('.h')
      || normalized.endsWith('.hpp')
      || normalized.endsWith('.inl')
      || normalized.endsWith('.generated.h')
    ) {
      reasons.add('header_or_uht_sensitive_change');
      continue;
    }

    if (
      name.endsWith('.build.cs')
      || name.endsWith('.target.cs')
      || normalized.endsWith('.uplugin')
      || normalized.endsWith('.uproject')
    ) {
      reasons.add('build_or_project_metadata_change');
      continue;
    }

    if (
      normalized.includes('/source/')
      && normalized.endsWith('.cpp') === false
      && normalized.endsWith('.c') === false
      && normalized.endsWith('.mm') === false
      && normalized.endsWith('.m') === false
    ) {
      reasons.add('non_implementation_source_change');
      continue;
    }
  }

  if (reasons.size > 0) {
    return {
      strategy: 'build_and_restart',
      restartRequired: true,
      reasons: Array.from(reasons),
    };
  }

  return {
    strategy: 'live_coding',
    restartRequired: false,
    reasons: [],
  };
}

const UHT_CACHE_PATTERN = /\.(uhtpath|uhtsettings)$/i;

async function walkAndDeleteMatching(dir: string, pattern: RegExp, deleted: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAndDeleteMatching(fullPath, pattern, deleted);
    } else if (pattern.test(entry.name)) {
      try {
        await unlink(fullPath);
        deleted.push(fullPath);
      } catch {
        // file may already be gone
      }
    }
  }
}

async function clearUhtCacheFiles(projectDir: string): Promise<string[]> {
  const deleted: string[] = [];
  const intermediateDir = resolve(projectDir, 'Intermediate');
  await walkAndDeleteMatching(intermediateDir, UHT_CACHE_PATTERN, deleted);
  return deleted;
}

async function waitForState(
  probeConnection: ProbeConnection,
  expectedState: boolean,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  if (!probeConnection) {
    throw new Error('Editor connection probing is unavailable');
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await probeConnection();
      if (state === expectedState) {
        return true;
      }
    } catch {
      if (!expectedState) {
        return true;
      }
    }

    await sleep(DEFAULT_POLL_INTERVAL_MS);
  }

  return false;
}

export class ProjectController implements ProjectControllerLike {
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly runCommand: CommandRunner;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ProjectControllerOptions = {}) {
    this.env = options.env ?? process.env;
    this.platform = parsePlatform(options.platform, process.platform);
    this.runCommand = options.runCommand ?? defaultRunCommand;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get liveCodingSupported(): boolean {
    return this.platform === 'win32';
  }

  classifyChangedPaths(changedPaths: string[], forceRebuild = false): SyncStrategyPlan {
    return classifyChangedPaths(changedPaths, forceRebuild);
  }

  async compileProjectCode(request: CompileProjectCodeRequest): Promise<CompileProjectCodeResult> {
    const engineRoot = request.engineRoot ?? this.env.UE_ENGINE_ROOT;
    const projectPath = request.projectPath ?? this.env.UE_PROJECT_PATH;
    const target = request.target ?? this.env.UE_PROJECT_TARGET ?? this.env.UE_EDITOR_TARGET;
    const platform = parseBuildPlatform(request.platform ?? this.env.UE_BUILD_PLATFORM, this.platform);
    const configuration = parseConfiguration(request.configuration ?? this.env.UE_BUILD_CONFIGURATION);
    const includeOutput = request.includeOutput ?? false;
    const buildTimeoutMs = request.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;

    if (!engineRoot) {
      throw new Error('compile_project_code requires engine_root or UE_ENGINE_ROOT');
    }

    if (!projectPath) {
      throw new Error('compile_project_code requires project_path or UE_PROJECT_PATH');
    }

    if (!target) {
      throw new Error('compile_project_code requires target or UE_PROJECT_TARGET/UE_EDITOR_TARGET');
    }

    const buildScript = this.platform === 'win32'
      ? resolve(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat')
      : resolve(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.sh');

    await access(buildScript, fsConstants.F_OK);

    let uhtCacheFilesDeleted: string[] | undefined;
    if (request.clearUhtCache) {
      uhtCacheFilesDeleted = await clearUhtCacheFiles(dirname(projectPath));
    }

    const args = [
      target,
      platform,
      configuration,
      `-Project=${projectPath}`,
      '-WaitMutex',
      '-NoHotReloadFromIDE',
    ];

    const startedAt = Date.now();
    const completed = await this.runCommand(buildScript, args, {
      cwd: dirname(projectPath),
      env: this.env,
      timeoutMs: buildTimeoutMs,
    });

    const result: CompileProjectCodeResult = {
      success: completed.exitCode === 0,
      operation: 'compile_project_code',
      strategy: 'external_build',
      engineRoot,
      projectPath,
      projectDir: dirname(projectPath),
      target,
      platform,
      configuration,
      command: {
        executable: buildScript,
        args,
      },
      durationMs: Date.now() - startedAt,
      exitCode: completed.exitCode,
      restartRequired: true,
      restartReasons: ['external_build_completed'],
      outputIncluded: includeOutput,
    };

    const stdout = trimOutput(completed.stdout, includeOutput || completed.exitCode !== 0);
    const stderr = trimOutput(completed.stderr, includeOutput || completed.exitCode !== 0);
    if (stdout) {
      result.stdout = stdout;
    }
    if (stderr) {
      result.stderr = stderr;
    }
    if (uhtCacheFilesDeleted && uhtCacheFilesDeleted.length > 0) {
      result.uhtCacheFilesDeleted = uhtCacheFilesDeleted;
    }

    return result;
  }

  async waitForEditorRestart(
    probeConnection: ProbeConnection,
    options: {
      disconnectTimeoutMs?: number;
      reconnectTimeoutMs?: number;
    } = {},
  ): Promise<RestartReconnectResult> {
    const disconnectTimeoutMs = options.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS;
    const reconnectTimeoutMs = options.reconnectTimeoutMs ?? DEFAULT_RECONNECT_TIMEOUT_MS;
    const diagnostics: string[] = [];

    const disconnected = await waitForState(probeConnection, false, disconnectTimeoutMs, this.sleep);
    if (!disconnected) {
      diagnostics.push('Editor never disconnected after restart request');
      return {
        success: false,
        operation: 'restart_editor',
        disconnected: false,
        reconnected: false,
        disconnectTimeoutMs,
        reconnectTimeoutMs,
        diagnostics,
      };
    }

    const reconnected = await waitForState(probeConnection, true, reconnectTimeoutMs, this.sleep);
    if (!reconnected) {
      diagnostics.push('Editor did not reconnect before the timeout elapsed');
    }

    return {
      success: reconnected,
      operation: 'restart_editor',
      disconnected: true,
      reconnected,
      disconnectTimeoutMs,
      reconnectTimeoutMs,
      diagnostics,
    };
  }
}
