import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


export function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
        }
      } catch {
        return [trimmed];
      }
    }

    return [trimmed];
  }

  return [];
}

export function formatPromptValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.stringify(value, null, 2);
  }

  return null;
}

export function formatPromptList(label: string, value: unknown, fallback: string): string {
  const entries = coerceStringArray(value);
  return entries.length > 0
    ? `${label}:\n${entries.map((entry) => `- ${entry}`).join('\n')}`
    : fallback;
}

export function formatPromptBlock(label: string, value: unknown, fallback: string): string {
  const formatted = formatPromptValue(value);
  return formatted ? `${label}:\n${formatted}` : fallback;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tryParseJsonText(text: string | undefined): unknown {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function extractTextContent(result: unknown): string | undefined {
  if (!isPlainObject(result) || !Array.isArray(result.content)) {
    return undefined;
  }

  const entry = result.content.find((candidate) => isPlainObject(candidate) && candidate.type === 'text');
  return isPlainObject(entry) && typeof entry.text === 'string' ? entry.text : undefined;
}

export function extractToolPayload(result: unknown): unknown {
  if (isPlainObject(result) && 'structuredContent' in result) {
    return result.structuredContent;
  }

  if (isPlainObject(result) && Array.isArray(result.content)) {
    const text = extractTextContent(result);
    const parsed = tryParseJsonText(text);
    if (parsed !== undefined) {
      return parsed;
    }

    if (text) {
      return { message: text };
    }
  }

  return result;
}

function isContentBlock(value: unknown): value is ContentBlock {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'text':
      return typeof value.text === 'string';
    case 'image':
    case 'audio':
      return typeof value.data === 'string' && typeof value.mimeType === 'string';
    case 'resource_link':
      return typeof value.uri === 'string' && typeof value.name === 'string';
    case 'resource':
      return isPlainObject(value.resource)
        && typeof value.resource.uri === 'string'
        && typeof value.resource.mimeType === 'string'
        && (
          typeof value.resource.text === 'string'
          || typeof value.resource.blob === 'string'
        );
    default:
      return false;
  }
}

export function extractExtraContent(result: unknown): ContentBlock[] {
  if (!isPlainObject(result) || !Array.isArray(result.content)) {
    return [];
  }

  return result.content.filter((candidate): candidate is ContentBlock => (
    isContentBlock(candidate)
  ));
}

export function maybeBoolean(...values: Array<unknown>): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }

  return undefined;
}

export function firstDefinedString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}
