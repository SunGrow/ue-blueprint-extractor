import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerAutomationRunTools } from '../src/tools/automation-runs.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const automationRunSchema = z.object({}).passthrough();
const automationRunListSchema = z.object({}).passthrough();

describe('registerAutomationRunTools', () => {
  it('runs automation tests with resolved project inputs and adds artifact links', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => ({
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      context: null,
      contextError: 'editor context unavailable',
      sources: {
        engineRoot: 'explicit',
        projectPath: 'editor_context',
        target: 'environment',
      },
    }));
    const automationController = {
      runAutomationTests: vi.fn(async () => ({
        runId: 'run-1',
        automationFilter: 'UI.Window',
        status: 'completed',
        artifacts: [{
          name: 'window-shot',
          path: 'C:/Reports/window-shot.png',
          resourceUri: 'blueprint://automation/window-shot',
          mimeType: 'image/png',
          relativePath: 'Reports/window-shot.png',
        }],
      })),
      getAutomationTestRun: vi.fn(),
      listAutomationTestRuns: vi.fn(),
    };

    registerAutomationRunTools({
      server: registry.server,
      automationController,
      resolveProjectInputs,
      automationRunSchema,
      automationRunListSchema,
    });

    const result = await registry.getTool('run_automation_tests').handler({
      automation_filter: 'UI.Window',
      timeout_seconds: 45,
      null_rhi: false,
    });

    expect(resolveProjectInputs).toHaveBeenCalledWith({
      engine_root: undefined,
      project_path: undefined,
      target: undefined,
    });
    expect(automationController.runAutomationTests).toHaveBeenCalledWith({
      automationFilter: 'UI.Window',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      reportOutputDir: undefined,
      timeoutMs: 45_000,
      nullRhi: false,
    });
    expect((result as { content?: Array<{ type: string }> }).content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'resource_link',
        uri: 'blueprint://automation/window-shot',
      }),
    ]));
    expect(parseDirectToolResult(result)).toMatchObject({
      runId: 'run-1',
      verificationArtifacts: [expect.objectContaining({
        resourceUri: 'blueprint://automation/window-shot',
        surface: 'pie_runtime',
      })],
      inputResolution: {
        engineRoot: 'explicit',
        projectPath: 'editor_context',
        target: 'environment',
        contextError: 'editor context unavailable',
      },
    });
  });

  it('returns an error when get_automation_test_run cannot find the run', async () => {
    const registry = createToolRegistry();

    registerAutomationRunTools({
      server: registry.server,
      automationController: {
        runAutomationTests: vi.fn(),
        getAutomationTestRun: vi.fn(async () => null),
        listAutomationTestRuns: vi.fn(),
      },
      resolveProjectInputs: vi.fn(),
      automationRunSchema,
      automationRunListSchema,
    });

    const result = await registry.getTool('get_automation_test_run').handler({
      run_id: 'missing-run',
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      "Automation test run 'missing-run' was not found.",
    );
  });

  it('normalizes listed automation runs and derived verification artifacts', async () => {
    const registry = createToolRegistry();
    const automationController = {
      runAutomationTests: vi.fn(),
      getAutomationTestRun: vi.fn(),
      listAutomationTestRuns: vi.fn(async () => ({
        runs: [{
          runId: 'run-2',
          automationFilter: 'Gameplay.Motion',
          artifacts: [{
            name: 'diff-capture',
            path: 'C:/Reports/diff.png',
            mimeType: 'image/png',
            resourceUri: 'blueprint://automation/diff',
          }],
        }],
      })),
    };

    registerAutomationRunTools({
      server: registry.server,
      automationController,
      resolveProjectInputs: vi.fn(),
      automationRunSchema,
      automationRunListSchema,
    });

    const result = await registry.getTool('list_automation_test_runs').handler({
      include_completed: false,
    });

    expect(automationController.listAutomationTestRuns).toHaveBeenCalledWith(false);
    expect(parseDirectToolResult(result)).toMatchObject({
      runs: [expect.objectContaining({
        runId: 'run-2',
        verificationArtifacts: [expect.objectContaining({
          captureType: 'automation_diff',
          resourceUri: 'blueprint://automation/diff',
        })],
      })],
    });
  });
});
