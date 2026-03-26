import { describe, expect, it } from 'vitest';
import {
  safeCall,
  compositeSuccess,
  compositeError,
  compositePartialFailure,
  type CompositeStepResult,
  type CompositeToolResult,
} from '../src/helpers/composite-patterns.js';

describe('composite-patterns', () => {
  const immediateExecution: CompositeToolResult['execution'] = {
    mode: 'immediate',
    task_support: 'forbidden',
    status: 'completed',
  };

  describe('safeCall', () => {
    it('returns ok result on success', async () => {
      const result = await safeCall(async () => 42);
      expect(result).toEqual({ ok: true, value: 42 });
    });

    it('returns error result when function throws an Error', async () => {
      const result = await safeCall(async () => { throw new Error('boom'); });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('boom');
      }
    });

    it('wraps non-Error thrown values in an Error', async () => {
      const result = await safeCall(async () => { throw 'string-error'; });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('string-error');
      }
    });

    it('handles async functions that return promises', async () => {
      const result = await safeCall(() => Promise.resolve('hello'));
      expect(result).toEqual({ ok: true, value: 'hello' });
    });
  });

  describe('compositeSuccess', () => {
    it('returns a success result with all steps', () => {
      const steps: CompositeStepResult[] = [
        { step: 'search', status: 'success', message: 'Found asset' },
        { step: 'extract', status: 'success', data: { path: '/Game/BP' } },
      ];

      const result = compositeSuccess('find_and_extract', steps, immediateExecution);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('find_and_extract');
      expect(result.steps).toEqual(steps);
      expect(result.execution).toEqual(immediateExecution);
      expect(result.partial_state).toBeUndefined();
    });
  });

  describe('compositeError', () => {
    it('returns a failure result with partial_state derived from steps', () => {
      const steps: CompositeStepResult[] = [
        { step: 'search', status: 'success' },
        { step: 'extract', status: 'failure', message: 'Asset not found' },
      ];

      const result = compositeError('find_and_extract', steps, 'extract', immediateExecution);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('find_and_extract');
      expect(result.partial_state).toEqual({
        completed_steps: ['search'],
        failed_step: 'extract',
        editor_state: 'No mutations performed; editor state unchanged',
      });
    });

    it('completed_steps excludes failed and skipped steps', () => {
      const steps: CompositeStepResult[] = [
        { step: 'a', status: 'success' },
        { step: 'b', status: 'success' },
        { step: 'c', status: 'failure' },
        { step: 'd', status: 'skipped' },
      ];

      const result = compositeError('op', steps, 'c', immediateExecution);

      expect(result.partial_state!.completed_steps).toEqual(['a', 'b']);
    });

    it('completed_steps is empty when the first step fails', () => {
      const steps: CompositeStepResult[] = [
        { step: 'first', status: 'failure' },
      ];

      const result = compositeError('op', steps, 'first', immediateExecution);

      expect(result.partial_state!.completed_steps).toEqual([]);
    });
  });

  describe('compositePartialFailure', () => {
    it('returns failure with caller-provided partial_state', () => {
      const steps: CompositeStepResult[] = [
        { step: 'search', status: 'success' },
        { step: 'mutate', status: 'failure', message: 'Compile error' },
      ];

      const partialState = {
        completed_steps: ['search'],
        failed_step: 'mutate',
        editor_state: 'Widget tree partially applied; unsaved',
      };

      const result = compositePartialFailure('apply_design', steps, 'mutate', partialState, immediateExecution);

      expect(result.success).toBe(false);
      expect(result.partial_state).toEqual(partialState);
      expect(result.steps).toEqual(steps);
    });

    it('accepts undefined partial_state', () => {
      const steps: CompositeStepResult[] = [
        { step: 'a', status: 'failure' },
      ];

      const result = compositePartialFailure('op', steps, 'a', undefined, immediateExecution);

      expect(result.success).toBe(false);
      expect(result.partial_state).toBeUndefined();
    });
  });
});
