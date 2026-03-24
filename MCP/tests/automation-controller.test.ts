import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { AutomationController, type AutomationRunResult } from '../src/automation-controller.js';

async function waitForRun(controller: AutomationController, runId: string): Promise<AutomationRunResult> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await controller.getAutomationTestRun(runId);
    if (run?.terminal) {
      return run;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }

  throw new Error(`Automation run ${runId} did not become terminal`);
}

describe('AutomationController', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop();
      if (!directory) {
        continue;
      }

      await rm(directory, { recursive: true, force: true });
    }
  });

  it('runs automation tests asynchronously and indexes summary, logs, and report artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-automation-controller-'));
    tempDirs.push(root);

    const controller = new AutomationController({
      platform: process.platform,
      resolveEditorCommand: async () => process.execPath,
      spawnProcess: (_executable, args, options) => spawn(process.execPath, ['-e', `
        const fs = require('node:fs');
        const path = require('node:path');
        const reportArg = process.argv.find((arg) => arg.startsWith('-ReportExportPath='));
        const reportDir = reportArg.slice('-ReportExportPath='.length);
        fs.mkdirSync(path.join(reportDir, 'Screenshots'), { recursive: true });
        fs.writeFileSync(path.join(reportDir, 'index.json'), JSON.stringify({
          totalTests: 3,
          succeeded: 3,
          failed: 0,
          warnings: 1,
        }, null, 2));
        fs.writeFileSync(path.join(reportDir, 'Screenshots', 'Diff.png'), 'png');
        console.log('automation stdout');
        console.error('automation stderr');
      `, ...args], options),
    });

    const started = await controller.runAutomationTests({
      engineRoot: root,
      projectPath: join(root, 'Fixture.uproject'),
      target: 'FixtureEditor',
      automationFilter: 'BlueprintExtractor.Verification',
      timeoutMs: 5_000,
      nullRhi: true,
    });

    expect(started.status).toBe('running');
    expect(started.terminal).toBe(false);

    const completed = await waitForRun(controller, started.runId);
    expect(completed.status).toBe('succeeded');
    expect(completed.summary).toMatchObject({
      successful: true,
      totalTests: 3,
      passedTests: 3,
      failedTests: 0,
      warningCount: 1,
      reportAvailable: true,
    });
    expect(completed.artifacts.map((artifact) => artifact.name)).toEqual(expect.arrayContaining([
      'stdout',
      'stderr',
      'summary',
      'report',
      'report__screenshots_diff_png',
    ]));

    const summaryArtifact = await controller.readAutomationArtifact(completed.runId, 'summary');
    const diffArtifact = await controller.readAutomationArtifact(completed.runId, 'report__screenshots_diff_png');
    expect(summaryArtifact?.artifact.mimeType).toBe('application/json');
    expect(summaryArtifact?.data.toString('utf8')).toContain('"successful": true');
    expect(diffArtifact?.artifact.mimeType).toBe('image/png');
    expect(diffArtifact?.data.toString('utf8')).toBe('png');
  });

  it('marks timed-out runs as terminal failures and keeps them out of active listings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-automation-timeout-'));
    tempDirs.push(root);

    const controller = new AutomationController({
      platform: process.platform,
      resolveEditorCommand: async () => process.execPath,
      spawnProcess: (_executable, args, options) => spawn(process.execPath, ['-e', `
        setTimeout(() => process.exit(0), 1000);
      `, ...args], options),
    });

    const started = await controller.runAutomationTests({
      engineRoot: root,
      projectPath: join(root, 'Fixture.uproject'),
      automationFilter: 'BlueprintExtractor.Timeout',
      timeoutMs: 50,
      nullRhi: true,
    });

    const completed = await waitForRun(controller, started.runId);
    expect(completed.status).toBe('timed_out');
    expect(completed.success).toBe(false);
    expect(completed.diagnostics.some((entry) => entry.includes('exceeded timeout'))).toBe(true);

    const activeRuns = await controller.listAutomationTestRuns(false);
    const allRuns = await controller.listAutomationTestRuns(true);
    expect(activeRuns.runs).toHaveLength(0);
    expect(allRuns.runs.some((run) => run.runId === completed.runId)).toBe(true);
  });

  it('omits -NullRHI when the caller requests rendered automation coverage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-automation-rendered-'));
    tempDirs.push(root);

    let capturedArgs: string[] = [];
    const controller = new AutomationController({
      platform: process.platform,
      resolveEditorCommand: async () => process.execPath,
      spawnProcess: (_executable, args, options) => {
        capturedArgs = [...args];
        return spawn(process.execPath, ['-e', 'process.exit(0);', ...args], options);
      },
    });

    const started = await controller.runAutomationTests({
      engineRoot: root,
      projectPath: join(root, 'Fixture.uproject'),
      automationFilter: 'BlueprintExtractor.Visual',
      timeoutMs: 5_000,
      nullRhi: false,
    });

    const completed = await waitForRun(controller, started.runId);
    expect(completed.status).toBe('succeeded');
    expect(capturedArgs).not.toContain('-NullRHI');
    expect(completed.nullRhi).toBe(false);
  });

  it('evicts the oldest terminal runs when the configured history limit is exceeded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-automation-history-'));
    tempDirs.push(root);

    const controller = new AutomationController({
      maxRunHistory: 2,
      terminalRunRetentionMs: 60_000,
      platform: process.platform,
      resolveEditorCommand: async () => process.execPath,
      spawnProcess: (_executable, args, options) => spawn(process.execPath, ['-e', `
        setTimeout(() => process.exit(0), 5);
      `, ...args], options),
    });

    const first = await controller.runAutomationTests({
      engineRoot: root,
      projectPath: join(root, 'Fixture.uproject'),
      automationFilter: 'BlueprintExtractor.History.First',
      timeoutMs: 5_000,
      nullRhi: true,
    });
    await waitForRun(controller, first.runId);

    const second = await controller.runAutomationTests({
      engineRoot: root,
      projectPath: join(root, 'Fixture.uproject'),
      automationFilter: 'BlueprintExtractor.History.Second',
      timeoutMs: 5_000,
      nullRhi: true,
    });
    await waitForRun(controller, second.runId);

    const third = await controller.runAutomationTests({
      engineRoot: root,
      projectPath: join(root, 'Fixture.uproject'),
      automationFilter: 'BlueprintExtractor.History.Third',
      timeoutMs: 5_000,
      nullRhi: true,
    });
    await waitForRun(controller, third.runId);

    const allRuns = await controller.listAutomationTestRuns(true);
    expect(allRuns.runCount).toBe(2);
    expect(allRuns.runs.map((run) => run.runId)).toEqual(expect.not.arrayContaining([first.runId]));
    expect(allRuns.runs.map((run) => run.runId)).toEqual(expect.arrayContaining([second.runId, third.runId]));
  });
});
