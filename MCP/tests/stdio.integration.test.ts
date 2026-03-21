import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getTextContent, startMockRemoteControlServer } from './test-helpers.js';

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
    await writeFile(capturePath, Buffer.from('capture-image'));

    const remoteServer = await startMockRemoteControlServer({
      onCall: (request) => {
        if (request.functionName === 'SearchAssets') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                results: [
                  {
                    path: '/Game/Test/BP_Player',
                    name: 'BP_Player',
                    class: 'Blueprint',
                  },
                ],
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
    const scopes = await client.readResource({ uri: 'blueprint://scopes' });
    const importCapabilities = await client.readResource({ uri: 'blueprint://import-capabilities' });
    const materialGuidance = await client.readResource({ uri: 'blueprint://material-graph-guidance' });
    const fontRoles = await client.readResource({ uri: 'blueprint://font-roles' });
    const projectAutomation = await client.readResource({ uri: 'blueprint://project-automation' });
    const verificationWorkflows = await client.readResource({ uri: 'blueprint://verification-workflows' });
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
    const captureResource = await client.readResource({ uri: 'blueprint://captures/capture-123' });

    expect(resources.resources.some((resource) => resource.uri === 'blueprint://material-graph-guidance')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://font-roles')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://project-automation')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://verification-workflows')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'search_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'extract_widget_blueprint')).toBe(true);
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
    expect(tools.tools.some((tool) => tool.name === 'run_automation_tests')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://examples/{family}')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://widget-patterns/{pattern}')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://captures/{capture_id}')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://test-runs/{run_id}/{artifact}')).toBe(true);
    expect(scopes.contents[0]?.text).toContain('Blueprint Extraction Scopes');
    expect(importCapabilities.contents[0]?.text).toContain('Blueprint Extractor Import Capabilities');
    expect(materialGuidance.contents[0]?.text).toContain('Blueprint Extractor Material Graph Guidance');
    expect(fontRoles.contents[0]?.text).toContain('Blueprint Extractor Font Roles');
    expect(projectAutomation.contents[0]?.text).toContain('Blueprint Extractor Project Automation');
    expect(verificationWorkflows.contents[0]?.text).toContain('Blueprint Extractor Verification Workflows');
    expect(widgetPattern.contents[0]?.text).toContain('Pattern: toolbar_header');
    expect(JSON.parse(getTextContent(result))).toMatchObject({
      success: true,
      operation: 'search_assets',
      data: [
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
    const triggerLiveCodingResult = JSON.parse(getTextContent(triggerLiveCoding));
    expect(triggerLiveCodingResult).toMatchObject({
      operation: 'trigger_live_coding',
      status: process.platform === 'win32' ? 'success' : 'unsupported',
    });
    expect(JSON.parse(getTextContent(captureWidgetPreview))).toMatchObject({
      captureId: 'capture-123',
      resourceUri: 'blueprint://captures/capture-123',
    });
    expect(captureWidgetPreview.content?.some((entry) => entry.type === 'resource_link')).toBe(true);
    expect(captureResource.contents[0]?.mimeType).toBe('image/png');
    expect(captureResource.contents[0]?.blob).toBe(Buffer.from('capture-image').toString('base64'));
    expect(remoteServer.requests).toHaveLength(process.platform === 'win32' ? 7 : 6);
    expect(remoteServer.requests[0]?.objectPath).toBe('/Script/Test.OverrideSubsystem');
    expect(remoteServer.requests[1]).toMatchObject({
      objectPath: '/Script/Test.OverrideSubsystem',
      functionName: 'ListImportJobs',
      parameters: {
        bIncludeCompleted: true,
      },
    });
    expect(remoteServer.requests[2]).toMatchObject({
      objectPath: '/Script/Test.OverrideSubsystem',
      functionName: 'ExtractMaterial',
      parameters: {
        AssetPath: '/Game/Test/M_Test',
        bVerbose: false,
      },
    });
    expect(remoteServer.requests[3]).toMatchObject({
      objectPath: '/Script/Test.OverrideSubsystem',
      functionName: 'ModifyMaterial',
      parameters: {
        AssetPath: '/Game/Test/M_Test',
        PayloadJson: JSON.stringify({
          operations: [
            {
              operation: 'add_expression',
              temp_id: 'roughness',
              expression_class: '/Script/Engine.MaterialExpressionScalarParameter',
            },
          ],
        }),
        bValidateOnly: false,
      },
    });
    if (process.platform === 'win32') {
      expect(remoteServer.requests[4]).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'TriggerLiveCoding',
        parameters: {
          bEnableForSession: true,
          bWaitForCompletion: true,
        },
      });
      expect(remoteServer.requests[5]).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'CaptureWidgetPreview',
        parameters: {
          AssetPath: '/Game/Test/WBP_Window',
          Width: 256,
          Height: 256,
        },
      });
      expect(remoteServer.requests[6]).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'ListCaptures',
        parameters: {
          AssetPathFilter: '',
        },
      });
    } else {
      expect(remoteServer.requests[4]).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'CaptureWidgetPreview',
        parameters: {
          AssetPath: '/Game/Test/WBP_Window',
          Width: 256,
          Height: 256,
        },
      });
      expect(remoteServer.requests[5]).toMatchObject({
        objectPath: '/Script/Test.OverrideSubsystem',
        functionName: 'ListCaptures',
        parameters: {
          AssetPathFilter: '',
        },
      });
    }
  });
});
