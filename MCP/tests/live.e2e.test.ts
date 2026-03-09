import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getTextContent } from './test-helpers.js';

const liveEnabled = process.env.BLUEPRINT_EXTRACTOR_LIVE_E2E === '1';
const currentDir = fileURLToPath(new URL('.', import.meta.url));
const serverEntry = resolve(currentDir, '../dist/index.js');

const describeLive = liveEnabled ? describe : describe.skip;

type FixtureSmokeCase = {
  envVar: string;
  tool: string;
  args: Record<string, unknown>;
};

const fixtureSmokeCases: FixtureSmokeCase[] = [
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_BLUEPRINT',
    tool: 'extract_blueprint',
    args: { scope: 'Variables' },
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_WIDGET_BLUEPRINT',
    tool: 'extract_blueprint',
    args: { scope: 'Components' },
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_STATE_TREE',
    tool: 'extract_state_tree',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_BEHAVIOR_TREE',
    tool: 'extract_behavior_tree',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_BLACKBOARD',
    tool: 'extract_blackboard',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_DATA_ASSET',
    tool: 'extract_dataasset',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_DATA_TABLE',
    tool: 'extract_datatable',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_STRUCT',
    tool: 'extract_user_defined_struct',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_USER_DEFINED_ENUM',
    tool: 'extract_user_defined_enum',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_CURVE',
    tool: 'extract_curve',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_CURVE_TABLE',
    tool: 'extract_curvetable',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_MATERIAL_INSTANCE',
    tool: 'extract_material_instance',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_ANIM_SEQUENCE',
    tool: 'extract_anim_sequence',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_ANIM_MONTAGE',
    tool: 'extract_anim_montage',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_BLEND_SPACE',
    tool: 'extract_blend_space',
    args: {},
  },
];

describeLive('live UE e2e', () => {
  const cleanup: Array<() => Promise<void>> = [];
  const runId = Date.now();
  const scratchRoot = `/Game/__GeneratedTests__/McpLive_${runId}`;
  const blueprintPath = `${scratchRoot}/BP_LiveSmoke`;

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
  });

  it('creates, extracts, and saves a scratch Blueprint through the real stdio server', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        ...process.env,
      },
      stderr: 'pipe',
    });

    const client = new Client({
      name: 'blueprint-extractor-live-tests',
      version: '1.0.0',
    });

    await client.connect(transport);
    cleanup.push(() => client.close());

    const searchAssets = await client.callTool({
      name: 'search_assets',
      arguments: {
        query: 'BlueprintExtractorSubsystem',
        class_filter: 'Blueprint',
        max_results: 5,
      },
    });
    expect(searchAssets.isError).toBeFalsy();

    const validateCreate = await client.callTool({
      name: 'create_blueprint',
      arguments: {
        asset_path: blueprintPath,
        parent_class_path: '/Script/Engine.Actor',
        validate_only: true,
      },
    });
    expect(validateCreate.isError).toBeFalsy();

    const createBlueprint = await client.callTool({
      name: 'create_blueprint',
      arguments: {
        asset_path: blueprintPath,
        parent_class_path: '/Script/Engine.Actor',
      },
    });
    expect(createBlueprint.isError).toBeFalsy();

    const extractBlueprint = await client.callTool({
      name: 'extract_blueprint',
      arguments: {
        asset_path: blueprintPath,
        scope: 'Variables',
      },
    });
    expect(extractBlueprint.isError).toBeFalsy();
    expect(getTextContent(extractBlueprint)).toContain('blueprint');

    const saveAssets = await client.callTool({
      name: 'save_assets',
      arguments: {
        asset_paths: [blueprintPath],
      },
    });
    expect(saveAssets.isError).toBeFalsy();

    for (const fixtureCase of fixtureSmokeCases) {
      const assetPath = process.env[fixtureCase.envVar];
      if (!assetPath) {
        continue;
      }

      const extractResult = await client.callTool({
        name: fixtureCase.tool,
        arguments: {
          asset_path: assetPath,
          ...fixtureCase.args,
        },
      });
      expect(extractResult.isError, `${fixtureCase.envVar} via ${fixtureCase.tool}`).toBeFalsy();
      expect(getTextContent(extractResult).trim().length, `${fixtureCase.envVar} produced JSON`).toBeGreaterThan(0);
    }
  });
});
