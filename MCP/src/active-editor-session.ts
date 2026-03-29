import path from 'node:path';
import { sleep } from './helpers/formatting.js';
import { listRegisteredEditors } from './editor-instance-registry.js';
import type {
  ActiveEditorState,
  EditorInstanceSnapshot,
  EditorSelectionSource,
} from './editor-instance-types.js';
import {
  filesystemPathsEqual,
  findNearestWorkspaceProject,
  type WorkspaceProjectResolution,
} from './helpers/workspace-project.js';
import { UEClient } from './ue-client.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_VALIDATION_TTL_MS = 2_000;

type ActiveValidationState = {
  checkedAt: number;
  healthy: boolean;
};

type ActiveEditorSessionOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onSelectionChanged?: () => void;
};

type LaunchBindingRequest = {
  processId?: number;
  projectPath: string;
  engineRoot?: string;
  target?: string;
  timeoutMs?: number;
};

type ExpectedEditorIdentity = {
  projectPath?: string;
  engineRoot?: string;
  target?: string;
};

function parseExplicitPort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function buildNoActiveEditorMessage(workspaceProjectPath?: string): string {
  const workspaceHint = workspaceProjectPath
    ? ` Workspace project: ${workspaceProjectPath}.`
    : '';
  return `No active editor is selected for this MCP session.${workspaceHint} `
    + 'Open the session inside a project workspace with one running matching editor, '
    + 'call list_running_editors and select_editor, or call launch_editor with explicit project inputs.';
}

function buildAmbiguousWorkspaceMessage(workspaceProjectPath: string, matches: EditorInstanceSnapshot[]): string {
  const ports = matches.map((entry) => `${entry.remoteControlHost}:${entry.remoteControlPort}`).join(', ');
  return `Multiple running editors match the workspace project "${workspaceProjectPath}" (${ports}). `
    + 'Call list_running_editors and select_editor to choose one.';
}

function buildActiveEditorDriftMessage(snapshot: EditorInstanceSnapshot): string {
  return `The previously selected active editor "${snapshot.instanceId}" no longer matches the editor now responding on `
    + `${snapshot.remoteControlHost}:${snapshot.remoteControlPort}. The session has been returned to an unbound state. `
    + 'Call list_running_editors and select_editor to continue.';
}

export class ActiveEditorSession {
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly onSelectionChanged?: () => void;
  private readonly clients = new Map<string, UEClient>();
  private readonly workspaceProjectPromise: Promise<WorkspaceProjectResolution>;
  private activeEditorSnapshot: EditorInstanceSnapshot | undefined;
  private selectionSource: EditorSelectionSource = 'none';
  private autoBindAllowed = true;
  private validationState: ActiveValidationState | null = null;

  constructor(options: ActiveEditorSessionOptions = {}) {
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.env = options.env ?? process.env;
    this.onSelectionChanged = options.onSelectionChanged;
    this.workspaceProjectPromise = Promise.resolve(findNearestWorkspaceProject(this.cwd));
  }

