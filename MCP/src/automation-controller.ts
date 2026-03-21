import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { resolveCommandInvocation, resolveEditorExecutable } from './project-controller.js';

export type AutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export interface AutomationArtifact {
  name: string;
  path: string;
  mimeType: string;
  resourceUri: string;
  relativePath?: string;
}

export interface AutomationRunSummary {
  successful: boolean;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  warningCount?: number;
  reportAvailable: boolean;
}

export interface AutomationRunResult {
  success: boolean;
  operation: 'run_automation_tests' | 'get_automation_test_run';
  runId: string;
  automationFilter: string;
  status: AutomationRunStatus;
  terminal: boolean;
  engineRoot: string;
  projectPath: string;
  projectDir: string;
  target?: string;
  reportOutputDir: string;
  command: {
    executable: string;
    args: string[];
  };
  diagnostics: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  timeoutMs: number;
  nullRhi: boolean;
  artifacts: AutomationArtifact[];
  summary?: AutomationRunSummary;
}

export interface AutomationRunListResult {
  success: boolean;
  operation: 'list_automation_test_runs';
  includeCompleted: boolean;
  runCount: number;
  runs: AutomationRunResult[];
}

export interface RunAutomationTestsRequest {
  engineRoot: string;
  projectPath: string;
  target?: string;
  automationFilter: string;
  reportOutputDir?: string;
  timeoutMs?: number;
  nullRhi?: boolean;
}

export interface AutomationControllerLike {
  runAutomationTests(request: RunAutomationTestsRequest): Promise<AutomationRunResult>;
  getAutomationTestRun(runId: string): Promise<AutomationRunResult | null>;
  listAutomationTestRuns(includeCompleted?: boolean): Promise<AutomationRunListResult>;
  readAutomationArtifact(runId: string, artifactName: string): Promise<AutomationArtifactReadResult | null>;
}

export interface AutomationArtifactReadResult {
  artifact: AutomationArtifact;
  data: Buffer;
}

type MutableAutomationRun = AutomationRunResult & {
  artifactMap: Map<string, AutomationArtifact>;
};

export interface AutomationControllerOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  now?: () => Date;
  spawnProcess?: typeof spawn;
  resolveEditorCommand?: (engineRoot: string, platform: NodeJS.Platform) => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

function defaultNow() {
  return new Date();
}

function sanitizeSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return sanitized.length > 0 ? sanitized : 'automation';
}

function inferMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.json':
      return 'application/json';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.txt':
    case '.log':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

async function collectFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      return await collectFilesRecursive(fullPath);
    }

    return [fullPath];
  }));

  return files.flat();
}

function firstNumericRecord(value: unknown, keys: string[]): number | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  for (const nested of Object.values(record)) {
    const found = firstNumericRecord(nested, keys);
    if (typeof found === 'number') {
      return found;
    }
  }

  return undefined;
}

function buildSummaryFromReport(report: unknown, successful: boolean): AutomationRunSummary {
  return {
    successful,
    totalTests: firstNumericRecord(report, ['totalTests', 'total', 'numTotal']),
    passedTests: firstNumericRecord(report, ['passedTests', 'succeeded', 'numSucceeded', 'passCount']),
    failedTests: firstNumericRecord(report, ['failedTests', 'failed', 'numFailed', 'failCount']),
    skippedTests: firstNumericRecord(report, ['skippedTests', 'skipped', 'numSkipped']),
    warningCount: firstNumericRecord(report, ['warningCount', 'warnings', 'numWarnings']),
    reportAvailable: true,
  };
}

async function tryReadJson(filePath: string): Promise<unknown | undefined> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function buildResourceUri(runId: string, artifactName: string): string {
  return `blueprint://test-runs/${encodeURIComponent(runId)}/${encodeURIComponent(artifactName)}`;
}

async function resolveEditorCommand(engineRoot: string, platform: NodeJS.Platform): Promise<string> {
  return await resolveEditorExecutable(engineRoot, platform, 'commandlet');
}

export class AutomationController implements AutomationControllerLike {
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => Date;
  private readonly spawnProcess: typeof spawn;
  private readonly resolveEditorCommandFn: (engineRoot: string, platform: NodeJS.Platform) => Promise<string>;
  private readonly runs = new Map<string, MutableAutomationRun>();

