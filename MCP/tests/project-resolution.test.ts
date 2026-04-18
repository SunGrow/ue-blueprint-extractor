import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getProjectAutomationContext,
  getHeuristicEngineCandidates,
  HEURISTIC_ENGINE_CANDIDATES,
  rememberExternalBuild,
  resolveProjectInputs,
} from '../src/helpers/project-resolution.js';
import {
  listRegisteredEditors,
} from '../src/editor-instance-registry.js';
import {
  buildEngineAssociationCandidates,
  filesystemPathsEqual,
  toHostFilesystemPath,
  toWindowsStylePath,
} from '../src/helpers/workspace-project.js';

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
  const scratchDirs: string[] = [];
  const firstDefinedString = (...values: Array<unknown>) =>
    values.find((v) => typeof v === 'string' && v.length > 0) as string | undefined;

  afterEach(async () => {
    await Promise.allSettled(
      scratchDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })),
    );
  });

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

  it('prefers the project EngineAssociation over stale implicit engine roots', async () => {
    const scratchRoot = await mkdtemp(path.join(tmpdir(), 'bpx-project-resolution-'));
    scratchDirs.push(scratchRoot);

    const associatedEngineRoot = path.join(scratchRoot, 'UE_5.7');
    await mkdir(path.join(associatedEngineRoot, 'Engine', 'Build', 'BatchFiles', 'Linux'), { recursive: true });
    await writeFile(
      path.join(associatedEngineRoot, 'Engine', 'Build', 'BatchFiles', 'Linux', 'Build.sh'),
      '#!/bin/sh\n',
      'utf8',
    );

    const projectPath = path.join(scratchRoot, 'MyGame.uproject');
    await writeFile(projectPath, JSON.stringify({ EngineAssociation: associatedEngineRoot }), 'utf8');

    const staleImplicitRoot = path.join(scratchRoot, 'UE_5.6');
    const getProjectAutomationContext = vi.fn(async () => ({
      engineRoot: staleImplicitRoot,
      projectFilePath: projectPath,
      editorTarget: 'MyGameEditor',
    }));

    const result = await resolveProjectInputs(
      {},
      {
        getProjectAutomationContext,
        firstDefinedString,
        env: {
          UE_ENGINE_ROOT: staleImplicitRoot,
        } as NodeJS.ProcessEnv,
        platform: 'linux',
      },
    );

    expect(result.engineRoot).toBe(associatedEngineRoot);
    expect(result.projectPath).toBe(projectPath);
    expect(result.target).toBe('MyGameEditor');
    expect(result.projectEngineAssociation).toBe(associatedEngineRoot);
    expect(result.sources.engineRoot).toBe('project_association');
    expect(result.sources.projectPath).toBe('editor_context');
    expect(result.sources.target).toBe('editor_context');
  });

  it('blocks mismatched implicit engine roots when no associated engine installation is available', async () => {
    const scratchRoot = await mkdtemp(path.join(tmpdir(), 'bpx-project-resolution-'));
    scratchDirs.push(scratchRoot);

    const associatedEngineRoot = path.join(scratchRoot, 'UE_5.7');
    const projectPath = path.join(scratchRoot, 'MyGame.uproject');
    await writeFile(projectPath, JSON.stringify({ EngineAssociation: associatedEngineRoot }), 'utf8');

    const staleImplicitRoot = path.join(scratchRoot, 'UE_5.6');
    const getProjectAutomationContext = vi.fn(async () => ({
      engineRoot: staleImplicitRoot,
      projectFilePath: projectPath,
      editorTarget: 'MyGameEditor',
    }));

    const result = await resolveProjectInputs(
      {},
      {
        getProjectAutomationContext,
        firstDefinedString,
        env: {
          UE_ENGINE_ROOT: staleImplicitRoot,
        } as NodeJS.ProcessEnv,
        platform: 'linux',
      },
    );

    expect(result.engineRoot).toBeUndefined();
    expect(result.projectPath).toBe(projectPath);
    expect(result.target).toBe('MyGameEditor');
    expect(result.projectEngineAssociation).toBe(associatedEngineRoot);
    expect(result.sources.engineRoot).toBe('missing');
    expect(result.engineRootConflict).toContain('EngineAssociation');
    expect(result.engineRootConflict).toContain(staleImplicitRoot);
    expect(result.engineRootConflict).toContain(associatedEngineRoot);
  });

  it('keeps explicit engine_root overrides even when the project association differs', async () => {
    const scratchRoot = await mkdtemp(path.join(tmpdir(), 'bpx-project-resolution-'));
    scratchDirs.push(scratchRoot);

    const associatedEngineRoot = path.join(scratchRoot, 'UE_5.7');
    const explicitEngineRoot = path.join(scratchRoot, 'UE_5.6');
    const projectPath = path.join(scratchRoot, 'MyGame.uproject');
    await writeFile(projectPath, JSON.stringify({ EngineAssociation: associatedEngineRoot }), 'utf8');

    const getProjectAutomationContext = vi.fn();
    const result = await resolveProjectInputs(
      {
        engine_root: explicitEngineRoot,
        project_path: projectPath,
        target: 'MyGameEditor',
      },
      {
        getProjectAutomationContext,
        firstDefinedString,
        platform: 'linux',
      },
    );

    expect(result.engineRoot).toBe(explicitEngineRoot);
    expect(result.sources.engineRoot).toBe('explicit');
    expect(getProjectAutomationContext).not.toHaveBeenCalled();
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

  it('normalizes Windows-style filesystem paths independently of the host platform', () => {
    expect(filesystemPathsEqual('C:/Proj/Proj.uproject', 'C:\\Proj\\Proj.uproject')).toBe(true);
  });

  it('matches WSL-mounted paths against Windows-style registry paths', () => {
    expect(filesystemPathsEqual('/mnt/d/Development/V2/CyberVolleyball6vs6.uproject', 'D:/Development/V2/CyberVolleyball6vs6.uproject')).toBe(true);
  });

  it('converts WSL-mounted paths into Windows command paths', () => {
    expect(toWindowsStylePath('/mnt/d/Development/V2/CyberVolleyball6vs6.uproject')).toBe(
      'D:\\Development\\V2\\CyberVolleyball6vs6.uproject',
    );
  });

  it('converts Windows command paths into host filesystem paths on Linux', () => {
    expect(toHostFilesystemPath('C:/Program Files/Epic Games/UE_5.6', 'win32', 'linux')).toBe(
      '/mnt/c/Program Files/Epic Games/UE_5.6',
    );
  });

  it('builds engine association candidates for Windows and macOS installs', () => {
    expect(buildEngineAssociationCandidates('5.7', 'win32')).toContain('C:/Program Files/Epic Games/UE_5.7');
    expect(buildEngineAssociationCandidates('5.7', 'darwin')).toContain('/Users/Shared/Epic Games/UE_5.7');
  });

  it('discovers editor registry entries from Windows temp when running under WSL', async () => {
    if (process.platform !== 'linux') {
      return;
    }

    vi.resetModules();
    const readdir = vi.fn(async (targetPath: string, options?: { withFileTypes?: boolean }) => {
      if (targetPath === '/tmp/BlueprintExtractor/EditorRegistry') {
        throw new Error('missing');
      }

      if (targetPath === '/mnt/c/Users' && options?.withFileTypes) {
        return [{
          name: 'LazyF',
          isDirectory: () => true,
        }];
      }

      if (targetPath === '/mnt/c/Users/LazyF/AppData/Local/Temp/BlueprintExtractor/EditorRegistry') {
        return ['editor-1.json'];
      }

      throw new Error(`unexpected readdir: ${targetPath}`);
    });
    const readFile = vi.fn(async () => JSON.stringify({
      instanceId: 'editor-1',
      projectFilePath: 'D:/Development/V2/CyberVolleyball6vs6.uproject',
      remoteControlHost: '127.0.0.1',
      remoteControlPort: 30010,
      lastSeenAt: new Date().toISOString(),
    }));
    const stat = vi.fn(async () => ({ mtimeMs: Date.now() }));
    const rm = vi.fn(async () => undefined);

    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return {
        ...actual,
        readdir,
        readFile,
        stat,
        rm,
      };
    });

    const registryModule = await import('../src/editor-instance-registry.js');
    const result = await registryModule.listRegisteredEditors();

    expect(result.editors).toHaveLength(1);
    expect(result.editors[0]?.instanceId).toBe('editor-1');
    expect(readdir).toHaveBeenCalledWith('/mnt/c/Users', { withFileTypes: true });
  });

  it('includes host-appropriate filesystem heuristic candidates', () => {
    if (process.platform === 'win32') {
      expect(HEURISTIC_ENGINE_CANDIDATES[0]).toBe('C:/Program Files/Epic Games/UE_5.7');
      expect(HEURISTIC_ENGINE_CANDIDATES).toContain('C:/Program Files/Epic Games/UE_5.7');
      return;
    }

    if (process.platform === 'darwin') {
      expect(HEURISTIC_ENGINE_CANDIDATES[0]).toBe('/Users/Shared/Epic Games/UE_5.7');
      expect(HEURISTIC_ENGINE_CANDIDATES).toContain('/Users/Shared/EpicGames/UE_5.7');
      return;
    }

    expect(HEURISTIC_ENGINE_CANDIDATES).toEqual([]);
  });

  it('exposes deterministic heuristic candidates for explicit platforms', () => {
    expect(getHeuristicEngineCandidates('win32')[0]).toBe('C:/Program Files/Epic Games/UE_5.7');
    expect(getHeuristicEngineCandidates('darwin')[0]).toBe('/Users/Shared/Epic Games/UE_5.7');
    expect(getHeuristicEngineCandidates('linux')).toEqual([]);
  });
});
