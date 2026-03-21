import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBlueprintExtractorServer,
  exampleCatalog,
  promptCatalog,
  type UEClientLike,
} from '../src/index.js';
import { connectInMemoryServer, getTextContent } from './test-helpers.js';

class FakeUEClient implements UEClientLike {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  constructor(
    private readonly handler: (method: string, params: Record<string, unknown>) => Promise<string> | string = (
      method,
      params,
    ) => JSON.stringify({ success: true, operation: method, method, params }),
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
  readonly launchCalls: Array<Record<string, unknown>> = [];
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
    private readonly launchHandler: (request: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown> = (request) => ({
      success: true,
      operation: 'launch_editor',
      engineRoot: request.engineRoot ?? 'C:/Epic/UE_5.7',
      projectPath: request.projectPath ?? 'C:/Projects/MyGame/MyGame.uproject',
      projectDir: 'C:/Projects/MyGame',
      command: {
        executable: 'C:/Epic/UE_5.7/Engine/Binaries/Win64/UnrealEditor.exe',
        args: [request.projectPath ?? 'C:/Projects/MyGame/MyGame.uproject'],
      },
      detached: true,
      diagnostics: [],
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

  async launchEditor(request: Record<string, unknown>) {
    this.launchCalls.push(request);
    return await this.launchHandler(request);
  }

  async waitForEditorRestart(_probeConnection: unknown, request: Record<string, unknown> = {}) {
    this.waitCalls.push(request);
    return await this.waitHandler(request);
  }
}

class FakeAutomationController {
  readonly runCalls: Array<Record<string, unknown>> = [];
  readonly getCalls: string[] = [];
  readonly listCalls: boolean[] = [];
  readonly readArtifactCalls: Array<{ runId: string; artifactName: string }> = [];

  constructor(
    private readonly runHandler: (request: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown> = (request) => ({
      success: true,
      operation: 'run_automation_tests',
      runId: 'run-123',
      automationFilter: request.automationFilter ?? 'BlueprintExtractor',
      status: 'running',
      terminal: false,
      engineRoot: request.engineRoot ?? 'C:/Epic/UE_5.7',
      projectPath: request.projectPath ?? 'C:/Projects/MyGame/MyGame.uproject',
      projectDir: 'C:/Projects/MyGame',
      target: request.target ?? 'MyGameEditor',
      reportOutputDir: 'C:/Projects/MyGame/Saved/BlueprintExtractor/AutomationRuns/run-123/reports',
      command: {
        executable: 'C:/Epic/UE_5.7/Engine/Binaries/Win64/UnrealEditor-Cmd.exe',
        args: ['Automation'],
      },
      diagnostics: [],
      timeoutMs: request.timeoutMs ?? 3600000,
      nullRhi: request.nullRhi ?? true,
      artifacts: [],
    }),
    private readonly getHandler: (runId: string) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null = () => null,
    private readonly listHandler: (includeCompleted: boolean) => Promise<Record<string, unknown>> | Record<string, unknown> = (includeCompleted) => ({
      success: true,
      operation: 'list_automation_test_runs',
      includeCompleted,
      runCount: 0,
      runs: [],
    }),
    private readonly readArtifactHandler: (
      runId: string,
      artifactName: string,
    ) => Promise<{ artifact: Record<string, unknown>; data: Buffer } | null> | { artifact: Record<string, unknown>; data: Buffer } | null = () => null,
  ) {}

  async runAutomationTests(request: Record<string, unknown>) {
    this.runCalls.push(request);
    return await this.runHandler(request);
  }

  async getAutomationTestRun(runId: string) {
    this.getCalls.push(runId);
    return await this.getHandler(runId);
  }

  async listAutomationTestRuns(includeCompleted = true) {
    this.listCalls.push(includeCompleted);
    return await this.listHandler(includeCompleted);
  }

  async readAutomationArtifact(runId: string, artifactName: string) {
    this.readArtifactCalls.push({ runId, artifactName });
    return await this.readArtifactHandler(runId, artifactName);
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

function parseToolResult(result: { content?: Array<{ text?: string; type: string }> }) {
  return JSON.parse(getTextContent(result));
}

function expectSchemaProperty(tool: { name: string; outputSchema?: unknown } | undefined, propertyName: string) {
  expect(tool, `Expected tool for schema property '${propertyName}'`).toBeTruthy();
  const schema = tool?.outputSchema as { properties?: Record<string, unknown> } | undefined;
  expect(schema?.properties?.[propertyName], `Expected ${tool?.name} outputSchema.properties.${propertyName}`).toBeTruthy();
}

describe('createBlueprintExtractorServer', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it('registers the expected resources, tools, prompts, and output schemas', async () => {
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient()));
    cleanups.push(harness.close);

    const resources = await harness.client.listResources();
    const resourceTemplates = await harness.client.listResourceTemplates();
    const prompts = await harness.client.listPrompts();
    const resourceUris = resources.resources.map((resource) => resource.uri);
    const resourceTemplateUris = resourceTemplates.resourceTemplates.map((template) => template.uriTemplate);
    const tools = await harness.client.listTools();
    const extractBlueprint = tools.tools.find((tool) => tool.name === 'extract_blueprint');
    const extractWidgetBlueprint = tools.tools.find((tool) => tool.name === 'extract_widget_blueprint');
    const extractMaterial = tools.tools.find((tool) => tool.name === 'extract_material');
    const createBlueprint = tools.tools.find((tool) => tool.name === 'create_blueprint');
    const extractCascade = tools.tools.find((tool) => tool.name === 'extract_cascade');
    const importAssets = tools.tools.find((tool) => tool.name === 'import_assets');
    const getImportJob = tools.tools.find((tool) => tool.name === 'get_import_job');
    const listImportJobs = tools.tools.find((tool) => tool.name === 'list_import_jobs');
    const saveAssets = tools.tools.find((tool) => tool.name === 'save_assets');
    const captureWidgetPreview = tools.tools.find((tool) => tool.name === 'capture_widget_preview');
    const compareCaptureToReference = tools.tools.find((tool) => tool.name === 'compare_capture_to_reference');
    const applyWindowUiChanges = tools.tools.find((tool) => tool.name === 'apply_window_ui_changes');
    const runAutomationTests = tools.tools.find((tool) => tool.name === 'run_automation_tests');
    const getAutomationTestRun = tools.tools.find((tool) => tool.name === 'get_automation_test_run');
    const listAutomationTestRuns = tools.tools.find((tool) => tool.name === 'list_automation_test_runs');

    expect(resourceTemplates.resourceTemplates).toHaveLength(4);
    expect(tools.tools).toHaveLength(87);
    expect(resourceUris).toContain('blueprint://scopes');
    expect(resourceUris).toContain('blueprint://write-capabilities');
    expect(resourceUris).toContain('blueprint://import-capabilities');
    expect(resourceUris).toContain('blueprint://authoring-conventions');
    expect(resourceUris).toContain('blueprint://selector-conventions');
    expect(resourceUris).toContain('blueprint://widget-best-practices');
    expect(resourceUris).toContain('blueprint://material-graph-guidance');
    expect(resourceUris).toContain('blueprint://font-roles');
    expect(resourceUris).toContain('blueprint://project-automation');
    expect(resourceUris).toContain('blueprint://verification-workflows');
    expect(resourceUris).toContain('blueprint://unsupported-surfaces');
    expect(resourceUris).toContain('blueprint://ui-redesign-workflow');
    expect(resourceTemplateUris).toContain('blueprint://examples/{family}');
    expect(resourceTemplateUris).toContain('blueprint://widget-patterns/{pattern}');
    expect(resourceTemplateUris).toContain('blueprint://captures/{capture_id}');
    expect(resourceTemplateUris).toContain('blueprint://test-runs/{run_id}/{artifact}');
    expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual(Object.keys(promptCatalog).sort());
    expect(tools.tools.some((tool) => tool.name === 'search_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_widget_blueprint')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'reimport_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'list_import_jobs')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'import_textures')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'import_meshes')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'extract_material_function')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'create_material')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'set_material_settings')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'add_material_expression')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'connect_material_expressions')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'bind_material_property')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_material')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'create_material_function')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_material_function')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'compile_material_asset')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'compile_project_code')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'get_project_automation_context')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'trigger_live_coding')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'restart_editor')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'sync_project_code')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'apply_window_ui_changes')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'capture_widget_preview')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'compare_capture_to_reference')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'list_captures')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'cleanup_captures')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'run_automation_tests')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'get_automation_test_run')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'list_automation_test_runs')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'create_input_action')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_input_action')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'create_input_mapping_context')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_input_mapping_context')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_blueprint_graphs')).toBe(true);
    expect(tools.tools.every((tool) => tool.outputSchema)).toBe(true);
    expectSchemaProperty(importAssets, 'jobId');
    expectSchemaProperty(importAssets, 'terminal');
    expectSchemaProperty(listImportJobs, 'jobs');
    expectSchemaProperty(extractCascade, 'extracted_count');
    expectSchemaProperty(extractCascade, 'manifest');
    expectSchemaProperty(captureWidgetPreview, 'captureId');
    expectSchemaProperty(captureWidgetPreview, 'surface');
    expectSchemaProperty(captureWidgetPreview, 'scenarioId');
    expectSchemaProperty(captureWidgetPreview, 'assetPaths');
    expectSchemaProperty(compareCaptureToReference, 'comparison');
    expectSchemaProperty(runAutomationTests, 'runId');
    expectSchemaProperty(runAutomationTests, 'verificationArtifacts');
    expectSchemaProperty(getAutomationTestRun, 'artifacts');
    expectSchemaProperty(listAutomationTestRuns, 'runs');
    expect(extractBlueprint?.annotations?.readOnlyHint).toBe(true);
    expect(extractWidgetBlueprint?.annotations?.readOnlyHint).toBe(true);
    expect(extractMaterial?.annotations?.readOnlyHint).toBe(true);
    expect(createBlueprint?.annotations?.readOnlyHint).toBe(false);
    expect(importAssets?.annotations?.readOnlyHint).toBe(false);
    expect(getImportJob?.annotations?.readOnlyHint).toBe(true);
    expect(captureWidgetPreview?.annotations?.readOnlyHint).toBe(true);
    expectSchemaProperty(applyWindowUiChanges, 'verification');
    expect(getAutomationTestRun?.annotations?.readOnlyHint).toBe(true);
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
    const verificationWorkflows = await harness.client.readResource({ uri: 'blueprint://verification-workflows' });
    const unsupportedSurfaces = await harness.client.readResource({ uri: 'blueprint://unsupported-surfaces' });
    const uiRedesignWorkflow = await harness.client.readResource({ uri: 'blueprint://ui-redesign-workflow' });
    const widgetExample = await harness.client.readResource({ uri: 'blueprint://examples/widget_blueprint' });
    const materialExample = await harness.client.readResource({ uri: 'blueprint://examples/material' });
    const enhancedInputExample = await harness.client.readResource({ uri: 'blueprint://examples/enhanced_input' });
    const windowPolishExample = await harness.client.readResource({ uri: 'blueprint://examples/window_ui_polish' });
    const projectCodeExample = await harness.client.readResource({ uri: 'blueprint://examples/project_code' });
    const widgetPattern = await harness.client.readResource({ uri: 'blueprint://widget-patterns/activatable_window' });
    const centeredOverlayPattern = await harness.client.readResource({ uri: 'blueprint://widget-patterns/centered_overlay' });
    const materialButtonPattern = await harness.client.readResource({ uri: 'blueprint://widget-patterns/material_button_base' });

    expect(scopes.contents[0]?.mimeType).toBe('text/plain');
    expect(scopes.contents[0]?.text).toContain('Blueprint Extraction Scopes');
    expect(writeCapabilities.contents[0]?.text).toContain('Current write-capable families:');
    expect(writeCapabilities.contents[0]?.text).toContain('extract_widget_blueprint');
    expect(writeCapabilities.contents[0]?.text).toContain('extract_material');
    expect(importCapabilities.contents[0]?.text).toContain('Blueprint Extractor Import Capabilities');
    expect(importCapabilities.contents[0]?.text).toContain('get_import_job');
    expect(importCapabilities.contents[0]?.text).toContain('mesh_type');
    expect(authoringConventions.contents[0]?.text).toContain('capture_widget_preview');
    expect(authoringConventions.contents[0]?.text).toContain('partial verification');
    expect(selectorConventions.contents[0]?.text).toContain('widget_path');
    expect(widgetBestPractices.contents[0]?.text).toContain('CommonActivatableWidget');
    expect(widgetBestPractices.contents[0]?.text).toContain('checkpoint_after_mutation_steps=true');
    expect(widgetBestPractices.contents[0]?.text).toContain('capture_widget_preview');
    expect(materialGraphGuidance.contents[0]?.text).toContain('Blueprint Extractor Material Graph Guidance');
    expect(materialGraphGuidance.contents[0]?.text).toContain('expression_guid');
    expect(fontRoles.contents[0]?.text).toContain('Blueprint Extractor Font Roles');
    expect(projectAutomation.contents[0]?.text).toContain('Blueprint Extractor Project Automation');
    expect(projectAutomation.contents[0]?.text).toContain('shutdown-first');
    expect(verificationWorkflows.contents[0]?.text).toContain('Blueprint Extractor Verification Workflows');
    expect(verificationWorkflows.contents[0]?.text).toContain('run_automation_tests');
    expect(verificationWorkflows.contents[0]?.text).toContain('partial verification');
    expect(unsupportedSurfaces.contents[0]?.text).toContain('Generic create_data_asset and modify_data_asset reject Enhanced Input asset classes');
    expect(unsupportedSurfaces.contents[0]?.text).toContain('CommonUI wrapper widgets');
    expect(uiRedesignWorkflow.contents[0]?.text).toContain('Safe UI Redesign Workflow');
    expect(uiRedesignWorkflow.contents[0]?.text).toContain('capture_widget_preview');
    expect(uiRedesignWorkflow.contents[0]?.text).toContain('partial verification');
    expect(widgetExample.contents[0]?.text).toContain('Example: insert_body_text');
    expect(widgetExample.contents[0]?.text).toContain('capture_widget_preview');
    expect(materialExample.contents[0]?.text).toContain('tool: bind_material_property');
    expect(enhancedInputExample.contents[0]?.text).toContain('tool: modify_input_mapping_context');
    expect(windowPolishExample.contents[0]?.text).toContain('tool: apply_window_ui_changes');
    expect(windowPolishExample.contents[0]?.text).toContain('capture_widget_preview');
    expect(projectCodeExample.contents[0]?.text).toContain('Use explicit changed_paths');
    expect(widgetPattern.contents[0]?.text).toContain('Pattern: activatable_window');
    expect(centeredOverlayPattern.contents[0]?.text).toContain('Pattern: centered_overlay');
    expect(materialButtonPattern.contents[0]?.text).toContain('Pattern: material_button_base');
  });

