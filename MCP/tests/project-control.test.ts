import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerProjectControlTools } from '../src/tools/project-control.js';
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

describe('registerProjectControlTools', () => {
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

    expect(projectController.classifyChangedPaths).toHaveBeenCalledWith(['Source/Test/MyActor.h'], undefined);
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
      'toolchain missing; attempted explicit args -> editor context -> environment',
    );
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'editor_context_error=editor missing',
    );
  });
});
