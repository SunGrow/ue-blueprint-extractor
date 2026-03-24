import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { isRecord } from './formatting.js';

type SubsystemClientLike = {
  callSubsystem(method: string, params: Record<string, unknown>): Promise<string>;
};

export async function callSubsystemJson(
  client: SubsystemClientLike,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callSubsystem(method, params);
  const parsed = JSON.parse(result) as Record<string, unknown>;
  if (typeof parsed.error === 'string' && parsed.error.length > 0) {
    throw new Error(parsed.error);
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

export function jsonToolError(e: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}
