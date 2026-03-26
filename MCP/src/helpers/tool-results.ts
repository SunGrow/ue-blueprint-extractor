import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { aliasMap } from './alias-registration.js';
import { isRecord } from './formatting.js';

type RecoverableToolFailure = {
  code: string;
  recoverable: boolean;
  retry_after_ms?: number;
  next_steps: string[];
};

type ToolFailureClassifier = (
  toolName: string,
  message: string,
) => RecoverableToolFailure | null;

type CreateToolResultNormalizersOptions = {
  taskAwareTools: ReadonlySet<string>;
  classifyRecoverableToolFailure: ToolFailureClassifier;
};

export function createToolResultNormalizers({
  taskAwareTools,
  classifyRecoverableToolFailure,
}: CreateToolResultNormalizersOptions) {
  function extractNonTextContent(
    existingResult?: Partial<CallToolResult> & Record<string, unknown>,
  ): ContentBlock[] {
    if (!existingResult || !Array.isArray(existingResult.content)) {
      return [];
    }

    return existingResult.content.filter((entry): entry is ContentBlock => (
      isRecord(entry)
      && typeof entry.type === 'string'
      && entry.type !== 'text'
    ));
  }

  function defaultNextSteps(toolName: string, payload?: Record<string, unknown>): string[] {
    const resolvedName = aliasMap.get(toolName) ?? toolName;

    if (resolvedName === 'wait_for_editor') {
      return [
        'Retry wait_for_editor if the editor is still restarting.',
        'Once connected=true, rerun the blocked editor-backed tool.',
      ];
    }

    if (resolvedName === 'compile_widget_blueprint') {
      return [
        'Inspect compile.messages and diagnostics for the first failing widget or property.',
        'Re-extract the widget blueprint before applying the next structural patch.',
        'Check BindWidget names/types and any abstract classes referenced by the widget tree.',
      ];
    }

    if (taskAwareTools.has(resolvedName)) {
      return [
        'Inspect the returned execution.status and diagnostics before retrying.',
        'Poll the task-oriented status tool again if the operation is still running.',
      ];
    }

    if (payload?.validateOnly === true) {
      return [
        'Fix the reported validation issues and rerun the same call.',
      ];
    }

    return [
      'Inspect diagnostics and validation details, then retry the same operation.',
      'Use validate_only=true first if the tool supports it and you need more actionable failures.',
    ];
  }

  function inferExecutionMetadata(toolName: string, payload?: Record<string, unknown>) {
    const taskSupport = taskAwareTools.has(toolName) ? 'optional' : 'forbidden';
    const mode = taskSupport === 'optional' ? 'task_aware' : 'immediate';
    const status = typeof payload?.status === 'string'
      ? payload.status
      : typeof payload?.compileResult === 'string'
        ? payload.compileResult
        : payload?.terminal === false
          ? 'running'
          : 'completed';
    const progressMessage = typeof payload?.reason === 'string'
      ? payload.reason
      : typeof payload?.summary === 'string'
        ? payload.summary
        : undefined;

    return {
      mode,
      task_support: taskSupport,
      status,
      ...(progressMessage ? { progress_message: progressMessage } : {}),
    };
  }

  function normalizeToolError(
    toolName: string,
    payloadOrError: unknown,
    existingResult?: Partial<CallToolResult> & Record<string, unknown>,
  ): CallToolResult & Record<string, unknown> {
    const payload = isRecord(payloadOrError) ? { ...payloadOrError } : {};
    const diagnostics = Array.isArray(payload.diagnostics)
      ? payload.diagnostics
      : [];

    // Merge diagnostics from ueResponse if the error carries one (set by callSubsystemJson).
    if (
      diagnostics.length === 0
      && payloadOrError instanceof Error
      && isRecord((payloadOrError as any).ueResponse)
    ) {
      const ueResp = (payloadOrError as any).ueResponse as Record<string, unknown>;
      if (Array.isArray(ueResp.diagnostics)) {
        diagnostics.push(...ueResp.diagnostics);
      }
    }

    const firstDiagnostic = diagnostics.find((candidate) => (
      isRecord(candidate)
      && typeof candidate.message === 'string'
      && candidate.message.length > 0
    ));
    const existingContentText = existingResult
      && Array.isArray(existingResult.content)
      && isRecord(existingResult.content[0])
      && existingResult.content[0].type === 'text'
      && typeof existingResult.content[0].text === 'string'
      ? (existingResult.content[0].text as string).replace(/^Error:\s*/, '')
      : undefined;

    const message = typeof payload.message === 'string'
      ? payload.message.replace(/^Error:\s*/, '')
      : typeof payload.error === 'string'
        ? payload.error
        : (isRecord(firstDiagnostic) && typeof firstDiagnostic.message === 'string')
          ? firstDiagnostic.message
          : payloadOrError instanceof Error
            ? payloadOrError.message
            : typeof payloadOrError === 'string'
              ? payloadOrError.replace(/^Error:\s*/, '')
              : typeof existingContentText === 'string'
                ? existingContentText
                : payloadOrError == null
                  ? `Tool '${toolName}' failed with no error details (received ${String(payloadOrError)})`
                  : (() => {
                      const type = (payloadOrError as Record<string, unknown>)?.constructor?.name ?? typeof payloadOrError;
                      const keys = isRecord(payloadOrError) ? Object.keys(payloadOrError).join(', ') : '';
                      const truncatedJson = (() => {
                        try { const s = JSON.stringify(payloadOrError); return s.length > 500 ? s.slice(0, 500) + '…' : s; }
                        catch { return '[unserializable]'; }
                      })();
                      return keys
                        ? `Tool '${toolName}' failed — received ${type} with keys [${keys}]: ${truncatedJson}`
                        : `Tool '${toolName}' failed — received ${type}: ${truncatedJson}`;
                    })();
    const classification = classifyRecoverableToolFailure(toolName, message);
    const envelope: Record<string, unknown> = {
      ...payload,
      success: false,
      operation: typeof payload.operation === 'string' ? payload.operation : toolName,
      code: typeof payload.code === 'string'
        ? payload.code
        : classification?.code ?? (
          (isRecord(firstDiagnostic) && typeof firstDiagnostic.code === 'string' && firstDiagnostic.code.length > 0)
            ? firstDiagnostic.code
            : 'tool_execution_failed'
        ),
      message,
      recoverable: typeof payload.recoverable === 'boolean'
        ? payload.recoverable
        : classification?.recoverable ?? true,
      next_steps: Array.isArray(payload.next_steps)
        ? payload.next_steps
        : classification?.next_steps ?? defaultNextSteps(toolName, payload),
      execution: inferExecutionMetadata(toolName, payload),
    };

    if (typeof payload.retry_after_ms === 'number' && Number.isFinite(payload.retry_after_ms)) {
      envelope.retry_after_ms = payload.retry_after_ms;
    } else if (typeof classification?.retry_after_ms === 'number') {
      envelope.retry_after_ms = classification.retry_after_ms;
    }

    if (diagnostics.length > 0) {
      envelope.diagnostics = diagnostics;
    }

    return {
      ...(existingResult ?? {}),
      content: [
        { type: 'text' as const, text: message },
        ...extractNonTextContent(existingResult),
      ],
      structuredContent: envelope,
      isError: true,
    };
  }

  function normalizeToolSuccess(
    toolName: string,
    payload: unknown,
    extraContent: ContentBlock[] = [],
  ): CallToolResult & Record<string, unknown> {
    const basePayload: Record<string, unknown> = isRecord(payload) ? payload : { data: payload };
    const success = typeof basePayload.success === 'boolean' ? basePayload.success : true;

    if (!success) {
      return normalizeToolError(toolName, basePayload);
    }

    const envelope: Record<string, unknown> = {
      ...basePayload,
      success: true,
      operation: typeof basePayload.operation === 'string' ? basePayload.operation : toolName,
      execution: inferExecutionMetadata(toolName, basePayload),
    };

    return {
      content: extraContent,
      structuredContent: envelope,
    };
  }

  return {
    normalizeToolError,
    normalizeToolSuccess,
  };
}
