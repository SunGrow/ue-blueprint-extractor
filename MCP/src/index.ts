import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { UEClient } from './ue-client.js';

const client = new UEClient();

const server = new McpServer({
  name: 'blueprint-extractor',
  version: '1.0.0',
});

// Tool 1: extract_blueprint
server.tool(
  'extract_blueprint',
  'Extract a UE5 Blueprint asset to JSON. Returns the full Blueprint structure including class info, variables, components, and graph data.',
  {
    asset_path: z.string().describe('UE asset path, e.g. /Game/Blueprints/BP_Character'),
    scope: z.enum(['ClassLevel', 'Variables', 'Components', 'FunctionsShallow', 'Full', 'FullWithBytecode']).default('Full').describe('Extraction depth'),
  },
  async ({ asset_path, scope }) => {
    try {
      const result = await client.callSubsystem('ExtractBlueprint', { AssetPath: asset_path, Scope: scope });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      const text = JSON.stringify(parsed, null, 2);
      if (text.length > 200_000) {
        return { content: [{ type: 'text' as const, text: `Warning: Response is ${(text.length / 1024).toFixed(0)}KB. Consider using a narrower scope.\n\n${text.substring(0, 200_000)}...\n[TRUNCATED]` }] };
      }
      return { content: [{ type: 'text' as const, text }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
);

// Tool 2: extract_statetree
server.tool(
  'extract_statetree',
  'Extract a UE5 StateTree asset to JSON. Returns the full state hierarchy, tasks, conditions, and transitions.',
  {
    asset_path: z.string().describe('UE asset path to a StateTree, e.g. /Game/AI/ST_BotBehavior'),
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractStateTree', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
);

// Tool 3: extract_cascade
server.tool(
  'extract_cascade',
  'Extract multiple Blueprint/StateTree assets with cascade reference following. Writes results to files on disk.',
  {
    asset_paths: z.array(z.string()).describe('Array of UE asset paths to extract'),
    scope: z.enum(['ClassLevel', 'Variables', 'Components', 'FunctionsShallow', 'Full', 'FullWithBytecode']).default('Full').describe('Extraction depth'),
    max_depth: z.number().int().min(0).max(10).default(3).describe('How many levels deep to follow references'),
  },
  async ({ asset_paths, scope, max_depth }) => {
    try {
      const result = await client.callSubsystem('ExtractCascade', {
        AssetPathsJson: JSON.stringify(asset_paths),
        Scope: scope,
        MaxDepth: max_depth,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: `Extracted ${parsed.extracted_count} assets to ${parsed.output_directory}` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
);

// Tool 4: search_assets
server.tool(
  'search_assets',
  'Search for UE5 assets by name. Returns matching asset paths, names, and classes.',
  {
    query: z.string().describe('Search query to match against asset names'),
    class_filter: z.string().default('Blueprint').describe('Filter by asset class (e.g. Blueprint, StateTree, or empty for all)'),
  },
  async ({ query, class_filter }) => {
    try {
      const result = await client.callSubsystem('SearchAssets', { Query: query, ClassFilter: class_filter });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
);

// Tool 5: list_assets
server.tool(
  'list_assets',
  'List UE5 assets in a directory. Returns asset paths, names, and classes.',
  {
    package_path: z.string().describe('UE package path, e.g. /Game/Blueprints'),
    recursive: z.boolean().default(true).describe('Search subdirectories'),
    class_filter: z.string().default('').describe('Filter by asset class (empty for all)'),
  },
  async ({ package_path, recursive, class_filter }) => {
    try {
      const result = await client.callSubsystem('ListAssets', {
        PackagePath: package_path,
        bRecursive: recursive,
        ClassFilter: class_filter,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
