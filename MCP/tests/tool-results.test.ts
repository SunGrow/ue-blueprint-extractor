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

  it('produces a meaningful message from an empty error object', () => {
    const result = normalizeToolError('create_blueprint', {});

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      operation: 'create_blueprint',
    });
    const msg = (result.structuredContent as Record<string, unknown>).message as string;
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toBe('Unknown error');
  });

  it('produces a meaningful message from an error object with no message/error/diagnostics', () => {
    const result = normalizeToolError('modify_widget', { foo: 'bar', count: 42 });

    expect(result.isError).toBe(true);
    const msg = (result.structuredContent as Record<string, unknown>).message as string;
    expect(msg).toContain('modify_widget');
    expect(msg).toContain('foo');
  });

  it('handles non-Error thrown values: strings, numbers, undefined, null', () => {
    const stringResult = normalizeToolError('extract_blueprint', 'raw string error');
    expect(stringResult.isError).toBe(true);
    expect((stringResult.structuredContent as Record<string, unknown>).message).toBe('raw string error');

    const numberResult = normalizeToolError('extract_blueprint', 42);
    expect(numberResult.isError).toBe(true);
    const numMsg = (numberResult.structuredContent as Record<string, unknown>).message as string;
    expect(numMsg).toContain('42');

    const undefinedResult = normalizeToolError('extract_blueprint', undefined);
    expect(undefinedResult.isError).toBe(true);
    const undMsg = (undefinedResult.structuredContent as Record<string, unknown>).message as string;
    expect(undMsg.length).toBeGreaterThan(0);
    expect(undMsg).toContain('undefined');

    const nullResult = normalizeToolError('extract_blueprint', null);
    expect(nullResult.isError).toBe(true);
    const nullMsg = (nullResult.structuredContent as Record<string, unknown>).message as string;
    expect(nullMsg.length).toBeGreaterThan(0);
    expect(nullMsg).toContain('null');
  });

  it('preserves HTTP status code in error messages from UE responses', () => {
    const result = normalizeToolError(
      'create_blueprint',
      new Error('UE editor returned HTTP 500: {"errorCode":"INTERNAL","message":"Segfault in blueprint compiler"}'),
    );

    expect(result.isError).toBe(true);
    const msg = (result.structuredContent as Record<string, unknown>).message as string;
    expect(msg).toContain('500');
    expect(msg).toContain('Segfault');
  });

  it('detects subsystem {success: false} without error field via normalizeToolSuccess pass-through', () => {
    const result = normalizeToolSuccess('trigger_live_coding', {
      success: false,
      operation: 'trigger_live_coding',
      status: 'failure',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      operation: 'trigger_live_coding',
    });
  });

  it('null payloadOrError message includes "no error details" and tool name', () => {
    const result = normalizeToolError('search_assets', null);
    const msg = (result.structuredContent as Record<string, unknown>).message as string;
    expect(msg).toContain('no error details');
    expect(msg).toContain('search_assets');
  });

  it('undefined payloadOrError message includes "no error details"', () => {
    const result = normalizeToolError('search_assets', undefined);
    const msg = (result.structuredContent as Record<string, unknown>).message as string;
    expect(msg).toContain('no error details');
  });

  it('empty object {} payloadOrError produces a fallback message with tool name and serialized JSON', () => {
    const result = normalizeToolError('create_blueprint', {});
    const msg = (result.structuredContent as Record<string, unknown>).message as string;
    expect(msg).toContain('create_blueprint');
    expect(msg).toContain('{}');
  });

  it('random object payloadOrError includes key names and serialized JSON', () => {
    const result = normalizeToolError('create_blueprint', { foo: 'bar' });
    const msg = (result.structuredContent as Record<string, unknown>).message as string;
    expect(msg).toContain('keys [foo]');
    expect(msg).toContain('"bar"');
  });

  it('extracts error text from existingResult.content[0].text, stripping "Error: " prefix', () => {
    // When payloadOrError does not carry a message (e.g. a plain number),
    // the normalizer falls back to existingResult content text.
    const result = normalizeToolError('extract_blueprint', 42, {
      content: [{ type: 'text', text: 'Error: something broke' }],
    });
    expect(result.isError).toBe(true);
    const msg = (result.structuredContent as Record<string, unknown>).message as string;
    expect(msg).toBe('something broke');
    const textBlock = result.content[0] as { type: string; text: string };
    expect(textBlock.text).toBe('something broke');
  });

  it('uses existingResult content text as-is when there is no "Error: " prefix', () => {
    const result = normalizeToolError('extract_blueprint', 42, {
      content: [{ type: 'text', text: 'plain failure reason' }],
    });
    const msg = (result.structuredContent as Record<string, unknown>).message as string;
    expect(msg).toBe('plain failure reason');
  });

  it('extracts diagnostics from Error.ueResponse when available', () => {
    const err = new Error('Schema class not found');
    (err as any).ueResponse = {
      success: false,
      diagnostics: [
        { severity: 'error', code: 'SCHEMA_NOT_FOUND', message: 'Schema class not found: /Script/Foo.Bar' },
        { severity: 'warning', message: 'F-prefix was auto-normalized' },
      ],
    };

    const result = normalizeToolError('create_state_tree', err);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.diagnostics).toHaveLength(2);
    expect((structured.diagnostics as any[])[0].code).toBe('SCHEMA_NOT_FOUND');
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
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'editor unavailable while extracting',
      },
      {
        type: 'resource_link',
        uri: 'blueprint://captures/capture-123',
        name: 'Capture',
      },
    ]);
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
