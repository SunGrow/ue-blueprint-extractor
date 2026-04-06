import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  jsonToolError,
  jsonToolSuccess,
} from '../helpers/subsystem.js';
import { isPlainObject } from '../helpers/formatting.js';
import { promptCatalog } from '../prompts/prompt-catalog.js';
import {
  ProjectIndexStatusResultSchema,
  RefreshProjectIndexResultSchema,
  SearchProjectContextResultSchema,
} from '../schemas/tool-results.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterProjectIntelligenceToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  workspaceRoot?: string;
};

type IndexedEntry = {
  id: string;
  sourceType: 'asset' | 'doc' | 'prompt' | 'resource';
  title: string;
  description: string;
  body: string;
  uri?: string;
  filePath?: string;
  assetPath?: string;
  assetClass?: string;
};

type ProjectIndexState = {
  packagePath: string;
  generatedAt: string;
  entries: IndexedEntry[];
  assetCount: number;
  repoDocCount: number;
  promptCount: number;
  resourceCount: number;
};

const PROJECT_INDEX_STALE_MS = 15 * 60 * 1000;

const publishedResourceContext: IndexedEntry[] = [
  {
    id: 'resource-extraction-scopes',
    sourceType: 'resource',
    title: 'Blueprint Extraction Scopes',
    description: 'Reference for Blueprint extraction scopes and when to use them.',
    uri: 'blueprint://scopes',
    body: [
      'ClassLevel covers inheritance and metadata.',
      'Variables focuses on the Blueprint data model.',
      'Components surfaces component or widget hierarchy.',
      'FunctionsShallow lists graphs without deep node payloads.',
      'Full returns full graph nodes, pins, and connections.',
    ].join('\n'),
  },
  {
    id: 'resource-write-capabilities',
    sourceType: 'resource',
    title: 'Blueprint Extractor Write Capabilities',
    description: 'Reference for write-capable asset families and explicit-save rules.',
    uri: 'blueprint://write-capabilities',
    body: [
      'Writes mutate the live UE editor but do not auto-save packages.',
      'WidgetBlueprint, CommonUI styles, DataAssets, DataTables, curves, materials, animation metadata, and Blueprint members are supported.',
      'save_assets is the shared persistence step.',
    ].join('\n'),
  },
  {
    id: 'resource-project-automation',
    sourceType: 'resource',
    title: 'Project Automation',
    description: 'Reference for editor/project identity and automation-backed project control.',
    uri: 'blueprint://project-automation',
    body: [
      'get_project_automation_context exposes coarse editor-derived identity and build context.',
      'Project-control tools handle launch, wait, restart, PIE, external build, live coding orchestration, and editor log inspection.',
      'Use read_output_log for buffered editor log lines, list_message_log_listings to probe Message Log listings, and read_message_log to inspect one listing.',
    ].join('\n'),
  },
  {
    id: 'resource-analysis-workflows',
    sourceType: 'resource',
    title: 'Blueprint Analysis Workflows',
    description: 'Job-based entry paths for reviewing Blueprint assets and interpreting deterministic findings.',
    uri: 'blueprint://analysis-workflows',
    body: [
      'Use review_blueprint for deterministic graph and variable checks.',
      'Expect findings to include severity, category, evidence, and next_steps.',
      'Review stays read-only and should be followed by extract_blueprint when deeper raw evidence is needed.',
    ].join('\n'),
  },
  {
    id: 'resource-project-intelligence-workflows',
    sourceType: 'resource',
    title: 'Project Intelligence Workflows',
    description: 'Job-based entry paths for understanding a project, searching published context, snapshotting editor context, and auditing assets.',
    uri: 'blueprint://project-intelligence-workflows',
    body: [
      'refresh_project_index caches asset metadata plus published docs, prompts, and resources.',
      'search_project_context returns snippet-first results with provenance and staleness markers.',
      'get_editor_context should remain bounded and session-bound.',
      'audit_project_assets summarizes low-noise metadata issues by check family.',
    ].join('\n'),
  },
];

function readOnlyAnnotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function normalizeListedAsset(entry: Record<string, unknown>) {
  return {
    assetPath: String(
      entry.assetPath
      ?? entry.asset_path
      ?? entry.PackagePath
      ?? entry.package_path
      ?? entry.path
      ?? '',
    ),
    assetName: String(
      entry.assetName
      ?? entry.asset_name
      ?? entry.Name
      ?? entry.name
      ?? '',
    ),
    assetClass: String(
      entry.assetClass
      ?? entry.className
      ?? entry.class_name
      ?? entry.class
      ?? '',
    ),
  };
}

function getListedAssets(parsed: Record<string, unknown>) {
  const rawAssets = Array.isArray(parsed.assets)
    ? parsed.assets
    : Array.isArray(parsed)
      ? parsed
      : [];
  return rawAssets
    .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
    .map(normalizeListedAsset);
}

