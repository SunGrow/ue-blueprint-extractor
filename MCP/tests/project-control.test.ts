import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerProjectControlTools } from '../src/tools/project-control.js';
import { createToolResultNormalizers } from '../src/helpers/tool-results.js';
import { extractToolPayload } from '../src/helpers/formatting.js';
import { classifyRecoverableToolFailure, taskAwareTools } from '../src/server-config.js';
import { getEditorContext } from '../src/tools/project-control.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const buildPlatformSchema = z.enum(['Win64', 'Mac', 'Linux']);
const buildConfigurationSchema = z.enum(['Debug', 'DebugGame', 'Development', 'Shipping', 'Test']);

function createResolvedProjectInputs(overrides: Record<string, unknown> = {}) {
  return {
    engineRoot: 'C:/UE',
    projectPath: 'C:/Proj/Proj.uproject',
    target: 'ProjEditor',
    context: null,
    contextError: undefined,
    sources: {
      engineRoot: 'explicit',
      projectPath: 'environment',
      target: 'editor_context',
    },
    ...overrides,
  };
}

function createProjectController(overrides: Record<string, unknown> = {}) {
  return {
    liveCodingSupported: true,
    classifyChangedPaths: vi.fn(() => ({
      strategy: 'live_coding',
      restartRequired: false,
      reasons: [],
    })),
    compileProjectCode: vi.fn(async () => ({
      success: true,
      operation: 'compile_project_code',
      strategy: 'external_build',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      projectDir: 'C:/Proj',
      target: 'ProjEditor',
      platform: 'Win64',
      configuration: 'Development',
      command: {
        executable: 'Build.bat',
        args: [],
      },
      durationMs: 123,
      exitCode: 0,
      restartRequired: true,
      restartReasons: ['external_build_completed'],
      outputIncluded: false,
    })),
    launchEditor: vi.fn(async () => ({
      success: true,
      operation: 'launch_editor',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      projectDir: 'C:/Proj',
      command: {
        executable: 'UnrealEditor.exe',
        args: [],
      },
      detached: true,
      diagnostics: [],
    })),
    killEditorProcess: vi.fn(async () => ({ killed: true })),
    waitForEditorRestart: vi.fn(async () => ({
      success: true,
      operation: 'restart_editor',
      disconnected: true,
      reconnected: true,
      disconnectTimeoutMs: 60_000,
      reconnectTimeoutMs: 180_000,
      diagnostics: [],
    })),
    ...overrides,
  };
}

function createActiveEditorSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: 'editor-1',
    projectName: 'Proj',
    projectFilePath: 'C:/Proj/Proj.uproject',
    projectDir: 'C:/Proj',
    engineRoot: 'C:/UE',
    engineVersion: '5.7.0',
    editorTarget: 'ProjEditor',
    processId: 4242,
    remoteControlHost: '127.0.0.1',
    remoteControlPort: 30010,
    lastSeenAt: '2026-03-30T00:00:00.000Z',
    ...overrides,
  };
}

function createActiveEditorSession(overrides: Record<string, unknown> = {}) {
  const activeEditor = createActiveEditorSnapshot();
  return {
    listRunningEditors: vi.fn(async () => [activeEditor]),
    getWorkspaceProjectPath: vi.fn(async () => 'C:\\Proj\\Proj.uproject'),
    getActiveEditorState: vi.fn(async () => ({
      active: true,
      selectionSource: 'manual',
      workspaceProjectPath: 'C:\\Proj\\Proj.uproject',
      autoBindAllowed: false,
      healthy: true,
      activeEditor,
    })),
    selectEditor: vi.fn(async () => activeEditor),
    clearSelection: vi.fn(() => ({
      active: false,
      selectionSource: 'none',
      workspaceProjectPath: undefined,
      autoBindAllowed: false,
      healthy: false,
      activeEditor,
      message: 'The session is now unbound.',
    })),
    bindLaunchedEditor: vi.fn(async () => activeEditor),
    refreshActiveEditorAfterReconnect: vi.fn(async () => activeEditor),
    getBoundSnapshot: vi.fn(() => activeEditor),
    getEditorContext: vi.fn(async () => ({
      success: true,
      operation: 'get_editor_context',
      instanceId: activeEditor.instanceId,
      projectName: activeEditor.projectName,
      projectFilePath: activeEditor.projectFilePath,
      projectDir: activeEditor.projectDir,
      engineRoot: activeEditor.engineRoot,
      editorTarget: activeEditor.editorTarget,
      remoteControlHost: activeEditor.remoteControlHost,
      remoteControlPort: activeEditor.remoteControlPort,
      selectedAssetPaths: ['/Game/Blueprints/BP_PlayerCharacter'],
      selectedActorNames: ['BP_PlayerCharacter_C_0'],
      openAssetEditors: ['/Game/UI/WBP_MainMenu'],
      activeLevel: '/Game/Maps/MainLevel',
      pieSummary: {
        isPlayingInEditor: false,
        isSimulatingInEditor: false,
      },
    })),
    ...overrides,
  };
}

