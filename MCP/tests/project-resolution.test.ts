import { describe, expect, it, vi } from 'vitest';
import {
  getProjectAutomationContext,
  HEURISTIC_ENGINE_CANDIDATES,
  rememberExternalBuild,
  resolveProjectInputs,
} from '../src/helpers/project-resolution.js';

describe('rememberExternalBuild', () => {
  it('maps CompileProjectCodeResult fields into a flat summary object', () => {
    const result = rememberExternalBuild({
      success: true,
      operation: 'compile_project_code',
      strategy: 'external_build',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      platform: 'Win64',
      configuration: 'Development',
      exitCode: 0,
      durationMs: 1234,
      restartRequired: true,
      restartReasons: ['external_build_completed'],
    } as never);

    expect(result).toEqual({
      success: true,
      operation: 'compile_project_code',
      strategy: 'external_build',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      target: 'ProjEditor',
      platform: 'Win64',
      configuration: 'Development',
      exitCode: 0,
      durationMs: 1234,
      restartRequired: true,
      restartReasons: ['external_build_completed'],
      errorCategory: undefined,
      errorSummary: undefined,
      lockedFiles: undefined,
    });
  });

  it('includes error fields when build fails', () => {
    const result = rememberExternalBuild({
      success: false,
      operation: 'compile_project_code',
      strategy: 'external_build',
      exitCode: 1,
      errorCategory: 'compilation_error',
      errorSummary: 'CS0001: syntax error',
    } as never);

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('compilation_error');
    expect(result.errorSummary).toBe('CS0001: syntax error');
  });
});

describe('getProjectAutomationContext', () => {
  it('returns cached context when available and forceRefresh is false', async () => {
    const cachedContext = {
      engineRoot: 'C:/UE',
      projectFilePath: 'C:/Proj/Proj.uproject',
      editorTarget: 'ProjEditor',
    };
    const callSubsystemJson = vi.fn();
    const setCachedContext = vi.fn();

    const result = await getProjectAutomationContext({
      forceRefresh: false,
      cachedContext: cachedContext as never,
      setCachedContext,
      callSubsystemJson,
    });

    expect(result).toBe(cachedContext);
    expect(callSubsystemJson).not.toHaveBeenCalled();
    expect(setCachedContext).not.toHaveBeenCalled();
  });

  it('fetches fresh context when forceRefresh is true', async () => {
    const freshContext = {
      engineRoot: 'C:/UE_5.6',
      projectFilePath: 'C:/Proj/Proj.uproject',
      editorTarget: 'ProjEditor',
    };
    const callSubsystemJson = vi.fn(async () => freshContext);
    const setCachedContext = vi.fn();

    const result = await getProjectAutomationContext({
      forceRefresh: true,
      cachedContext: { engineRoot: 'old' } as never,
      setCachedContext,
      callSubsystemJson,
    });

    expect(result).toEqual(freshContext);
    expect(callSubsystemJson).toHaveBeenCalledWith('GetProjectAutomationContext', {});
    expect(setCachedContext).toHaveBeenCalledWith(freshContext);
  });

  it('fetches context when cache is null', async () => {
    const freshContext = {
      engineRoot: 'C:/UE',
      projectFilePath: 'C:/Proj/Proj.uproject',
      editorTarget: 'ProjEditor',
    };
    const callSubsystemJson = vi.fn(async () => freshContext);
    const setCachedContext = vi.fn();

    const result = await getProjectAutomationContext({
      forceRefresh: false,
      cachedContext: null,
      setCachedContext,
      callSubsystemJson,
    });

    expect(result).toEqual(freshContext);
    expect(callSubsystemJson).toHaveBeenCalled();
  });

  it('captures isPlayingInEditor when the editor context includes it', async () => {
    const freshContext = {
      engineRoot: 'C:/UE',
      projectFilePath: 'C:/Proj/Proj.uproject',
      editorTarget: 'ProjEditor',
      isPlayingInEditor: true,
    };
    const callSubsystemJson = vi.fn(async () => freshContext);
    const setCachedContext = vi.fn();

    const result = await getProjectAutomationContext({
      forceRefresh: true,
      cachedContext: null,
      setCachedContext,
      callSubsystemJson,
    });

    expect(result.isPlayingInEditor).toBe(true);
  });
});

