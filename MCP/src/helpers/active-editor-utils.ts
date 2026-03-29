import type { ActiveEditorSession } from '../active-editor-session.js';
import { filesystemPathsEqual } from './workspace-project.js';

type ProjectInputsRequest = {
  engine_root?: string;
  project_path?: string;
  target?: string;
};

export async function assertRequestMatchesActiveEditor(
  activeEditorSession: ActiveEditorSession | null | undefined,
  request: ProjectInputsRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!activeEditorSession) {
    return;
  }

  const active = activeEditorSession.getBoundSnapshot();
  if (!active) {
    return;
  }

  const conflicts: string[] = [];
  const explicitProjectPath = request.project_path ?? env.UE_PROJECT_PATH;
  const explicitEngineRoot = request.engine_root ?? env.UE_ENGINE_ROOT;
  const explicitTarget = request.target ?? env.UE_PROJECT_TARGET ?? env.UE_EDITOR_TARGET;

  if (explicitProjectPath && !filesystemPathsEqual(explicitProjectPath, active.projectFilePath)) {
    conflicts.push(`project_path=${explicitProjectPath}`);
  }
  if (explicitEngineRoot && active.engineRoot && !filesystemPathsEqual(explicitEngineRoot, active.engineRoot)) {
    conflicts.push(`engine_root=${explicitEngineRoot}`);
  }
  if (explicitTarget && active.editorTarget && explicitTarget !== active.editorTarget) {
    conflicts.push(`target=${explicitTarget}`);
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Active editor mismatch. The current session is bound to ${active.projectFilePath}`
      + ` (${active.engineRoot ?? 'unknown engine'}, ${active.editorTarget ?? 'unknown target'})`
      + ` but the request resolved conflicting inputs: ${conflicts.join(', ')}. `
      + 'Call clear_editor_selection or select_editor before retrying.',
    );
  }
}
