import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProjectController,
  classifyChangedPaths,
  classifyBuildError,
  inferExecutionPlatform,
  resolveBuildScript,
  resolveCommandInvocation,
  resolveEditorExecutable,
} from '../src/project-controller.js';

describe('ProjectController', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
    vi.restoreAllMocks();

    while (tempDirs.length > 0) {
      const directory = tempDirs.pop();
      if (!directory) {
        continue;
      }

      await rm(directory, { recursive: true, force: true });
    }
  });

  it('classifies implementation-only edits for live coding and header/build metadata edits for rebuild', () => {
    expect(classifyChangedPaths(['Source/MyGame/Private/MyActor.cpp'])).toEqual({
      strategy: 'live_coding',
      restartRequired: false,
      reasons: [],
    });

    expect(classifyChangedPaths(['Source/MyGame/Public/MyActor.h'])).toEqual({
      strategy: 'build_and_restart',
      restartRequired: true,
      reasons: ['header_or_uht_sensitive_change'],
    });

    expect(classifyChangedPaths(['Plugins/MyPlugin/MyPlugin.uplugin'])).toEqual({
      strategy: 'build_and_restart',
      restartRequired: true,
      reasons: ['build_or_project_metadata_change'],
    });

    expect(classifyChangedPaths(['Source/MyGame/Private/MyActor.cpp'], true)).toEqual({
      strategy: 'build_and_restart',
      restartRequired: true,
      reasons: ['force_rebuild'],
    });
  });

  it('builds the correct command line from explicit inputs and env fallbacks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-project-controller-'));
    tempDirs.push(root);

    const engineRoot = join(root, 'UE_5.7');
    const buildScript = join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.sh');
    const projectPath = join(root, 'MyGame.uproject');
    await mkdir(join(engineRoot, 'Engine', 'Build', 'BatchFiles'), { recursive: true });
    await writeFile(buildScript, '#!/usr/bin/env bash\n');
    await writeFile(projectPath, '{}');

    const controller = new ProjectController({
      env: {
        UE_ENGINE_ROOT: engineRoot,
        UE_PROJECT_PATH: projectPath,
        UE_PROJECT_TARGET: 'MyGameEditor',
      },
      platform: 'linux',
      runCommand: async (executable, args) => ({
        exitCode: 0,
        stdout: JSON.stringify({ executable, args }),
        stderr: '',
      }),
    });

    const result = await controller.compileProjectCode({
      includeOutput: true,
    });

    expect(result.success).toBe(true);
    expect(result.command.executable).toBe(buildScript);
    expect(result.command.args).toEqual([
      'MyGameEditor',
      'Linux',
      'Development',
      `-Project=${projectPath}`,
      '-WaitMutex',
      '-NoHotReloadFromIDE',
    ]);
    expect(result.stdout).toContain('MyGameEditor');
  });

  it('normalizes Windows project paths before passing them to the build script', async () => {
    vi.resetModules();
    const access = vi.fn(async () => undefined);
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return {
        ...actual,
        access,
      };
    });

    const module = await import('../src/project-controller.js');
    let capturedExecutable = '';
    let capturedArgs: string[] = [];
    let capturedCwd = '';
    const controller = new module.ProjectController({
      env: {
        UE_ENGINE_ROOT: 'C:/Program Files/Epic Games/UE_5.7',
        UE_PROJECT_TARGET: 'MyGameEditor',
      },
      platform: 'linux',
      runCommand: async (executable, args, options) => {
        capturedExecutable = executable;
        capturedArgs = args;
        capturedCwd = options.cwd ?? '';
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
        };
      },
    });

    const result = await controller.compileProjectCode({
      projectPath: 'C:/Projects/My Game/MyGame.uproject',
      platform: 'Win64',
    });

    expect(result.success).toBe(true);
    expect(access).toHaveBeenCalledWith(
      '/mnt/c/Program Files/Epic Games/UE_5.7/Engine/Build/BatchFiles/Build.bat',
      expect.any(Number),
    );
    expect(capturedExecutable).toBe('C:\\Program Files\\Epic Games\\UE_5.7\\Engine\\Build\\BatchFiles\\Build.bat');
    expect(capturedArgs).toEqual([
      'MyGameEditor',
      'Win64',
      'Development',
      '-Project=C:\\Projects\\My Game\\MyGame.uproject',
      '-WaitMutex',
      '-NoHotReloadFromIDE',
    ]);
    expect(capturedCwd).toBe('/mnt/c/Projects/My Game');
    expect(result.projectPath).toBe('C:/Projects/My Game/MyGame.uproject');
  });

  it('infers Windows execution from WSL-mounted paths on Linux hosts', () => {
    expect(inferExecutionPlatform(
      'C:/Program Files/Epic Games/UE_5.6',
      '/mnt/d/Projects/MyGame/MyGame.uproject',
      'linux',
    )).toBe('win32');
  });

  it('uses Windows command paths and WSL cwd when compiling from Linux against a Windows UE install', async () => {
    vi.resetModules();
    const access = vi.fn(async () => undefined);
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return {
        ...actual,
        access,
      };
    });

    const module = await import('../src/project-controller.js');
    const runCommand = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
    }));
    const controller = new module.ProjectController({
      env: {
        UE_ENGINE_ROOT: 'C:/Program Files/Epic Games/UE_5.6',
        UE_PROJECT_PATH: '/mnt/d/Projects/MyGame/MyGame.uproject',
        UE_PROJECT_TARGET: 'MyGameEditor',
      },
      platform: 'linux',
      runCommand,
    });

    const result = await controller.compileProjectCode({
      platform: 'Win64',
    });

    expect(result.success).toBe(true);
    expect(access).toHaveBeenCalledWith(
      '/mnt/c/Program Files/Epic Games/UE_5.6/Engine/Build/BatchFiles/Build.bat',
      expect.any(Number),
    );
    expect(runCommand).toHaveBeenCalledWith(
      'C:\\Program Files\\Epic Games\\UE_5.6\\Engine\\Build\\BatchFiles\\Build.bat',
      [
        'MyGameEditor',
        'Win64',
        'Development',
        '-Project=D:\\Projects\\MyGame\\MyGame.uproject',
        '-WaitMutex',
        '-NoHotReloadFromIDE',
      ],
      expect.objectContaining({
        cwd: '/mnt/d/Projects/MyGame',
        platform: 'win32',
      }),
    );
  });

  it('wraps Windows batch files through cmd.exe to avoid spawn EINVAL', () => {
    const invocation = resolveCommandInvocation(
      'C:/Program Files/Epic Games/UE_5.7/Engine/Build/BatchFiles/Build.bat',
      ['MyGameEditor', 'Win64', 'Development', '-Project=C:/Projects/My Game/MyGame.uproject'],
      'win32',
      { ComSpec: 'C:/Windows/System32/cmd.exe' },
    );

    expect(invocation).toEqual({
      executable: 'C:/Windows/System32/cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'call "C:/Program Files/Epic Games/UE_5.7/Engine/Build/BatchFiles/Build.bat" MyGameEditor Win64 Development "-Project=C:/Projects/My Game/MyGame.uproject"',
      ],
    });
  });

  it('escapes cmd.exe metacharacters in Windows command arguments', () => {
    const invocation = resolveCommandInvocation(
      'C:/UE/Engine/Build/BatchFiles/Build.bat',
      ['Target', '-Arg=foo&bar', '-Path=a|b', 'val<x>y', 'hat^ed', 'pct%VAR%', 'bang!ed', 'group(a)b'],
      'win32',
      { ComSpec: 'cmd.exe' },
    );

    expect(invocation.executable).toBe('cmd.exe');
    const commandLine = invocation.args[3];
    expect(commandLine).toContain('"-Arg=foo^&bar"');
    expect(commandLine).toContain('"-Path=a^|b"');
    expect(commandLine).toContain('"val^<x^>y"');
    expect(commandLine).toContain('"hat^^ed"');
    expect(commandLine).toContain('"pct^%VAR^%"');
    expect(commandLine).toContain('"bang^!ed"');
    expect(commandLine).toContain('"group^(a^)b"');
  });

  it('launches the editor from the host as a detached process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-project-controller-launch-'));
    tempDirs.push(root);

    const engineRoot = join(root, 'UE_5.7');
    const editorExecutable = join(engineRoot, 'Engine', 'Binaries', 'Linux', 'UnrealEditor');
    const projectPath = join(root, 'MyGame.uproject');
    await mkdir(join(engineRoot, 'Engine', 'Binaries', 'Linux'), { recursive: true });
    await writeFile(editorExecutable, '#!/usr/bin/env bash\n');
    await writeFile(projectPath, '{}');

    const spawnCalls: Array<Record<string, unknown>> = [];
    const controller = new ProjectController({
      env: {
        UE_ENGINE_ROOT: engineRoot,
        UE_PROJECT_PATH: projectPath,
      },
      platform: 'linux',
      spawnProcess: ((executable, args, options) => {
        spawnCalls.push({ executable, args, options });
        return {
          unref() {},
        } as never;
      }) as typeof import('node:child_process').spawn,
    });

    const result = await controller.launchEditor({});

    expect(result.success).toBe(true);
    expect(result.command.executable).toBe(editorExecutable);
    expect(result.command.args).toEqual([projectPath, '-RCWebControlEnable', '-RCWebInterfaceEnable', '-WebControl.EnableServerOnStartup=1']);
    expect(spawnCalls).toEqual([{
      executable: editorExecutable,
      args: [projectPath, '-RCWebControlEnable', '-RCWebInterfaceEnable', '-WebControl.EnableServerOnStartup=1'],
      options: expect.objectContaining({
        cwd: root,
        detached: true,
        shell: false,
        stdio: 'ignore',
      }),
    }]);
  });

  it('does not duplicate default launch switches when explicit overrides are provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-project-controller-launch-args-'));
    tempDirs.push(root);

    const engineRoot = join(root, 'UE_5.7');
    const editorExecutable = join(engineRoot, 'Engine', 'Binaries', 'Linux', 'UnrealEditor');
    const projectPath = join(root, 'MyGame.uproject');
    await mkdir(join(engineRoot, 'Engine', 'Binaries', 'Linux'), { recursive: true });
    await writeFile(editorExecutable, '#!/usr/bin/env bash\n');
    await writeFile(projectPath, '{}');

    const spawnCalls: Array<Record<string, unknown>> = [];
    const controller = new ProjectController({
      env: {
        UE_ENGINE_ROOT: engineRoot,
        UE_PROJECT_PATH: projectPath,
      },
      platform: 'linux',
      spawnProcess: ((executable, args, options) => {
        spawnCalls.push({ executable, args, options });
        return {
          unref() {},
        } as never;
      }) as typeof import('node:child_process').spawn,
    });

    const result = await controller.launchEditor({
      additionalArgs: ['-RCWebControlEnable', '-WebControl.EnableServerOnStartup=0'],
    });

    expect(result.command.args).toEqual([
      projectPath,
      '-RCWebInterfaceEnable',
      '-RCWebControlEnable',
      '-WebControl.EnableServerOnStartup=0',
    ]);
    expect(spawnCalls).toEqual([{
      executable: editorExecutable,
      args: [
        projectPath,
        '-RCWebInterfaceEnable',
        '-RCWebControlEnable',
        '-WebControl.EnableServerOnStartup=0',
      ],
      options: expect.objectContaining({
        cwd: root,
        detached: true,
        shell: false,
        stdio: 'ignore',
      }),
    }]);
  });

  it('resolves platform-specific build scripts and commandlet executables', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-project-controller-platforms-'));
    tempDirs.push(root);

    const linuxEngineRoot = join(root, 'UE_5.7-linux');
    const macEngineRoot = join(root, 'UE_5.7-mac');

    const linuxBuild = join(linuxEngineRoot, 'Engine', 'Build', 'BatchFiles', 'Linux', 'Build.sh');
    const linuxCmd = join(linuxEngineRoot, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd');
    const macBuild = join(macEngineRoot, 'Engine', 'Build', 'BatchFiles', 'Mac', 'Build.sh');
    const macCmd = join(macEngineRoot, 'Engine', 'Binaries', 'Mac', 'UnrealEditor-Cmd');

    await mkdir(join(linuxEngineRoot, 'Engine', 'Build', 'BatchFiles', 'Linux'), { recursive: true });
    await mkdir(join(linuxEngineRoot, 'Engine', 'Binaries', 'Linux'), { recursive: true });
    await mkdir(join(macEngineRoot, 'Engine', 'Build', 'BatchFiles', 'Mac'), { recursive: true });
    await mkdir(join(macEngineRoot, 'Engine', 'Binaries', 'Mac'), { recursive: true });

    await writeFile(linuxBuild, '#!/usr/bin/env bash\n');
    await writeFile(linuxCmd, '#!/usr/bin/env bash\n');
    await writeFile(macBuild, '#!/usr/bin/env bash\n');
    await writeFile(macCmd, '#!/usr/bin/env bash\n');

    await expect(resolveBuildScript(linuxEngineRoot, 'linux')).resolves.toBe(linuxBuild);
    await expect(resolveEditorExecutable(linuxEngineRoot, 'linux', 'commandlet')).resolves.toBe(linuxCmd);
    await expect(resolveBuildScript(macEngineRoot, 'darwin')).resolves.toBe(macBuild);
    await expect(resolveEditorExecutable(macEngineRoot, 'darwin', 'commandlet')).resolves.toBe(macCmd);
  });

  it('waits for the editor to disconnect and reconnect after restart', async () => {
    const states = [true, true, false, false, true];
    const controller = new ProjectController({
      sleep: async () => {},
    });

    const reconnect = await controller.waitForEditorRestart(async () => states.shift() ?? true, {
      disconnectTimeoutMs: 50,
      reconnectTimeoutMs: 50,
    });

    expect(reconnect.success).toBe(true);
    expect(reconnect.disconnected).toBe(true);
    expect(reconnect.reconnected).toBe(true);
  });

  it('can wait only for editor disconnect during shutdown-first orchestration', async () => {
    const states = [true, true, false];
    const controller = new ProjectController({
      sleep: async () => {},
    });

    const disconnect = await controller.waitForEditorRestart(async () => states.shift() ?? false, {
      disconnectTimeoutMs: 50,
      reconnectTimeoutMs: 50,
      waitForReconnect: false,
    });

    expect(disconnect.success).toBe(true);
    expect(disconnect.disconnected).toBe(true);
    expect(disconnect.reconnected).toBe(false);
  });

  it('can wait only for editor reconnect after a host-side launch', async () => {
    const states = [false, false, true];
    const controller = new ProjectController({
      sleep: async () => {},
    });

    const reconnect = await controller.waitForEditorRestart(async () => states.shift() ?? true, {
      disconnectTimeoutMs: 50,
      reconnectTimeoutMs: 50,
      waitForDisconnect: false,
    });

    expect(reconnect.success).toBe(true);
    expect(reconnect.disconnected).toBe(false);
    expect(reconnect.reconnected).toBe(true);
  });

  it('classifies locked DLL build errors with the correct category and file list', () => {
    const result = classifyBuildError(
      '',
      'LINK : fatal error LNK1104: cannot open file \'C:\\Proj\\Binaries\\Win64\\UnrealEditor-MyGame.dll\'\n' +
      'Access is denied',
      1,
    );

    expect(result.errorCategory).toBe('locked_file');
    expect(result.lockedFiles).toContain('C:\\Proj\\Binaries\\Win64\\UnrealEditor-MyGame.dll');
    expect(result.errorSummary).toContain('locked by another process');
  });

  it('sets compilationSucceeded true when errorCategory is locked_file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-project-controller-locked-'));
    tempDirs.push(root);

    const engineRoot = join(root, 'UE_5.7');
    const buildScript = join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.sh');
    const projectPath = join(root, 'MyGame.uproject');
    await mkdir(join(engineRoot, 'Engine', 'Build', 'BatchFiles'), { recursive: true });
    await writeFile(buildScript, '#!/usr/bin/env bash\n');
    await writeFile(projectPath, '{}');

    const controller = new ProjectController({
      env: {
        UE_ENGINE_ROOT: engineRoot,
        UE_PROJECT_PATH: projectPath,
        UE_PROJECT_TARGET: 'MyGameEditor',
      },
      platform: 'linux',
      runCommand: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'LINK : fatal error LNK1104: cannot open file \'UnrealEditor-MyGame.dll\'\nAccess is denied',
      }),
    });

    const result = await controller.compileProjectCode({});
    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('locked_file');
    expect(result.compilationSucceeded).toBe(true);
  });

  it('sets compilationSucceeded false when errorCategory is compilation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-project-controller-comperr-'));
    tempDirs.push(root);

    const engineRoot = join(root, 'UE_5.7');
    const buildScript = join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.sh');
    const projectPath = join(root, 'MyGame.uproject');
    await mkdir(join(engineRoot, 'Engine', 'Build', 'BatchFiles'), { recursive: true });
    await writeFile(buildScript, '#!/usr/bin/env bash\n');
    await writeFile(projectPath, '{}');

    const controller = new ProjectController({
      env: {
        UE_ENGINE_ROOT: engineRoot,
        UE_PROJECT_PATH: projectPath,
        UE_PROJECT_TARGET: 'MyGameEditor',
      },
      platform: 'linux',
      runCommand: async () => ({
        exitCode: 1,
        stdout: 'Source/MyActor.cpp(42): error C2065: undeclared identifier\n',
        stderr: '',
      }),
    });

    const result = await controller.compileProjectCode({});
    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('compilation');
    expect(result.compilationSucceeded).toBe(false);
  });

  it('sets compilationSucceeded true when build succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-project-controller-ok-'));
    tempDirs.push(root);

    const engineRoot = join(root, 'UE_5.7');
    const buildScript = join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.sh');
    const projectPath = join(root, 'MyGame.uproject');
    await mkdir(join(engineRoot, 'Engine', 'Build', 'BatchFiles'), { recursive: true });
    await writeFile(buildScript, '#!/usr/bin/env bash\n');
    await writeFile(projectPath, '{}');

    const controller = new ProjectController({
      env: {
        UE_ENGINE_ROOT: engineRoot,
        UE_PROJECT_PATH: projectPath,
        UE_PROJECT_TARGET: 'MyGameEditor',
      },
      platform: 'linux',
      runCommand: async () => ({
        exitCode: 0,
        stdout: 'Build succeeded',
        stderr: '',
      }),
    });

    const result = await controller.compileProjectCode({});
    expect(result.success).toBe(true);
    expect(result.compilationSucceeded).toBe(true);
  });

  it('classifies compilation errors distinctly from locked file errors', () => {
    const result = classifyBuildError(
      'Source/MyActor.cpp(42): error C2065: \'undeclared\': undeclared identifier\n',
      '',
      1,
    );

    expect(result.errorCategory).toBe('compilation');
    expect(result.lockedFiles).toEqual([]);
    expect(result.errorSummary).toContain('compilation errors');
  });

  it('falls back to environment variables when explicit inputs are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-project-controller-env-'));
    tempDirs.push(root);

    const engineRoot = join(root, 'UE_5.7');
    const buildScript = join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.sh');
    const projectPath = join(root, 'MyGame.uproject');
    await mkdir(join(engineRoot, 'Engine', 'Build', 'BatchFiles'), { recursive: true });
    await writeFile(buildScript, '#!/usr/bin/env bash\n');
    await writeFile(projectPath, '{}');

    const controller = new ProjectController({
      env: {
        UE_ENGINE_ROOT: engineRoot,
        UE_PROJECT_PATH: projectPath,
        UE_PROJECT_TARGET: 'MyGameEditor',
      },
      platform: 'linux',
      runCommand: async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }),
    });

    // Call without explicit engine_root — should fall back to env
    const result = await controller.compileProjectCode({});

    expect(result.success).toBe(true);
    expect(result.engineRoot).toBe(engineRoot);
    expect(result.projectPath).toBe(projectPath);
    expect(result.target).toBe('MyGameEditor');
  });

  it('reports disconnect timeout when editor never goes offline', async () => {
    // Editor stays connected forever — probe always returns true
    const controller = new ProjectController({
      sleep: async () => {},
    });

    const reconnect = await controller.waitForEditorRestart(async () => true, {
      disconnectTimeoutMs: 10,
      reconnectTimeoutMs: 10,
    });

    expect(reconnect.success).toBe(false);
    expect(reconnect.disconnected).toBe(false);
    expect(reconnect.reconnected).toBe(false);
    expect(reconnect.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining('never disconnected'),
      ]),
    );
  });

  it('reports reconnect timeout when editor disconnects but never comes back', async () => {
    // Editor disconnects on the second probe, then never reconnects
    const states = [true, false, false, false, false];
    const controller = new ProjectController({
      sleep: async () => {},
    });

    const reconnect = await controller.waitForEditorRestart(async () => states.shift() ?? false, {
      disconnectTimeoutMs: 50,
      reconnectTimeoutMs: 10,
    });

    expect(reconnect.success).toBe(false);
    expect(reconnect.disconnected).toBe(true);
    expect(reconnect.reconnected).toBe(false);
    expect(reconnect.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining('did not reconnect'),
      ]),
    );
  });
});
