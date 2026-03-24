import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerWidgetVerificationTools } from '../src/tools/widget-verification.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const captureResultSchema = z.object({}).passthrough();
const widgetAnimationCheckpointSchema = z.object({}).passthrough();
const motionCaptureModeSchema = z.enum(['editor_preview', 'automation_scenario']);
const motionCaptureBundleResultSchema = z.object({}).passthrough();
const compareCaptureResultSchema = z.object({}).passthrough();
const listCapturesResultSchema = z.object({}).passthrough();
const cleanupCapturesResultSchema = z.object({}).passthrough();
const compareMotionCaptureBundleResultSchema = z.object({}).passthrough();

describe('registerWidgetVerificationTools', () => {
  it('captures widget previews and exposes capture resource links', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      captureId: 'cap-1',
      captureType: 'widget_preview',
      assetPath: '/Game/UI/WBP_Window',
      artifactPath: 'Z:/nonexistent/cap-1.png',
    }));

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson,
      automationController: {
        runAutomationTests: vi.fn(),
      } as never,
      resolveProjectInputs: vi.fn(),
      captureResultSchema,
      widgetAnimationCheckpointSchema,
      motionCaptureModeSchema,
      motionCaptureBundleResultSchema,
      compareCaptureResultSchema,
      listCapturesResultSchema,
      cleanupCapturesResultSchema,
      compareMotionCaptureBundleResultSchema,
    });

    const result = await registry.getTool('capture_widget_preview').handler({
      asset_path: '/Game/UI/WBP_Window',
      width: 640,
      height: 360,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CaptureWidgetPreview', {
      AssetPath: '/Game/UI/WBP_Window',
      Width: 640,
      Height: 360,
    });
    expect((result as { content?: Array<{ type: string; uri?: string }> }).content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'resource_link',
        uri: 'blueprint://captures/cap-1',
      }),
    ]));
    expect(parseDirectToolResult(result)).toMatchObject({
      captureId: 'cap-1',
      resourceUri: 'blueprint://captures/cap-1',
      surface: 'editor_offscreen',
    });
  });

  it('returns an error when editor_preview motion capture is missing required inputs', async () => {
    const registry = createToolRegistry();

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson: vi.fn(),
      automationController: {
        runAutomationTests: vi.fn(),
      } as never,
      resolveProjectInputs: vi.fn(),
      captureResultSchema,
      widgetAnimationCheckpointSchema,
      motionCaptureModeSchema,
      motionCaptureBundleResultSchema,
      compareCaptureResultSchema,
      listCapturesResultSchema,
      cleanupCapturesResultSchema,
      compareMotionCaptureBundleResultSchema,
    });

    const result = await registry.getTool('capture_widget_motion_checkpoints').handler({
      mode: 'editor_preview',
      width: 320,
      height: 180,
      timeout_seconds: 30,
      null_rhi: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'editor_preview mode requires asset_path and animation_name',
    );
  });

  it('normalizes comparison payloads and exposes diff captures as resource links', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      capturePath: 'actual.png',
      referencePath: 'expected.png',
      diffCaptureId: 'diff-1',
      diffArtifactPath: 'Z:/nonexistent/diff-1.png',
      pass: true,
      rmse: 0.002,
      mismatchPixelCount: 0,
    }));

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson,
      automationController: {
        runAutomationTests: vi.fn(),
      } as never,
      resolveProjectInputs: vi.fn(),
      captureResultSchema,
      widgetAnimationCheckpointSchema,
      motionCaptureModeSchema,
      motionCaptureBundleResultSchema,
      compareCaptureResultSchema,
      listCapturesResultSchema,
      cleanupCapturesResultSchema,
      compareMotionCaptureBundleResultSchema,
    });

    const result = await registry.getTool('compare_capture_to_reference').handler({
      capture: 'cap-1',
      reference: 'ref-1',
      tolerance: 0.05,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CompareCaptureToReference', {
      CaptureIdOrPath: 'cap-1',
      ReferenceIdOrPath: 'ref-1',
      Tolerance: 0.05,
    });
    expect((result as { content?: Array<{ type: string; uri?: string }> }).content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'resource_link',
        uri: 'blueprint://captures/diff-1',
      }),
    ]));
    expect(parseDirectToolResult(result)).toMatchObject({
      diffResourceUri: 'blueprint://captures/diff-1',
      comparison: {
        capturePath: 'actual.png',
        referencePath: 'expected.png',
        diffCaptureId: 'diff-1',
        pass: true,
        rmse: 0.002,
        mismatchPixelCount: 0,
      },
    });
  });

  it('marks automation motion capture as partial verification when no checkpoint artifacts are exported', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => ({
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      context: null,
      contextError: undefined,
      sources: {
        engineRoot: 'explicit',
        projectPath: 'environment',
        target: 'editor_context',
      },
    }));
    const automationController = {
      runAutomationTests: vi.fn(async () => ({
        runId: 'run-1',
        automationFilter: 'UI.Motion',
        diagnostics: ['base diagnostic'],
        artifacts: [{
          name: 'window-shot',
          path: 'C:/Reports/window-shot.png',
          resourceUri: 'blueprint://automation/window-shot',
          mimeType: 'image/png',
        }],
      })),
    };

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson: vi.fn(),
      automationController: automationController as never,
      resolveProjectInputs,
      captureResultSchema,
      widgetAnimationCheckpointSchema,
      motionCaptureModeSchema,
      motionCaptureBundleResultSchema,
      compareCaptureResultSchema,
      listCapturesResultSchema,
      cleanupCapturesResultSchema,
      compareMotionCaptureBundleResultSchema,
    });

    const result = await registry.getTool('capture_widget_motion_checkpoints').handler({
      mode: 'automation_scenario',
      automation_filter: 'UI.Motion',
      timeout_seconds: 15,
      null_rhi: true,
    });

    expect(resolveProjectInputs).toHaveBeenCalledTimes(1);
    expect(automationController.runAutomationTests).toHaveBeenCalledWith({
      automationFilter: 'UI.Motion',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      reportOutputDir: undefined,
      timeoutMs: 15_000,
      nullRhi: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'capture_widget_motion_checkpoints',
      mode: 'automation_scenario',
      checkpointCount: 0,
      partialVerification: true,
      diagnostics: expect.arrayContaining([
        'base diagnostic',
        expect.stringContaining('partial verification'),
      ]),
      inputResolution: {
        engineRoot: 'explicit',
        projectPath: 'environment',
        target: 'editor_context',
      },
    });
  });
});
