import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  safeCall,
  compositeSuccess,
  compositeError,
  compositePartialFailure,
  type CompositeStepResult,
  type CompositeToolResult,
} from '../helpers/composite-patterns.js';
import { filterPhantomAssets } from '../helpers/phantom-filter.js';
import { jsonToolSuccess } from '../helpers/subsystem.js';
import type { ToolHelpEntry } from '../helpers/tool-help.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterCompositeToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  toolHelpRegistry: Map<string, ToolHelpEntry>;
};

const EXECUTION: CompositeToolResult['execution'] = {
  mode: 'immediate',
  task_support: 'optional',
};

interface SearchResult {
  assetPath?: string;
  asset_path?: string;
  className?: string;
  class_name?: string;
  [key: string]: unknown;
}

function getAssetPath(result: SearchResult): string {
  return result.assetPath ?? result.asset_path ?? '';
}

function compositeResult(composite: CompositeToolResult, options?: { isError?: boolean }) {
  const result = jsonToolSuccess(composite as unknown as Record<string, unknown>);
  if (options?.isError) {
    return { ...result, isError: true };
  }
  return result;
}

function compositeErrorResult(composite: CompositeToolResult, errorText: string) {
  return {
    content: [{ type: 'text' as const, text: errorText }],
    structuredContent: composite as unknown as Record<string, unknown>,
    isError: true,
  };
}

async function performExtraction(
  callSubsystemJson: JsonSubsystemCaller,
  extractType: string,
  assetPath: string,
  options: {
    scope?: string;
    compact?: boolean;
    verbose?: boolean;
    include_class_defaults?: boolean;
    animation_name?: string;
    max_depth?: number;
  },
): Promise<Record<string, unknown>> {
  switch (extractType) {
    case 'blueprint':
      return callSubsystemJson('ExtractBlueprint', {
        AssetPath: assetPath,
        Scope: options.scope ?? 'Variables',
        GraphFilter: '',
        bIncludeClassDefaults: options.include_class_defaults ?? false,
      });

    case 'asset':
      return callSubsystemJson('ExtractDataAsset', {
        AssetPath: assetPath,
      });

    case 'material':
      return callSubsystemJson('ExtractMaterial', {
        AssetPath: assetPath,
        bVerbose: options.verbose ?? false,
      });

    case 'widget_blueprint':
      return callSubsystemJson('ExtractWidgetBlueprint', {
        AssetPath: assetPath,
        bIncludeClassDefaults: options.include_class_defaults ?? false,
      });

    case 'widget_animation':
      return callSubsystemJson('ExtractWidgetAnimation', {
        AssetPath: assetPath,
        AnimationName: options.animation_name ?? '',
      });

    case 'cascade':
      return callSubsystemJson('ExtractCascade', {
        AssetPathsJson: JSON.stringify([assetPath]),
        Scope: options.scope ?? 'Full',
        MaxDepth: options.max_depth ?? 3,
        GraphFilter: '',
      });

    case 'commonui_button_style':
      return callSubsystemJson('ExtractBlueprint', {
        AssetPath: assetPath,
        Scope: 'ClassLevel',
        GraphFilter: '',
        bIncludeClassDefaults: true,
      });

    default:
      throw new Error(`Unsupported extract_type: ${extractType}`);
  }
}

