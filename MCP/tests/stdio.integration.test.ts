import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getTextContent, parseToolResult, startMockRemoteControlServer } from './test-helpers.js';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const serverEntry = resolve(currentDir, '../dist/index.js');

describe('stdio integration', () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
  });

  it('serves the MCP contract over stdio against a mock Remote Control endpoint', async () => {
    const captureRoot = await mkdtemp(join(tmpdir(), 'bpx-stdio-capture-'));
    cleanup.push(() => rm(captureRoot, { recursive: true, force: true }));
    const capturePath = join(captureRoot, 'capture.png');
    const motionCapturePath = join(captureRoot, 'motion-open.png');
    await writeFile(capturePath, Buffer.from('capture-image'));
    await writeFile(motionCapturePath, Buffer.from('motion-image'));

    const remoteServer = await startMockRemoteControlServer({
      onCall: (request) => {
        if (request.functionName === 'GetProjectAutomationContext') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'get_project_automation_context',
                instanceId: 'stdio-mock-editor',
                projectName: 'MockProject',
                projectFilePath: 'C:/Projects/MyGame/MyGame.uproject',
                projectDir: 'C:/Projects/MyGame',
                engineDir: 'C:/Epic/UE_5.7/Engine',
                engineRoot: 'C:/Epic/UE_5.7',
                engineVersion: '5.7.0-stdio',
                editorTarget: 'MyGameEditor',
                processId: 4242,
                remoteControlHost: remoteServer.host,
                remoteControlPort: remoteServer.port,
                lastSeenAt: '2026-03-30T00:00:00.000Z',
                hostPlatform: 'Windows',
                isPlayingInEditor: false,
              }),
            },
          };
        }

        if (request.functionName === 'SearchAssets') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'search_assets',
                results: [
                  {
                    path: '/Game/Test/BP_Player',
                    name: 'BP_Player',
                    class: 'Blueprint',
                  },
                ],
                page: 1,
                per_page: 5,
                total_count: 1,
                total_pages: 1,
                has_more: false,
              }),
            },
          };
        }

        if (request.functionName === 'ListImportJobs') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'list_import_jobs',
                jobCount: 1,
                jobs: [
                  {
                    success: true,
                    operation: 'import_assets',
                    status: 'running',
                    terminal: false,
                    validateOnly: false,
                    createdAt: '2026-03-09T10:00:00Z',
                    startedAt: '2026-03-09T10:00:01Z',
                    jobId: 'job-123',
                    itemCount: 1,
                    acceptedItemCount: 1,
                    failedItemCount: 0,
                    items: [
                      {
                        index: 0,
                        status: 'importing',
                        filePath: 'C:/Temp/Test.png',
                        destinationPath: '/Game/Imported',
                        importedObjects: [],
                        dirtyPackages: [],
                        diagnostics: [],
                      },
                    ],
                    importedObjects: [],
                    dirtyPackages: [],
                    diagnostics: [],
                  },
                ],
                includeCompleted: true,
              }),
            },
          };
        }

        if (request.functionName === 'ExtractMaterial') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'extract_material',
                material: {
                  assetPath: request.parameters.AssetPath,
                  expressions: [{
                    expressionGuid: 'expr-guid-1',
                    class: '/Script/Engine.MaterialExpressionScalarParameter',
                  }],
                },
              }),
            },
          };
        }

        if (request.functionName === 'ModifyMaterial') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'modify_material',
                assetPath: request.parameters.AssetPath,
                tempIdMap: {
                  roughness: 'expr-guid-2',
                },
              }),
            },
          };
        }

        if (request.functionName === 'TriggerLiveCoding') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'trigger_live_coding',
                status: 'success',
              }),
            },
          };
        }

        if (request.functionName === 'CaptureWidgetPreview') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'capture_widget_preview',
                captureId: 'capture-123',
                captureType: 'widget_preview',
                assetPath: request.parameters.AssetPath,
                widgetClass: '/Game/Test/WBP_Window.WBP_Window_C',
                captureDirectory: captureRoot,
                artifactPath: capturePath,
                metadataPath: join(captureRoot, 'metadata.json'),
                width: request.parameters.Width,
                height: request.parameters.Height,
                fileSizeBytes: 13,
                createdAt: '2026-03-17T10:00:00.000Z',
                projectDir: 'C:/Projects/MyGame',
              }),
            },
          };
        }

        if (request.functionName === 'ExtractWidgetAnimation') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'extract_widget_animation',
                assetPath: request.parameters.AssetPath,
                animationName: request.parameters.AnimationName,
                supportedTracks: ['render_opacity', 'render_transform_translation', 'render_transform_scale', 'render_transform_angle', 'color_and_opacity'],
                animation: {
                  name: 'OpenSequence',
                  durationMs: 260,
                  bindings: [
                    {
                      widgetPath: 'WindowRoot/MainPanel',
                    },
                  ],
                  tracks: [
                    {
                      widget_path: 'WindowRoot/MainPanel',
                      property: 'render_opacity',
                      keys: [
                        { time_ms: 0, value: 0 },
                        { time_ms: 260, value: 1 },
                      ],
                    },
                  ],
                  checkpoints: [
                    { name: 'open', timeMs: 260 },
                  ],
                },
              }),
            },
          };
        }

        if (request.functionName === 'CaptureWidgetMotionCheckpoints') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'capture_widget_motion_checkpoints',
                motionCaptureId: 'motion-123',
                mode: 'editor_preview',
                triggerMode: 'asset_animation',
                playbackSource: request.parameters.AssetPath,
                assetPath: request.parameters.AssetPath,
                animationName: 'OpenSequence',
                verificationArtifacts: [
                  {
                    captureId: 'motion-open-1',
                    captureType: 'widget_motion_checkpoint',
                    surface: 'widget_motion_checkpoint',
                    assetPath: request.parameters.AssetPath,
                    captureDirectory: captureRoot,
                    artifactPath: motionCapturePath,
                    metadataPath: join(captureRoot, 'motion-open.json'),
                    width: 256,
                    height: 256,
                    fileSizeBytes: 11,
                    createdAt: '2026-03-17T10:01:00.000Z',
                    projectDir: 'C:/Projects/MyGame',
                    checkpointName: 'open',
                    checkpointMs: 260,
                    playbackSource: 'OpenSequence',
                    triggerMode: 'asset_animation',
                    motionCaptureId: 'motion-123',
                  },
                ],
              }),
            },
          };
        }

        if (request.functionName === 'CompareCaptureToReference') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'compare_capture_to_reference',
                pass: true,
                capture: request.parameters.CaptureIdOrPath,
                reference: request.parameters.ReferenceIdOrPath,
                tolerance: request.parameters.Tolerance,
                comparison: {
                  pass: true,
                  tolerance: request.parameters.Tolerance,
                  normalizedRmse: 0.001,
                  mismatchPixels: 0,
                  pixelCount: 65536,
                },
              }),
            },
          };
        }

        if (request.functionName === 'ListCaptures') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'list_captures',
                assetPathFilter: request.parameters.AssetPathFilter ?? '',
                captureCount: 1,
                captures: [{
                  captureId: 'capture-123',
                  captureType: 'widget_preview',
                  assetPath: '/Game/Test/WBP_Window',
                  widgetClass: '/Game/Test/WBP_Window.WBP_Window_C',
                  captureDirectory: captureRoot,
                  artifactPath: capturePath,
                  metadataPath: join(captureRoot, 'metadata.json'),
                  width: 256,
                  height: 256,
                  fileSizeBytes: 13,
                  createdAt: '2026-03-17T10:00:00.000Z',
                  projectDir: 'C:/Projects/MyGame',
                }],
              }),
            },
          };
        }

        return {
          status: 404,
          body: { error: `Unexpected method ${request.functionName}` },
        };
      },
    });
    cleanup.push(() => remoteServer.close());

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        ...process.env,
        UE_REMOTE_CONTROL_HOST: remoteServer.host,
        UE_REMOTE_CONTROL_PORT: String(remoteServer.port),
        UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH: '/Script/Test.OverrideSubsystem',
      },
      stderr: 'pipe',
    });

    const client = new Client({
      name: 'blueprint-extractor-stdio-tests',
      version: '1.0.0',
    });

    await client.connect(transport);
    cleanup.push(() => client.close());

    const tools = await client.listTools();
    const resources = await client.listResources();
    const resourceTemplates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();
    const scopes = await client.readResource({ uri: 'blueprint://scopes' });
    const importCapabilities = await client.readResource({ uri: 'blueprint://import-capabilities' });
    const materialGuidance = await client.readResource({ uri: 'blueprint://material-graph-guidance' });
    const fontRoles = await client.readResource({ uri: 'blueprint://font-roles' });
    const projectAutomation = await client.readResource({ uri: 'blueprint://project-automation' });
    const verificationWorkflows = await client.readResource({ uri: 'blueprint://verification-workflows' });
    const designSpecSchema = await client.readResource({ uri: 'blueprint://design-spec-schema' });
    const multimodalWorkflow = await client.readResource({ uri: 'blueprint://multimodal-ui-design-workflow' });
    const widgetMotionAuthoring = await client.readResource({ uri: 'blueprint://widget-motion-authoring' });
    const motionVerificationWorkflow = await client.readResource({ uri: 'blueprint://motion-verification-workflow' });
    const widgetPattern = await client.readResource({ uri: 'blueprint://widget-patterns/toolbar_header' });
    const result = await client.callTool({
      name: 'search_assets',
      arguments: {
        query: 'Player',
        class_filter: 'Blueprint',
        max_results: 5,
      },
    });
    const importJobs = await client.callTool({
      name: 'list_import_jobs',
      arguments: {
        include_completed: true,
      },
    });
    const extractMaterial = await client.callTool({
      name: 'extract_material',
      arguments: {
        asset_path: '/Game/Test/M_Test',
      },
    });
    const modifyMaterial = await client.callTool({
      name: 'modify_material',
      arguments: {
        asset_path: '/Game/Test/M_Test',
        operations: [
          {
            operation: 'add_expression',
            temp_id: 'roughness',
            expression_class: '/Script/Engine.MaterialExpressionScalarParameter',
          },
        ],
      },
    });
    const triggerLiveCoding = await client.callTool({
      name: 'trigger_live_coding',
      arguments: {
        changed_paths: ['Source/Test/MyActor.cpp'],
      },
    });
    const captureWidgetPreview = await client.callTool({
      name: 'capture_widget_preview',
      arguments: {
        asset_path: '/Game/Test/WBP_Window',
        width: 256,
        height: 256,
      },
    });
    const extractWidgetAnimation = await client.callTool({
      name: 'extract_widget_animation',
      arguments: {
        asset_path: '/Game/Test/WBP_Window',
        animation_name: 'OpenSequence',
      },
    });
    const captureWidgetMotion = await client.callTool({
      name: 'capture_widget_motion_checkpoints',
      arguments: {
        mode: 'editor_preview',
        asset_path: '/Game/Test/WBP_Window',
        animation_name: 'OpenSequence',
        checkpoints: [
          { name: 'open', time_ms: 260 },
        ],
        width: 256,
        height: 256,
      },
    });
    const motionBundle = JSON.parse(getTextContent(captureWidgetMotion));
    const compareMotionBundle = await client.callTool({
      name: 'compare_motion_capture_bundle',
      arguments: {
        capture_artifacts: motionBundle.verificationArtifacts,
        reference_frames: [
          { checkpoint_name: 'open', reference: motionCapturePath },
        ],
        tolerance: 0.05,
      },
    });
    const captureResource = await client.readResource({ uri: 'blueprint://captures/capture-123' });

    expect(resources.resources.some((resource) => resource.uri === 'blueprint://material-graph-guidance')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://font-roles')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://project-automation')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://verification-workflows')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://design-spec-schema')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://multimodal-ui-design-workflow')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://widget-motion-authoring')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://motion-verification-workflow')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'search_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'extract_widget_blueprint')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'extract_widget_animation')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'import_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_material')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'get_project_automation_context')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'compile_project_code')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'trigger_live_coding')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'restart_editor')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'sync_project_code')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'apply_window_ui_changes')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_blueprint_graphs')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'capture_widget_preview')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'capture_widget_motion_checkpoints')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'compare_motion_capture_bundle')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'run_automation_tests')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://examples/{family}')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://widget-patterns/{pattern}')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://captures/{capture_id}')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://test-runs/{run_id}/{artifact}')).toBe(true);
    expect(prompts.prompts.some((prompt) => prompt.name === 'normalize_ui_design_input')).toBe(true);
    expect(prompts.prompts.some((prompt) => prompt.name === 'design_menu_from_design_spec')).toBe(true);
    expect(prompts.prompts.some((prompt) => prompt.name === 'author_widget_motion_from_design_spec')).toBe(true);
    expect(prompts.prompts.some((prompt) => prompt.name === 'plan_widget_motion_verification')).toBe(true);
    expect(scopes.contents[0]?.text).toContain('Blueprint Extraction Scopes');
    expect(importCapabilities.contents[0]?.text).toContain('Blueprint Extractor Import Capabilities');
    expect(materialGuidance.contents[0]?.text).toContain('Blueprint Extractor Material Graph Guidance');
    expect(fontRoles.contents[0]?.text).toContain('Blueprint Extractor Font Roles');
    expect(projectAutomation.contents[0]?.text).toContain('Blueprint Extractor Project Automation');
    expect(verificationWorkflows.contents[0]?.text).toContain('Blueprint Extractor Verification Workflows');
    expect(verificationWorkflows.contents[0]?.text).toContain('design_spec_json');
    expect(designSpecSchema.contents[0]?.text).toContain('Blueprint Extractor Design Spec Schema');
    expect(multimodalWorkflow.contents[0]?.text).toContain('Blueprint Extractor Multimodal UI Design Workflow');
    expect(widgetMotionAuthoring.contents[0]?.text).toContain('Blueprint Extractor Widget Motion Authoring');
    expect(motionVerificationWorkflow.contents[0]?.text).toContain('Blueprint Extractor Motion Verification Workflow');
    expect(widgetPattern.contents[0]?.text).toContain('Pattern: toolbar_header');
    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: true,
      operation: 'search_assets',
      results: [
        {
          path: '/Game/Test/BP_Player',
          name: 'BP_Player',
          class: 'Blueprint',
        },
      ],
    });
    expect(JSON.parse(getTextContent(importJobs))).toMatchObject({
      includeCompleted: true,
      jobs: [
        {
          jobId: 'job-123',
          status: 'running',
        },
      ],
    });
    expect(getTextContent(extractMaterial)).not.toContain('\n');
    expect(JSON.parse(getTextContent(extractMaterial))).toMatchObject({
      operation: 'extract_material',
      material: {
        assetPath: '/Game/Test/M_Test',
      },
    });
    expect(JSON.parse(getTextContent(modifyMaterial))).toMatchObject({
      operation: 'modify_material',
      tempIdMap: {
        roughness: 'expr-guid-2',
      },
    });
    const triggerLiveCodingResult = parseToolResult(triggerLiveCoding);
    expect(triggerLiveCodingResult).toMatchObject({
      operation: 'trigger_live_coding',
      status: process.platform === 'win32' ? 'success' : 'unsupported',
    });
    expect(JSON.parse(getTextContent(captureWidgetPreview))).toMatchObject({
      captureId: 'capture-123',
      resourceUri: 'blueprint://captures/capture-123',
      surface: 'editor_offscreen',
      scenarioId: 'widget_preview:/Game/Test/WBP_Window',
      assetPaths: ['/Game/Test/WBP_Window'],
    });
    expect(JSON.parse(getTextContent(extractWidgetAnimation))).toMatchObject({
      operation: 'extract_widget_animation',
      animationName: 'OpenSequence',
      animation: {
        durationMs: 260,
      },
    });
    expect(motionBundle).toMatchObject({
      operation: 'capture_widget_motion_checkpoints',
      motionCaptureId: 'motion-123',
      checkpointCount: 1,
      verificationArtifacts: [
        {
          captureId: 'motion-open-1',
          surface: 'widget_motion_checkpoint',
          checkpointName: 'open',
          resourceUri: 'blueprint://captures/motion-open-1',
        },
      ],
    });
    expect(JSON.parse(getTextContent(compareMotionBundle))).toMatchObject({
      operation: 'compare_motion_capture_bundle',
      mode: 'reference_frames',
      matchedCount: 1,
      pass: true,
      comparisons: [
        {
          checkpointName: 'open',
          matched: true,
        },
      ],
    });
    expect(captureWidgetPreview.content?.some((entry) => entry.type === 'resource_link')).toBe(true);
    expect(captureWidgetMotion.content?.some((entry) => entry.type === 'resource_link')).toBe(true);
    expect(captureResource.contents[0]?.mimeType).toBe('image/png');
    expect(captureResource.contents[0]?.blob).toBe(Buffer.from('capture-image').toString('base64'));
    expect(remoteServer.requests.length).toBeGreaterThanOrEqual(process.platform === 'win32' ? 11 : 10);
    expect(remoteServer.requests.every((request) => request.objectPath === '/Script/Test.OverrideSubsystem')).toBe(true);
    const getRequest = (functionName: string) => remoteServer.requests.find((request) => request.functionName === functionName);

    expect(getRequest('SearchAssets')).toMatchObject({
      objectPath: '/Script/Test.OverrideSubsystem',
      functionName: 'SearchAssets',
      parameters: {
        Query: 'Player',
        ClassFilter: 'Blueprint',
        MaxResults: 5,
      },
    });
    expect(getRequest('ListImportJobs')).toMatchObject({
      objectPath: '/Script/Test.OverrideSubsystem',
      functionName: 'ListImportJobs',
      parameters: {
        bIncludeCompleted: true,
      },
    });
    expect(getRequest('ExtractMaterial')).toMatchObject({
      objectPath: '/Script/Test.OverrideSubsystem',
      functionName: 'ExtractMaterial',
      parameters: {
        AssetPath: '/Game/Test/M_Test',
        bVerbose: false,
      },
    });
    expect(getRequest('ModifyMaterial')).toMatchObject({
      objectPath: '/Script/Test.OverrideSubsystem',
      functionName: 'ModifyMaterial',
      parameters: {
        AssetPath: '/Game/Test/M_Test',
        bValidateOnly: false,
      },
    });
    expect(JSON.parse(String(getRequest('ModifyMaterial')?.parameters?.PayloadJson))).toMatchObject({
      operations: [
        {
          operation: 'add_expression',
          temp_id: 'roughness',
          expression_class: '/Script/Engine.MaterialExpressionScalarParameter',
        },
      ],
    });
    if (process.platform === 'win32') {
      expect(getRequest('TriggerLiveCoding')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'TriggerLiveCoding',
        parameters: {
          bEnableForSession: true,
          bWaitForCompletion: true,
        },
      });
      expect(getRequest('CaptureWidgetPreview')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'CaptureWidgetPreview',
        parameters: {
          AssetPath: '/Game/Test/WBP_Window',
          Width: 256,
          Height: 256,
        },
      });
      expect(getRequest('ExtractWidgetAnimation')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'ExtractWidgetAnimation',
        parameters: {
          AssetPath: '/Game/Test/WBP_Window',
          AnimationName: 'OpenSequence',
        },
      });
      expect(getRequest('CaptureWidgetMotionCheckpoints')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'CaptureWidgetMotionCheckpoints',
        parameters: {
          AssetPath: '/Game/Test/WBP_Window',
        },
      });
      expect(getRequest('CompareCaptureToReference')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'CompareCaptureToReference',
        parameters: {
          Tolerance: 0.05,
        },
      });
      expect(getRequest('ListCaptures')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'ListCaptures',
        parameters: {
          AssetPathFilter: '',
        },
      });
    } else {
      expect(getRequest('CaptureWidgetPreview')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'CaptureWidgetPreview',
        parameters: {
          AssetPath: '/Game/Test/WBP_Window',
          Width: 256,
          Height: 256,
        },
      });
      expect(getRequest('ExtractWidgetAnimation')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'ExtractWidgetAnimation',
        parameters: {
          AssetPath: '/Game/Test/WBP_Window',
          AnimationName: 'OpenSequence',
        },
      });
      expect(getRequest('CaptureWidgetMotionCheckpoints')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'CaptureWidgetMotionCheckpoints',
        parameters: {
          AssetPath: '/Game/Test/WBP_Window',
        },
      });
      expect(getRequest('CompareCaptureToReference')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'CompareCaptureToReference',
        parameters: {
          Tolerance: 0.05,
        },
      });
      expect(getRequest('ListCaptures')).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'ListCaptures',
        parameters: {
          AssetPathFilter: '',
        },
      });
    }
  });
});
