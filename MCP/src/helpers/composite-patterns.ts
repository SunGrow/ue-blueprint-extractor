export interface CompositeStepResult {
  step: string;
  status: 'success' | 'failure' | 'skipped';
  message?: string;
  data?: Record<string, unknown>;
  diagnostics?: Array<{ severity?: string; code?: string; message?: string; path?: string }>;
}

export interface CompositeToolResult {
  success: boolean;
  operation: string;
  steps: CompositeStepResult[];
  partial_state?: {
    completed_steps: string[];
    failed_step: string;
    editor_state: string;
  };
  execution: {
    mode: 'immediate' | 'task_aware';
    task_support: 'optional' | 'required' | 'forbidden';
    status?: string;
    progress_message?: string;
  };
}

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export async function safeCall<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export function compositeSuccess(operation: string, steps: CompositeStepResult[], execution: CompositeToolResult['execution']): CompositeToolResult {
  return { success: true, operation, steps, execution };
}

export function compositeError(operation: string, steps: CompositeStepResult[], failedStep: string, execution: CompositeToolResult['execution']): CompositeToolResult {
  return {
    success: false,
    operation,
    steps,
    partial_state: {
      completed_steps: steps.filter(s => s.status === 'success').map(s => s.step),
      failed_step: failedStep,
      editor_state: 'No mutations performed; editor state unchanged',
    },
    execution,
  };
}

export function compositePartialFailure(operation: string, steps: CompositeStepResult[], failedStep: string, partialState: CompositeToolResult['partial_state'], execution: CompositeToolResult['execution']): CompositeToolResult {
  return { success: false, operation, steps, partial_state: partialState, execution };
}