  constructor(options: AutomationControllerOptions = {}) {
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? defaultNow;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.resolveEditorCommandFn = options.resolveEditorCommand ?? resolveEditorCommand;
  }

  async runAutomationTests(request: RunAutomationTestsRequest): Promise<AutomationRunResult> {
    if (!request.engineRoot) {
      throw new Error('run_automation_tests requires engine_root');
    }

    if (!request.projectPath) {
      throw new Error('run_automation_tests requires project_path');
    }

    if (!request.automationFilter) {
      throw new Error('run_automation_tests requires automation_filter');
    }

    const started = this.now();
    const filterSlug = sanitizeSegment(request.automationFilter);
    const runId = `${filterSlug}_${started.getTime()}_${randomUUID().slice(0, 8)}`;
    const projectDir = dirname(request.projectPath);
    const runRoot = request.reportOutputDir
      ? resolve(request.reportOutputDir)
      : resolve(projectDir, 'Saved', 'BlueprintExtractor', 'AutomationRuns', runId);
    const reportOutputDir = resolve(runRoot, 'reports');
    const stdoutPath = resolve(runRoot, 'stdout.log');
    const stderrPath = resolve(runRoot, 'stderr.log');
    const summaryPath = resolve(runRoot, 'summary.json');
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const nullRhi = request.nullRhi ?? true;

    await mkdir(reportOutputDir, { recursive: true });

    const editorCmd = await this.resolveEditorCommandFn(request.engineRoot, this.platform);
    const args = [
      request.projectPath,
      '-unattended',
      '-nop4',
      '-nosplash',
      ...(nullRhi ? ['-NullRHI'] : []),
      '-RCWebControlEnable',
      '-RCWebInterfaceEnable',
      `-ReportExportPath=${reportOutputDir}`,
      `-ExecCmds=Automation RunTests ${request.automationFilter};Quit`,
    ];
    const invocation = resolveCommandInvocation(editorCmd, args, this.platform, this.env);

    const run: MutableAutomationRun = {
      success: true,
      operation: 'run_automation_tests',
      runId,
      automationFilter: request.automationFilter,
      status: 'queued',
      terminal: false,
      engineRoot: request.engineRoot,
      projectPath: request.projectPath,
      projectDir,
      target: request.target,
      reportOutputDir,
      command: {
        executable: invocation.executable,
        args: invocation.args,
      },
      diagnostics: [],
      timeoutMs,
      nullRhi,
      artifacts: [],
      artifactMap: new Map<string, AutomationArtifact>(),
    };
    this.runs.set(runId, run);

    const stdoutStream = createWriteStream(stdoutPath, { encoding: 'utf8' });
    const stderrStream = createWriteStream(stderrPath, { encoding: 'utf8' });
    const child = this.spawnProcess(invocation.executable, invocation.args, {
      cwd: projectDir,
      env: this.env,
      shell: false,
      windowsVerbatimArguments: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    run.status = 'running';
    run.startedAt = started.toISOString();

    child.stdout?.on('data', (chunk) => {
      stdoutStream.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderrStream.write(chunk);
    });

    const finalize = async (status: AutomationRunStatus, exitCode?: number, diagnostic?: string) => {
      if (run.terminal) {
        return;
      }

      run.status = status;
      run.exitCode = exitCode;
      run.completedAt = this.now().toISOString();
      run.durationMs = new Date(run.completedAt).getTime() - started.getTime();
      run.success = status !== 'failed' && status !== 'timed_out' && status !== 'cancelled';
      if (diagnostic) {
        run.diagnostics.push(diagnostic);
      }

      await Promise.all([
        new Promise<void>((resolveClose) => stdoutStream.end(resolveClose)),
        new Promise<void>((resolveClose) => stderrStream.end(resolveClose)),
      ]);

      this.registerArtifact(run, 'stdout', stdoutPath, 'text/plain');
      this.registerArtifact(run, 'stderr', stderrPath, 'text/plain');

      const reportFiles = await this.collectReportArtifacts(runId, reportOutputDir);
      for (const artifact of reportFiles) {
        this.registerArtifact(run, artifact.name, artifact.path, artifact.mimeType, artifact.relativePath);
      }

      const summary = await this.buildRunSummary(run, reportOutputDir);
      run.summary = summary;
      await writeFile(summaryPath, JSON.stringify({
        runId,
        automationFilter: run.automationFilter,
        status: run.status,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        diagnostics: run.diagnostics,
        reportOutputDir: run.reportOutputDir,
        summary,
      }, null, 2), 'utf8');
      this.registerArtifact(run, 'summary', summaryPath, 'application/json');
      run.terminal = true;
    };

    const timeoutHandle = setTimeout(() => {
      if (!run.terminal) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    child.on('error', async (error) => {
      clearTimeout(timeoutHandle);
      await finalize('failed', 1, error.message);
    });

    child.on('close', async (code, signal) => {
      clearTimeout(timeoutHandle);
      const status: AutomationRunStatus = signal === 'SIGTERM' && !run.terminal
        ? 'timed_out'
        : (code ?? 1) === 0
          ? 'succeeded'
          : 'failed';
      const diagnostic = signal === 'SIGTERM' && status === 'timed_out'
        ? `Automation run exceeded timeout of ${timeoutMs}ms`
        : undefined;
      await finalize(status, code ?? 1, diagnostic);
    });

    return this.cloneRun(run, 'run_automation_tests');
  }

  async getAutomationTestRun(runId: string): Promise<AutomationRunResult | null> {
    const run = this.runs.get(runId);
    return run ? this.cloneRun(run, 'get_automation_test_run') : null;
  }

  async listAutomationTestRuns(includeCompleted = true): Promise<AutomationRunListResult> {
    const runs = Array.from(this.runs.values())
      .filter((run) => includeCompleted || !run.terminal)
      .sort((left, right) => {
        const leftTime = left.startedAt ? Date.parse(left.startedAt) : 0;
        const rightTime = right.startedAt ? Date.parse(right.startedAt) : 0;
        return rightTime - leftTime;
      })
      .map((run) => this.cloneRun(run, 'get_automation_test_run'));

    return {
      success: true,
      operation: 'list_automation_test_runs',
      includeCompleted,
      runCount: runs.length,
      runs,
    };
  }

  async readAutomationArtifact(runId: string, artifactName: string): Promise<AutomationArtifactReadResult | null> {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    const artifact = run.artifactMap.get(artifactName);
    if (!artifact) {
      return null;
    }

    const data = await readFile(artifact.path);
    return {
      artifact,
      data,
    };
  }

  private cloneRun(run: MutableAutomationRun, operation: AutomationRunResult['operation']): AutomationRunResult {
    return {
      ...run,
      operation,
      artifacts: [...run.artifacts],
    };
  }

  private registerArtifact(
    run: MutableAutomationRun,
    name: string,
    filePath: string,
    mimeType: string,
    relativePath?: string,
  ) {
    const existing = run.artifactMap.get(name);
    const artifact: AutomationArtifact = {
      name,
      path: filePath,
      mimeType,
      relativePath,
      resourceUri: buildResourceUri(run.runId, name),
    };

    if (existing) {
      const index = run.artifacts.findIndex((candidate) => candidate.name === name);
      if (index >= 0) {
        run.artifacts[index] = artifact;
      }
    } else {
      run.artifacts.push(artifact);
    }

    run.artifactMap.set(name, artifact);
  }

  private async collectReportArtifacts(runId: string, reportOutputDir: string): Promise<AutomationArtifact[]> {
    try {
      const files = await collectFilesRecursive(reportOutputDir);
      return files.map((filePath) => {
        const rel = relative(reportOutputDir, filePath).replaceAll('\\', '/');
        const lowerRel = rel.toLowerCase();
        const name = lowerRel === 'index.json'
          ? 'report'
          : lowerRel === 'index.html'
            ? 'report_html'
            : `report__${sanitizeSegment(rel.replaceAll('/', '__'))}`;

        return {
          name,
          path: filePath,
          mimeType: inferMimeType(filePath),
          relativePath: rel,
          resourceUri: buildResourceUri(runId, name),
        };
      });
    } catch {
      return [];
    }
  }

  private async buildRunSummary(run: MutableAutomationRun, reportOutputDir: string): Promise<AutomationRunSummary> {
    const reportArtifact = run.artifactMap.get('report');
    if (!reportArtifact) {
      return {
        successful: run.status === 'succeeded',
        reportAvailable: false,
      };
    }

    const parsed = await tryReadJson(reportArtifact.path);
    if (!parsed) {
      return {
        successful: run.status === 'succeeded',
        reportAvailable: true,
      };
    }

    return buildSummaryFromReport(parsed, run.status === 'succeeded');
  }
}