describe('resolveProjectInputs', () => {
  const firstDefinedString = (...values: Array<unknown>) =>
    values.find((v) => typeof v === 'string' && v.length > 0) as string | undefined;

  it('uses explicit request values when provided', async () => {
    const getProjectAutomationContext = vi.fn();

    const result = await resolveProjectInputs(
      {
        engine_root: 'C:/UE',
        project_path: 'C:/Proj/Proj.uproject',
        target: 'ProjEditor',
      },
      {
        getProjectAutomationContext,
        firstDefinedString,
      },
    );

    expect(result.engineRoot).toBe('C:/UE');
    expect(result.projectPath).toBe('C:/Proj/Proj.uproject');
    expect(result.target).toBe('ProjEditor');
    expect(result.sources.engineRoot).toBe('explicit');
    expect(result.sources.projectPath).toBe('explicit');
    expect(result.sources.target).toBe('explicit');
    // Should not call context when all values are explicit
    expect(getProjectAutomationContext).not.toHaveBeenCalled();
  });

  it('falls back to editor context when request values are missing', async () => {
    const getProjectAutomationContext = vi.fn(async () => ({
      engineRoot: 'C:/ContextUE',
      projectFilePath: 'C:/ContextProj/Proj.uproject',
      editorTarget: 'ContextEditor',
    }));

    const result = await resolveProjectInputs(
      {},
      {
        getProjectAutomationContext,
        firstDefinedString,
      },
    );

    expect(result.engineRoot).toBe('C:/ContextUE');
    expect(result.projectPath).toBe('C:/ContextProj/Proj.uproject');
    expect(result.target).toBe('ContextEditor');
    expect(result.sources.engineRoot).toBe('editor_context');
    expect(result.sources.projectPath).toBe('editor_context');
    expect(result.sources.target).toBe('editor_context');
    expect(result.context).toBeDefined();
  });

  it('falls back to environment variables when context is unavailable', async () => {
    const getProjectAutomationContext = vi.fn(async () => {
      throw new Error('editor offline');
    });

    const result = await resolveProjectInputs(
      {},
      {
        getProjectAutomationContext,
        firstDefinedString,
        env: {
          UE_ENGINE_ROOT: 'C:/EnvUE',
          UE_PROJECT_PATH: 'C:/EnvProj/Proj.uproject',
          UE_PROJECT_TARGET: 'EnvEditor',
        } as NodeJS.ProcessEnv,
      },
    );

    expect(result.engineRoot).toBe('C:/EnvUE');
    expect(result.projectPath).toBe('C:/EnvProj/Proj.uproject');
    expect(result.target).toBe('EnvEditor');
    expect(result.sources.engineRoot).toBe('environment');
    expect(result.sources.projectPath).toBe('environment');
    expect(result.sources.target).toBe('environment');
    expect(result.contextError).toBe('editor offline');
  });

  it('captures contextError when automation context fails', async () => {
    const getProjectAutomationContext = vi.fn(async () => {
      throw new Error('subsystem unavailable');
    });

    const result = await resolveProjectInputs(
      { engine_root: 'C:/UE' },
      {
        getProjectAutomationContext,
        firstDefinedString,
        env: {} as NodeJS.ProcessEnv,
      },
    );

    expect(result.contextError).toBe('subsystem unavailable');
    expect(result.sources.engineRoot).toBe('explicit');
  });

  it('includes UE 5.7 in the filesystem heuristic candidate list', () => {
    expect(HEURISTIC_ENGINE_CANDIDATES[0]).toBe('C:/Program Files/Epic Games/UE_5.7');
    expect(HEURISTIC_ENGINE_CANDIDATES).toContain('C:/Program Files/Epic Games/UE_5.7');
  });
});
