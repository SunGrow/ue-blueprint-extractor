import { afterEach, describe, expect, it } from 'vitest';
import { ActiveEditorSession } from '../src/active-editor-session.js';
import { startMockRemoteControlServer } from './test-helpers.js';

describe('ActiveEditorSession editor context', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()?.close();
    }
  });

  it('reads a bounded read-only editor context without touching automation context', async () => {
    const server = await startMockRemoteControlServer({
      onCall: (request) => {
        if (request.functionName === 'GetEditorContext') {
          return {
            body: {
              ReturnValue: JSON.stringify({
                success: true,
                operation: 'get_editor_context',
                instanceId: 'editor-1',
                projectName: 'Proj',
                projectFilePath: 'C:/Proj/Proj.uproject',
                projectDir: 'C:/Proj',
                engineRoot: 'C:/UE',
                editorTarget: 'ProjEditor',
                remoteControlHost: server.host,
                remoteControlPort: server.port,
                lastSeenAt: '2026-03-30T00:00:00.000Z',
                selectedAssetPaths: ['/Game/UI/WBP_Menu'],
                selectedActorNames: ['PlayerStart'],
                openAssetEditors: ['/Game/UI/WBP_Menu.WBP_Menu'],
                activeLevel: '/Game/Maps/Entry',
                partial: true,
                unsupportedSections: ['selected_actor_names'],
                pieSummary: {
                  isPlayingInEditor: false,
                  isSimulatingInEditor: false,
                },
              }),
            },
          };
        }

        return {
          status: 404,
          body: { error: `Unexpected ${request.functionName}` },
        };
      },
    });
    servers.push(server);

    const session = new ActiveEditorSession({
      cwd: 'C:/Proj',
      env: {
        UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH: '/Script/Test.OverrideSubsystem',
      } as NodeJS.ProcessEnv,
    });

    (session as any).activeEditorSnapshot = {
      instanceId: 'editor-1',
      projectName: 'Proj',
      projectFilePath: 'C:/Proj/Proj.uproject',
      projectDir: 'C:/Proj',
      engineRoot: 'C:/UE',
      engineVersion: '5.7.0',
      editorTarget: 'ProjEditor',
      processId: 4242,
      remoteControlHost: server.host,
      remoteControlPort: server.port,
      lastSeenAt: '2026-03-30T00:00:00.000Z',
    };
    (session as any).validationState = {
      checkedAt: Date.now(),
      healthy: true,
    };

    const context = await session.getEditorContext();

    expect(context).toMatchObject({
      instanceId: 'editor-1',
      projectFilePath: 'C:/Proj/Proj.uproject',
      selectedAssetPaths: ['/Game/UI/WBP_Menu'],
      selectedActorNames: ['PlayerStart'],
      openAssetEditors: ['/Game/UI/WBP_Menu.WBP_Menu'],
      activeLevel: '/Game/Maps/Entry',
      partial: true,
      unsupportedSections: ['selected_actor_names'],
      pieSummary: {
        isPlayingInEditor: false,
        isSimulatingInEditor: false,
      },
    });
    expect(server.requests.map((request) => request.functionName)).toEqual(['GetEditorContext']);
  });
});