export function registerCompositeTools({
  server,
  callSubsystemJson,
  toolHelpRegistry,
}: RegisterCompositeToolsOptions): void {
  server.registerTool(
    'find_and_extract',
    {
      title: 'Find and Extract',
      description: 'Search for an asset by name and extract it in one step. Auto-extracts when a single result is found.',
      inputSchema: {
        query: z.string().describe('Asset name search query'),
        class_filter: z.string().default('Blueprint').describe('Asset class filter for search'),
        max_search_results: z.number().int().min(1).max(50).default(10),
        extract_type: z.enum([
          'blueprint', 'asset', 'material', 'widget_blueprint',
          'widget_animation', 'cascade', 'commonui_button_style',
        ]).default('blueprint'),
        auto_extract_if_single: z.boolean().default(true),
        scope: z.enum([
          'ClassLevel', 'Variables', 'Components',
          'FunctionsShallow', 'Full', 'FullWithBytecode',
        ]).optional(),
        compact: z.boolean().default(true),
        verbose: z.boolean().optional(),
        include_class_defaults: z.boolean().optional(),
        animation_name: z.string().optional(),
        max_depth: z.number().int().min(0).max(10).optional(),
        asset_paths: z.array(z.string()).optional().describe(
          'Override: extract these paths directly instead of searching',
        ),
      },
      annotations: {
        title: 'Find and Extract',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const {
        query,
        class_filter,
        max_search_results,
        extract_type,
        auto_extract_if_single,
        scope,
        compact,
        verbose,
        include_class_defaults,
        animation_name,
        max_depth,
        asset_paths,
      } = args as {
        query: string;
        class_filter: string;
        max_search_results: number;
        extract_type: string;
        auto_extract_if_single: boolean;
        scope?: string;
        compact: boolean;
        verbose?: boolean;
        include_class_defaults?: boolean;
        animation_name?: string;
        max_depth?: number;
        asset_paths?: string[];
      };

      const extractOptions = { scope, compact, verbose, include_class_defaults, animation_name, max_depth };

      // Direct extraction when asset_paths provided — skip search
      if (asset_paths && asset_paths.length > 0) {
        const steps: CompositeStepResult[] = [
          { step: 'search', status: 'skipped', message: 'asset_paths provided; search skipped' },
        ];

        for (const path of asset_paths) {
          const extractResult = await safeCall(() =>
            performExtraction(callSubsystemJson, extract_type, path, extractOptions),
          );

          if (extractResult.ok) {
            steps.push({
              step: `extract:${path}`,
              status: 'success',
              data: extractResult.value,
            });
          } else {
            steps.push({
              step: `extract:${path}`,
              status: 'failure',
              message: extractResult.error.message,
            });
          }
        }

        const anyFailure = steps.some(s => s.status === 'failure');
        if (anyFailure) {
          const failedStep = steps.find(s => s.status === 'failure')!;
          return compositeResult(
            compositePartialFailure(
              'find_and_extract', steps, failedStep.step,
              {
                completed_steps: steps.filter(s => s.status === 'success').map(s => s.step),
                failed_step: failedStep.step,
                editor_state: 'No mutations performed; editor state unchanged',
              },
              EXECUTION,
            ),
            { isError: true },
          );
        }

        return compositeResult(compositeSuccess('find_and_extract', steps, EXECUTION));
      }

      // Step 1: Search
      const searchResult = await safeCall(() =>
        callSubsystemJson('SearchAssets', {
          Query: query,
          ClassFilter: class_filter,
          MaxResults: max_search_results,
        }),
      );

      if (!searchResult.ok) {
        const steps: CompositeStepResult[] = [
          { step: 'search', status: 'failure', message: searchResult.error.message },
        ];
        return compositeErrorResult(
          compositeError('find_and_extract', steps, 'search', EXECUTION),
          `Error: Search failed — ${searchResult.error.message}`,
        );
      }

      const rawResults: SearchResult[] = Array.isArray(searchResult.value.results)
        ? searchResult.value.results as SearchResult[]
        : [];

      // Filter phantom assets
      const { filtered: results, removedCount } = await filterPhantomAssets(rawResults, callSubsystemJson);

      // No results
      if (results.length === 0) {
        const steps: CompositeStepResult[] = [
          {
            step: 'search',
            status: 'failure',
            message: `No assets found matching "${query}" with class filter "${class_filter}"`,
          },
        ];
        return compositeErrorResult(
          compositeError('find_and_extract', steps, 'search', EXECUTION),
          `No assets found matching "${query}"`,
        );
      }

      const searchStep: CompositeStepResult = {
        step: 'search',
        status: 'success',
        message: removedCount > 0
          ? `Found ${results.length} result(s) (${removedCount} phantom asset(s) filtered)`
          : `Found ${results.length} result(s)`,
        data: { results, ...(removedCount > 0 ? { _filtered_count: removedCount } : {}) },
      };

      // Multiple results or auto_extract disabled → return search results for selection
      if (results.length > 1 || !auto_extract_if_single) {
        return compositeResult(
          compositeSuccess(
            'find_and_extract',
            [
              searchStep,
              { step: 'extract', status: 'skipped', message: 'Multiple results; awaiting selection' },
            ],
            { ...EXECUTION, needs_selection: true } as CompositeToolResult['execution'] & { needs_selection: boolean },
          ),
        );
      }

      // Single result — auto-extract
      const selectedPath = getAssetPath(results[0]);

      const extractResult = await safeCall(() =>
        performExtraction(callSubsystemJson, extract_type, selectedPath, extractOptions),
      );

      if (!extractResult.ok) {
        const steps: CompositeStepResult[] = [
          searchStep,
          { step: 'extract', status: 'failure', message: extractResult.error.message },
        ];
        return compositeErrorResult(
          compositePartialFailure(
            'find_and_extract', steps, 'extract',
            {
              completed_steps: ['search'],
              failed_step: 'extract',
              editor_state: 'No mutations performed; editor state unchanged',
            },
            EXECUTION,
          ),
          `Error: Extraction failed — ${extractResult.error.message}`,
        );
      }

      return compositeResult(
        compositeSuccess(
          'find_and_extract',
          [
            searchStep,
            {
              step: 'extract',
              status: 'success',
              message: `Extracted ${selectedPath}`,
              data: extractResult.value,
            },
          ],
          EXECUTION,
        ),
      );
    },
  );

  toolHelpRegistry.set('find_and_extract', {
    title: 'Find and Extract',
    description: 'Search for an asset by name and extract it in one step. Auto-extracts when a single result is found.',
    inputSchema: {} as Record<string, z.ZodTypeAny>,
    outputSchema: z.object({}).passthrough(),
  });
}
