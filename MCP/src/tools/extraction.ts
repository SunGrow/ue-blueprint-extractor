import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  compactBehaviorTree,
  compactBlueprint,
  compactGenericExtraction,
  compactMaterial,
  compactStateTree,
} from '../compactor.js';
import {
  jsonToolError,
  jsonToolSuccess,
} from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterExtractionToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  scopeEnum: z.ZodType<string>;
  extractAssetTypeSchema: z.ZodTypeAny;
  cascadeResultSchema: z.ZodTypeAny;
};

const extractAssetMethods = {
  statetree: 'ExtractStateTree',
  data_asset: 'ExtractDataAsset',
  data_table: 'ExtractDataTable',
  behavior_tree: 'ExtractBehaviorTree',
  blackboard: 'ExtractBlackboard',
  user_defined_struct: 'ExtractUserDefinedStruct',
  user_defined_enum: 'ExtractUserDefinedEnum',
  curve: 'ExtractCurve',
  curve_table: 'ExtractCurveTable',
  material_instance: 'ExtractMaterialInstance',
  anim_sequence: 'ExtractAnimSequence',
  anim_montage: 'ExtractAnimMontage',
  blend_space: 'ExtractBlendSpace',
} as const;

function readOnlyAnnotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

export function registerExtractionTools({
  server,
  callSubsystemJson,
  scopeEnum,
  extractAssetTypeSchema,
  cascadeResultSchema,
}: RegisterExtractionToolsOptions): void {
  server.registerTool(
    'extract_blueprint',
    {
      title: 'Extract Blueprint',
      description: 'Extract a UE5 Blueprint asset to structured JSON with configurable scope, graph filtering, compact output, and class defaults.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the Blueprint asset.',
        ),
        scope: scopeEnum.default('Variables').describe(
          'Extraction depth. Use Full only for graph or node details.',
        ),
        graph_filter: z.array(z.string()).optional().describe(
          'Filter to specific graph names. Omit to extract all graphs.',
        ),
        compact: z.boolean().default(false).describe(
          'Minify JSON by stripping low-value fields (~50-70% smaller).',
        ),
        include_class_defaults: z.boolean().default(false).describe(
          'Include generated-class default values that differ from the parent class.',
        ),
      },
      annotations: readOnlyAnnotations('Extract Blueprint'),
    },
    async ({ asset_path, scope, graph_filter, compact, include_class_defaults }) => {
      try {
        let parsed = await callSubsystemJson('ExtractBlueprint', {
          AssetPath: asset_path,
          Scope: scope,
          GraphFilter: graph_filter ? graph_filter.join(',') : '',
          bIncludeClassDefaults: include_class_defaults,
        });
        if (compact) {
          parsed = compactBlueprint(parsed) as Record<string, unknown>;
        }
        const text = compact ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
        if (text.length > 200_000) {
          return {
            content: [{
              type: 'text' as const,
              text: `Warning: Response is ${(text.length / 1024).toFixed(0)}KB — consider using a narrower scope (ClassLevel, Variables, or FunctionsShallow).\n\n${text.substring(0, 200_000)}...\n[TRUNCATED]`,
            }],
          };
        }
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'extract_asset',
    {
      title: 'Extract Asset',
      description: 'Extract one supported UE asset family to structured JSON through a single routed tool.',
      inputSchema: {
        asset_type: extractAssetTypeSchema.describe(
          'Asset family to extract.',
        ),
        asset_path: z.string().describe(
          'UE content path to the asset.',
        ),
        compact: z.boolean().default(false).describe(
          'Strip GUIDs, positions, and empty containers from the result.',
        ),
      },
      annotations: readOnlyAnnotations('Extract Asset'),
    },
    async (args) => {
      try {
        const {
          asset_type,
          asset_path,
          compact,
        } = args as {
          asset_type: keyof typeof extractAssetMethods;
          asset_path: string;
          compact: boolean;
        };

        let parsed = await callSubsystemJson(extractAssetMethods[asset_type], { AssetPath: asset_path });
        if (compact) {
          switch (asset_type) {
            case 'behavior_tree':
              parsed = compactBehaviorTree(parsed) as Record<string, unknown>;
              break;
            case 'statetree':
              parsed = compactStateTree(parsed) as Record<string, unknown>;
              break;
            default:
              parsed = compactGenericExtraction(parsed) as Record<string, unknown>;
              break;
          }
        }

        if (asset_type === 'data_table') {
          const text = JSON.stringify(parsed, null, 2);
          if (text.length > 200_000) {
            return {
              content: [{
                type: 'text' as const,
                text: `Warning: Response is ${(text.length / 1024).toFixed(0)}KB — large DataTable.\n\n${text.substring(0, 200_000)}...\n[TRUNCATED]`,
              }],
            };
          }
        }

        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'extract_material',
    {
      title: 'Extract Material',
      description: 'Extract a compact classic material graph snapshot.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the Material asset.',
        ),
        verbose: z.boolean().default(false).describe(
          'Include more authored property detail for expressions and comments.',
        ),
        compact: z.boolean().default(false).describe(
          'Strip layout noise and shorten expression references.',
        ),
      },
      annotations: readOnlyAnnotations('Extract Material'),
    },
    async ({ asset_path, verbose, compact }) => {
      try {
        let parsed = await callSubsystemJson('ExtractMaterial', {
          AssetPath: asset_path,
          bVerbose: verbose,
        });
        if (compact) {
          parsed = compactMaterial(parsed) as Record<string, unknown>;
        }
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'extract_material_function',
    {
      title: 'Extract Material Function',
      description: 'Extract a compact graph snapshot for a material function, layer, or layer blend asset.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the MaterialFunction-family asset.',
        ),
        verbose: z.boolean().default(false).describe(
          'Include more authored property detail for expressions and comments.',
        ),
        compact: z.boolean().default(false).describe(
          'Strip layout noise and shorten expression references.',
        ),
      },
      annotations: readOnlyAnnotations('Extract Material Function'),
    },
    async ({ asset_path, verbose, compact }) => {
      try {
        let parsed = await callSubsystemJson('ExtractMaterialFunction', {
          AssetPath: asset_path,
          bVerbose: verbose,
        });
        if (compact) {
          parsed = compactMaterial(parsed) as Record<string, unknown>;
        }
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'extract_cascade',
    {
      title: 'Extract Cascade',
      description: 'Extract multiple asset types with dependency-chain reference following and return a manifest summary.',
      inputSchema: {
        asset_paths: z.array(z.string()).describe(
          'Array of UE content paths to extract (e.g. ["/Game/Blueprints/BP_Character", "/Game/Blueprints/BP_Weapon"])',
        ),
        scope: scopeEnum.default('Full').describe(
          'Extraction depth applied to all assets. Full is the default since cascade is typically used for deep analysis.',
        ),
        max_depth: z.number().int().min(0).max(10).default(3).describe(
          'How many levels deep to follow references (0 = only the listed assets, 3 = default)',
        ),
        graph_filter: z.array(z.string()).optional().describe(
          'Filter to specific graph names. Omit to extract all graphs.',
        ),
        compact: z.boolean().default(false).describe(
          'Strip layout noise for LLM consumption.',
        ),
      },
      outputSchema: cascadeResultSchema,
      annotations: {
        title: 'Extract Cascade',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_paths, scope, max_depth, graph_filter, compact }) => {
      try {
        const parsed = await callSubsystemJson('ExtractCascade', {
          AssetPathsJson: JSON.stringify(asset_paths),
          Scope: scope,
          MaxDepth: max_depth,
          GraphFilter: graph_filter ? graph_filter.join(',') : '',
        });
        const manifest = (
          Array.isArray(parsed.manifest)
            ? parsed.manifest
            : Array.isArray(parsed.assets)
              ? parsed.assets
              : []
        ) as Record<string, unknown>[];

        const compactedManifest = compact
          ? manifest.map((entry) => compactGenericExtraction(entry) as Record<string, unknown>)
          : manifest;

        const totalCount = typeof parsed.total_count === 'number' ? parsed.total_count : manifest.length;
        const extractedCount = typeof parsed.extracted_count === 'number'
          ? parsed.extracted_count
          : manifest.filter((asset) => asset.status === 'extracted').length;
        const skippedCount = typeof parsed.skipped_count === 'number'
          ? parsed.skipped_count
          : manifest.filter((asset) => asset.status === 'skipped').length;

        return jsonToolSuccess({
          extracted_count: extractedCount,
          skipped_count: skippedCount,
          total_count: totalCount,
          output_directory: typeof parsed.output_directory === 'string' ? parsed.output_directory : '',
          manifest: compactedManifest,
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'search_assets',
    {
      title: 'Search Assets',
      description: 'Search for UE5 assets by name with an optional class filter.',
      inputSchema: {
        query: z.string().describe(
          'Search term to match against asset names. Partial matches work (e.g. "Player" finds "BP_PlayerCharacter").',
        ),
        class_filter: z.string().default('Blueprint').describe(
          'Filter by asset class. Use an empty string to search all asset types.',
        ),
        max_results: z.number().int().min(1).max(200).default(50).describe(
          'Maximum number of results to return. Lower values keep the response small and the query fast.',
        ),
      },
      annotations: readOnlyAnnotations('Search Assets'),
    },
    async ({ query, class_filter, max_results }) => {
      try {
        const parsed = await callSubsystemJson('SearchAssets', {
          Query: query,
          ClassFilter: class_filter,
          MaxResults: max_results,
        });
        return jsonToolSuccess(Array.isArray(parsed.results) ? parsed.results : []);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'list_assets',
    {
      title: 'List Assets',
      description: 'List UE5 assets under a package path, optionally recursively.',
      inputSchema: {
        package_path: z.string().describe(
          'UE package path to list (e.g. /Game/Blueprints, /Game/AI). Use /Game to list from the Content root.',
        ),
        recursive: z.boolean().default(true).describe(
          'Whether to include assets in subdirectories.',
        ),
        class_filter: z.string().default('').describe(
          'Filter by asset class (e.g. "Blueprint", "StateTree"). Empty string returns all asset types.',
        ),
      },
      annotations: readOnlyAnnotations('List Assets'),
    },
    async ({ package_path, recursive, class_filter }) => {
      try {
        const parsed = await callSubsystemJson('ListAssets', {
          PackagePath: package_path,
          bRecursive: recursive,
          ClassFilter: class_filter,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
