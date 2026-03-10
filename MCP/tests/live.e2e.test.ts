import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getTextContent, startFixtureFileServer } from './test-helpers.js';

const liveEnabled = process.env.BLUEPRINT_EXTRACTOR_LIVE_E2E === '1';
const currentDir = fileURLToPath(new URL('.', import.meta.url));
const serverEntry = resolve(currentDir, '../dist/index.js');
const importSourceDir = resolve(currentDir, '../../tests/fixtures/BlueprintExtractorFixture/ImportSources');
const textureFixture = resolve(importSourceDir, 'T_Test.png');
const meshFixture = resolve(importSourceDir, 'SM_Test.obj');

const describeLive = liveEnabled ? describe : describe.skip;

type ImportJobResult = {
  jobId?: string;
  status?: string;
  terminal?: boolean;
  importedObjects?: string[];
  diagnostics?: Array<{ code?: string; message?: string }>;
};

type FixtureSmokeCase = {
  envVar: string;
  tool: string;
  args: Record<string, unknown>;
};

function toObjectPath(assetPath: string): string {
  const assetName = assetPath.split('/').at(-1);
  if (!assetName) {
    throw new Error(`Could not derive asset name from ${assetPath}`);
  }

  return `${assetPath}.${assetName}`;
}

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
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_MATERIAL',
    tool: 'extract_material',
    args: {},
  },
  {
    envVar: 'BLUEPRINT_EXTRACTOR_TEST_MATERIAL_FUNCTION',
    tool: 'extract_material_function',
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

async function waitForImportJob(client: Client, jobId: string): Promise<ImportJobResult> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await client.callTool({
      name: 'get_import_job',
      arguments: {
        job_id: jobId,
      },
    });

    expect(result.isError, `get_import_job(${jobId})`).toBeFalsy();
    const parsed = JSON.parse(getTextContent(result)) as ImportJobResult;
    if (parsed.terminal) {
      return parsed;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error(`Import job ${jobId} did not reach a terminal state`);
}

describeLive('live UE e2e', () => {
  const cleanup: Array<() => Promise<void>> = [];
  const runId = Date.now();
  const scratchRoot = `/Game/__GeneratedTests__/McpLive_${runId}`;
  const blueprintValidatePath = `${scratchRoot}/BP_LiveSmokeValidate`;
  const blueprintPath = `${scratchRoot}/BP_LiveSmoke`;
  const blueprintObjectPath = toObjectPath(blueprintPath);
  const liveImportRoot = `${scratchRoot}/LiveImports`;
  const materialRoot = `${scratchRoot}/Materials`;
  const textureObjectPath = `${liveImportRoot}/T_LiveTexture.T_LiveTexture`;
  const meshObjectPath = `${liveImportRoot}/SM_LiveMesh.SM_LiveMesh`;
  const materialPath = `${materialRoot}/M_LiveSmoke`;
  const materialObjectPath = toObjectPath(materialPath);
  const materialFunctionPath = `${materialRoot}/MF_LiveSmoke`;
  const materialFunctionObjectPath = toObjectPath(materialFunctionPath);
  const materialInstancePath = `${materialRoot}/MI_LiveSmoke`;
  const materialInstanceObjectPath = toObjectPath(materialInstancePath);
  const defaultTexturePath = '/Engine/EngineResources/DefaultTexture.DefaultTexture';

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

    const tools = await client.listTools();
    const resourceTemplates = await client.listResourceTemplates();
    const importCapabilities = await client.readResource({ uri: 'blueprint://import-capabilities' });
    const widgetBestPractices = await client.readResource({ uri: 'blueprint://widget-best-practices' });

    expect(tools.tools.some((tool) => tool.name === 'import_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'extract_widget_blueprint')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://widget-patterns/{pattern}')).toBe(true);
    expect(importCapabilities.contents[0]?.text).toContain('Blueprint Extractor Import Capabilities');
    expect(widgetBestPractices.contents[0]?.text).toContain('CommonActivatableWidget');

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
        asset_path: blueprintValidatePath,
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
        asset_path: blueprintObjectPath,
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

  it('imports texture and mesh assets through async job polling and explicit save', async () => {
    const authHeader = 'Bearer live-import-token';
    const fixtureServer = await startFixtureFileServer({
      '/texture.png': {
        filePath: textureFixture,
        contentType: 'image/png',
        requiredHeaders: {
          authorization: authHeader,
        },
      },
    });
    cleanup.push(() => fixtureServer.close());

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        ...process.env,
      },
      stderr: 'pipe',
    });

    const client = new Client({
      name: 'blueprint-extractor-live-import-tests',
      version: '1.0.0',
    });

    await client.connect(transport);
    cleanup.push(() => client.close());

    const textureEnqueue = await client.callTool({
      name: 'import_textures',
      arguments: {
        payload: {
          items: [{
            url: `http://${fixtureServer.host}:${fixtureServer.port}/texture.png`,
            headers: {
              Authorization: authHeader,
            },
            destination_path: liveImportRoot,
            destination_name: 'T_LiveTexture',
            options: {
              srgb: false,
            },
          }],
        },
      },
    });
    expect(textureEnqueue.isError).toBeFalsy();
    expect(getTextContent(textureEnqueue)).not.toContain(authHeader);
    const textureJob = JSON.parse(getTextContent(textureEnqueue)) as ImportJobResult;
    expect(textureJob.jobId).toBeTruthy();

    const textureTerminal = await waitForImportJob(client, textureJob.jobId as string);
    expect(textureTerminal.status).toBe('succeeded');
    expect(textureTerminal.importedObjects).toContain(textureObjectPath);
    expect(JSON.stringify(textureTerminal)).not.toContain(authHeader);
    expect(
      fixtureServer.requests.some((request) => (
        request.url === '/texture.png'
        && request.headers.authorization === authHeader
      )),
    ).toBe(true);

    const meshEnqueue = await client.callTool({
      name: 'import_meshes',
      arguments: {
        payload: {
          items: [{
            file_path: meshFixture,
            destination_path: liveImportRoot,
            destination_name: 'SM_LiveMesh',
            options: {
              mesh_type: 'static',
              combine_meshes: true,
              generate_collision: true,
            },
          }],
        },
      },
    });
    expect(meshEnqueue.isError).toBeFalsy();
    const meshJob = JSON.parse(getTextContent(meshEnqueue)) as ImportJobResult;
    expect(meshJob.jobId).toBeTruthy();

    const meshTerminal = await waitForImportJob(client, meshJob.jobId as string);
    expect(meshTerminal.status).toBe('succeeded');
    expect(meshTerminal.importedObjects).toContain(meshObjectPath);

    const listAssets = await client.callTool({
      name: 'list_assets',
      arguments: {
        package_path: liveImportRoot,
        recursive: false,
      },
    });
    expect(listAssets.isError).toBeFalsy();
    const listedAssets = JSON.parse(getTextContent(listAssets)) as Array<{ path: string; name: string; class: string }>;
    expect(listedAssets.some((asset) => asset.path === textureObjectPath && asset.name === 'T_LiveTexture')).toBe(true);
    expect(listedAssets.some((asset) => asset.path === meshObjectPath && asset.name === 'SM_LiveMesh')).toBe(true);

    const saveAssets = await client.callTool({
      name: 'save_assets',
      arguments: {
        asset_paths: [textureObjectPath, meshObjectPath],
      },
    });
    expect(saveAssets.isError).toBeFalsy();
    expect(JSON.parse(getTextContent(saveAssets))).toMatchObject({
      saved: true,
    });
  });

  it('creates, modifies, extracts, compiles, and saves scratch material-family assets', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        ...process.env,
      },
      stderr: 'pipe',
    });

    const client = new Client({
      name: 'blueprint-extractor-live-material-tests',
      version: '1.0.0',
    });

    await client.connect(transport);
    cleanup.push(() => client.close());

    const createMaterial = await client.callTool({
      name: 'create_material',
      arguments: {
        asset_path: materialPath,
        initial_texture_path: defaultTexturePath,
        settings: {
          two_sided: true,
          blend_mode: 'BLEND_Opaque',
          material_domain: 'MD_Surface',
        },
      },
    });
    expect(createMaterial.isError).toBeFalsy();

    const modifyMaterial = await client.callTool({
      name: 'modify_material',
      arguments: {
        asset_path: materialObjectPath,
        compile_after: true,
        layout_after: true,
        operations: [
          {
            operation: 'add_expression',
            temp_id: 'baseColor',
            expression_class: '/Script/Engine.MaterialExpressionVectorParameter',
            editor_x: -360,
            editor_y: -120,
            properties: {
              ParameterName: 'BaseColorTint',
              Group: 'Surface',
              DefaultValue: { r: 0.2, g: 0.4, b: 0.8, a: 1.0 },
            },
          },
          {
            operation: 'add_expression',
            temp_id: 'roughness',
            expression_class: '/Script/Engine.MaterialExpressionScalarParameter',
            editor_x: -360,
            editor_y: 120,
            properties: {
              ParameterName: 'SurfaceRoughness',
              Group: 'Surface',
              DefaultValue: 0.35,
            },
          },
          {
            operation: 'connect_material_property',
            from_temp_id: 'baseColor',
            material_property: 'MP_BaseColor',
          },
          {
            operation: 'connect_material_property',
            from_temp_id: 'roughness',
            material_property: 'MP_Roughness',
          },
          {
            operation: 'rename_parameter_group',
            old_group_name: 'Surface',
            new_group_name: 'Shading',
          },
        ],
      },
    });
    expect(modifyMaterial.isError).toBeFalsy();
    expect(JSON.parse(getTextContent(modifyMaterial))).toMatchObject({
      success: true,
      operation: 'modify_material',
    });

    const extractMaterial = await client.callTool({
      name: 'extract_material',
      arguments: {
        asset_path: materialObjectPath,
      },
    });
    expect(extractMaterial.isError).toBeFalsy();
    expect(JSON.parse(getTextContent(extractMaterial))).toMatchObject({
      material: {
        assetPath: materialObjectPath,
      },
    });

    const createMaterialFunction = await client.callTool({
      name: 'create_material_function',
      arguments: {
        asset_path: materialFunctionPath,
        asset_kind: 'function',
        settings: {
          description: 'Live smoke material function',
        },
      },
    });
    expect(createMaterialFunction.isError).toBeFalsy();

    const modifyMaterialFunction = await client.callTool({
      name: 'modify_material_function',
      arguments: {
        asset_path: materialFunctionObjectPath,
        compile_after: true,
        operations: [
          {
            operation: 'add_expression',
            temp_id: 'inputColor',
            expression_class: '/Script/Engine.MaterialExpressionFunctionInput',
            properties: {
              InputName: 'InputColor',
              InputType: 'FunctionInput_Vector3',
            },
          },
          {
            operation: 'add_expression',
            temp_id: 'resultOutput',
            expression_class: '/Script/Engine.MaterialExpressionFunctionOutput',
            properties: {
              OutputName: 'Result',
            },
          },
          {
            operation: 'connect_expressions',
            from_temp_id: 'inputColor',
            to_temp_id: 'resultOutput',
          },
        ],
      },
    });
    expect(modifyMaterialFunction.isError).toBeFalsy();

    const extractMaterialFunction = await client.callTool({
      name: 'extract_material_function',
      arguments: {
        asset_path: materialFunctionObjectPath,
      },
    });
    expect(extractMaterialFunction.isError).toBeFalsy();
    expect(JSON.parse(getTextContent(extractMaterialFunction))).toMatchObject({
      materialFunction: {
        assetKind: 'function',
      },
    });

    const createMaterialInstance = await client.callTool({
      name: 'create_material_instance',
      arguments: {
        asset_path: materialInstancePath,
        parent_material_path: materialObjectPath,
      },
    });
    expect(createMaterialInstance.isError).toBeFalsy();

    const modifyMaterialInstance = await client.callTool({
      name: 'modify_material_instance',
      arguments: {
        asset_path: materialInstanceObjectPath,
        scalarParameters: [
          { name: 'SurfaceRoughness', value: 0.6 },
        ],
        vectorParameters: [
          { name: 'BaseColorTint', value: { r: 0.9, g: 0.2, b: 0.1, a: 1.0 } },
        ],
      },
    });
    expect(modifyMaterialInstance.isError).toBeFalsy();

    const compileMaterial = await client.callTool({
      name: 'compile_material_asset',
      arguments: {
        asset_path: materialObjectPath,
      },
    });
    expect(compileMaterial.isError).toBeFalsy();

    const compileMaterialFunction = await client.callTool({
      name: 'compile_material_asset',
      arguments: {
        asset_path: materialFunctionObjectPath,
      },
    });
    expect(compileMaterialFunction.isError).toBeFalsy();

    const compileMaterialInstance = await client.callTool({
      name: 'compile_material_asset',
      arguments: {
        asset_path: materialInstanceObjectPath,
      },
    });
    expect(compileMaterialInstance.isError).toBeFalsy();

    const saveAssets = await client.callTool({
      name: 'save_assets',
      arguments: {
        asset_paths: [
          materialPath,
          materialFunctionPath,
          materialInstancePath,
        ],
      },
    });
    expect(saveAssets.isError).toBeFalsy();
    expect(JSON.parse(getTextContent(saveAssets))).toMatchObject({
      saved: true,
    });
  });
});
