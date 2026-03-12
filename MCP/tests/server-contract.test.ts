import { afterEach, describe, expect, it } from 'vitest';
import { createBlueprintExtractorServer, type UEClientLike } from '../src/index.js';
import { connectInMemoryServer, getTextContent } from './test-helpers.js';

class FakeUEClient implements UEClientLike {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  constructor(
    private readonly handler: (method: string, params: Record<string, unknown>) => Promise<string> | string = (
      method,
      params,
    ) => JSON.stringify({ ok: true, method, params }),
    private readonly connectionProbe: () => Promise<boolean> | boolean = () => true,
  ) {}

  async callSubsystem(method: string, params: Record<string, unknown>): Promise<string> {
    this.calls.push({ method, params });
    return await this.handler(method, params);
  }

  async checkConnection(): Promise<boolean> {
    return await this.connectionProbe();
  }
}

class FakeProjectController {
  readonly compileCalls: Array<Record<string, unknown>> = [];
  readonly waitCalls: Array<Record<string, unknown>> = [];
  readonly classifyCalls: Array<{ changedPaths: string[]; forceRebuild: boolean }> = [];

  constructor(
    readonly liveCodingSupported = true,
    private readonly classifyHandler: (
      changedPaths: string[],
      forceRebuild: boolean,
    ) => { strategy: 'live_coding' | 'build_and_restart'; restartRequired: boolean; reasons: string[] } = (
      changedPaths,
      forceRebuild,
    ) => ({
      strategy: forceRebuild ? 'build_and_restart' : 'live_coding',
      restartRequired: forceRebuild,
      reasons: forceRebuild ? ['force_rebuild'] : [],
    }),
    private readonly compileHandler: (request: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown> = () => ({
      success: true,
      operation: 'compile_project_code',
      strategy: 'external_build',
      exitCode: 0,
      restartRequired: true,
      restartReasons: ['external_build_completed'],
    }),
    private readonly waitHandler: (request: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown> = () => ({
      success: true,
      operation: 'restart_editor',
      disconnected: true,
      reconnected: true,
      diagnostics: [],
    }),
  ) {}

  classifyChangedPaths(changedPaths: string[], forceRebuild = false) {
    this.classifyCalls.push({ changedPaths, forceRebuild });
    return this.classifyHandler(changedPaths, forceRebuild);
  }

  async compileProjectCode(request: Record<string, unknown>) {
    this.compileCalls.push(request);
    return await this.compileHandler(request);
  }

  async waitForEditorRestart(_probeConnection: unknown, request: Record<string, unknown> = {}) {
    this.waitCalls.push(request);
    return await this.waitHandler(request);
  }
}

function makeImportJobResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    operation: 'import_assets',
    status: 'queued',
    terminal: false,
    validateOnly: false,
    createdAt: '2026-03-09T10:00:00Z',
    jobId: 'job-123',
    itemCount: 1,
    acceptedItemCount: 1,
    failedItemCount: 0,
    items: [{
      index: 0,
      status: 'queued',
      filePath: 'C:/Temp/Test.png',
      destinationPath: '/Game/Imported',
      importedObjects: [],
      dirtyPackages: [],
      diagnostics: [],
    }],
    importedObjects: [],
    dirtyPackages: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('createBlueprintExtractorServer', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it('registers the expected resources and tools', async () => {
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient()));
    cleanups.push(harness.close);

    const resources = await harness.client.listResources();
    const resourceTemplates = await harness.client.listResourceTemplates();
    const resourceUris = resources.resources.map((resource) => resource.uri);
    const resourceTemplateUris = resourceTemplates.resourceTemplates.map((template) => template.uriTemplate);
    const tools = await harness.client.listTools();
    const extractBlueprint = tools.tools.find((tool) => tool.name === 'extract_blueprint');
    const extractWidgetBlueprint = tools.tools.find((tool) => tool.name === 'extract_widget_blueprint');
    const extractMaterial = tools.tools.find((tool) => tool.name === 'extract_material');
    const createBlueprint = tools.tools.find((tool) => tool.name === 'create_blueprint');
    const importAssets = tools.tools.find((tool) => tool.name === 'import_assets');
    const getImportJob = tools.tools.find((tool) => tool.name === 'get_import_job');
    const saveAssets = tools.tools.find((tool) => tool.name === 'save_assets');

    expect(resourceTemplates.resourceTemplates).toHaveLength(2);
    expect(tools.tools).toHaveLength(70);
    expect(resourceUris).toContain('blueprint://scopes');
    expect(resourceUris).toContain('blueprint://write-capabilities');
    expect(resourceUris).toContain('blueprint://import-capabilities');
    expect(resourceUris).toContain('blueprint://authoring-conventions');
    expect(resourceUris).toContain('blueprint://selector-conventions');
    expect(resourceUris).toContain('blueprint://widget-best-practices');
    expect(resourceUris).toContain('blueprint://material-graph-guidance');
    expect(resourceUris).toContain('blueprint://font-roles');
    expect(resourceUris).toContain('blueprint://project-automation');
    expect(resourceTemplateUris).toContain('blueprint://examples/{family}');
    expect(resourceTemplateUris).toContain('blueprint://widget-patterns/{pattern}');
    expect(tools.tools.some((tool) => tool.name === 'search_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_widget_blueprint')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'reimport_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'list_import_jobs')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'import_textures')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'import_meshes')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'extract_material_function')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'create_material')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_material')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'create_material_function')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_material_function')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'compile_material_asset')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'compile_project_code')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'trigger_live_coding')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'restart_editor')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'sync_project_code')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'apply_window_ui_changes')).toBe(true);
    expect(extractBlueprint?.annotations?.readOnlyHint).toBe(true);
    expect(extractWidgetBlueprint?.annotations?.readOnlyHint).toBe(true);
    expect(extractMaterial?.annotations?.readOnlyHint).toBe(true);
    expect(createBlueprint?.annotations?.readOnlyHint).toBe(false);
    expect(importAssets?.annotations?.readOnlyHint).toBe(false);
    expect(getImportJob?.annotations?.readOnlyHint).toBe(true);
    expect(saveAssets?.annotations?.idempotentHint).toBe(true);
  });

  it('serves the static reference resources', async () => {
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient()));
    cleanups.push(harness.close);

    const scopes = await harness.client.readResource({ uri: 'blueprint://scopes' });
    const writeCapabilities = await harness.client.readResource({ uri: 'blueprint://write-capabilities' });
    const importCapabilities = await harness.client.readResource({ uri: 'blueprint://import-capabilities' });
    const authoringConventions = await harness.client.readResource({ uri: 'blueprint://authoring-conventions' });
    const selectorConventions = await harness.client.readResource({ uri: 'blueprint://selector-conventions' });
    const widgetBestPractices = await harness.client.readResource({ uri: 'blueprint://widget-best-practices' });
    const materialGraphGuidance = await harness.client.readResource({ uri: 'blueprint://material-graph-guidance' });
    const fontRoles = await harness.client.readResource({ uri: 'blueprint://font-roles' });
    const projectAutomation = await harness.client.readResource({ uri: 'blueprint://project-automation' });
    const widgetExample = await harness.client.readResource({ uri: 'blueprint://examples/widget_blueprint' });
    const materialExample = await harness.client.readResource({ uri: 'blueprint://examples/material' });
    const materialFunctionExample = await harness.client.readResource({ uri: 'blueprint://examples/material_function' });
    const windowPolishExample = await harness.client.readResource({ uri: 'blueprint://examples/window_ui_polish' });
    const projectCodeExample = await harness.client.readResource({ uri: 'blueprint://examples/project_code' });
    const widgetPattern = await harness.client.readResource({ uri: 'blueprint://widget-patterns/activatable_window' });

    expect(scopes.contents[0]?.mimeType).toBe('text/plain');
    expect(scopes.contents[0]?.text).toContain('Blueprint Extraction Scopes');
    expect(writeCapabilities.contents[0]?.text).toContain('Current write-capable families:');
    expect(writeCapabilities.contents[0]?.text).toContain('extract_widget_blueprint');
    expect(writeCapabilities.contents[0]?.text).toContain('extract_material');
    expect(importCapabilities.contents[0]?.text).toContain('Blueprint Extractor Import Capabilities');
    expect(importCapabilities.contents[0]?.text).toContain('get_import_job');
    expect(importCapabilities.contents[0]?.text).toContain('mesh_type');
    expect(authoringConventions.contents[0]?.text).toContain('extract_widget_blueprint -> modify_widget_blueprint');
    expect(selectorConventions.contents[0]?.text).toContain('widget_path');
    expect(widgetBestPractices.contents[0]?.text).toContain('CommonActivatableWidget');
    expect(materialGraphGuidance.contents[0]?.text).toContain('Blueprint Extractor Material Graph Guidance');
    expect(materialGraphGuidance.contents[0]?.text).toContain('expression_guid');
    expect(fontRoles.contents[0]?.text).toContain('Blueprint Extractor Font Roles');
    expect(projectAutomation.contents[0]?.text).toContain('Blueprint Extractor Project Automation');
    expect(widgetExample.contents[0]?.text).toContain('Example structural batch');
    expect(materialExample.contents[0]?.text).toContain('connect_material_property');
    expect(materialFunctionExample.contents[0]?.text).toContain('asset_kind=function, layer, or layer_blend');
    expect(windowPolishExample.contents[0]?.text).toContain('modify_widget / modify_widget_blueprint.patch_widget with is_variable');
    expect(projectCodeExample.contents[0]?.text).toContain('Use explicit changed_paths with sync_project_code');
    expect(widgetPattern.contents[0]?.text).toContain('Pattern: activatable_window');
  });

  it('serializes arguments to subsystem calls and returns parsed JSON', async () => {
    const fakeClient = new FakeUEClient((method, params) => JSON.stringify({
      results: [{ method, params }],
    }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'search_assets',
      arguments: {
        query: 'Player',
        class_filter: 'Blueprint',
        max_results: 7,
      },
    });

    expect(JSON.parse(getTextContent(result))).toEqual([
      {
        method: 'SearchAssets',
        params: {
          Query: 'Player',
          ClassFilter: 'Blueprint',
          MaxResults: 7,
        },
      },
    ]);
    expect(fakeClient.calls).toEqual([
      {
        method: 'SearchAssets',
        params: {
          Query: 'Player',
          ClassFilter: 'Blueprint',
          MaxResults: 7,
        },
      },
    ]);
  });

  it('serializes import payloads to subsystem JSON passthrough parameters', async () => {
    const fakeClient = new FakeUEClient(() => JSON.stringify(makeImportJobResult()));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const payload = {
      items: [{
        file_path: 'C:/Temp/Test.png',
        destination_path: '/Game/Imported',
        options: {
          compression_settings: 'TC_Default',
        },
      }],
    };

    const result = await harness.client.callTool({
      name: 'import_textures',
      arguments: {
        payload,
        validate_only: true,
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      jobId: 'job-123',
      operation: 'import_assets',
      terminal: false,
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'ImportTextures',
        params: {
          PayloadJson: JSON.stringify(payload),
          bValidateOnly: true,
        },
      },
    ]);
  });

  it('routes compact widget extraction and structural widget mutations through the new subsystem calls', async () => {
    const fakeClient = new FakeUEClient((method, params) => {
      if (method === 'ExtractWidgetBlueprint') {
        return JSON.stringify({
          success: true,
          operation: 'extract_widget_blueprint',
          assetPath: params.AssetPath,
          rootWidget: {
            class: 'VerticalBox',
            name: 'WindowRoot',
            widgetPath: 'WindowRoot',
          },
          compile: {
            success: true,
            status: 'UpToDate',
          },
        });
      }

      if (method === 'ModifyWidgetBlueprintStructure') {
        return JSON.stringify({
          success: true,
          operation: 'modify_widget_blueprint',
          widgetOperation: params.Operation,
          assetPath: params.AssetPath,
        });
      }

      if (method === 'CompileWidgetBlueprint') {
        return JSON.stringify({
          success: true,
          operation: 'compile_widget_blueprint',
          compile: {
            success: true,
            status: 'UpToDate',
          },
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const extractResult = await harness.client.callTool({
      name: 'extract_widget_blueprint',
      arguments: {
        asset_path: '/Game/UI/WBP_Window',
        include_class_defaults: true,
      },
    });
    const modifyResult = await harness.client.callTool({
      name: 'modify_widget_blueprint',
      arguments: {
        asset_path: '/Game/UI/WBP_Window',
        operation: 'batch',
        operations: [
          {
            operation: 'insert_child',
            parent_widget_path: 'WindowRoot/ContentRoot',
            child_widget: {
              class: 'TextBlock',
              name: 'BodyText',
              is_variable: true,
            },
          },
          {
            operation: 'replace_widget_class',
            widget_path: 'WindowRoot/TitleBar/PrimaryButton',
            replacement_class: 'Button',
          },
        ],
        compile_after: true,
      },
    });

    expect(JSON.parse(getTextContent(extractResult))).toMatchObject({
      operation: 'extract_widget_blueprint',
      rootWidget: {
        widgetPath: 'WindowRoot',
      },
    });
    expect(JSON.parse(getTextContent(modifyResult))).toMatchObject({
      operation: 'modify_widget_blueprint',
      widgetOperation: 'batch',
      compile: {
        success: true,
        status: 'UpToDate',
      },
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'ExtractWidgetBlueprint',
        params: {
          AssetPath: '/Game/UI/WBP_Window',
          bIncludeClassDefaults: true,
        },
      },
      {
        method: 'ModifyWidgetBlueprintStructure',
        params: {
          AssetPath: '/Game/UI/WBP_Window',
          Operation: 'batch',
          PayloadJson: JSON.stringify({
            operations: [
              {
                operation: 'insert_child',
                parent_widget_path: 'WindowRoot/ContentRoot',
                child_widget: {
                  class: 'TextBlock',
                  name: 'BodyText',
                  is_variable: true,
                },
              },
              {
                operation: 'replace_widget_class',
                widget_path: 'WindowRoot/TitleBar/PrimaryButton',
                replacement_class: 'Button',
              },
            ],
          }),
          bValidateOnly: false,
        },
      },
      {
        method: 'CompileWidgetBlueprint',
        params: {
          AssetPath: '/Game/UI/WBP_Window',
        },
      },
    ]);
  });

  it('routes widget variable aliases, widget-path patches, and widget class-default patches through the narrowed widget API', async () => {
    const fakeClient = new FakeUEClient((method) => JSON.stringify({
      success: true,
      operation: method,
    }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const modifyWidget = await harness.client.callTool({
      name: 'modify_widget',
      arguments: {
        asset_path: '/Game/UI/WBP_Window',
        widget_path: 'WindowRoot/TitleBar/TitleBarBg',
        bIsVariable: true,
      },
    });
    const patchDefaults = await harness.client.callTool({
      name: 'modify_widget_blueprint',
      arguments: {
        asset_path: '/Game/UI/WBP_Window',
        operation: 'patch_class_defaults',
        class_defaults: {
          ActiveTitleBarMaterial: '/Game/UI/MI_TitleBarActive.MI_TitleBarActive',
        },
      },
    });

    expect(JSON.parse(getTextContent(modifyWidget))).toMatchObject({
      operation: 'ModifyWidget',
      success: true,
    });
    expect(JSON.parse(getTextContent(patchDefaults))).toMatchObject({
      operation: 'ModifyWidgetBlueprintStructure',
      success: true,
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'ModifyWidget',
        params: {
          AssetPath: '/Game/UI/WBP_Window',
          WidgetName: 'WindowRoot/TitleBar/TitleBarBg',
          PropertiesJson: '{}',
          SlotJson: '{}',
          WidgetOptionsJson: JSON.stringify({
            is_variable: true,
          }),
          bValidateOnly: false,
        },
      },
      {
        method: 'ModifyWidgetBlueprintStructure',
        params: {
          AssetPath: '/Game/UI/WBP_Window',
          Operation: 'patch_class_defaults',
          PayloadJson: JSON.stringify({
            class_defaults: {
              ActiveTitleBarMaterial: '/Game/UI/MI_TitleBarActive.MI_TitleBarActive',
            },
          }),
          bValidateOnly: false,
        },
      },
    ]);
  });

  it('routes material graph tools through the new subsystem calls and keeps compact text plus structured content', async () => {
    const fakeClient = new FakeUEClient((method, params) => {
      if (method === 'ExtractMaterial') {
        return JSON.stringify({
          success: true,
          operation: 'extract_material',
          material: {
            assetPath: params.AssetPath,
            expressions: [{
              expressionGuid: 'expr-guid-1',
              class: '/Script/Engine.MaterialExpressionScalarParameter',
            }],
            propertyConnections: [{
              property: 'MP_BaseColor',
              expressionGuid: 'expr-guid-1',
            }],
          },
        });
      }

      if (method === 'ModifyMaterial') {
        return JSON.stringify({
          success: true,
          operation: 'modify_material',
          assetPath: params.AssetPath,
          tempIdMap: {
            baseColor: 'expr-guid-1',
          },
          diagnostics: [],
        });
      }

      if (method === 'CreateMaterialFunction') {
        return JSON.stringify({
          success: true,
          operation: 'create_material_function',
          assetPath: params.AssetPath,
          assetKind: params.AssetKind,
        });
      }

      if (method === 'CompileMaterialAsset') {
        return JSON.stringify({
          success: true,
          operation: 'compile_material_asset',
          assetPath: params.AssetPath,
          compile: {
            success: true,
            status: 'UpToDate',
          },
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const extractResult = await harness.client.callTool({
      name: 'extract_material',
      arguments: {
        asset_path: '/Game/Materials/M_Test',
        verbose: false,
      },
    });
    const modifyResult = await harness.client.callTool({
      name: 'modify_material',
      arguments: {
        asset_path: '/Game/Materials/M_Test',
        compile_after: false,
        operations: [
          {
            operation: 'add_expression',
            temp_id: 'baseColor',
            expression_class: '/Script/Engine.MaterialExpressionScalarParameter',
          },
        ],
      },
    });
    const createFunctionResult = await harness.client.callTool({
      name: 'create_material_function',
      arguments: {
        asset_path: '/Game/Materials/MF_Test',
        asset_kind: 'layer_blend',
        settings: {
          description: 'Blend asset',
        },
      },
    });
    const compileResult = await harness.client.callTool({
      name: 'compile_material_asset',
      arguments: {
        asset_path: '/Game/Materials/M_Test',
      },
    });

    expect(getTextContent(extractResult)).not.toContain('\n');
    expect(JSON.parse(getTextContent(extractResult))).toMatchObject({
      operation: 'extract_material',
      material: {
        assetPath: '/Game/Materials/M_Test',
      },
    });
    expect((extractResult as { structuredContent?: unknown }).structuredContent).toMatchObject({
      operation: 'extract_material',
    });
    expect(JSON.parse(getTextContent(modifyResult))).toMatchObject({
      operation: 'modify_material',
      tempIdMap: {
        baseColor: 'expr-guid-1',
      },
    });
    expect(JSON.parse(getTextContent(createFunctionResult))).toMatchObject({
      operation: 'create_material_function',
      assetKind: 'layer_blend',
    });
    expect(JSON.parse(getTextContent(compileResult))).toMatchObject({
      operation: 'compile_material_asset',
      compile: {
        success: true,
      },
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'ExtractMaterial',
        params: {
          AssetPath: '/Game/Materials/M_Test',
          bVerbose: false,
        },
      },
      {
        method: 'ModifyMaterial',
        params: {
          AssetPath: '/Game/Materials/M_Test',
          PayloadJson: JSON.stringify({
            compile_after: false,
            operations: [
              {
                operation: 'add_expression',
                temp_id: 'baseColor',
                expression_class: '/Script/Engine.MaterialExpressionScalarParameter',
              },
            ],
          }),
          bValidateOnly: false,
        },
      },
      {
        method: 'CreateMaterialFunction',
        params: {
          AssetPath: '/Game/Materials/MF_Test',
          AssetKind: 'layer_blend',
          SettingsJson: JSON.stringify({
            description: 'Blend asset',
          }),
          bValidateOnly: false,
        },
      },
      {
        method: 'CompileMaterialAsset',
        params: {
          AssetPath: '/Game/Materials/M_Test',
        },
      },
    ]);
  });

  it('passes widget_path selectors and validate_only through modify_widget', async () => {
    const fakeClient = new FakeUEClient(() => JSON.stringify({
      success: true,
      operation: 'modify_widget',
      widgetName: 'TitleText',
      widgetPath: 'WindowRoot/TitleBar/TitleText',
      validateOnly: true,
    }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'modify_widget',
      arguments: {
        asset_path: '/Game/UI/WBP_Window',
        widget_path: 'WindowRoot/TitleBar/TitleText',
        properties: {
          Text: 'Window',
        },
        validate_only: true,
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      widgetPath: 'WindowRoot/TitleBar/TitleText',
      validateOnly: true,
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'ModifyWidget',
        params: {
          AssetPath: '/Game/UI/WBP_Window',
          WidgetName: 'WindowRoot/TitleBar/TitleText',
          PropertiesJson: JSON.stringify({ Text: 'Window' }),
          SlotJson: JSON.stringify({}),
          WidgetOptionsJson: JSON.stringify({}),
          bValidateOnly: true,
        },
      },
    ]);
  });

  it('passes through import job polling and listing responses', async () => {
    const fakeClient = new FakeUEClient((method, params) => {
      if (method === 'GetImportJob') {
        return JSON.stringify(makeImportJobResult({
          status: 'running',
          startedAt: '2026-03-09T10:00:01Z',
          jobId: params.JobId,
        }));
      }

      if (method === 'ListImportJobs') {
        return JSON.stringify({
          success: true,
          operation: 'list_import_jobs',
          jobCount: 2,
          jobs: [
            makeImportJobResult({
              status: 'running',
              startedAt: '2026-03-09T10:00:01Z',
            }),
            makeImportJobResult({
              success: false,
              operation: 'import_meshes',
              status: 'failed',
              terminal: true,
              completedAt: '2026-03-09T10:02:00Z',
              jobId: 'job-456',
            }),
          ],
          includeCompleted: params.bIncludeCompleted,
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const getResult = await harness.client.callTool({
      name: 'get_import_job',
      arguments: {
        job_id: 'job-123',
      },
    });
    const listResult = await harness.client.callTool({
      name: 'list_import_jobs',
      arguments: {
        include_completed: true,
      },
    });

    expect(JSON.parse(getTextContent(getResult))).toMatchObject({
      jobId: 'job-123',
      status: 'running',
      terminal: false,
    });
    expect(JSON.parse(getTextContent(listResult))).toMatchObject({
      includeCompleted: true,
      jobs: [
        { jobId: 'job-123', status: 'running' },
        { jobId: 'job-456', status: 'failed', terminal: true },
      ],
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'GetImportJob',
        params: {
          JobId: 'job-123',
        },
      },
      {
        method: 'ListImportJobs',
        params: {
          bIncludeCompleted: true,
        },
      },
    ]);
  });

  it('routes compile_project_code through the host-side project controller', async () => {
    const fakeController = new FakeProjectController(
      true,
      undefined,
      (request) => ({
        success: true,
        operation: 'compile_project_code',
        strategy: 'external_build',
        exitCode: 0,
        target: request.target ?? 'MyGameEditor',
        projectPath: request.projectPath,
        engineRoot: request.engineRoot,
        restartRequired: true,
        restartReasons: ['external_build_completed'],
      }),
    );
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient(), fakeController));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'compile_project_code',
      arguments: {
        engine_root: 'C:/Epic/UE_5.7',
        project_path: 'C:/Projects/MyGame/MyGame.uproject',
        target: 'MyGameEditor',
        platform: 'Win64',
        configuration: 'Development',
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      operation: 'compile_project_code',
      target: 'MyGameEditor',
      engineRoot: 'C:/Epic/UE_5.7',
      projectPath: 'C:/Projects/MyGame/MyGame.uproject',
    });
    expect(fakeController.compileCalls).toEqual([
      {
        engineRoot: 'C:/Epic/UE_5.7',
        projectPath: 'C:/Projects/MyGame/MyGame.uproject',
        target: 'MyGameEditor',
        platform: 'Win64',
        configuration: 'Development',
        buildTimeoutMs: undefined,
        includeOutput: false,
      },
    ]);
  });

  it('returns generic live coding failures without falling back to build-and-restart', async () => {
    const fakeClient = new FakeUEClient((method) => {
      if (method === 'TriggerLiveCoding') {
        return JSON.stringify({
          success: false,
          operation: 'trigger_live_coding',
          status: 'failure',
          compileResult: 'Failure',
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const fakeController = new FakeProjectController();
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient, fakeController));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'sync_project_code',
      arguments: {
        changed_paths: ['Source/MyGame/Private/MyActor.cpp'],
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: false,
      operation: 'sync_project_code',
      strategy: 'live_coding',
      liveCoding: {
        status: 'failure',
        compileResult: 'Failure',
      },
    });
    expect(fakeController.compileCalls).toHaveLength(0);
  });

  it('falls back from precondition live coding failures to build-and-restart and waits for reconnect', async () => {
    const fakeClient = new FakeUEClient((method, params) => {
      if (method === 'TriggerLiveCoding') {
        return JSON.stringify({
          success: false,
          operation: 'trigger_live_coding',
          status: 'unsupported',
          fallbackRecommended: true,
        });
      }

      if (method === 'SaveAssets') {
        return JSON.stringify({
          success: true,
          operation: 'save_assets',
          saved: true,
          assetPaths: JSON.parse(String(params.AssetPathsJson)),
        });
      }

      if (method === 'RestartEditor') {
        return JSON.stringify({
          success: true,
          operation: 'restart_editor',
          requested: true,
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const fakeController = new FakeProjectController(
      true,
      undefined,
      () => ({
        success: true,
        operation: 'compile_project_code',
        strategy: 'external_build',
        exitCode: 0,
        restartRequired: true,
        restartReasons: ['external_build_completed'],
      }),
      () => ({
        success: true,
        operation: 'restart_editor',
        disconnected: true,
        reconnected: true,
        diagnostics: [],
      }),
    );
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient, fakeController));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'sync_project_code',
      arguments: {
        changed_paths: ['Source/MyGame/Private/MyActor.cpp'],
        save_asset_paths: ['/Game/UI/WBP_Window'],
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: true,
      operation: 'sync_project_code',
      strategy: 'build_and_restart',
      liveCoding: {
        status: 'unsupported',
      },
      save: {
        saved: true,
      },
      reconnect: {
        reconnected: true,
      },
    });
    expect(fakeController.compileCalls).toHaveLength(1);
    expect(fakeController.waitCalls).toEqual([
      {
        disconnectTimeoutMs: 60000,
        reconnectTimeoutMs: 180000,
      },
    ]);
  });

  it('orchestrates apply_window_ui_changes in order and stops on the first failed step', async () => {
    const fakeClient = new FakeUEClient((method) => {
      if (method === 'ModifyWidget' || method === 'ModifyWidgetBlueprintStructure' || method === 'ImportFonts') {
        return JSON.stringify({
          success: true,
          operation: method,
        });
      }

      if (method === 'ApplyWidgetFonts') {
        return JSON.stringify({
          success: false,
          operation: 'ApplyWidgetFonts',
          diagnostics: [{ message: 'Missing font asset' }],
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient, new FakeProjectController()));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'apply_window_ui_changes',
      arguments: {
        asset_path: '/Game/UI/WBP_Window',
        variable_widgets: [
          { widget_path: 'WindowRoot/TitleBar/TitleBarBg', is_variable: true },
        ],
        class_defaults: {
          ActiveTitleBarMaterial: '/Game/UI/MI_TitleBarActive.MI_TitleBarActive',
        },
        font_import: {
          destination_path: '/Game/UI/Fonts',
          font_asset_path: '/Game/UI/Fonts/F_Window',
          items: [{ file_path: 'C:/Windows/Fonts/tahoma.ttf', entry_name: 'Regular' }],
        },
        font_applications: [
          {
            widget_path: 'WindowRoot/TitleBar/TitleText',
            font_asset: '/Game/UI/Fonts/F_Window.F_Window',
            typeface: 'Regular',
            size: 14,
          },
        ],
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: false,
      operation: 'apply_window_ui_changes',
      stoppedAt: 'apply_widget_fonts',
    });
    expect(fakeClient.calls.map((call) => call.method)).toEqual([
      'ModifyWidget',
      'ModifyWidgetBlueprintStructure',
      'ImportFonts',
      'ApplyWidgetFonts',
    ]);
  });

  it('compacts extract_blueprint responses when requested', async () => {
    const fakeClient = new FakeUEClient(() => JSON.stringify({
      blueprint: {
        functions: [{
          graphGuid: 'graph-guid',
          nodes: [{
            nodeGuid: 'guid-a',
            posX: 10,
            posY: 20,
            nodeComment: '',
            pins: [{
              pinId: 'pin-guid',
              autogeneratedDefaultValue: '',
              defaultValue: '',
              type: {
                category: 'exec',
                sub_category: '',
              },
              connections: [],
            }],
          }],
        }],
      },
    }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'extract_blueprint',
      arguments: {
        asset_path: '/Game/Test/BP_Test',
        compact: true,
      },
    });

    const parsed = JSON.parse(getTextContent(result));
    const node = parsed.blueprint.functions[0].nodes[0];

    expect(parsed.blueprint.functions[0].graphGuid).toBeUndefined();
    expect(node.id).toBe('n0');
    expect(node.posX).toBeUndefined();
    expect(node.posY).toBeUndefined();
    expect(node.pins[0].type).toBe('exec');
    expect(node.pins[0].connections).toBeUndefined();
  });

  it('truncates oversized extract_blueprint responses', async () => {
    const fakeClient = new FakeUEClient(() => JSON.stringify({
      blueprint: {
        summary: 'x'.repeat(220_000),
      },
    }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'extract_blueprint',
      arguments: {
        asset_path: '/Game/Test/BP_Large',
      },
    });

    const text = getTextContent(result);
    expect(text).toContain('Warning: Response is');
    expect(text).toContain('[TRUNCATED]');
  });

  it('returns tool errors with structured text when the subsystem returns an error JSON payload', async () => {
    const fakeClient = new FakeUEClient(() => JSON.stringify({ error: 'validation failed' }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'create_blueprint',
      arguments: {
        asset_path: '/Game/Test/BP_Invalid',
        parent_class_path: '/Script/Engine.Actor',
      },
    });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain('validation failed');
  });

  it('surfaces schema validation failures through the MCP tool contract', async () => {
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient()));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'extract_blueprint',
      arguments: {
        asset_path: 123,
      } as never,
    });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain('Input validation error');
  });

  it('validates import payload structure before calling the subsystem', async () => {
    const fakeClient = new FakeUEClient();
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'import_assets',
      arguments: {
        payload: {
          items: 'not-an-array',
        },
      } as never,
    });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain('Input validation error');
    expect(fakeClient.calls).toHaveLength(0);
  });
});
