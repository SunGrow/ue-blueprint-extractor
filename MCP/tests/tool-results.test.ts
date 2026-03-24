import { describe, expect, it } from 'vitest';
import { createToolResultNormalizers } from '../src/helpers/tool-results.js';

describe('tool result normalizers', () => {
  const { normalizeToolError, normalizeToolSuccess } = createToolResultNormalizers({
    taskAwareTools: new Set(['run_automation_tests']),
    classifyRecoverableToolFailure: (_toolName, message) => {
      if (message.includes('editor unavailable')) {
        return {
          code: 'editor_unavailable',
          recoverable: true,
          retry_after_ms: 1000,
          next_steps: ['Call wait_for_editor.'],
        };
      }

      return null;
    },
  });

  it('uses structuredContent as the canonical success payload and preserves non-text content', () => {
    const result = normalizeToolSuccess(
      'run_automation_tests',
      {
        success: true,
        runId: 'run-123',
        status: 'running',
        terminal: false,
      },
      [{
        type: 'resource_link',
        uri: 'blueprint://test-runs/run-123/report.json',
        name: 'Automation Report',
      }],
    );

    expect(result.content).toEqual([{
      type: 'resource_link',
      uri: 'blueprint://test-runs/run-123/report.json',
      name: 'Automation Report',
    }]);
    expect(result.structuredContent).toMatchObject({
      success: true,
      operation: 'run_automation_tests',
      runId: 'run-123',
      execution: {
        mode: 'task_aware',
        task_support: 'optional',
        status: 'running',
      },
    });
  });

  it('normalizes errors without re-emitting text blocks and preserves non-text artifacts', () => {
    const result = normalizeToolError(
      'extract_blueprint',
      new Error('editor unavailable while extracting'),
      {
        content: [
          {
            type: 'text',
            text: 'legacy text payload',
          },
          {
            type: 'resource_link',
            uri: 'blueprint://captures/capture-123',
            name: 'Capture',
          },
        ],
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{
      type: 'resource_link',
      uri: 'blueprint://captures/capture-123',
      name: 'Capture',
    }]);
    expect(result.structuredContent).toMatchObject({
      success: false,
      operation: 'extract_blueprint',
      code: 'editor_unavailable',
      recoverable: true,
      retry_after_ms: 1000,
      next_steps: ['Call wait_for_editor.'],
      message: 'editor unavailable while extracting',
      execution: {
        mode: 'immediate',
        task_support: 'forbidden',
        status: 'completed',
      },
    });
  });
});
