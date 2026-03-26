import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolHelpEntry, ToolInputSchema } from './tool-help.js';

type RawToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown> | unknown;

// Global alias map: old name -> new name
export const aliasMap = new Map<string, string>();

// Registry for raw (pre-normalization) handlers, keyed by tool name.
// Populated by installNormalizedToolRegistration and used by alias delegation.
export const rawHandlerRegistry = new Map<string, RawToolHandler>();

export function registerAlias(
  server: McpServer,
  oldName: string,
  targetName: string,
  parameterMapping: (args: Record<string, unknown>) => Record<string, unknown>,
  deprecationMessage: string,
  toolHelpRegistry: Map<string, ToolHelpEntry>,
  aliasInputSchema?: ToolInputSchema,
): void {
  const targetEntry = toolHelpRegistry.get(targetName);
  if (!targetEntry) {
    throw new Error(`Cannot register alias '${oldName}': target tool '${targetName}' not found in registry`);
  }

  const targetHandler = rawHandlerRegistry.get(targetName);
  if (!targetHandler) {
    throw new Error(`Cannot register alias '${oldName}': no raw handler found for target tool '${targetName}'`);
  }

  aliasMap.set(oldName, targetName);

  const aliasDescription = `[DEPRECATED: use ${targetName}] ${targetEntry.description}`;

  server.registerTool(
    oldName,
    {
      title: `${targetEntry.title} (deprecated alias)`,
      description: aliasDescription,
      inputSchema: aliasInputSchema ?? targetEntry.inputSchema,
      annotations: {
        ...targetEntry.annotations,
      },
    },
    async (args: Record<string, unknown>, extra: unknown) => {
      const mappedArgs = parameterMapping(args);
      return targetHandler(mappedArgs, extra) as any;
    },
  );

  toolHelpRegistry.set(oldName, {
    ...targetEntry,
    title: `${targetEntry.title} (deprecated alias)`,
    description: `Alias for ${targetName}. ${deprecationMessage} ${targetEntry.description}`,
    annotations: {
      ...targetEntry.annotations,
    },
  });
}
