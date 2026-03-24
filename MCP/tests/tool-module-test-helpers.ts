import { getTextContent } from './test-helpers.js';

type RegisteredTool = {
  config: Record<string, unknown>;
  handler: (args: unknown) => Promise<unknown> | unknown;
};

export function createToolRegistry() {
  const tools = new Map<string, RegisteredTool>();

  return {
    server: {
      registerTool(name: string, config: Record<string, unknown>, handler: RegisteredTool['handler']) {
        tools.set(name, { config, handler });
      },
    },
    getTool(name: string): RegisteredTool {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool '${name}' was not registered.`);
      }

      return tool;
    },
  };
}

export function parseDirectToolResult(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) {
    return result;
  }

  const structuredContent = (result as { structuredContent?: unknown }).structuredContent;
  if (structuredContent !== undefined) {
    return structuredContent;
  }

  const text = getTextContent(result as { content?: Array<{ text?: string; type: string }> });
  if (!text) {
    return result;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