describe('registerProjectControlTools', () => {
  it('lists running editors with workspace and active flags', async () => {
    const registry = createToolRegistry();
    const activeEditorSession = createActiveEditorSession({
      listRunningEditors: vi.fn(async () => [
        createActiveEditorSnapshot(),
        createActiveEditorSnapshot({
          instanceId: 'editor-2',
          projectName: 'OtherProj',
          projectFilePath: 'C:/Other/Other.uproject',
          projectDir: 'C:/Other',
          editorTarget: 'OtherEditor',
          remoteControlPort: 30011,
        }),
      ]),
    });

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      activeEditorSession: activeEditorSession as any,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('list_running_editors').handler({});

    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'list_running_editors',
      workspaceProjectPath: 'C:\\Proj\\Proj.uproject',
      activeEditorInstanceId: 'editor-1',
      editorCount: 2,
      editors: [
        {
          instanceId: 'editor-1',
          matchesWorkspace: true,
          isActive: true,
        },
        {
          instanceId: 'editor-2',
          matchesWorkspace: false,
          isActive: false,
        },
      ],
    });
  });

  it('selects and clears the active editor for the session', async () => {
    const registry = createToolRegistry();
    const clearProjectAutomationContext = vi.fn();
    const activeEditorSession = createActiveEditorSession();

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext,
      activeEditorSession: activeEditorSession as any,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const selectResult = await registry.getTool('select_editor').handler({
      instance_id: 'editor-1',
    });
    const clearResult = await registry.getTool('clear_editor_selection').handler({});

    expect(activeEditorSession.selectEditor).toHaveBeenCalledWith({
      instanceId: 'editor-1',
      processId: undefined,
    });
    expect(activeEditorSession.clearSelection).toHaveBeenCalledTimes(1);
    expect(clearProjectAutomationContext).toHaveBeenCalledTimes(2);
    expect(parseDirectToolResult(selectResult)).toMatchObject({
      success: true,
      operation: 'select_editor',
      selectionSource: 'manual',
      activeEditor: {
        instanceId: 'editor-1',
      },
    });
    expect(parseDirectToolResult(clearResult)).toMatchObject({
      success: true,
      operation: 'clear_editor_selection',
      active: false,
      selectionSource: 'none',
    });
  });

  it('reports the active editor state and blocks wait_for_editor when unbound', async () => {
    const registry = createToolRegistry();
    const activeEditorSession = createActiveEditorSession({
      getActiveEditorState: vi.fn(async () => ({
        active: false,
        selectionSource: 'none',
        workspaceProjectPath: 'C:/Proj/Proj.uproject',
        autoBindAllowed: true,
        healthy: false,
        message: 'No active editor is selected for this MCP session.',
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: {
        checkConnection: vi.fn(async () => true),
      },
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      activeEditorSession: activeEditorSession as any,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const activeResult = await registry.getTool('get_active_editor').handler({});
    const waitResult = await registry.getTool('wait_for_editor').handler({
      timeout_seconds: 1,
    });

    expect(parseDirectToolResult(activeResult)).toMatchObject({
      success: true,
      operation: 'get_active_editor',
      active: false,
      selectionSource: 'none',
    });
    expect(parseDirectToolResult(waitResult)).toMatchObject({
      success: false,
      operation: 'wait_for_editor',
      code: 'no_active_editor',
      recoverable: true,
    });
  });

  it('binds the launched editor into the session', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const activeEditorSession = createActiveEditorSession({
      listRunningEditors: vi.fn(async () => []),
    });

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController({
        launchEditor: vi.fn(async () => ({
          success: true,
          operation: 'launch_editor',
          engineRoot: 'C:/UE',
          projectPath: 'C:/Proj/Proj.uproject',
          projectDir: 'C:/Proj',
          processId: 4242,
          command: {
            executable: 'UnrealEditor.exe',
            args: [],
          },
          detached: true,
          diagnostics: [],
        })),
      }),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      activeEditorSession: activeEditorSession as any,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('launch_editor').handler({
      reconnect_timeout_seconds: 30,
    });

    expect(activeEditorSession.bindLaunchedEditor).toHaveBeenCalledWith({
      processId: 4242,
      projectPath: 'C:/Proj/Proj.uproject',
      engineRoot: 'C:/UE',
      target: 'ProjEditor',
      timeoutMs: 30_000,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'launch_editor',
      activeEditor: {
        instanceId: 'editor-1',
      },
    });
  });

  it('reuses an existing matching editor instead of launching a second one', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const activeEditorSession = createActiveEditorSession();
    const projectController = createProjectController();

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController,
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      activeEditorSession: activeEditorSession as any,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('launch_editor').handler({
      reconnect_timeout_seconds: 30,
    });

    expect(activeEditorSession.listRunningEditors).toHaveBeenCalledTimes(1);
    expect(activeEditorSession.selectEditor).toHaveBeenCalledWith({ instanceId: 'editor-1' });
    expect(projectController.launchEditor).not.toHaveBeenCalled();
    expect(activeEditorSession.bindLaunchedEditor).not.toHaveBeenCalled();
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'launch_editor',
      launched: false,
      reusedExistingEditor: true,
      activeEditor: {
        instanceId: 'editor-1',
      },
    });
  });

  it('rejects compile_project_code when explicit inputs conflict with the bound editor', async () => {
    const registry = createToolRegistry();
    const projectController = createProjectController();
    const activeEditorSession = createActiveEditorSession({
      getBoundSnapshot: vi.fn(() => createActiveEditorSnapshot({
        instanceId: 'editor-other',
        projectName: 'OtherProj',
        projectFilePath: 'C:/Other/Other.uproject',
        projectDir: 'C:/Other',
        engineRoot: 'C:/OtherUE',
        editorTarget: 'OtherEditor',
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController,
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(async () => createResolvedProjectInputs()),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      activeEditorSession: activeEditorSession as any,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('compile_project_code').handler({
      engine_root: 'C:/UE',
      project_path: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(projectController.compileProjectCode).not.toHaveBeenCalled();
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'Active editor mismatch',
    );
  });

  it('starts PIE through the subsystem wrapper', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'start_pie',
      scheduled: true,
      simulate: true,
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('start_pie').handler({
      simulate: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('StartPIE', {
      bSimulateInEditor: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'start_pie',
      scheduled: true,
      simulate: true,
    });
  });

  it('stops PIE through the subsystem wrapper', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'stop_pie',
      scheduled: true,
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('stop_pie').handler({});

    expect(callSubsystemJson).toHaveBeenCalledWith('StopPIE', {});
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'stop_pie',
      scheduled: true,
    });
  });

  it('relaunches PIE through the subsystem wrapper', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'relaunch_pie',
      scheduled: true,
      simulate: false,
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('relaunch_pie').handler({
      simulate: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('RelaunchPIE', {
      bSimulateInEditor: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'relaunch_pie',
      scheduled: true,
      simulate: false,
    });
  });

  it('compiles project code with resolved inputs and records the external build context', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController();
    const rememberExternalBuild = vi.fn();

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController,
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild,
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('compile_project_code').handler({
      build_timeout_seconds: 30,
      include_output: true,
      clear_uht_cache: true,
    });

    expect(resolveProjectInputs).toHaveBeenCalledWith({
      engine_root: undefined,
      project_path: undefined,
      target: undefined,
    });
    expect(projectController.compileProjectCode).toHaveBeenCalledWith({
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      platform: undefined,
      configuration: undefined,
      buildTimeoutMs: 30_000,
      includeOutput: true,
      clearUhtCache: true,
    });
    expect(rememberExternalBuild).toHaveBeenCalledTimes(1);
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'compile_project_code',
      inputResolution: {
        engineRoot: 'explicit',
        projectPath: 'environment',
        target: 'editor_context',
      },
    });
  });

  it('returns a structured result when wait_for_editor has no connection probe available', async () => {
    const registry = createToolRegistry();

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('wait_for_editor').handler({
      timeout_seconds: 1,
    });

    expect(parseDirectToolResult(result)).toEqual({
      success: false,
      operation: 'wait_for_editor',
      connected: false,
      elapsedMs: 0,
      timeoutMs: 1_000,
      attempts: 0,
      code: 'connection_probe_unavailable',
      recoverable: false,
      message: 'wait_for_editor requires a client implementation with checkConnection().',
      next_steps: [
        'Use a UE client implementation that exposes checkConnection() before calling wait_for_editor.',
      ],
    });
  });

  it('enriches live-coding results with fallback context and header-change warnings', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: false,
      status: 'unavailable',
      warnings: ['base warning'],
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => ({
        operation: 'compile_project_code',
        exitCode: 0,
      })),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('trigger_live_coding').handler({
      changed_paths: ['Source/Test/MyActor.h'],
      wait_for_completion: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('TriggerLiveCoding', {
      bEnableForSession: true,
      bWaitForCompletion: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: false,
      status: 'unavailable',
      fallbackRecommended: true,
      reason: 'live_coding_unavailable',
      lastExternalBuild: {
        operation: 'compile_project_code',
        exitCode: 0,
      },
      changedPathsAccepted: ['Source/Test/MyActor.h'],
      headerChangesDetected: ['Source/Test/MyActor.h'],
      warnings: expect.arrayContaining([
        'base warning',
        expect.stringContaining('Live Coding cannot add, remove, or reorder UPROPERTYs'),
      ]),
    });
  });

  it('restarts the editor and reports reconnect state through the project controller', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'RestartEditor',
    }));
    const clearProjectAutomationContext = vi.fn();
    const projectController = createProjectController();

    registerProjectControlTools({
      server: registry.server,
      client: {
        checkConnection: vi.fn(async () => true),
      },
      projectController,
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('restart_editor').handler({
      save_dirty_assets: false,
      wait_for_reconnect: true,
      disconnect_timeout_seconds: 2,
      reconnect_timeout_seconds: 3,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('RestartEditor', {
      bWarn: false,
      bSaveDirtyAssets: false,
      bRelaunch: true,
    });
    expect(projectController.waitForEditorRestart).toHaveBeenCalledTimes(1);
    expect(clearProjectAutomationContext).toHaveBeenCalledTimes(1);
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      saveDirtyAssetsAccepted: false,
      saveDirtyAssetsAppliedByEditor: false,
      reconnect: {
        success: true,
        disconnected: true,
        reconnected: true,
      },
    });
  });

  it('runs the build-and-restart sync path with save, restart, and reconnect steps', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
    });
    const callSubsystemJson = vi.fn(async (method) => {
      if (method === 'SaveAssets') {
        return { success: true, saved: true };
      }
      if (method === 'RestartEditor') {
        return { success: true, operation: 'RestartEditor' };
      }
      throw new Error(`Unexpected method ${method}`);
    });
    const rememberExternalBuild = vi.fn();
    const clearProjectAutomationContext = vi.fn();

    registerProjectControlTools({
      server: registry.server,
      client: {
        checkConnection: vi.fn(async () => true),
      },
      projectController,
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild,
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['Source/Test/MyActor.h'],
      save_asset_paths: ['/Game/UI/WBP_Window'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 2,
      reconnect_timeout_seconds: 3,
    });

    const expectedNormalized = path.resolve('C:/Proj', 'Source/Test/MyActor.h');
    expect(projectController.classifyChangedPaths).toHaveBeenCalledWith([expectedNormalized], undefined);
    expect(projectController.compileProjectCode).toHaveBeenCalledWith({
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      platform: undefined,
      configuration: undefined,
      buildTimeoutMs: undefined,
      includeOutput: undefined,
      clearUhtCache: undefined,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'SaveAssets', {
      AssetPathsJson: JSON.stringify(['/Game/UI/WBP_Window']),
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'RestartEditor', {
      bWarn: false,
      bSaveDirtyAssets: true,
      bRelaunch: true,
    });
    expect(rememberExternalBuild).toHaveBeenCalledTimes(1);
    expect(clearProjectAutomationContext).toHaveBeenCalledTimes(1);
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'sync_project_code',
      strategy: 'build_and_restart',
      plan: {
        strategy: 'build_and_restart',
        reasons: ['header_or_uht_sensitive_change'],
      },
      save: {
        success: true,
        saved: true,
      },
      reconnect: {
        success: true,
        disconnected: true,
        reconnected: true,
      },
    });
  });

  it('wraps compile_project_code failures with project-resolution diagnostics', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs({
      contextError: 'editor missing',
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController({
        compileProjectCode: vi.fn(async () => {
          throw new Error('toolchain missing');
        }),
      }),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('compile_project_code').handler({});

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(resolveProjectInputs).toHaveBeenCalledTimes(2);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'toolchain missing; attempted explicit args -> project association -> editor context -> environment',
    );
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'editor_context_error=editor missing',
    );
  });

  it('compile_project_code error has non-empty content[0].text', async () => {
    const registry = createToolRegistry();
    const engineRootError = new Error('requires engine_root or UE_ENGINE_ROOT');
    const resolveProjectInputs = vi.fn()
      .mockRejectedValueOnce(engineRootError)
      .mockResolvedValueOnce(createResolvedProjectInputs());

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('compile_project_code').handler({});
    const typed = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };

    expect(typed.isError).toBe(true);
    expect(typed.content).toBeDefined();
    expect(Array.isArray(typed.content)).toBe(true);
    expect(typed.content!.length).toBeGreaterThanOrEqual(1);
    expect(typed.content![0].type).toBe('text');
    expect(typeof typed.content![0].text).toBe('string');
    expect(typed.content![0].text!.length).toBeGreaterThan(0);
    expect(typed.content![0].text).toContain('requires engine_root or UE_ENGINE_ROOT');
  });

  it('compile_project_code missing engine_root produces engine_root_missing code', async () => {
    const registry = createToolRegistry();
    const engineRootError = new Error('requires engine_root or UE_ENGINE_ROOT');
    const resolveProjectInputs = vi.fn()
      .mockRejectedValueOnce(engineRootError)
      .mockResolvedValueOnce(createResolvedProjectInputs());

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const rawResult = await registry.getTool('compile_project_code').handler({});

    const { normalizeToolError } = createToolResultNormalizers({
      taskAwareTools,
      classifyRecoverableToolFailure,
    });

    const normalized = normalizeToolError(
      'compile_project_code',
      extractToolPayload(rawResult),
      rawResult as Record<string, unknown>,
    ) as { isError?: boolean; structuredContent?: Record<string, unknown> };

    expect(normalized.isError).toBe(true);
    expect(normalized.structuredContent).toBeDefined();
    expect(normalized.structuredContent!.code).toBe('engine_root_missing');
    expect(normalized.structuredContent!.recoverable).toBe(false);
  });

  it('sync_project_code missing engine_root produces engine_root_missing code', async () => {
    const registry = createToolRegistry();
    const engineRootError = new Error('requires engine_root or UE_ENGINE_ROOT');
    const resolveProjectInputs = vi.fn()
      .mockRejectedValueOnce(engineRootError)
      .mockResolvedValueOnce(createResolvedProjectInputs());

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const rawResult = await registry.getTool('sync_project_code').handler({
      changed_paths: ['Source/Test/MyActor.cpp'],
    });

    const { normalizeToolError } = createToolResultNormalizers({
      taskAwareTools,
      classifyRecoverableToolFailure,
    });

    const normalized = normalizeToolError(
      'sync_project_code',
      extractToolPayload(rawResult),
      rawResult as Record<string, unknown>,
    ) as { isError?: boolean; structuredContent?: Record<string, unknown> };

    expect(normalized.isError).toBe(true);
    expect(normalized.structuredContent).toBeDefined();
    expect(normalized.structuredContent!.code).toBe('engine_root_missing');
    expect(normalized.structuredContent!.recoverable).toBe(false);
  });

  it('sync_project_code normalizes relative paths to absolute using project root', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async () => ({ success: true })),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['Source/MyActor.h', 'Source/Private/Helper.cpp'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;

    // Paths should be normalized to absolute
    const changedPaths = parsed.changedPaths as string[];
    expect(changedPaths).toHaveLength(2);
    expect(path.isAbsolute(changedPaths[0])).toBe(true);
    expect(path.isAbsolute(changedPaths[1])).toBe(true);
    expect(changedPaths[0]).toBe(path.resolve('C:/Proj', 'Source/MyActor.h'));
    expect(changedPaths[1]).toBe(path.resolve('C:/Proj', 'Source/Private/Helper.cpp'));

    // Should include pathWarnings about normalization
    const warnings = parsed.pathWarnings as string[];
    expect(warnings).toBeDefined();
    expect(warnings.length).toBe(2);
    expect(warnings[0]).toContain('Source/MyActor.h');
    expect(warnings[1]).toContain('Source/Private/Helper.cpp');
  });

  it('sync_project_code passes already-absolute paths through unchanged', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async () => ({ success: true })),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const absolutePath = 'C:/Proj/Source/MyActor.h';
    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: [absolutePath],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const changedPaths = parsed.changedPaths as string[];
    expect(changedPaths).toEqual([absolutePath]);

    // No pathWarnings when all paths are already absolute
    expect(parsed.pathWarnings).toBeUndefined();
  });

  it('sync_project_code reports structured stepErrors when build step throws', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
      compileProjectCode: vi.fn(async () => {
        throw new Error('toolchain not found');
      }),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async () => ({ success: true })),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.h'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.stepErrors).toBeDefined();

    const stepErrors = parsed.stepErrors as Record<string, string>;
    expect(stepErrors.build).toBe('toolchain not found');
  });

  it('sync_project_code reports structured stepErrors when restart step throws', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async (method) => {
        if (method === 'SaveAssets') return { success: true };
        if (method === 'RestartEditor') throw new Error('editor crashed during restart');
        throw new Error(`Unexpected method ${method}`);
      }),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.h'],
      save_asset_paths: ['/Game/UI/WBP_Window'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.stepErrors).toBeDefined();

    const stepErrors = parsed.stepErrors as Record<string, string>;
    expect(stepErrors.restart).toBe('editor crashed during restart');
    // Build should have succeeded — no build error
    expect(stepErrors.build).toBeUndefined();
  });

  it('restart_editor succeeds with a connected editor', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'RestartEditor',
    }));

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(async () => ({ isPlayingInEditor: false })),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('restart_editor').handler({
      save_dirty_assets: true,
      wait_for_reconnect: true,
      disconnect_timeout_seconds: 2,
      reconnect_timeout_seconds: 3,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect(parsed.saveDirtyAssetsAccepted).toBe(true);
    expect(callSubsystemJson).toHaveBeenCalledWith('RestartEditor', {
      bWarn: false,
      bSaveDirtyAssets: true,
      bRelaunch: true,
    });
  });

  it('restart_editor reports reconnection timeout diagnostics', async () => {
    const registry = createToolRegistry();
    const projectController = createProjectController({
      waitForEditorRestart: vi.fn(async () => ({
        success: false,
        operation: 'restart_editor',
        disconnected: true,
        reconnected: false,
        disconnectTimeoutMs: 2000,
        reconnectTimeoutMs: 3000,
        diagnostics: ['Editor did not reconnect before the timeout elapsed'],
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async () => ({ success: true, operation: 'RestartEditor' })),
      getProjectAutomationContext: vi.fn(async () => ({ isPlayingInEditor: false })),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('restart_editor').handler({
      save_dirty_assets: false,
      wait_for_reconnect: true,
      disconnect_timeout_seconds: 2,
      reconnect_timeout_seconds: 3,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(false);
    const reconnect = parsed.reconnect as Record<string, unknown>;
    expect(reconnect.disconnected).toBe(true);
    expect(reconnect.reconnected).toBe(false);
    expect(reconnect.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining('did not reconnect'),
      ]),
    );
  });

  it('restart_editor recovers from failed graceful reconnect by killing and relaunching the bound editor', async () => {
    const registry = createToolRegistry();
    const activeEditorSession = createActiveEditorSession();
    const waitForEditorRestart = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        operation: 'restart_editor',
        disconnected: true,
        reconnected: false,
        disconnectTimeoutMs: 2000,
        reconnectTimeoutMs: 3000,
        diagnostics: ['Editor did not reconnect before the timeout elapsed'],
      })
      .mockResolvedValueOnce({
        success: true,
        operation: 'restart_editor',
        disconnected: false,
        reconnected: true,
        disconnectTimeoutMs: 60000,
        reconnectTimeoutMs: 3000,
        diagnostics: [],
      });
    const killEditorProcess = vi.fn(async () => ({ killed: true }));
    const launchEditor = vi.fn(async () => ({
      success: true,
      operation: 'launch_editor',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      projectDir: 'C:/Proj',
      processId: 5050,
      command: {
        executable: 'UnrealEditor.exe',
        args: [],
      },
      detached: true,
      diagnostics: [],
    }));
    const projectController = createProjectController({
      waitForEditorRestart,
      killEditorProcess,
      launchEditor,
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async () => ({ success: true, operation: 'RestartEditor' })),
      getProjectAutomationContext: vi.fn(async () => ({ isPlayingInEditor: false })),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      activeEditorSession: activeEditorSession as any,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('restart_editor').handler({
      save_dirty_assets: false,
      wait_for_reconnect: true,
      disconnect_timeout_seconds: 2,
      reconnect_timeout_seconds: 3,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect(parsed.recovery).toMatchObject({
      strategy: 'host_relaunch_after_failed_graceful_restart',
    });
    expect(parsed.reconnect).toMatchObject({
      success: true,
      reconnected: true,
    });
    expect(killEditorProcess).toHaveBeenCalledWith({ processId: 4242 });
    expect(launchEditor).toHaveBeenCalledWith({
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
    });
    expect(waitForEditorRestart).toHaveBeenCalledTimes(2);
    expect(activeEditorSession.refreshActiveEditorAfterReconnect).toHaveBeenCalledTimes(1);
  });

  it('restart_editor retries on transient failure and succeeds on second attempt', async () => {
    const registry = createToolRegistry();
    let callCount = 0;
    const callSubsystemJson = vi.fn(async (method) => {
      if (method === 'RestartEditor') {
        callCount++;
        if (callCount === 1) {
          throw new Error('Remote Control connection lost');
        }
        return { success: true, operation: 'RestartEditor' };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(async () => ({ isPlayingInEditor: false })),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('restart_editor').handler({
      save_dirty_assets: false,
      wait_for_reconnect: true,
      disconnect_timeout_seconds: 2,
      reconnect_timeout_seconds: 3,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    // Should have called RestartEditor twice (first attempt + retry)
    expect(callSubsystemJson).toHaveBeenCalledTimes(2);
  });

  it('restart_editor returns early when editor is not connected', async () => {
    const registry = createToolRegistry();

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => false) },
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('restart_editor').handler({
      save_dirty_assets: false,
      wait_for_reconnect: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'not connected',
    );
  });

  it('restart_editor rejects restart during Play-In-Editor session', async () => {
    const registry = createToolRegistry();

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(async () => ({ isPlayingInEditor: true })),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('restart_editor').handler({
      save_dirty_assets: false,
      wait_for_reconnect: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'Play-In-Editor',
    );
  });

  it('restart_editor force_kill terminates editor process directly', async () => {
    const registry = createToolRegistry();
    const killEditorProcess = vi.fn(async () => ({ killed: true }));
    const projectController = createProjectController({ killEditorProcess });
    const callSubsystemJson = vi.fn(async () => ({ success: true }));
    const clearProjectAutomationContext = vi.fn();

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController,
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(async () => ({ isPlayingInEditor: false })),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('restart_editor').handler({
      save_dirty_assets: false,
      force_kill: true,
      wait_for_reconnect: false,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    expect(killEditorProcess).toHaveBeenCalled();
    expect(callSubsystemJson).not.toHaveBeenCalledWith('RestartEditor', expect.anything());
    expect(clearProjectAutomationContext).toHaveBeenCalled();
    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.strategy).toBe('force_kill');
  });

  it('includes accumulated stepErrors and failedStep in outer catch error payload', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    // classifyChangedPaths throws — this is NOT wrapped in an inner try/catch,
    // so the error propagates to the outer catch block.
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => {
        throw new Error('unexpected classify crash');
      }),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async () => ({ success: true })),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.cpp'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    // The outer catch should produce a structured error with stepErrors, failedStep, changedPaths
    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed).toHaveProperty('stepErrors');
    expect(parsed).toHaveProperty('failedStep');
    expect(parsed).toHaveProperty('changedPaths');
    expect(parsed.operation).toBe('sync_project_code');
  });

  it('reports failedStep as "live_coding" when live coding throws and cannot fallback', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'live_coding',
        restartRequired: false,
        reasons: [],
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async (method) => {
        if (method === 'TriggerLiveCoding') throw new Error('live coding module crashed');
        return { success: true };
      }),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.cpp'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.strategy).toBe('live_coding');
    expect(parsed.failedStep).toBe('live_coding');
    expect(parsed.stepErrors).toBeDefined();
    expect((parsed.stepErrors as Record<string, string>).liveCoding).toBe('live coding module crashed');
  });

  it('reports failedStep as "save" when SaveAssets returns success=false', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async (method) => {
        if (method === 'SaveAssets') return { success: false, error: 'disk full' };
        return { success: true };
      }),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.h'],
      save_asset_paths: ['/Game/Maps/MainLevel'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.stepErrors).toBeDefined();
    expect((parsed.stepErrors as Record<string, string>).save).toBe('SaveAssets returned success=false');
    expect(parsed.failedStep).toBe('save');
  });

  it('reports failedStep as "restart" when RestartEditor returns success=false', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async (method) => {
        if (method === 'SaveAssets') return { success: true };
        if (method === 'RestartEditor') return { success: false, error: 'editor busy' };
        throw new Error(`Unexpected method ${method}`);
      }),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.h'],
      save_asset_paths: ['/Game/Maps/MainLevel'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.stepErrors).toBeDefined();
    expect((parsed.stepErrors as Record<string, string>).restart).toBe('RestartEditor returned success=false');
    expect(parsed.failedStep).toBe('restart');
  });

  it('reports stepErrors for reconnect when waitForEditorRestart throws', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
      waitForEditorRestart: vi.fn(async () => {
        throw new Error('reconnect timed out');
      }),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async (method) => {
        if (method === 'SaveAssets') return { success: true };
        if (method === 'RestartEditor') return { success: true, operation: 'RestartEditor' };
        throw new Error(`Unexpected method ${method}`);
      }),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.h'],
      save_asset_paths: ['/Game/Maps/MainLevel'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.stepErrors).toBeDefined();
    expect((parsed.stepErrors as Record<string, string>).reconnect).toBe('reconnect timed out');
  });

  it('sync_project_code recovers from failed graceful reconnect by relaunching the bound editor', async () => {
    const registry = createToolRegistry();
    const activeEditorSession = createActiveEditorSession();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const waitForEditorRestart = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        operation: 'restart_editor',
        disconnected: true,
        reconnected: false,
        disconnectTimeoutMs: 1000,
        reconnectTimeoutMs: 1000,
        diagnostics: ['Editor did not reconnect before the timeout elapsed'],
      })
      .mockResolvedValueOnce({
        success: true,
        operation: 'restart_editor',
        disconnected: false,
        reconnected: true,
        disconnectTimeoutMs: 60000,
        reconnectTimeoutMs: 1000,
        diagnostics: [],
      });
    const killEditorProcess = vi.fn(async () => ({ killed: true }));
    const launchEditor = vi.fn(async () => ({
      success: true,
      operation: 'launch_editor',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      projectDir: 'C:/Proj',
      processId: 6060,
      command: {
        executable: 'UnrealEditor.exe',
        args: [],
      },
      detached: true,
      diagnostics: [],
    }));
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_change'],
      })),
      waitForEditorRestart,
      killEditorProcess,
      launchEditor,
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async (method) => {
        if (method === 'RestartEditor') {
          return { success: true, operation: 'RestartEditor' };
        }
        if (method === 'SaveAssets') {
          return { success: true };
        }
        throw new Error(`Unexpected method ${method}`);
      }),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      activeEditorSession: activeEditorSession as any,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.h'],
      save_asset_paths: ['/Game/Maps/MainLevel'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect(parsed.restartRecovery).toMatchObject({
      strategy: 'host_relaunch_after_failed_graceful_restart',
    });
    expect(parsed.reconnect).toMatchObject({
      success: true,
      reconnected: true,
    });
    expect(killEditorProcess).toHaveBeenCalledWith({ processId: 4242 });
    expect(launchEditor).toHaveBeenCalledWith({
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
    });
    expect(waitForEditorRestart).toHaveBeenCalledTimes(2);
    expect(activeEditorSession.refreshActiveEditorAfterReconnect).toHaveBeenCalledTimes(1);
  });

  it('includes stepErrors in success response when save throws but is non-critical', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async (method) => {
        if (method === 'SaveAssets') throw new Error('asset lock conflict');
        if (method === 'RestartEditor') return { success: true, operation: 'RestartEditor' };
        throw new Error(`Unexpected method ${method}`);
      }),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.h'],
      save_asset_paths: ['/Game/Maps/MainLevel'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    // Save is non-critical, so the overall operation should still succeed if reconnect succeeds
    expect(parsed.success).toBe(true);
    expect(parsed.stepErrors).toBeDefined();
    expect((parsed.stepErrors as Record<string, string>).save).toBe('asset lock conflict');
    // No failedStep since the overall operation succeeded
    expect(parsed.failedStep).toBeUndefined();
  });

  it('outer catch preserves stepErrors and failedStep from earlier steps', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    // classifyChangedPaths is NOT wrapped in a try/catch inside the handler.
    // If it throws after the init step, the outer catch will fire
    // with currentStep still at 'init' and any prior stepErrors.
    // To test with accumulated stepErrors we need to reach the outer catch
    // after an inner step recorded a stepError. The most realistic scenario
    // is a crash in an unwrapped area. Since classifyChangedPaths throws
    // before inner steps, stepErrors will be empty — but the outer catch
    // should still include the empty stepErrors and the correct failedStep.
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => {
        throw new Error('unexpected path classification error');
      }),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async () => ({ success: true })),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.cpp'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.operation).toBe('sync_project_code');
    // Outer catch always includes stepErrors (even if empty) and failedStep
    expect(parsed).toHaveProperty('stepErrors');
    expect(parsed).toHaveProperty('failedStep');
    expect(parsed.failedStep).toBe('init');
    expect(parsed).toHaveProperty('changedPaths');
    expect(parsed.message).toContain('unexpected path classification error');
  });

  it('identifies failedStep as "build" when build step throws', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_or_uht_sensitive_change'],
      })),
      compileProjectCode: vi.fn(async () => {
        throw new Error('linker error LNK2019');
      }),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async () => ({ success: true })),
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.cpp'],
      save_dirty_assets: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.stepErrors).toBeDefined();
    expect((parsed.stepErrors as Record<string, string>).build).toBe('linker error LNK2019');
    // failedStep should identify the build step specifically
    expect(parsed.failedStep).toBe('build');
  });

  it('returns project automation context from the subsystem', async () => {
    const registry = createToolRegistry();
    const getProjectAutomationContext = vi.fn(async () => ({
      engineRoot: 'C:/UE',
      projectFilePath: 'C:/Proj/Proj.uproject',
      editorTarget: 'ProjEditor',
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext,
      resolveProjectInputs: vi.fn(async () => createResolvedProjectInputs()),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('get_project_automation_context').handler({});

    expect(getProjectAutomationContext).toHaveBeenCalledWith(true);
    expect(parseDirectToolResult(result)).toMatchObject({
      engineRoot: 'C:/UE',
      projectFilePath: 'C:/Proj/Proj.uproject',
      editorTarget: 'ProjEditor',
    });
  });

  it('returns bounded editor context from the active editor session', async () => {
    const registry = createToolRegistry();
    const activeEditorSession = createActiveEditorSession();

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext: vi.fn(async () => ({
        engineRoot: 'C:/UE',
        projectFilePath: 'C:/Proj/Proj.uproject',
      })),
      resolveProjectInputs: vi.fn(async () => createResolvedProjectInputs()),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      activeEditorSession: activeEditorSession as any,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('get_editor_context').handler({});

    expect(activeEditorSession.getEditorContext).toHaveBeenCalledTimes(1);
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'get_editor_context',
      instanceId: 'editor-1',
      selectedAssetPaths: ['/Game/Blueprints/BP_PlayerCharacter'],
      selectedActorNames: ['BP_PlayerCharacter_C_0'],
      openAssetEditors: ['/Game/UI/WBP_MainMenu'],
      activeLevel: '/Game/Maps/MainLevel',
    });
  });

  it('returns an error when get_project_automation_context fails', async () => {
    const registry = createToolRegistry();
    const getProjectAutomationContext = vi.fn(async () => {
      throw new Error('editor not connected');
    });

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      getProjectAutomationContext,
      resolveProjectInputs: vi.fn(async () => createResolvedProjectInputs()),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('get_project_automation_context').handler({});

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'editor not connected',
    );
  });

  it('reads the bounded editor context without touching project automation context', async () => {
    const editorContext = {
      instanceId: 'editor-1',
      projectFilePath: 'C:/Proj/Proj.uproject',
      selectedAssetPaths: ['/Game/UI/WBP_Menu'],
      selectedActorNames: ['PlayerStart'],
      openAssetEditors: ['/Game/UI/WBP_Menu.WBP_Menu'],
      activeLevel: '/Game/Maps/Entry',
      pieSummary: {
        isPlayingInEditor: false,
        isSimulatingInEditor: false,
      },
    };
    const activeEditorSession = {
      getEditorContext: vi.fn(async () => editorContext),
    } as any;

    await expect(getEditorContext(activeEditorSession)).resolves.toEqual(editorContext);
    expect(activeEditorSession.getEditorContext).toHaveBeenCalledTimes(1);
  });

  it('reads Output Log entries through the subsystem with filters', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'read_output_log',
      snapshotAtUtc: '2026-04-06T00:00:00Z',
      bufferedCount: 12,
      matchedCount: 2,
      returnedCount: 2,
      offset: 0,
      limit: 50,
      hasMore: false,
      categoryCounts: [{ name: 'LogBlueprintExtractor', count: 2 }],
      verbosityCounts: [{ name: 'error', count: 2 }],
      entries: [{ sequence: 12, category: 'LogBlueprintExtractor', verbosity: 'error', message: 'bad thing', capturedAtUtc: '2026-04-06T00:00:00Z' }],
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(async () => ({ engineRoot: 'C:/UE', projectFilePath: 'C:/Proj/Proj.uproject' })),
      resolveProjectInputs: vi.fn(async () => createResolvedProjectInputs()),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('read_output_log').handler({
      query: 'bad',
      categories: ['LogBlueprintExtractor'],
      verbosities: ['error'],
      since_seconds: 60,
      offset: 0,
      limit: 50,
      reverse: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ReadOutputLog', {
      FilterJson: JSON.stringify({
        query: 'bad',
        categories: ['LogBlueprintExtractor'],
        verbosities: ['error'],
        since_utc: undefined,
        since_seconds: 60,
        offset: 0,
        limit: 50,
        reverse: true,
      }),
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'read_output_log',
      matchedCount: 2,
    });
  });

  it('lists Message Log listings through the subsystem', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'list_message_log_listings',
      snapshotAtUtc: '2026-04-06T00:00:00Z',
      discoveryMode: 'known_candidates',
      candidateCount: 3,
      listingCount: 2,
      includeUnregistered: true,
      listings: [
        { listingName: 'PIE', registered: true, listingLabel: 'Play In Editor', messageCount: 3, filteredMessageCount: 3, filterCount: 2 },
        { listingName: 'CustomLog', registered: false },
      ],
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(async () => ({ engineRoot: 'C:/UE', projectFilePath: 'C:/Proj/Proj.uproject' })),
      resolveProjectInputs: vi.fn(async () => createResolvedProjectInputs()),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('list_message_log_listings').handler({
      candidate_names: ['PIE', 'CustomLog'],
      include_unregistered: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ListMessageLogListings', {
      PayloadJson: JSON.stringify({
        candidate_names: ['PIE', 'CustomLog'],
        include_unregistered: true,
      }),
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'list_message_log_listings',
      listingCount: 2,
    });
  });

  it('reads one Message Log listing through the subsystem with token filters', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      operation: 'read_message_log',
      snapshotAtUtc: '2026-04-06T00:00:00Z',
      listingName: 'PIE',
      listingLabel: 'Play In Editor',
      messageCount: 4,
      filteredMessageCount: 4,
      matchedCount: 1,
      returnedCount: 1,
      offset: 0,
      limit: 10,
      hasMore: false,
      filterCount: 2,
      severityCounts: [{ name: 'error', count: 1 }],
      entries: [{ index: 0, severity: 'error', text: 'No owning player', tokenCount: 0, hasMessageLink: false }],
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(async () => ({ engineRoot: 'C:/UE', projectFilePath: 'C:/Proj/Proj.uproject' })),
      resolveProjectInputs: vi.fn(async () => createResolvedProjectInputs()),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('read_message_log').handler({
      listing_name: 'PIE',
      query: 'player',
      severities: ['error'],
      token_types: ['text'],
      include_tokens: true,
      offset: 0,
      limit: 10,
      reverse: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ReadMessageLog', {
      ListingName: 'PIE',
      FilterJson: JSON.stringify({
        query: 'player',
        severities: ['error'],
        token_types: ['text'],
        include_tokens: true,
        offset: 0,
        limit: 10,
        reverse: true,
      }),
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'read_message_log',
      listingName: 'PIE',
      matchedCount: 1,
    });
  });

  // --- Phase 5: critical coverage gaps ---

  it('sync_project_code restart_first=true orchestrates shutdown-build-launch sequence', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'RestartEditor') return { success: true, operation: 'RestartEditor' };
      return { success: true };
    });
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'build_and_restart',
        restartRequired: true,
        reasons: ['header_changes'],
      })),
      waitForEditorRestart: vi.fn(async () => ({
        success: true,
        operation: 'restart_editor',
        disconnected: true,
        reconnected: true,
        disconnectTimeoutMs: 2000,
        reconnectTimeoutMs: 3000,
        diagnostics: [],
      })),
    });
    const clearProjectAutomationContext = vi.fn();

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(async () => ({ isPlayingInEditor: false })),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext,
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('sync_project_code').handler({
      changed_paths: ['C:/Proj/Source/MyActor.cpp'],
      restart_first: true,
      save_dirty_assets: true,
      disconnect_timeout_seconds: 2,
      reconnect_timeout_seconds: 3,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.strategy).toBe('restart_first');
    // RestartEditor should be called with bRelaunch: false (shutdown only)
    expect(callSubsystemJson).toHaveBeenCalledWith('RestartEditor', {
      bWarn: false,
      bSaveDirtyAssets: true,
      bRelaunch: false,
    });
    // launchEditor should be called after build
    expect(projectController.launchEditor).toHaveBeenCalled();
  });

  it('compile_project_code locked_file contract: success=false, compilationSucceeded=true, errorCategory=locked_file', async () => {
    const registry = createToolRegistry();
    const resolveProjectInputs = vi.fn(async () => createResolvedProjectInputs());
    const projectController = createProjectController({
      compileProjectCode: vi.fn(async () => ({
        success: false,
        operation: 'compile_project_code',
        strategy: 'external_build',
        engineRoot: 'C:/UE',
        projectPath: 'C:/Proj/Proj.uproject',
        projectDir: 'C:/Proj',
        target: 'ProjEditor',
        platform: 'Win64',
        configuration: 'Development',
        command: { executable: 'Build.bat', args: [] },
        durationMs: 5000,
        exitCode: 1,
        compilationSucceeded: true,
        restartRequired: true,
        restartReasons: ['external_build_completed'],
        outputIncluded: false,
        errorCategory: 'locked_file',
        errorSummary: 'Build failed: UnrealEditor-MyGame.dll locked by another process.',
        lockedFiles: ['UnrealEditor-MyGame.dll'],
      })),
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController,
      callSubsystemJson: vi.fn(async () => ({ success: true })),
      getProjectAutomationContext: vi.fn(async () => ({ isPlayingInEditor: false })),
      resolveProjectInputs,
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('compile_project_code').handler({
      include_output: false,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.success).toBe(false);
    expect(parsed.compilationSucceeded).toBe(true);
    expect(parsed.errorCategory).toBe('locked_file');
    expect(parsed.lockedFiles).toEqual(['UnrealEditor-MyGame.dll']);
  });

  it('trigger_live_coding NoChanges at tool level includes new-file warning', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      compileResult: 'NoChanges',
      noOp: true,
    }));

    registerProjectControlTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('trigger_live_coding').handler({
      changed_paths: ['Source/NewFile.cpp'],
      wait_for_completion: true,
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    expect(parsed.fallbackRecommended).toBe(true);
    expect(parsed.reason).toBe('live_coding_reported_nochanges');
    const warnings = parsed.warnings as string[];
    expect(warnings.some((w: string) => w.includes('newly added'))).toBe(true);
  });

  it('restart_editor returns error when subsystem throws on both attempts', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => {
      throw new Error('Remote Control connection refused');
    });

    registerProjectControlTools({
      server: registry.server,
      client: { checkConnection: vi.fn(async () => true) },
      projectController: createProjectController(),
      callSubsystemJson,
      getProjectAutomationContext: vi.fn(async () => ({ isPlayingInEditor: false })),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      buildPlatformSchema,
      buildConfigurationSchema,
      editorPollIntervalMs: 5,
    });

    const result = await registry.getTool('restart_editor').handler({
      save_dirty_assets: true,
      force_kill: false,
      wait_for_reconnect: true,
      disconnect_timeout_seconds: 1,
      reconnect_timeout_seconds: 1,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = getTextContent(result as { content?: Array<{ text?: string; type: string }> });
    expect(text).toContain('restart_editor failed after retry');
    expect(text).toContain('Remote Control connection refused');
    expect(callSubsystemJson).toHaveBeenCalledTimes(2);
  });
});
