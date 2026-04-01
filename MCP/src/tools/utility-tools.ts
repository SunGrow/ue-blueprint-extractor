import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type ToolInputSchema = Record<string, z.ZodTypeAny>;

type ToolHelpEntry = {
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  outputSchema: z.ZodTypeAny;
  annotations?: Record<string, unknown>;
};

type RegisterUtilityToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  getToolHelpEntry: (toolName: string) => ToolHelpEntry | undefined;
  summarizeSchemaFields: (shape: ToolInputSchema) => Array<Record<string, unknown>>;
  summarizeOutputSchema: (schema: z.ZodTypeAny) => Record<string, unknown>;
  collectRelatedResources: (toolName: string) => string[];
  collectToolExampleFamilies: (toolName: string) => Array<Record<string, unknown>>;
};

export function registerUtilityTools({
  server,
  callSubsystemJson,
  getToolHelpEntry,
  summarizeSchemaFields,
  summarizeOutputSchema,
  collectRelatedResources,
  collectToolExampleFamilies,
}: RegisterUtilityToolsOptions): void {
  server.registerTool(
    'save_assets',
    {
      title: 'Save Assets',
      description: 'Persist dirty UE asset packages explicitly.',
      inputSchema: {
        asset_paths: z.array(z.string()).describe(
          'UE content paths to save.',
        ),
      },
      annotations: {
        title: 'Save Assets',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_paths }) => {
      try {
        const parsed = await callSubsystemJson('SaveAssets', {
          AssetPathsJson: JSON.stringify(asset_paths),
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'get_tool_help',
    {
      title: 'Get Tool Help',
      description: 'Return help for one registered tool, including parameter summaries and related resources.',
      inputSchema: {
        tool_name: z.string().describe(
          'Tool name to inspect.',
        ),
      },
      annotations: {
        title: 'Get Tool Help',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ tool_name }) => {
      const entry = getToolHelpEntry(tool_name);
      if (!entry) {
        return jsonToolError(new Error(`Unknown tool '${tool_name}'.`));
      }

      return jsonToolSuccess({
        success: true,
        operation: 'get_tool_help',
        tool: {
          name: tool_name,
          title: entry.title,
          description: entry.description,
          annotations: entry.annotations ?? {},
          parameters: summarizeSchemaFields(entry.inputSchema),
          output: summarizeOutputSchema(entry.outputSchema),
          relatedResources: collectRelatedResources(tool_name),
          exampleFamilies: collectToolExampleFamilies(tool_name),
        },
      });
    },
  );
}
