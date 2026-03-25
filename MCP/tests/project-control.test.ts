import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerProjectControlTools } from '../src/tools/project-control.js';
import { createToolResultNormalizers } from '../src/helpers/tool-results.js';
import { extractToolPayload } from '../src/helpers/formatting.js';
import { classifyRecoverableToolFailure, taskAwareTools } from '../src/server-config.js';
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
      'toolchain missing; attempted explicit args -> editor context -> environment',
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
});
