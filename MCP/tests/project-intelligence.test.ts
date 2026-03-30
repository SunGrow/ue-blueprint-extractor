import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { promptCatalog } from '../src/prompts/prompt-catalog.js';
import { registerProjectIntelligenceTools } from '../src/tools/project-intelligence.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function createWorkspaceFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'bp-project-intel-'));
  cleanups.push(async () => rm(root, { recursive: true, force: true }));

  await mkdir(path.join(root, 'docs', 'plans'), { recursive: true });
  await writeFile(path.join(root, 'README.md'), '# Blueprint Extractor\nSearchable workspace readme.\n', 'utf8');
  await writeFile(path.join(root, 'docs', 'CURRENT_STATUS.md'), 'Current contract status.\n', 'utf8');
  await writeFile(path.join(root, 'docs', 'testing.md'), 'Testing guide.\n', 'utf8');
  await writeFile(
    path.join(root, 'docs', 'plans', '2026-03-30-post-stabilization-improvement-plan.md'),
    'Improvement plan.\n',
    'utf8',
  );

  return root;
}

describe('registerProjectIntelligenceTools', () => {
  it('refreshes the project index and reports counts', async () => {
    const workspaceRoot = await createWorkspaceFixture();
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      assets: [
        { assetPath: '/Game/Blueprints/BP_PlayerCharacter', assetName: 'BP_PlayerCharacter', assetClass: 'Blueprint' },
        { assetPath: '/Game/UI/WBP_MainMenu', assetName: 'WBP_MainMenu', assetClass: 'WidgetBlueprint' },
      ],
    }));

    registerProjectIntelligenceTools({
      server: registry.server,
      callSubsystemJson,
      workspaceRoot,
    });

    const result = await registry.getTool('refresh_project_index').handler({
      package_path: '/Game',
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect(parsed.operation).toBe('refresh_project_index');
    expect(parsed.refreshed).toBe(true);
    expect(parsed.package_path).toBe('/Game');
    expect(parsed.asset_count).toBe(2);
    expect(parsed.repo_doc_count).toBe(4);
    expect(parsed.prompt_count).toBe(Object.keys(promptCatalog).length);
    expect(parsed.resource_count).toBe(5);
    expect(parsed.entry_count).toBe(2 + 4 + Object.keys(promptCatalog).length + 5);
  });

  it('reports empty status before the first refresh', async () => {
    const workspaceRoot = await createWorkspaceFixture();
    const registry = createToolRegistry();

    registerProjectIntelligenceTools({
      server: registry.server,
      callSubsystemJson: vi.fn(async () => ({ assets: [] })),
      workspaceRoot,
    });

    const result = await registry.getTool('get_project_index_status').handler({});
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'get_project_index_status',
      generated_at: null,
      stale: true,
      asset_count: 0,
    });
  });

  it('auto-builds the index on first search and returns snippet-first provenance', async () => {
    const workspaceRoot = await createWorkspaceFixture();
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      assets: [
        { assetPath: '/Game/Blueprints/BP_PlayerCharacter', assetName: 'BP_PlayerCharacter', assetClass: 'Blueprint' },
      ],
    }));

    registerProjectIntelligenceTools({
      server: registry.server,
      callSubsystemJson,
      workspaceRoot,
    });

    const result = await registry.getTool('search_project_context').handler({
      query: 'player character',
      page: 1,
      per_page: 5,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const results = parsed.results as Array<Record<string, unknown>>;
    expect(parsed.success).toBe(true);
    expect(parsed.operation).toBe('search_project_context');
    expect(parsed.query).toBe('player character');
    expect(parsed.stale).toBe(false);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source_type).toBe('asset');
    expect(results[0].asset_path).toBe('/Game/Blueprints/BP_PlayerCharacter');
    expect(Array.isArray(results[0].snippets)).toBe(true);
    expect((results[0].snippets as Array<Record<string, unknown>>)[0].text).toContain('BP_PlayerCharacter');
  });

  it('filters by source type during search', async () => {
    const workspaceRoot = await createWorkspaceFixture();
    const registry = createToolRegistry();

    registerProjectIntelligenceTools({
      server: registry.server,
      callSubsystemJson: vi.fn(async () => ({ assets: [] })),
      workspaceRoot,
    });

    await registry.getTool('refresh_project_index').handler({ package_path: '/Game' });
    const result = await registry.getTool('search_project_context').handler({
      query: 'review blueprint',
      source_types: ['prompt'],
      page: 1,
      per_page: 10,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const results = parsed.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.source_type === 'prompt')).toBe(true);
  });
});