function buildStatus(state: ProjectIndexState | null, packagePath: string) {
  if (!state) {
    return {
      package_path: packagePath,
      generated_at: null,
      age_ms: null,
      stale: true,
      asset_count: 0,
      repo_doc_count: 0,
      prompt_count: 0,
      resource_count: 0,
      entry_count: 0,
    };
  }

  const ageMs = Math.max(0, Date.now() - Date.parse(state.generatedAt));
  return {
    package_path: state.packagePath,
    generated_at: state.generatedAt,
    age_ms: ageMs,
    stale: ageMs > PROJECT_INDEX_STALE_MS,
    asset_count: state.assetCount,
    repo_doc_count: state.repoDocCount,
    prompt_count: state.promptCount,
    resource_count: state.resourceCount,
    entry_count: state.entries.length,
  };
}

async function safeReadText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function tokenizeQuery(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0),
  )];
}

function scoreEntry(entry: IndexedEntry, tokens: string[], loweredQuery: string) {
  const title = entry.title.toLowerCase();
  const description = entry.description.toLowerCase();
  const body = entry.body.toLowerCase();
  let score = 0;

  if (loweredQuery.length > 0 && title.includes(loweredQuery)) {
    score += 10;
  }
  if (loweredQuery.length > 0 && body.includes(loweredQuery)) {
    score += 4;
  }

  for (const token of tokens) {
    if (title.includes(token)) score += 5;
    if (description.includes(token)) score += 3;
    if (body.includes(token)) score += 1;
  }

  return score;
}

function buildSnippet(entry: IndexedEntry, token: string) {
  const sources: Array<{ field: 'title' | 'description' | 'content' | 'metadata'; text: string }> = [
    { field: 'title', text: entry.title },
    { field: 'description', text: entry.description },
    { field: 'content', text: entry.body },
  ];

  for (const source of sources) {
    const lowered = source.text.toLowerCase();
    const matchIndex = lowered.indexOf(token);
    if (matchIndex >= 0) {
      const start = Math.max(0, matchIndex - 48);
      const end = Math.min(source.text.length, matchIndex + token.length + 72);
      return {
        field: source.field,
        text: source.text.slice(start, end).trim(),
        match_start: matchIndex - start,
        match_end: matchIndex - start + token.length,
      };
    }
  }

  return {
    field: 'content' as const,
    text: entry.body.slice(0, 120).trim() || entry.description.slice(0, 120).trim() || entry.title,
  };
}

async function loadRepoDocs(workspaceRoot: string): Promise<IndexedEntry[]> {
  const docPaths = [
    'README.md',
    path.join('docs', 'CURRENT_STATUS.md'),
    path.join('docs', 'testing.md'),
    path.join('docs', 'plans', '2026-03-30-post-stabilization-improvement-plan.md'),
  ];

  const loaded: Array<IndexedEntry | null> = await Promise.all(docPaths.map(async (relativePath) => {
    const absolutePath = path.join(workspaceRoot, relativePath);
    const text = await safeReadText(absolutePath);
    if (!text) {
      return null;
    }
    return {
      id: `doc:${relativePath.replaceAll('\\', '/')}`,
      sourceType: 'doc' as const,
      title: path.basename(relativePath),
      description: `Repository document ${relativePath.replaceAll('\\', '/')}.`,
      body: text,
      filePath: absolutePath,
    };
  }));

  return loaded.filter((entry): entry is IndexedEntry => entry !== null);
}

function loadPromptEntries(): IndexedEntry[] {
  return Object.entries(promptCatalog).map(([name, entry]) => ({
    id: `prompt:${name}`,
    sourceType: 'prompt',
    title: entry.title,
    description: entry.description,
    body: [
      entry.title,
      entry.description,
      `Arguments: ${Object.keys(entry.args).join(', ') || 'none'}.`,
    ].join('\n'),
    uri: `blueprint://prompt/${name}`,
  }));
}

function loadAssetEntries(assets: Array<{ assetPath: string; assetName: string; assetClass: string }>): IndexedEntry[] {
  return assets.map((asset) => ({
    id: `asset:${asset.assetPath}`,
    sourceType: 'asset',
    title: asset.assetName || asset.assetPath,
    description: `${asset.assetClass} asset metadata`,
    body: [
      asset.assetName,
      asset.assetClass,
      asset.assetPath,
    ].filter((value) => value.length > 0).join('\n'),
    assetPath: asset.assetPath,
    assetClass: asset.assetClass,
  }));
}