  async callSubsystem(method: string, params: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<string> {
    const editor = await this.ensureActiveEditor();
    const client = this.getClient(editor);
    return client.callSubsystem(method, params, options);
  }

  async checkConnection(): Promise<boolean> {
    const editor = await this.resolveCurrentEditorForConnection();
    if (!editor) {
      return false;
    }

    const client = this.getClient(editor);
    if (await client.checkConnection()) {
      return true;
    }

    if (!this.activeEditorSnapshot) {
      return false;
    }

    const rebound = await this.rebindFromRegisteredEditors({
      projectPath: this.activeEditorSnapshot.projectFilePath,
      engineRoot: this.activeEditorSnapshot.engineRoot,
      target: this.activeEditorSnapshot.editorTarget,
    });
    if (!rebound) {
      return false;
    }

    return this.getClient(rebound).checkConnection();
  }

  async editorModeAvailable(): Promise<boolean> {
    return true;
  }

  async listRunningEditors(): Promise<EditorInstanceSnapshot[]> {
    const result = await listRegisteredEditors();
    return result.editors;
  }

  async selectEditor(selector: { instanceId?: string; processId?: number }): Promise<EditorInstanceSnapshot> {
    const editors = await this.listRunningEditors();
    const selected = selector.instanceId
      ? editors.find((entry) => entry.instanceId === selector.instanceId)
      : typeof selector.processId === 'number'
        ? editors.find((entry) => entry.processId === selector.processId)
        : undefined;

    if (!selected) {
      throw new Error(selector.instanceId
        ? `Running editor "${selector.instanceId}" was not found. Call list_running_editors first.`
        : `Running editor pid=${selector.processId} was not found. Call list_running_editors first.`);
    }

    const verified = await this.fetchProjectContext(selected.remoteControlHost, selected.remoteControlPort);
    this.bindSelection(verified, 'manual');
    return verified;
  }

  clearSelection(): ActiveEditorState {
    const previous = this.activeEditorSnapshot;
    this.activeEditorSnapshot = undefined;
    this.selectionSource = 'none';
    this.autoBindAllowed = false;
    this.validationState = null;
    this.emitSelectionChanged();
    return {
      active: false,
      selectionSource: 'none',
      workspaceProjectPath: undefined,
      autoBindAllowed: this.autoBindAllowed,
      healthy: false,
      activeEditor: previous,
      message: 'The session is now unbound. Automatic workspace auto-bind is disabled until a new editor is selected or launched.',
    };
  }

  async getActiveEditorState(options: { autoBindIfNeeded?: boolean } = {}): Promise<ActiveEditorState> {
    const workspace = await this.workspaceProjectPromise;
    if (!this.activeEditorSnapshot && options.autoBindIfNeeded !== false) {
      try {
        await this.ensureActiveEditor();
      } catch {
        // Report the current state without failing the inspection tool.
      }
    }

    if (!this.activeEditorSnapshot) {
      return {
        active: false,
        selectionSource: this.selectionSource,
        workspaceProjectPath: workspace.projectPath,
        autoBindAllowed: this.autoBindAllowed,
        healthy: false,
        message: buildNoActiveEditorMessage(workspace.projectPath),
      };
    }

    let validation: ActiveValidationState;
    try {
      validation = await this.validateActiveSelection();
    } catch (error) {
      return {
        active: false,
        selectionSource: 'none',
        workspaceProjectPath: workspace.projectPath,
        autoBindAllowed: this.autoBindAllowed,
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      active: true,
      selectionSource: this.selectionSource,
      workspaceProjectPath: workspace.projectPath,
      autoBindAllowed: this.autoBindAllowed,
      healthy: validation.healthy,
      activeEditor: this.activeEditorSnapshot,
      message: validation.healthy
        ? undefined
        : 'The selected active editor is currently unavailable on its registered Remote Control endpoint.',
    };
  }

  async bindLaunchedEditor(request: LaunchBindingRequest): Promise<EditorInstanceSnapshot> {
    const timeoutMs = request.timeoutMs ?? 180_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const editors = await this.listRunningEditors();
      const matches = editors.filter((entry) => (
        filesystemPathsEqual(entry.projectFilePath, request.projectPath)
        && (!request.engineRoot || filesystemPathsEqual(entry.engineRoot, request.engineRoot))
        && (!request.target || entry.editorTarget === request.target)
        && (!request.processId || entry.processId === request.processId)
      ));

      for (const match of matches) {
        try {
          const verified = await this.fetchProjectContext(match.remoteControlHost, match.remoteControlPort);
          if (!filesystemPathsEqual(verified.projectFilePath, request.projectPath)) {
            continue;
          }
          if (request.engineRoot && !filesystemPathsEqual(verified.engineRoot, request.engineRoot)) {
            continue;
          }
          if (request.target && verified.editorTarget !== request.target) {
            continue;
          }

          this.bindSelection(verified, 'launch');
          return verified;
        } catch {
          // The launched editor may still be starting up.
        }
      }

      await sleep(1_000);
    }

    throw new Error(
      `launch_editor did not discover a running editor for ${request.projectPath} before the timeout elapsed.`,
    );
  }

  async refreshActiveEditorAfterReconnect(expected?: {
    projectPath?: string;
    engineRoot?: string;
    target?: string;
  }): Promise<EditorInstanceSnapshot | undefined> {
    if (!this.activeEditorSnapshot) {
      return undefined;
    }

    const expectedIdentity: ExpectedEditorIdentity = {
      projectPath: expected?.projectPath ?? this.activeEditorSnapshot.projectFilePath,
      engineRoot: expected?.engineRoot ?? this.activeEditorSnapshot.engineRoot,
      target: expected?.target ?? this.activeEditorSnapshot.editorTarget,
    };

    try {
      const refreshed = await this.fetchProjectContext(
        this.activeEditorSnapshot.remoteControlHost,
        this.activeEditorSnapshot.remoteControlPort,
      );
      this.assertMatchesExpected(refreshed, expectedIdentity);
      this.bindSelection(refreshed, this.selectionSource);
      return refreshed;
    } catch {
      const rebound = await this.rebindFromRegisteredEditors(expectedIdentity);
      if (rebound) {
        return rebound;
      }
    }

    throw new Error(
      `The restarted editor for "${expectedIdentity.projectPath ?? this.activeEditorSnapshot.projectFilePath}" `
      + 'did not reconnect with a matching project/engine identity before the timeout elapsed.',
    );
  }

  getBoundSnapshot(): EditorInstanceSnapshot | undefined {
    return this.activeEditorSnapshot;
  }

  async getWorkspaceProjectPath(): Promise<string | undefined> {
    const resolution = await this.workspaceProjectPromise;
    return resolution.projectPath;
  }

  private async ensureActiveEditor(): Promise<EditorInstanceSnapshot> {
    const validation = await this.validateActiveSelection();
    if (validation.healthy && this.activeEditorSnapshot) {
      return this.activeEditorSnapshot;
    }

    if (this.activeEditorSnapshot) {
      const rebound = await this.rebindFromRegisteredEditors({
        projectPath: this.activeEditorSnapshot.projectFilePath,
        engineRoot: this.activeEditorSnapshot.engineRoot,
        target: this.activeEditorSnapshot.editorTarget,
      });
      if (rebound) {
        return rebound;
      }
    }

    const explicit = await this.bindFromExplicitPins();
    if (explicit) {
      return explicit;
    }

    const autoBound = await this.tryWorkspaceAutoBind();
    if (autoBound) {
      return autoBound;
    }

    throw new Error(buildNoActiveEditorMessage(await this.getWorkspaceProjectPath()));
  }

  private async resolveCurrentEditorForConnection(): Promise<EditorInstanceSnapshot | undefined> {
    if (this.activeEditorSnapshot) {
      const rebound = await this.rebindFromRegisteredEditors({
        projectPath: this.activeEditorSnapshot.projectFilePath,
        engineRoot: this.activeEditorSnapshot.engineRoot,
        target: this.activeEditorSnapshot.editorTarget,
      });
      return rebound ?? this.activeEditorSnapshot;
    }

    const explicit = await this.bindFromExplicitPins();
    if (explicit) {
      return explicit;
    }

    return this.tryWorkspaceAutoBind();
  }

  private async bindFromExplicitPins(): Promise<EditorInstanceSnapshot | undefined> {
    const explicitInstanceId = this.env.UE_EDITOR_INSTANCE_ID;
    if (explicitInstanceId && explicitInstanceId.trim().length > 0) {
      return this.selectEditor({ instanceId: explicitInstanceId.trim() });
    }

    const explicitPort = parseExplicitPort(this.env.UE_REMOTE_CONTROL_PORT);
    if (!explicitPort) {
      return undefined;
    }

    const host = this.env.UE_REMOTE_CONTROL_HOST ?? DEFAULT_HOST;
    const editors = await this.listRunningEditors();
    const byRegistry = editors.find((entry) => (
      entry.remoteControlPort === explicitPort
      && entry.remoteControlHost === host
    ));
    if (byRegistry) {
      const verified = await this.fetchProjectContext(byRegistry.remoteControlHost, byRegistry.remoteControlPort);
      this.bindSelection(verified, 'manual');
      return verified;
    }

    const verified = await this.fetchProjectContext(host, explicitPort);
    this.bindSelection(verified, 'manual');
    return verified;
  }

  private async tryWorkspaceAutoBind(): Promise<EditorInstanceSnapshot | undefined> {
    if (!this.autoBindAllowed) {
      return undefined;
    }

    const workspace = await this.workspaceProjectPromise;
    if (!workspace.projectPath) {
      return undefined;
    }

    if (workspace.ambiguous) {
      throw new Error(
        `Multiple .uproject files were found while resolving the workspace rooted at ${workspace.searchedFrom}. `
        + 'Open the MCP session inside one concrete project directory or use select_editor explicitly.',
      );
    }

    const editors = await this.listRunningEditors();
    const matches = editors.filter((entry) => filesystemPathsEqual(entry.projectFilePath, workspace.projectPath));
    if (matches.length === 0) {
      return undefined;
    }
    if (matches.length > 1) {
      throw new Error(buildAmbiguousWorkspaceMessage(workspace.projectPath, matches));
    }

    const verified = await this.fetchProjectContext(matches[0]!.remoteControlHost, matches[0]!.remoteControlPort);
    this.bindSelection(verified, 'workspace_auto');
    return verified;
  }

  private async rebindFromRegisteredEditors(expected: ExpectedEditorIdentity): Promise<EditorInstanceSnapshot | undefined> {
    const candidates = (await this.listRunningEditors()).filter((entry) => this.matchesExpected(entry, expected));
    if (candidates.length !== 1) {
      return undefined;
    }

    try {
      const verified = await this.fetchProjectContext(
        candidates[0]!.remoteControlHost,
        candidates[0]!.remoteControlPort,
      );
      this.assertMatchesExpected(verified, expected);
      this.bindSelection(verified, this.selectionSource === 'none' ? 'manual' : this.selectionSource);
      return verified;
    } catch {
      return undefined;
    }
  }

  private matchesExpected(snapshot: EditorInstanceSnapshot, expected: ExpectedEditorIdentity): boolean {
    if (expected.projectPath && !filesystemPathsEqual(snapshot.projectFilePath, expected.projectPath)) {
      return false;
    }
    if (expected.engineRoot && snapshot.engineRoot && !filesystemPathsEqual(snapshot.engineRoot, expected.engineRoot)) {
      return false;
    }
    if (expected.target && snapshot.editorTarget && snapshot.editorTarget !== expected.target) {
      return false;
    }
    return true;
  }

  private assertMatchesExpected(snapshot: EditorInstanceSnapshot, expected: ExpectedEditorIdentity): void {
    if (expected.projectPath && !filesystemPathsEqual(snapshot.projectFilePath, expected.projectPath)) {
      throw new Error(
        `The editor that reconnected does not match the expected project "${expected.projectPath}".`,
      );
    }
    if (expected.engineRoot && !filesystemPathsEqual(snapshot.engineRoot, expected.engineRoot)) {
      throw new Error(
        `The editor that reconnected does not match the expected engine_root "${expected.engineRoot}".`,
      );
    }
    if (expected.target && snapshot.editorTarget !== expected.target) {
      throw new Error(
        `The editor that reconnected does not match the expected target "${expected.target}".`,
      );
    }
  }

  private bindSelection(snapshot: EditorInstanceSnapshot, source: EditorSelectionSource): void {
    this.activeEditorSnapshot = snapshot;
    this.selectionSource = source;
    this.validationState = {
      checkedAt: Date.now(),
      healthy: true,
    };
    if (source !== 'workspace_auto') {
      this.autoBindAllowed = false;
    }
    this.emitSelectionChanged();
  }

  private async validateActiveSelection(): Promise<ActiveValidationState> {
    if (!this.activeEditorSnapshot) {
      return { checkedAt: Date.now(), healthy: false };
    }

    if (this.validationState && (Date.now() - this.validationState.checkedAt) < DEFAULT_VALIDATION_TTL_MS) {
      return this.validationState;
    }

    try {
      const refreshed = await this.fetchProjectContext(
        this.activeEditorSnapshot.remoteControlHost,
        this.activeEditorSnapshot.remoteControlPort,
      );
      if (refreshed.instanceId !== this.activeEditorSnapshot.instanceId) {
        const previous = this.activeEditorSnapshot;
        this.activeEditorSnapshot = undefined;
        this.selectionSource = 'none';
        this.validationState = {
          checkedAt: Date.now(),
          healthy: false,
        };
        this.emitSelectionChanged();
        throw new Error(buildActiveEditorDriftMessage(previous));
      }

      this.activeEditorSnapshot = refreshed;
      this.validationState = {
        checkedAt: Date.now(),
        healthy: true,
      };
      return this.validationState;
    } catch (error) {
      if (error instanceof Error && error.message.includes('previously selected active editor')) {
        throw error;
      }

      this.validationState = {
        checkedAt: Date.now(),
        healthy: false,
      };
      return this.validationState;
    }
  }

  private getClient(snapshot: Pick<EditorInstanceSnapshot, 'remoteControlHost' | 'remoteControlPort'>): UEClient {
    const key = `${snapshot.remoteControlHost}:${snapshot.remoteControlPort}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new UEClient({
        host: snapshot.remoteControlHost,
        port: snapshot.remoteControlPort,
        subsystemPath: this.env.UE_BLUEPRINT_EXTRACTOR_SUBSYSTEM_PATH ?? undefined,
      });
      this.clients.set(key, client);
    }
    return client;
  }

  private async fetchProjectContext(host: string, port: number): Promise<EditorInstanceSnapshot> {
    const client = this.getClient({
      remoteControlHost: host,
      remoteControlPort: port,
    });
    const raw = await client.callSubsystem('GetProjectAutomationContext', {});
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      throw new Error(parsed.error);
    }

    const instanceId = typeof parsed.instanceId === 'string' ? parsed.instanceId : undefined;
    const projectFilePath = typeof parsed.projectFilePath === 'string' ? parsed.projectFilePath : undefined;
    if (!instanceId || !projectFilePath) {
      throw new Error('GetProjectAutomationContext did not return instanceId and projectFilePath.');
    }

    return {
      instanceId,
      projectName: typeof parsed.projectName === 'string' ? parsed.projectName : undefined,
      projectFilePath,
      projectDir: typeof parsed.projectDir === 'string' ? parsed.projectDir : undefined,
      engineRoot: typeof parsed.engineRoot === 'string' ? parsed.engineRoot : undefined,
      engineVersion: typeof parsed.engineVersion === 'string' ? parsed.engineVersion : undefined,
      editorTarget: typeof parsed.editorTarget === 'string' ? parsed.editorTarget : undefined,
      processId: typeof parsed.processId === 'number' ? parsed.processId : undefined,
      remoteControlHost: typeof parsed.remoteControlHost === 'string' ? parsed.remoteControlHost : host,
      remoteControlPort: typeof parsed.remoteControlPort === 'number' ? parsed.remoteControlPort : port,
      lastSeenAt: typeof parsed.lastSeenAt === 'string' ? parsed.lastSeenAt : undefined,
    };
  }

  private emitSelectionChanged(): void {
    this.onSelectionChanged?.();
  }
}
