import { describe, expect, it } from 'vitest';
import {
  normalizeAutomationRunResult,
  normalizeVerificationArtifact,
  normalizeVerificationArtifactReference,
  normalizeVerificationComparison,
} from '../src/helpers/verification.js';

describe('verification helpers', () => {
  it('normalizes verification artifacts with inferred contexts and defaults', () => {
    const artifact = normalizeVerificationArtifact({
      captureId: 'capture-123',
      captureType: 'widget_preview',
      assetPaths: ['/Game/UI/WBP_Window'],
      widgetClass: '/Game/UI/WBP_Window.WBP_Window_C',
      width: 1280,
      height: 720,
    });

    expect(artifact).toMatchObject({
      assetPath: '/Game/UI/WBP_Window',
      assetPaths: ['/Game/UI/WBP_Window'],
      surface: 'editor_offscreen',
      scenarioId: 'widget_preview:/Game/UI/WBP_Window',
      worldContext: {
        contextType: 'widget_blueprint',
        renderLane: 'offscreen',
        widgetClass: '/Game/UI/WBP_Window.WBP_Window_C',
      },
      cameraContext: {
        contextType: 'offscreen_widget',
        width: 1280,
        height: 720,
      },
    });
  });

  it('builds artifact references and merges comparison payloads', () => {
    const reference = normalizeVerificationArtifactReference({
      captureId: 'capture-123',
      captureType: 'widget_motion_checkpoint',
      assetPath: '/Game/UI/WBP_Window',
      checkpointName: 'open',
      checkpointMs: 260,
      width: 512,
      height: 512,
    });
    const comparison = normalizeVerificationComparison({
      capturePath: 'actual.png',
      comparison: {
        pass: true,
        tolerance: 0.05,
      },
      rmse: 0.001,
      mismatchPixelCount: 0,
    });

    expect(reference).toMatchObject({
      resourceUri: 'blueprint://captures/capture-123',
      surface: 'widget_motion_checkpoint',
      worldContext: {
        contextType: 'widget_motion',
        checkpointName: 'open',
      },
      cameraContext: {
        contextType: 'motion_checkpoint',
        checkpointMs: 260,
      },
    });
    expect(comparison).toEqual({
      pass: true,
      tolerance: 0.05,
      capturePath: 'actual.png',
      rmse: 0.001,
      mismatchPixelCount: 0,
    });
  });

  it('maps raw comparison aliases onto the public contract fields', () => {
    const comparison = normalizeVerificationComparison({
      capture: 'actual.png',
      reference: 'expected.png',
      comparison: {
        pass: true,
        tolerance: 0.05,
        normalizedRmse: 0.001,
        mismatchPixels: 32,
        pixelCount: 6400,
      },
    });

    expect(comparison).toEqual({
      pass: true,
      tolerance: 0.05,
      capturePath: 'actual.png',
      referencePath: 'expected.png',
      rmse: 0.001,
      mismatchPixelCount: 32,
      mismatchPercentage: 0.5,
    });
  });

  it('normalizes automation run artifacts into verification artifacts', () => {
    const run = normalizeAutomationRunResult({
      runId: 'run-123',
      automationFilter: 'Smoke.UI',
      target: 'MyGameEditor',
      projectDir: 'C:/Projects/MyGame',
      nullRhi: false,
      completedAt: '2026-03-24T10:00:00Z',
      artifacts: [
        {
          name: 'MenuScreenshot',
          path: 'C:/Reports/menu.png',
          mimeType: 'image/png',
          relativePath: 'Images/menu.png',
        },
        {
          name: 'Log',
          path: 'C:/Reports/log.txt',
          mimeType: 'text/plain',
        },
      ],
    });

    expect(run.verificationArtifacts).toHaveLength(1);
    expect(run.verificationArtifacts[0]).toMatchObject({
      captureId: 'run-123:MenuScreenshot',
      captureType: 'automation_screenshot',
      surface: 'pie_runtime',
      scenarioId: 'automation:Smoke.UI:MenuScreenshot',
      resourceUri: '',
      mimeType: 'image/png',
      relativePath: 'Images/menu.png',
      worldContext: {
        contextType: 'automation_run',
        runId: 'run-123',
        automationFilter: 'Smoke.UI',
        target: 'MyGameEditor',
        projectDir: 'C:/Projects/MyGame',
        nullRhi: false,
        reportArtifactName: 'MenuScreenshot',
        relativePath: 'Images/menu.png',
      },
    });
  });
});