export function registerProjectIntelligenceTools({
  server,
  callSubsystemJson,
  workspaceRoot = process.cwd(),
}: RegisterProjectIntelligenceToolsOptions): void {
  let indexState: ProjectIndexState | null = null;

  const refreshIndex = async (packagePath: string): Promise<ProjectIndexState> => {
    const [assetsResponse, repoDocs] = await Promise.all([
      callSubsystemJson('ListAssets', {
        PackagePath: packagePath,
        bRecursive: true,
        ClassFilter: '',
      }),
      loadRepoDocs(workspaceRoot),
    ]);

    const assets = getListedAssets(assetsResponse);
    const assetEntries = loadAssetEntries(assets);
    const promptEntries = loadPromptEntries();
    const resourceEntries = publishedResourceContext;

    indexState = {
      packagePath,
      generatedAt: new Date().toISOString(),
      entries: [
        ...assetEntries,
        ...repoDocs,
        ...promptEntries,
        ...resourceEntries,
      ],
      assetCount: assetEntries.length,
      repoDocCount: repoDocs.length,
      promptCount: promptEntries.length,
      resourceCount: resourceEntries.length,
    };

    return indexState;
  };

  server.registerTool(
    'refresh_project_index',
    {
      title: 'Refresh Project Index',
      description: 'Refresh the in-memory project index from asset metadata plus published docs, prompts, and resources.',
      inputSchema: {
        package_path: z.string().default('/Game').describe(
          'UE package path to index.',
        ),
      },
      outputSchema: RefreshProjectIndexResultSchema,
      annotations: readOnlyAnnotations('Refresh Project Index'),
    },
    async ({ package_path }) => {
      try {
        const nextState = await refreshIndex(package_path);
        return jsonToolSuccess({
          success: true,
          operation: 'refresh_project_index',
          refreshed: true,
          ...buildStatus(nextState, package_path),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'get_project_index_status',
    {
      title: 'Get Project Index Status',
      description: 'Report the current in-memory project index status and freshness.',
      inputSchema: {},
      outputSchema: ProjectIndexStatusResultSchema,
      annotations: readOnlyAnnotations('Get Project Index Status'),
    },
    async () => {
      try {
        const status = buildStatus(indexState, indexState?.packagePath ?? '/Game');
        return jsonToolSuccess({
          success: true,
          operation: 'get_project_index_status',
          ...status,
          ...(indexState
            ? {}
            : { message: 'No cached project index exists yet. Run refresh_project_index to warm the cache.' }),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'search_project_context',
    {
      title: 'Search Project Context',
      description: 'Search indexed asset metadata plus published docs, prompts, and resources with snippet-first results.',
      inputSchema: {
        query: z.string().describe(
          'Search term.',
        ),
        package_path: z.string().optional().describe(
          'Package path to refresh if uncached.',
        ),
        source_types: z.array(z.enum(['asset', 'doc', 'prompt', 'resource'])).optional().describe(
          'Source-type filter.',
        ),
        page: z.number().int().min(1).default(1).describe(
          'Page number.',
        ),
        per_page: z.number().int().min(1).max(50).default(10).describe(
          'Results per page.',
        ),
      },
      outputSchema: SearchProjectContextResultSchema,
      annotations: readOnlyAnnotations('Search Project Context'),
    },
    async ({ query, package_path, source_types, page, per_page }) => {
      try {
        const requestedPackagePath = package_path ?? indexState?.packagePath ?? '/Game';
        if (!indexState || indexState.packagePath !== requestedPackagePath) {
          await refreshIndex(requestedPackagePath);
        }

        const activeIndex = indexState;
        if (!activeIndex) {
          throw new Error('Project index could not be initialized.');
        }

        const status = buildStatus(activeIndex, requestedPackagePath);
        const loweredQuery = query.trim().toLowerCase();
        const tokens = tokenizeQuery(query);
        const allowedSourceTypes = new Set(source_types ?? ['asset', 'doc', 'prompt', 'resource']);

        const ranked = activeIndex.entries
          .filter((entry) => allowedSourceTypes.has(entry.sourceType))
          .map((entry) => ({
            entry,
            score: scoreEntry(entry, tokens, loweredQuery),
          }))
          .filter((candidate) => candidate.score > 0)
          .sort((left, right) => (
            right.score - left.score
            || left.entry.title.localeCompare(right.entry.title)
          ));

        const totalCount = ranked.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / per_page));
        const startIndex = (page - 1) * per_page;
        const results = ranked.slice(startIndex, startIndex + per_page).map(({ entry, score }) => ({
          source_id: entry.id,
          source_type: entry.sourceType,
          title: entry.title,
          score,
          stale: status.stale,
          ...(entry.uri ? { uri: entry.uri } : {}),
          ...(entry.filePath ? { path: entry.filePath } : {}),
          ...(entry.assetPath ? { asset_path: entry.assetPath } : {}),
          ...(entry.assetClass ? { asset_class: entry.assetClass } : {}),
          snippets: [buildSnippet(entry, tokens[0] ?? loweredQuery)],
        }));

        return jsonToolSuccess({
          success: true,
          operation: 'search_project_context',
          query,
          page,
          per_page,
          total_count: totalCount,
          total_pages: totalPages,
          has_more: page < totalPages,
          stale: status.stale,
          generated_at: status.generated_at,
          results,
          ...(status.stale
            ? { message: 'Search results were served from a stale project index. Run refresh_project_index to refresh asset metadata and published context.' }
            : {}),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
