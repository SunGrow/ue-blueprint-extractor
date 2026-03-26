import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  compactBehaviorTree,
  compactBlueprint,
  compactGenericExtraction,
  compactMaterial,
  compactStateTree,
} from '../compactor.js';
import { filterPhantomAssets } from '../helpers/phantom-filter.js';
import { isOverBudget } from '../helpers/token-budget.js';
import { summarizeResponse } from '../helpers/response-summarizer.js';
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
        compact: z.boolean().default(true).describe(
          'Return compact output (set false for raw).',
        ),
        include_class_defaults: z.boolean().default(false).describe(
          'Include generated-class default values that differ from the parent class.',
        ),
        verbose: z.boolean().default(false).describe(
          'When true, skip budget enforcement and return full data regardless of size.',
        ),
      },
      annotations: readOnlyAnnotations('Extract Blueprint'),
    },
    async ({ asset_path, scope, graph_filter, compact, include_class_defaults, verbose: rawVerbose }) => {
      const verbose = rawVerbose ?? false;
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
        const extraContent: Array<{ type: 'text'; text: string }> = [];
        if (text.length > 200_000) {
          extraContent.push({
            type: 'text',
            text: `Warning: Response is ${(text.length / 1024).toFixed(0)}KB (${text.length} chars). Consider using a narrower scope (ClassLevel, Variables, or FunctionsShallow) first, then Full with graph_filter for specific functions.`,
          });
        }

        // Budget enforcement (Task 4.5 + 4.6)
        if (!verbose) {
          const budget = isOverBudget(parsed);
          if (budget.over) {
            const summary = summarizeResponse(parsed, 'blueprint');
            return jsonToolSuccess({
              ...summary.data,
              _truncated: true,
              _omitted_sections: summary.omittedSections,
              _recommendations: ['Use extract_blueprint with verbose: true for full data', 'Use a narrower scope (ClassLevel, Variables, FunctionsShallow) first'],
            }, { extraContent });
          }
        }

        return jsonToolSuccess(parsed, { extraContent });
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
        compact: z.boolean().default(true).describe(
          'Return compact output (set false for raw).',
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

        const extraContent: Array<{ type: 'text'; text: string }> = [];
        if (asset_type === 'data_table') {
          const text = JSON.stringify(parsed, null, 2);
          if (text.length > 200_000) {
            extraContent.push({
              type: 'text',
              text: `Warning: Response is ${(text.length / 1024).toFixed(0)}KB (${text.length} chars) — large DataTable. Consider filtering rows or extracting a subset.`,
            });
          }
        }

        return jsonToolSuccess(parsed, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'extract_material',
    {
      title: 'Extract Material',
      description: 'Extract a compact material graph snapshot for a material, material function, layer, or layer blend asset.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the material-family asset.',
        ),
        asset_kind: z.enum(['material', 'function', 'layer', 'layer_blend']).default('material').describe(
          'Material asset subtype.',
        ),
        verbose: z.boolean().default(false).describe(
          'Include more authored property detail for expressions and comments.',
        ),
        compact: z.boolean().default(true).describe(
          'Return compact output (set false for raw).',
        ),
      },
      annotations: readOnlyAnnotations('Extract Material'),
    },
    async ({ asset_path, asset_kind = 'material', verbose, compact }) => {
      try {
        const method = asset_kind === 'material' ? 'ExtractMaterial' : 'ExtractMaterialFunction';
        let parsed = await callSubsystemJson(method, {
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
        compact: z.boolean().default(true).describe(
          'Return compact output (set false for raw).',
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
        page: z.number().int().min(1).default(1).describe(
          'Page number for paginated results.',
        ),
        per_page: z.number().int().min(1).max(200).default(50).describe(
          'Number of results per page.',
        ),
        sort_by: z.enum(['path', 'name', 'class']).default('path').describe(
          'Sort results by the specified field.',
        ),
      },
      annotations: readOnlyAnnotations('Search Assets'),
    },
    async ({ query, class_filter, max_results, page: rawPage, per_page: rawPerPage, sort_by: rawSortBy }) => {
      const page = rawPage ?? 1;
      const per_page = rawPerPage ?? 50;
      const sort_by = rawSortBy ?? 'path';
      try {
        const parsed = await callSubsystemJson('SearchAssets', {
          Query: query,
          ClassFilter: class_filter,
          MaxResults: max_results,
        });
        const rawResults = Array.isArray(parsed.results) ? parsed.results as Record<string, unknown>[] : [];
        const { filtered, removedCount } = await filterPhantomAssets(rawResults, callSubsystemJson);

        // Sort results
        const sorted = [...filtered].sort((a, b) => {
          let aVal: string, bVal: string;
          switch (sort_by) {
            case 'name':
              aVal = String(a.name ?? a.Name ?? a.assetName ?? '');
              bVal = String(b.name ?? b.Name ?? b.assetName ?? '');
              break;
            case 'class':
              aVal = String(a.className ?? a.class_name ?? a.assetClass ?? '');
              bVal = String(b.className ?? b.class_name ?? b.assetClass ?? '');
              break;
            default: // 'path'
              aVal = String(a.assetPath ?? a.asset_path ?? a.PackagePath ?? '');
              bVal = String(b.assetPath ?? b.asset_path ?? b.PackagePath ?? '');
              break;
          }
          return aVal.localeCompare(bVal);
        });

        // Paginate
        const totalCount = sorted.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / per_page));
        const startIndex = (page - 1) * per_page;
        const pageResults = sorted.slice(startIndex, startIndex + per_page);

        return jsonToolSuccess({
          results: pageResults,
          page,
          per_page,
          total_count: totalCount,
          total_pages: totalPages,
          has_more: page < totalPages,
          ...(removedCount > 0 ? { _filtered_count: removedCount } : {}),
        });
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
        page: z.number().int().min(1).default(1).describe(
          'Page number for paginated results.',
        ),
        per_page: z.number().int().min(1).max(200).default(50).describe(
          'Number of results per page.',
        ),
        sort_by: z.enum(['path', 'name', 'class']).default('path').describe(
          'Sort results by the specified field.',
        ),
      },
      annotations: readOnlyAnnotations('List Assets'),
    },
    async ({ package_path, recursive, class_filter, page: rawPage, per_page: rawPerPage, sort_by: rawSortBy }) => {
      const page = rawPage ?? 1;
      const per_page = rawPerPage ?? 50;
      const sort_by = rawSortBy ?? 'path';
      try {
        const parsed = await callSubsystemJson('ListAssets', {
          PackagePath: package_path,
          bRecursive: recursive,
          ClassFilter: class_filter,
        });

        const rawAssets = Array.isArray(parsed.assets) ? parsed.assets as Record<string, unknown>[] : [];

        // Sort results
        const sorted = [...rawAssets].sort((a, b) => {
          let aVal: string, bVal: string;
          switch (sort_by) {
            case 'name':
              aVal = String(a.name ?? a.Name ?? a.assetName ?? '');
              bVal = String(b.name ?? b.Name ?? b.assetName ?? '');
              break;
            case 'class':
              aVal = String(a.className ?? a.class_name ?? a.assetClass ?? '');
              bVal = String(b.className ?? b.class_name ?? b.assetClass ?? '');
              break;
            default: // 'path'
              aVal = String(a.assetPath ?? a.asset_path ?? a.PackagePath ?? '');
              bVal = String(b.assetPath ?? b.asset_path ?? b.PackagePath ?? '');
              break;
          }
          return aVal.localeCompare(bVal);
        });

        // Paginate
        const totalCount = sorted.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / per_page));
        const startIndex = (page - 1) * per_page;
        const pageAssets = sorted.slice(startIndex, startIndex + per_page);

        return jsonToolSuccess({
          assets: pageAssets,
          page,
          per_page,
          total_count: totalCount,
          total_pages: totalPages,
          has_more: page < totalPages,
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'check_asset_exists',
    {
      title: 'Check Asset Exists',
      description: 'Check whether a UE asset exists at the given path. Returns existence status, asset class, and package path.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to check (e.g. /Game/Blueprints/BP_Player).',
        ),
      },
      annotations: readOnlyAnnotations('Check Asset Exists'),
    },
    async ({ asset_path }) => {
      try {
        const lastSlash = asset_path.lastIndexOf('/');
        const parentDir = lastSlash > 0 ? asset_path.slice(0, lastSlash) : '/Game';

        const parsed = await callSubsystemJson('ListAssets', {
          PackagePath: parentDir,
          bRecursive: false,
          ClassFilter: '',
        });

        const assets = Array.isArray(parsed.assets) ? parsed.assets as Record<string, unknown>[] : [];
        const match = assets.find((a) => {
          const path = a.assetPath ?? a.asset_path ?? a.PackagePath ?? a.package_path ?? '';
          return path === asset_path;
        });

        if (match) {
          return jsonToolSuccess({
            exists: true,
            asset_class: String(match.className ?? match.class_name ?? match.assetClass ?? null),
            package_path: String(match.assetPath ?? match.asset_path ?? match.PackagePath ?? asset_path),
          });
        }

        return jsonToolSuccess({
          exists: false,
          asset_class: null,
          package_path: asset_path,
        });
      } catch {
        // If listing fails (e.g., invalid path), the asset does not exist
        return jsonToolSuccess({
          exists: false,
          asset_class: null,
          package_path: asset_path,
        });
      }
    },
  );
}
