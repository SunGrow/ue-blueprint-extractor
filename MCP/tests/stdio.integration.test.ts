import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
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

    expect(resources.resources.some((resource) => resource.uri === 'blueprint://material-graph-guidance')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://font-roles')).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === 'blueprint://project-automation')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'search_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'extract_widget_blueprint')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'import_assets')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'modify_material')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'compile_project_code')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'trigger_live_coding')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'restart_editor')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'sync_project_code')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'apply_window_ui_changes')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://examples/{family}')).toBe(true);
    expect(resourceTemplates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://widget-patterns/{pattern}')).toBe(true);
    expect(scopes.contents[0]?.text).toContain('Blueprint Extraction Scopes');
    expect(importCapabilities.contents[0]?.text).toContain('Blueprint Extractor Import Capabilities');
    expect(materialGuidance.contents[0]?.text).toContain('Blueprint Extractor Material Graph Guidance');
    expect(fontRoles.contents[0]?.text).toContain('Blueprint Extractor Font Roles');
    expect(projectAutomation.contents[0]?.text).toContain('Blueprint Extractor Project Automation');
    expect(widgetPattern.contents[0]?.text).toContain('Pattern: toolbar_header');
    expect(JSON.parse(getTextContent(result))).toEqual([
      {
        path: '/Game/Test/BP_Player',
        name: 'BP_Player',
        class: 'Blueprint',
      },
    ]);
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
    expect(remoteServer.requests).toHaveLength(process.platform === 'win32' ? 5 : 4);
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
          ChangedPathsJson: JSON.stringify(['Source/Test/MyActor.cpp']),
          bWaitForCompletion: true,
        },
      });
    }
  });
});
