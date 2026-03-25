import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { isRecord } from './formatting.js';

export interface SubsystemCallOptions {
  timeoutMs?: number;
}

type SubsystemClientLike = {
  callSubsystem(method: string, params: Record<string, unknown>, options?: SubsystemCallOptions): Promise<string>;
};

export async function callSubsystemJson(
  client: SubsystemClientLike,
  method: string,
  params: Record<string, unknown>,
  options?: SubsystemCallOptions,
): Promise<Record<string, unknown>> {
  const result = await client.callSubsystem(method, params, options);

  if (process.env.MCP_DEBUG_RESPONSES) {
    process.stderr.write(`[MCP_DEBUG] ${method} raw response: ${result}\n`);
  }

  const parsed = JSON.parse(result) as Record<string, unknown>;

  if (typeof parsed.error === 'string' && parsed.error.length > 0) {
    throw new Error(parsed.error);
  }

  // Check for error-only failure responses (success: false with an explicit error message
  // but no business-level fields). Structured responses with success: false are passed
  // through so tool code can inspect them for orchestration (e.g., fallback strategies).
  if (parsed.success === false) {
    const explicitMessage = parsed.message ?? parsed.errorMessage;
    if (typeof explicitMessage === 'string' && explicitMessage.length > 0) {
      throw new Error(explicitMessage);
    }
  }

  // Catch structured error responses with diagnostics but no explicit message.
  // These come from FAssetMutationContext.BuildResult(false) in the C++ plugin.
  if (parsed.success === false
    && Array.isArray(parsed.diagnostics)
    && parsed.diagnostics.length > 0) {
    const messages = parsed.diagnostics
      .filter((d: unknown): d is Record<string, unknown> =>
        typeof d === 'object' && d !== null && typeof (d as Record<string, unknown>).message === 'string')
      .map((d: Record<string, unknown>) => d.message as string);
    const synthesized = messages.length > 0
      ? messages.join('; ')
      : `Operation failed with ${parsed.diagnostics.length} diagnostic(s)`;
    const err = new Error(synthesized);
    (err as any).ueResponse = parsed;
    throw err;
  }

  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(typeof firstError === 'string' ? firstError : JSON.stringify(firstError));
  }

  if (Object.keys(parsed).length === 0) {
    throw new Error('Empty response from subsystem');
  }

  return parsed;
}

export function jsonToolSuccess(
  parsed: unknown,
  options: {
    extraContent?: ContentBlock[];
  } = {},
): CallToolResult & { structuredContent: Record<string, unknown> } {
  const structuredContent = isRecord(parsed) ? parsed : { data: parsed };
  return {
    content: options.extraContent ? [...options.extraContent] : [],
    structuredContent,
  };
}

/**
 * Strips the C++ 'F' prefix from USTRUCT script paths.
 * UE registers USTRUCTs without the F prefix in script paths.
 * e.g., /Script/Module.FSTCFoo → /Script/Module.STCFoo
 *
 * Only strips when the class name starts with F followed by an uppercase letter,
 * matching the UE USTRUCT naming convention.
 */
export function normalizeUStructPath(path: string): string {
  return path.replace(/^(\/Script\/[^.]+\.)F([A-Z])/, '$1$2');
}

export function normalizeUStructPaths(paths: string[]): { normalized: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const normalized = paths.map(p => {
    const result = normalizeUStructPath(p);
    if (result !== p) {
      warnings.push(`Auto-normalized F-prefix: "${p}" → "${result}"`);
    }
    return result;
  });
  return { normalized, warnings };
}

export function jsonToolError(e: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}
