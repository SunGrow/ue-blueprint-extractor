import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { isPlainObject } from './formatting.js';

type RecoverableToolFailure = {
  code: string;
  recoverable: boolean;
  retry_after_ms?: number;
  next_steps?: string[];
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
      isPlainObject(entry)
      && typeof entry.type === 'string'
      && entry.type !== 'text'
    ));
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
    const payload = isPlainObject(payloadOrError) ? { ...payloadOrError } : {};
    const diagnostics = Array.isArray(payload.diagnostics)
      ? payload.diagnostics
      : [];

    // Merge diagnostics from ueResponse if the error carries one (set by callSubsystemJson).
    if (
      diagnostics.length === 0
      && payloadOrError instanceof Error
      && isPlainObject((payloadOrError as any).ueResponse)
    ) {
      const ueResp = (payloadOrError as any).ueResponse as Record<string, unknown>;
      if (Array.isArray(ueResp.diagnostics)) {
        diagnostics.push(...ueResp.diagnostics);
      }
    }

    const firstDiagnostic = diagnostics.find((candidate) => (
      isPlainObject(candidate)
      && typeof candidate.message === 'string'
      && candidate.message.length > 0
    ));
    const existingContentText = existingResult
      && Array.isArray(existingResult.content)
      && isPlainObject(existingResult.content[0])
      && existingResult.content[0].type === 'text'
      && typeof existingResult.content[0].text === 'string'
      ? (existingResult.content[0].text as string).replace(/^Error:\s*/, '')
      : undefined;

    const message = typeof payload.message === 'string'
      ? payload.message.replace(/^Error:\s*/, '')
      : typeof payload.error === 'string'
        ? payload.error
        : (isPlainObject(firstDiagnostic) && typeof firstDiagnostic.message === 'string')
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
                      const keys = isPlainObject(payloadOrError) ? Object.keys(payloadOrError).join(', ') : '';
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
          (isPlainObject(firstDiagnostic) && typeof firstDiagnostic.code === 'string' && firstDiagnostic.code.length > 0)
            ? firstDiagnostic.code
            : 'tool_execution_failed'
        ),
      message,
      recoverable: typeof payload.recoverable === 'boolean'
        ? payload.recoverable
        : classification?.recoverable ?? true,
      ...(taskAwareTools.has(toolName) ? { execution: inferExecutionMetadata(toolName, payload) } : {}),
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
    const basePayload: Record<string, unknown> = isPlainObject(payload) ? payload : { data: payload };
    const success = typeof basePayload.success === 'boolean' ? basePayload.success : true;

    if (!success) {
      return normalizeToolError(toolName, basePayload);
    }

    const envelope: Record<string, unknown> = {
      ...basePayload,
      success: true,
      operation: typeof basePayload.operation === 'string' ? basePayload.operation : toolName,
      ...(taskAwareTools.has(toolName) ? { execution: inferExecutionMetadata(toolName, basePayload) } : {}),
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