  it('serves the prompt catalog with concrete workflow guidance', async () => {
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient()));
    cleanups.push(harness.close);

    const promptNames = Object.keys(promptCatalog);
    const promptTextByName: Record<string, string> = {};
    for (const promptName of promptNames) {
      const argsByPrompt: Record<string, Record<string, string>> = {
        design_menu_screen: {
          widget_asset_path: '/Game/UI/WBP_Menu',
          design_goal: 'Create a centered main menu',
        },
        author_material_button_style: {
          asset_path: '/Game/Materials/M_Button',
          visual_goal: 'Warm metallic CTA',
        },
        wire_hud_widget_classes: {
          hud_asset_path: '/Game/UI/BP_HUD',
          widget_class_path: '/Game/UI/WBP_Menu.WBP_Menu_C',
          class_default_property: 'MainMenuClass',
        },
        debug_widget_compile_errors: {
          widget_asset_path: '/Game/UI/WBP_Menu',
          compile_summary_json: '{"status":"Error"}',
        },
      };

      const prompt = await harness.client.getPrompt({
        name: promptName,
        arguments: argsByPrompt[promptName],
      });

      expect(prompt.messages).toHaveLength(1);
      expect(prompt.messages[0]?.role).toBe('user');
      expect(prompt.messages[0]?.content.type).toBe('text');
      promptTextByName[promptName] = prompt.messages[0]?.content.type === 'text'
        ? prompt.messages[0].content.text
        : '';
    }

