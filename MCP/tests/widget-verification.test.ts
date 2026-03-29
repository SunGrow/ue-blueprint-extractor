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

  it('captures editor screenshots and normalizes viewport capture artifacts', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      captureId: 'editor-cap-1',
      captureType: 'editor_screenshot',
      surface: 'editor_viewport',
      assetPath: 'editor://active_level_viewport',
      artifactPath: 'Z:/nonexistent/editor-cap-1.png',
      metadataPath: 'Z:/nonexistent/editor-cap-1.json',
      captureDirectory: 'Z:/nonexistent/editor-cap-1',
      width: 1280,
      height: 720,
      fileSizeBytes: 12345,
      createdAt: '2026-03-28T12:00:00Z',
    }));

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson,
      automationController: { runAutomationTests: vi.fn() } as never,
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

    const result = await registry.getTool('capture_editor_screenshot').handler({});

    expect(callSubsystemJson).toHaveBeenCalledWith('CaptureEditorScreenshot', {});
    expect(parseDirectToolResult(result)).toMatchObject({
      captureId: 'editor-cap-1',
      captureType: 'editor_screenshot',
      surface: 'editor_tool_viewport',
      resourceUri: 'blueprint://captures/editor-cap-1',
    });
  });

  it('captures runtime screenshots from automation artifacts and normalizes legacy runtime surfaces', async () => {
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
        automationFilter: 'Runtime.Screenshot',
        verificationArtifacts: [{
          captureId: 'runtime-cap-1',
          captureType: 'runtime_screenshot',
          surface: 'runtime_viewport',
          scenarioId: 'runtime_screenshot:runtime',
          artifactPath: 'Z:/nonexistent/runtime-cap-1.png',
          metadataPath: 'Z:/nonexistent/runtime-cap-1.json',
          captureDirectory: 'Z:/nonexistent/runtime-cap-1',
          assetPath: 'runtime_screenshot://runtime',
          assetPaths: ['runtime_screenshot://runtime'],
          width: 1920,
          height: 1080,
          fileSizeBytes: 67890,
          createdAt: '2026-03-28T12:00:00Z',
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

    const result = await registry.getTool('capture_runtime_screenshot').handler({
      automation_filter: 'Runtime.Screenshot',
      timeout_seconds: 45,
      null_rhi: false,
    });

    expect(automationController.runAutomationTests).toHaveBeenCalledWith({
      automationFilter: 'Runtime.Screenshot',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      reportOutputDir: undefined,
      timeoutMs: 45_000,
      nullRhi: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      operation: 'capture_runtime_screenshot',
      captureId: 'runtime-cap-1',
      surface: 'pie_runtime',
      inputResolution: {
        engineRoot: 'explicit',
        projectPath: 'environment',
        target: 'editor_context',
      },
      automationRun: {
        runId: 'run-1',
      },
    });
  });

  it('returns an error when runtime screenshot automation exports no runtime artifact', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => ({
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      context: null,
      contextError: undefined,
      sources: {
        engineRoot: 'explicit',
        projectPath: 'explicit',
        target: 'explicit',
      },
    }));

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson: vi.fn(),
      automationController: {
        runAutomationTests: vi.fn(async () => ({
          runId: 'run-2',
          automationFilter: 'Runtime.Empty',
          verificationArtifacts: [],
        })),
      } as never,
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

    const result = await registry.getTool('capture_runtime_screenshot').handler({
      automation_filter: 'Runtime.Empty',
      timeout_seconds: 15,
      null_rhi: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'did not find a normalized pie_runtime artifact',
    );
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

  it('lists captures with optional asset path filter', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      captures: [
        {
          captureId: 'cap-1',
          captureType: 'widget_preview',
          assetPath: '/Game/UI/WBP_Window',
          artifactPath: 'Z:/nonexistent/cap-1.png',
        },
        {
          captureId: 'cap-2',
          captureType: 'widget_preview',
          assetPath: '/Game/UI/WBP_Window',
          artifactPath: 'Z:/nonexistent/cap-2.png',
        },
      ],
    }));

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson,
      automationController: { runAutomationTests: vi.fn() } as never,
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

    const result = await registry.getTool('list_captures').handler({
      asset_path_filter: '/Game/UI/WBP_Window',
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ListCaptures', {
      AssetPathFilter: '/Game/UI/WBP_Window',
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      captureCount: 2,
    });
  });

  it('returns an error when list_captures fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('listing captures failed');
    });

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson,
      automationController: { runAutomationTests: vi.fn() } as never,
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

    const result = await registry.getTool('list_captures').handler({
      asset_path_filter: '',
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'listing captures failed',
    );
  });

  it('cleans up old captures with max_age_days parameter', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      removedCount: 3,
    }));

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson,
      automationController: { runAutomationTests: vi.fn() } as never,
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

    const result = await registry.getTool('cleanup_captures').handler({
      max_age_days: 14,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CleanupCaptures', {
      MaxAgeDays: 14,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      removedCount: 3,
    });
  });

  it('returns an error when cleanup_captures fails', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('cleanup failed');
    });

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson,
      automationController: { runAutomationTests: vi.fn() } as never,
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

    const result = await registry.getTool('cleanup_captures').handler({
      max_age_days: 0,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain('cleanup failed');
  });

  it('compares motion capture bundles against reference frames', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      pass: true,
      rmse: 0.001,
      mismatchPixelCount: 0,
      capturePath: '/tmp/start.png',
      referencePath: '/ref/start.png',
    }));

    registerWidgetVerificationTools({
      server: registry.server,
      callSubsystemJson,
      automationController: { runAutomationTests: vi.fn() } as never,
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

    const result = await registry.getTool('compare_motion_capture_bundle').handler({
      capture_artifacts: [
        { checkpointName: 'start', captureId: 'cap-start', artifactPath: '/tmp/start.png' },
        { checkpointName: 'end', captureId: 'cap-end', artifactPath: '/tmp/end.png' },
      ],
      reference_frames: [
        { checkpoint_name: 'start', reference: '/ref/start.png' },
      ],
      tolerance: 0.02,
    });

    // The 'start' checkpoint should match; 'end' has no reference and is skipped
    expect(callSubsystemJson).toHaveBeenCalledWith('CompareCaptureToReference', {
      CaptureIdOrPath: 'cap-start',
      ReferenceIdOrPath: '/ref/start.png',
      Tolerance: 0.02,
    });
    expect((result as { isError?: boolean }).isError).not.toBe(true);
    expect(parseDirectToolResult(result)).toMatchObject({
      operation: 'compare_motion_capture_bundle',
      mode: 'reference_frames',
      captureCount: 2,
      matchedCount: 1,
    });
  });
});
