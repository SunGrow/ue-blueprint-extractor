import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectController, classifyChangedPaths } from '../src/project-controller.js';

describe('ProjectController', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
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
});
