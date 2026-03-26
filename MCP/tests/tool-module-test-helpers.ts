import { z } from 'zod';
import { rawHandlerRegistry } from '../src/helpers/alias-registration.js';
import type { ToolHelpEntry } from '../src/helpers/tool-help.js';
import { getTextContent } from './test-helpers.js';

type RegisteredTool = {
  config: Record<string, unknown>;
  handler: (args: unknown) => Promise<unknown> | unknown;
};

export function createToolRegistry() {
  const tools = new Map<string, RegisteredTool>();
  const toolHelpRegistry = new Map<string, ToolHelpEntry>();

  return {
    server: {
      registerTool(name: string, config: Record<string, unknown>, handler: RegisteredTool['handler']) {
        tools.set(name, { config, handler });
        rawHandlerRegistry.set(name, handler as (args: Record<string, unknown>, extra: unknown) => Promise<unknown> | unknown);
        toolHelpRegistry.set(name, {
          title: (config.title as string) ?? name,
          description: (config.description as string) ?? '',
          inputSchema: (config.inputSchema ?? {}) as Record<string, z.ZodTypeAny>,
          outputSchema: z.object({}).passthrough(),
        });
      },
    },
    toolHelpRegistry,
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