    expect(promptTextByName.design_menu_screen).toContain('capture_widget_preview');
    expect(promptTextByName.design_menu_screen).toContain('partial verification');
    expect(promptTextByName.debug_widget_compile_errors).toContain('capture_widget_preview');
    expect(promptTextByName.debug_widget_compile_errors).toContain('partial verification');
  });

  it('validates example catalog payloads against the live tool schemas', async () => {
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(new FakeUEClient(), new FakeProjectController()));
    cleanups.push(harness.close);

    for (const family of Object.values(exampleCatalog)) {
      for (const example of family.examples) {
        const result = await harness.client.callTool({
          name: example.tool,
          arguments: example.arguments,
        });

        expect(result.isError).not.toBe(true);
        expect(parseToolResult(result)).toMatchObject({
          success: true,
        });
      }
    }
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

    expect(parseToolResult(result)).toMatchObject({
      success: true,
      operation: 'search_assets',
      data: [
        {
          method: 'SearchAssets',
          params: {
            Query: 'Player',
            ClassFilter: 'Blueprint',
            MaxResults: 7,
          },
        },
      ],
    });
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
          widgetTreeStatus: 'ok',
          rootWidget: {
            class: 'VerticalBox',
            name: 'WindowRoot',
            widgetPath: 'WindowRoot',
          },
          compile: {
            success: true,
            status: 'UpToDate',
            errors: [],
            warnings: [],
            messages: [],
            errorCount: 0,
            warningCount: 0,
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
      widgetTreeStatus: 'ok',
      rootWidget: {
        widgetPath: 'WindowRoot',
      },
      compile: {
        errors: [],
        warnings: [],
        messages: [],
        errorCount: 0,
        warningCount: 0,
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

  it('preserves degraded extract_widget_blueprint snapshots with rootWidget=null and compile diagnostics', async () => {
    const fakeClient = new FakeUEClient((method) => {
      if (method === 'ExtractWidgetBlueprint') {
        return JSON.stringify({
          success: true,
          operation: 'extract_widget_blueprint',
          assetPath: '/Game/UI/WBP_Broken',
          rootWidget: null,
          widgetTreeStatus: 'missing_root_widget',
          widgetTreeError: 'WidgetTree exists but RootWidget is null.',
          compile: {
            success: false,
            status: 'Error',
            errors: ['BindWidget mismatch'],
            warnings: ['Blueprint is dirty'],
            messages: [
              { severity: 'error', message: 'BindWidget mismatch' },
            ],
            errorCount: 1,
            warningCount: 1,
          },
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'extract_widget_blueprint',
      arguments: {
        asset_path: '/Game/UI/WBP_Broken',
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      operation: 'extract_widget_blueprint',
      rootWidget: null,
      widgetTreeStatus: 'missing_root_widget',
      widgetTreeError: 'WidgetTree exists but RootWidget is null.',
      compile: {
        status: 'Error',
        errors: ['BindWidget mismatch'],
        warningCount: 1,
      },
    });
  });

  it('routes snake_case widget variable flags, widget-path patches, and widget class-default patches through the narrowed widget API', async () => {
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
        is_variable: true,
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
            classDefaults: {
              ActiveTitleBarMaterial: '/Game/UI/MI_TitleBarActive.MI_TitleBarActive',
            },
          }),
          bValidateOnly: false,
        },
      },
    ]);
  });

  it('routes explicit Blueprint graph mutations through the graph authoring API', async () => {
    const fakeClient = new FakeUEClient((method, params) => JSON.stringify({
      success: true,
      operation: 'modify_blueprint_graphs',
      assetPath: params.AssetPath,
      widgetOperation: params.Operation,
      functionGraphs: ['ForcedRallyServeMode_WidgetInitialize', 'ForcedRallyServeMode_UpdateAfterChanges'],
    }));
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const upsertGraphs = await harness.client.callTool({
      name: 'modify_blueprint_graphs',
      arguments: {
        asset_path: '/Game/Test/BP_SettingsLogic',
        operation: 'upsert_function_graphs',
        payload: {
          functionGraphs: [
            { graphName: 'ForcedRallyServeMode_WidgetInitialize', category: 'Settings' },
            { graphName: 'ForcedRallyServeMode_UpdateAfterChanges', category: 'Settings' },
          ],
        },
      },
    });
    const appendCall = await harness.client.callTool({
      name: 'modify_blueprint_graphs',
      arguments: {
        asset_path: '/Game/Test/BP_SettingsLogic',
        operation: 'append_function_call_to_sequence',
        payload: {
          graphName: 'BpInitialize',
          functionName: 'ForcedRallyServeMode_UpdateAfterChanges',
          sequenceNodeTitle: 'Sequence',
          posX: 256,
          posY: 144,
        },
        validate_only: true,
      },
    });

    expect(JSON.parse(getTextContent(upsertGraphs))).toMatchObject({
      success: true,
      operation: 'modify_blueprint_graphs',
      functionGraphs: [
        'ForcedRallyServeMode_WidgetInitialize',
        'ForcedRallyServeMode_UpdateAfterChanges',
      ],
    });
    expect(JSON.parse(getTextContent(appendCall))).toMatchObject({
      success: true,
      operation: 'modify_blueprint_graphs',
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'ModifyBlueprintGraphs',
        params: {
          AssetPath: '/Game/Test/BP_SettingsLogic',
          Operation: 'upsert_function_graphs',
          PayloadJson: JSON.stringify({
            functionGraphs: [
              { graphName: 'ForcedRallyServeMode_WidgetInitialize', category: 'Settings' },
              { graphName: 'ForcedRallyServeMode_UpdateAfterChanges', category: 'Settings' },
            ],
          }),
          bValidateOnly: false,
        },
      },
      {
        method: 'ModifyBlueprintGraphs',
        params: {
          AssetPath: '/Game/Test/BP_SettingsLogic',
          Operation: 'append_function_call_to_sequence',
          PayloadJson: JSON.stringify({
            graphName: 'BpInitialize',
            functionName: 'ForcedRallyServeMode_UpdateAfterChanges',
            sequenceNodeTitle: 'Sequence',
            posX: 256,
            posY: 144,
          }),
          bValidateOnly: true,
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

  it('preserves resource_link and inline image content for capture tools and serves capture resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-capture-resource-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const artifactPath = join(root, 'capture.png');
    await writeFile(artifactPath, Buffer.from('png-bytes'));

    const fakeClient = new FakeUEClient((method, params) => {
      if (method === 'CaptureWidgetPreview') {
        return JSON.stringify({
          success: true,
          operation: 'capture_widget_preview',
          captureId: 'capture-123',
          captureType: 'widget_preview',
          assetPath: params.AssetPath,
          widgetClass: '/Game/UI/WBP_Window.WBP_Window_C',
          captureDirectory: root,
          artifactPath,
          metadataPath: join(root, 'metadata.json'),
          width: params.Width,
          height: params.Height,
          fileSizeBytes: 9,
          createdAt: '2026-03-17T10:00:00.000Z',
          projectDir: 'C:/Projects/MyGame',
        });
      }

      if (method === 'ListCaptures') {
        return JSON.stringify({
          success: true,
          operation: 'list_captures',
          assetPathFilter: params.AssetPathFilter ?? '',
          captureCount: 1,
          captures: [{
            captureId: 'capture-123',
            captureType: 'widget_preview',
            assetPath: '/Game/UI/WBP_Window',
            widgetClass: '/Game/UI/WBP_Window.WBP_Window_C',
            captureDirectory: root,
            artifactPath,
            metadataPath: join(root, 'metadata.json'),
            width: 320,
            height: 180,
            fileSizeBytes: 9,
            createdAt: '2026-03-17T10:00:00.000Z',
            projectDir: 'C:/Projects/MyGame',
          }],
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });

    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'capture_widget_preview',
      arguments: {
        asset_path: '/Game/UI/WBP_Window',
        width: 320,
        height: 180,
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      captureId: 'capture-123',
      resourceUri: 'blueprint://captures/capture-123',
      surface: 'editor_offscreen',
      scenarioId: 'widget_preview:/Game/UI/WBP_Window',
      assetPaths: ['/Game/UI/WBP_Window'],
      width: 320,
      height: 180,
      worldContext: {
        contextType: 'widget_blueprint',
        renderLane: 'offscreen',
        assetPath: '/Game/UI/WBP_Window',
      },
      cameraContext: {
        contextType: 'offscreen_widget',
        width: 320,
        height: 180,
      },
    });
    expect(result.content?.some((entry) => entry.type === 'resource_link')).toBe(true);
    expect(result.content?.some((entry) => entry.type === 'image')).toBe(true);

    const captureResource = await harness.client.readResource({ uri: 'blueprint://captures/capture-123' });
    expect(captureResource.contents[0]?.mimeType).toBe('image/png');
    expect(captureResource.contents[0]?.blob).toBe(Buffer.from('png-bytes').toString('base64'));
  });

  it('normalizes comparison metadata into a shared verification comparison block', async () => {
    const fakeClient = new FakeUEClient((method) => {
      if (method === 'CompareCaptureToReference') {
        return JSON.stringify({
          success: true,
          operation: 'compare_capture_to_reference',
          capturePath: 'C:/Captures/actual.png',
          referencePath: 'C:/Captures/reference.png',
          tolerance: 0.02,
          pass: false,
          rmse: 0.12,
          maxPixelDelta: 19,
          mismatchPixelCount: 42,
          mismatchPercentage: 0.5,
          diffCaptureId: 'diff-123',
          diffArtifactPath: 'C:/Captures/diff.png',
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'compare_capture_to_reference',
      arguments: {
        capture: 'capture-123',
        reference: 'C:/Captures/reference.png',
        tolerance: 0.02,
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: true,
      operation: 'compare_capture_to_reference',
      diffResourceUri: 'blueprint://captures/diff-123',
      comparison: {
        capturePath: 'C:/Captures/actual.png',
        referencePath: 'C:/Captures/reference.png',
        tolerance: 0.02,
        pass: false,
        rmse: 0.12,
        maxPixelDelta: 19,
        mismatchPixelCount: 42,
        mismatchPercentage: 0.5,
        diffCaptureId: 'diff-123',
        diffArtifactPath: 'C:/Captures/diff.png',
      },
    });
    expect(result.content?.some((entry) => entry.type === 'resource_link')).toBe(true);
  });

  it('routes automation runs through the host-side automation controller and serves artifact resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-automation-artifacts-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const screenshotPath = join(root, 'RuntimeShot.png');
    await writeFile(screenshotPath, Buffer.from('runtime-png'));

    const fakeClient = new FakeUEClient((method) => {
      if (method === 'GetProjectAutomationContext') {
        return JSON.stringify({
          success: true,
          operation: 'get_project_automation_context',
          engineRoot: 'C:/Epic/UE_5.7',
          projectFilePath: 'C:/Projects/MyGame/MyGame.uproject',
          editorTarget: 'MyGameEditor',
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const fakeAutomationController = new FakeAutomationController(
      (request) => ({
        success: true,
        operation: 'run_automation_tests',
        runId: 'run-123',
        automationFilter: request.automationFilter,
        status: 'running',
        terminal: false,
        engineRoot: request.engineRoot,
        projectPath: request.projectPath,
        projectDir: 'C:/Projects/MyGame',
        target: request.target,
        reportOutputDir: 'C:/Projects/MyGame/Saved/BlueprintExtractor/AutomationRuns/run-123/reports',
        command: {
          executable: 'C:/Epic/UE_5.7/Engine/Binaries/Win64/UnrealEditor-Cmd.exe',
          args: ['Automation'],
        },
        diagnostics: [],
        timeoutMs: request.timeoutMs,
        nullRhi: request.nullRhi,
        artifacts: [
          {
            name: 'summary',
            path: 'C:/Projects/MyGame/Saved/BlueprintExtractor/AutomationRuns/run-123/summary.json',
            mimeType: 'application/json',
            resourceUri: 'blueprint://test-runs/run-123/summary',
          },
          {
            name: 'report__screenshots_runtime_png',
            path: screenshotPath,
            mimeType: 'image/png',
            resourceUri: 'blueprint://test-runs/run-123/report__screenshots_runtime_png',
            relativePath: 'Screenshots/RuntimeShot.png',
          },
        ],
      }),
      async (runId) => ({
        success: true,
        operation: 'get_automation_test_run',
        runId,
        automationFilter: 'BlueprintExtractor.Verification',
        status: 'succeeded',
        terminal: true,
        engineRoot: 'C:/Epic/UE_5.7',
        projectPath: 'C:/Projects/MyGame/MyGame.uproject',
        projectDir: 'C:/Projects/MyGame',
        target: 'MyGameEditor',
        reportOutputDir: 'C:/Projects/MyGame/Saved/BlueprintExtractor/AutomationRuns/run-123/reports',
        command: {
          executable: 'C:/Epic/UE_5.7/Engine/Binaries/Win64/UnrealEditor-Cmd.exe',
          args: ['Automation'],
        },
        diagnostics: [],
        timeoutMs: 900000,
        nullRhi: false,
        artifacts: [
          {
            name: 'summary',
            path: 'C:/Projects/MyGame/Saved/BlueprintExtractor/AutomationRuns/run-123/summary.json',
            mimeType: 'application/json',
            resourceUri: 'blueprint://test-runs/run-123/summary',
          },
          {
            name: 'report__screenshots_runtime_png',
            path: screenshotPath,
            mimeType: 'image/png',
            resourceUri: 'blueprint://test-runs/run-123/report__screenshots_runtime_png',
            relativePath: 'Screenshots/RuntimeShot.png',
          },
        ],
        summary: {
          successful: true,
          reportAvailable: true,
          totalTests: 2,
          passedTests: 2,
          failedTests: 0,
        },
      }),
      async (includeCompleted) => ({
        success: true,
        operation: 'list_automation_test_runs',
        includeCompleted,
        runCount: 1,
        runs: [{
          success: true,
          operation: 'get_automation_test_run',
          runId: 'run-123',
          automationFilter: 'BlueprintExtractor.Verification',
          status: 'succeeded',
          terminal: true,
          engineRoot: 'C:/Epic/UE_5.7',
          projectPath: 'C:/Projects/MyGame/MyGame.uproject',
          projectDir: 'C:/Projects/MyGame',
          target: 'MyGameEditor',
          reportOutputDir: 'C:/Projects/MyGame/Saved/BlueprintExtractor/AutomationRuns/run-123/reports',
          command: {
            executable: 'C:/Epic/UE_5.7/Engine/Binaries/Win64/UnrealEditor-Cmd.exe',
            args: ['Automation'],
          },
          diagnostics: [],
          timeoutMs: 900000,
          nullRhi: false,
          artifacts: [{
            name: 'report__screenshots_runtime_png',
            path: screenshotPath,
            mimeType: 'image/png',
            resourceUri: 'blueprint://test-runs/run-123/report__screenshots_runtime_png',
            relativePath: 'Screenshots/RuntimeShot.png',
          }],
        }],
      }),
      async () => ({
        artifact: {
          name: 'summary',
          path: 'C:/Projects/MyGame/Saved/BlueprintExtractor/AutomationRuns/run-123/summary.json',
          mimeType: 'application/json',
          resourceUri: 'blueprint://test-runs/run-123/summary',
        },
        data: Buffer.from('{"successful":true}'),
      }),
    );

    const harness = await connectInMemoryServer(createBlueprintExtractorServer(
      fakeClient,
      new FakeProjectController(),
      fakeAutomationController,
    ));
    cleanups.push(harness.close);

    const runResult = await harness.client.callTool({
      name: 'run_automation_tests',
      arguments: {
        automation_filter: 'BlueprintExtractor.Verification',
        timeout_seconds: 900,
      },
    });
    const getResult = await harness.client.callTool({
      name: 'get_automation_test_run',
      arguments: {
        run_id: 'run-123',
      },
    });
    const listResult = await harness.client.callTool({
      name: 'list_automation_test_runs',
      arguments: {
        include_completed: false,
      },
    });

    expect(JSON.parse(getTextContent(runResult))).toMatchObject({
      runId: 'run-123',
      verificationArtifacts: [{
        surface: 'pie_runtime',
        captureType: 'automation_screenshot',
        scenarioId: 'automation:BlueprintExtractor.Verification:report__screenshots_runtime_png',
        artifactPath: screenshotPath,
        resourceUri: 'blueprint://test-runs/run-123/report__screenshots_runtime_png',
      }],
      inputResolution: {
        engineRoot: 'editor_context',
        projectPath: 'editor_context',
        target: 'editor_context',
      },
    });
    expect(runResult.content?.some((entry) => entry.type === 'resource_link')).toBe(true);
    expect(runResult.content?.some((entry) => entry.type === 'image')).toBe(true);
    expect(JSON.parse(getTextContent(getResult))).toMatchObject({
      runId: 'run-123',
      status: 'succeeded',
      verificationArtifacts: [{
        surface: 'pie_runtime',
        captureType: 'automation_screenshot',
        scenarioId: 'automation:BlueprintExtractor.Verification:report__screenshots_runtime_png',
        artifactPath: screenshotPath,
        resourceUri: 'blueprint://test-runs/run-123/report__screenshots_runtime_png',
      }],
      summary: {
        successful: true,
        totalTests: 2,
      },
    });
    expect(JSON.parse(getTextContent(listResult))).toMatchObject({
      includeCompleted: false,
      runCount: 1,
      runs: [{
        runId: 'run-123',
        verificationArtifacts: [{
          surface: 'pie_runtime',
          captureType: 'automation_screenshot',
          scenarioId: 'automation:BlueprintExtractor.Verification:report__screenshots_runtime_png',
          artifactPath: screenshotPath,
          resourceUri: 'blueprint://test-runs/run-123/report__screenshots_runtime_png',
        }],
      }],
    });

    const summaryResource = await harness.client.readResource({ uri: 'blueprint://test-runs/run-123/summary' });
    expect(summaryResource.contents[0]?.mimeType).toBe('application/json');
    expect(summaryResource.contents[0]?.text).toContain('"successful":true');
    expect(fakeAutomationController.runCalls).toEqual([
      {
        automationFilter: 'BlueprintExtractor.Verification',
        engineRoot: 'C:/Epic/UE_5.7',
        projectPath: 'C:/Projects/MyGame/MyGame.uproject',
        target: 'MyGameEditor',
        reportOutputDir: undefined,
        timeoutMs: 900000,
        nullRhi: true,
      },
    ]);
    expect(fakeAutomationController.getCalls).toEqual(['run-123']);
    expect(fakeAutomationController.listCalls).toEqual([false]);
    expect(fakeAutomationController.readArtifactCalls).toEqual([{ runId: 'run-123', artifactName: 'summary' }]);
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
        clearUhtCache: false,
      },
    ]);
  });

  it('fills missing compile_project_code inputs from editor automation context before env fallback', async () => {
    const fakeClient = new FakeUEClient((method) => {
      if (method === 'GetProjectAutomationContext') {
        return JSON.stringify({
          success: true,
          operation: 'get_project_automation_context',
          engineRoot: 'C:/Epic/UE_5.7',
          projectFilePath: 'C:/Projects/MyGame/MyGame.uproject',
          editorTarget: 'MyGameEditor',
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const fakeController = new FakeProjectController();
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient, fakeController));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'compile_project_code',
      arguments: {},
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      operation: 'compile_project_code',
      inputResolution: {
        engineRoot: 'editor_context',
        projectPath: 'editor_context',
        target: 'editor_context',
      },
    });
    expect(fakeController.compileCalls).toEqual([
      {
        engineRoot: 'C:/Epic/UE_5.7',
        projectPath: 'C:/Projects/MyGame/MyGame.uproject',
        target: 'MyGameEditor',
        platform: undefined,
        configuration: undefined,
        buildTimeoutMs: undefined,
        includeOutput: false,
        clearUhtCache: false,
      },
    ]);
  });

  it('exposes editor-derived project automation context directly', async () => {
    const fakeClient = new FakeUEClient((method) => {
      if (method === 'GetProjectAutomationContext') {
        return JSON.stringify({
          success: true,
          operation: 'get_project_automation_context',
          engineRoot: 'C:/Epic/UE_5.7',
          projectFilePath: 'C:/Projects/MyGame/MyGame.uproject',
          editorTarget: 'MyGameEditor',
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'get_project_automation_context',
      arguments: {},
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      operation: 'get_project_automation_context',
      engineRoot: 'C:/Epic/UE_5.7',
      projectFilePath: 'C:/Projects/MyGame/MyGame.uproject',
      editorTarget: 'MyGameEditor',
    });
    expect(fakeClient.calls).toEqual([
      {
        method: 'GetProjectAutomationContext',
        params: {},
      },
    ]);
  });

  it('returns live coding fallback metadata and last external build context for NoChanges results', async () => {
    const fakeClient = new FakeUEClient((method) => {
      if (method === 'TriggerLiveCoding') {
        return JSON.stringify({
          success: true,
          operation: 'trigger_live_coding',
          status: 'completed',
          compileResult: 'NoChanges',
          noOp: true,
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
        engineRoot: 'C:/Epic/UE_5.7',
        projectPath: 'C:/Projects/MyGame/MyGame.uproject',
        target: 'MyGameEditor',
        platform: 'Win64',
        configuration: 'Development',
        restartRequired: true,
        restartReasons: ['external_build_completed'],
      }),
    );
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient, fakeController));
    cleanups.push(harness.close);

    await harness.client.callTool({
      name: 'compile_project_code',
      arguments: {
        engine_root: 'C:/Epic/UE_5.7',
        project_path: 'C:/Projects/MyGame/MyGame.uproject',
        target: 'MyGameEditor',
      },
    });
    const result = await harness.client.callTool({
      name: 'trigger_live_coding',
      arguments: {
        changed_paths: ['Source/MyGame/Private/MyActor.cpp'],
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      operation: 'trigger_live_coding',
      compileResult: 'NoChanges',
      fallbackRecommended: true,
      reason: 'live_coding_reported_nochanges',
      lastExternalBuild: {
        target: 'MyGameEditor',
        configuration: 'Development',
      },
    });
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
      undefined,
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
    expect(fakeClient.calls).toEqual([
      {
        method: 'GetProjectAutomationContext',
        params: {},
      },
      {
        method: 'TriggerLiveCoding',
        params: {
          bEnableForSession: true,
          bWaitForCompletion: true,
        },
      },
      {
        method: 'SaveAssets',
        params: {
          AssetPathsJson: JSON.stringify(['/Game/UI/WBP_Window']),
        },
      },
      {
        method: 'RestartEditor',
        params: {
          bWarn: false,
          bSaveDirtyAssets: true,
          bRelaunch: true,
        },
      },
    ]);
  });

  it('uses shutdown-first orchestration and host-side launch when sync_project_code.restart_first is true', async () => {
    const fakeClient = new FakeUEClient((method, params) => {
      if (method === 'GetProjectAutomationContext') {
        return JSON.stringify({
          success: true,
          operation: 'get_project_automation_context',
          engineRoot: 'C:/Epic/UE_5.7',
          projectFilePath: 'C:/Projects/MyGame/MyGame.uproject',
          editorTarget: 'MyGameEditor',
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
          relaunch: params.bRelaunch,
        });
      }

      return JSON.stringify({ error: `Unexpected method ${method}` });
    });
    const fakeController = new FakeProjectController(
      true,
      () => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      }),
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
        operation: 'launch_editor',
        engineRoot: 'C:/Epic/UE_5.7',
        projectPath: 'C:/Projects/MyGame/MyGame.uproject',
        projectDir: 'C:/Projects/MyGame',
        command: {
          executable: 'C:/Epic/UE_5.7/Engine/Binaries/Win64/UnrealEditor.exe',
          args: ['C:/Projects/MyGame/MyGame.uproject'],
        },
        detached: true,
        diagnostics: [],
      }),
      (request) => ({
        success: true,
        operation: 'restart_editor',
        disconnected: request.waitForDisconnect === false ? false : true,
        reconnected: request.waitForReconnect === false ? false : true,
        diagnostics: [],
      }),
    );
    const harness = await connectInMemoryServer(createBlueprintExtractorServer(fakeClient, fakeController));
    cleanups.push(harness.close);

    const result = await harness.client.callTool({
      name: 'sync_project_code',
      arguments: {
        changed_paths: ['Source/MyGame/Public/MyActor.h'],
        restart_first: true,
        save_asset_paths: ['/Game/UI/WBP_Window'],
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: true,
      operation: 'sync_project_code',
      strategy: 'restart_first',
      preRestart: {
        relaunch: false,
      },
      preDisconnect: {
        disconnected: true,
        reconnected: false,
      },
      editorLaunch: {
        operation: 'launch_editor',
      },
      reconnect: {
        disconnected: false,
        reconnected: true,
      },
    });
    expect(fakeController.launchCalls).toEqual([{
      engineRoot: 'C:/Epic/UE_5.7',
      projectPath: 'C:/Projects/MyGame/MyGame.uproject',
    }]);
    expect(fakeController.waitCalls).toEqual([
      {
        disconnectTimeoutMs: 60000,
        reconnectTimeoutMs: 180000,
        waitForReconnect: false,
      },
      {
        disconnectTimeoutMs: 60000,
        reconnectTimeoutMs: 180000,
        waitForDisconnect: false,
      },
    ]);
    expect(fakeClient.calls).toEqual([
      {
        method: 'GetProjectAutomationContext',
        params: {},
      },
      {
        method: 'SaveAssets',
        params: {
          AssetPathsJson: JSON.stringify(['/Game/UI/WBP_Window']),
        },
      },
      {
        method: 'RestartEditor',
        params: {
          bWarn: false,
          bSaveDirtyAssets: true,
          bRelaunch: false,
        },
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
    expect(fakeClient.calls[1]).toMatchObject({
      method: 'ModifyWidgetBlueprintStructure',
      params: {
        PayloadJson: JSON.stringify({
          classDefaults: {
            ActiveTitleBarMaterial: '/Game/UI/MI_TitleBarActive.MI_TitleBarActive',
          },
        }),
      },
    });
  });

  it('can checkpoint after each successful apply_window_ui_changes mutation step', async () => {
    const fakeClient = new FakeUEClient((method, params) => {
      if (method === 'ModifyWidget' || method === 'ModifyWidgetBlueprintStructure') {
        return JSON.stringify({
          success: true,
          operation: method,
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
        checkpoint_after_mutation_steps: true,
        compile_after: false,
        save_after: false,
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: true,
      operation: 'apply_window_ui_changes',
      verification: {
        required: true,
        status: 'compile_pending',
        surface: 'editor_offscreen',
        recommendedTool: 'capture_widget_preview',
        partialAllowed: true,
      },
    });
    expect(fakeClient.calls.map((call) => call.method)).toEqual([
      'ModifyWidget',
      'SaveAssets',
      'ModifyWidgetBlueprintStructure',
      'SaveAssets',
    ]);
  });

  it('surfaces unverified visual verification state after a successful apply_window_ui_changes compile/save flow', async () => {
    const fakeClient = new FakeUEClient((method) => {
      if (method === 'ModifyWidgetBlueprintStructure' || method === 'CompileWidgetBlueprint' || method === 'SaveAssets') {
        return JSON.stringify({
          success: true,
          operation: method,
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
        class_defaults: {
          ActiveTitleBarMaterial: '/Game/UI/MI_TitleBarActive.MI_TitleBarActive',
        },
        compile_after: true,
        save_after: true,
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: true,
      operation: 'apply_window_ui_changes',
      verification: {
        required: true,
        status: 'unverified',
        surface: 'editor_offscreen',
        recommendedTool: 'capture_widget_preview',
        partialAllowed: true,
      },
      next_steps: expect.arrayContaining([
        'If preview capture is blocked, report partial verification explicitly with the blocking reason.',
      ]),
    });
    expect(fakeClient.calls.map((call) => call.method)).toEqual([
      'ModifyWidgetBlueprintStructure',
      'CompileWidgetBlueprint',
      'SaveAssets',
    ]);
  });

  it('keeps save_after disabled by default so visual verification can run before persistence', async () => {
    const fakeClient = new FakeUEClient((method) => {
      if (method === 'ModifyWidgetBlueprintStructure' || method === 'CompileWidgetBlueprint') {
        return JSON.stringify({
          success: true,
          operation: method,
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
        class_defaults: {
          ActiveTitleBarMaterial: '/Game/UI/MI_TitleBarActive.MI_TitleBarActive',
        },
        compile_after: true,
      },
    });

    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: true,
      operation: 'apply_window_ui_changes',
      verification: {
        required: true,
        status: 'unverified',
        surface: 'editor_offscreen',
        recommendedTool: 'capture_widget_preview',
        partialAllowed: true,
      },
    });
    expect(fakeClient.calls.map((call) => call.method)).toEqual([
      'ModifyWidgetBlueprintStructure',
      'CompileWidgetBlueprint',
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
