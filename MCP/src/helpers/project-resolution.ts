import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path, { resolve } from 'node:path';
import type { CompileProjectCodeResult } from '../project-controller.js';
import type { ProjectAutomationContext, ResolvedProjectInputs } from '../tool-context.js';
import { buildEngineAssociationCandidates, readProjectEngineAssociation } from './workspace-project.js';

export type ProjectInputsRequest = {
  engine_root?: string;
  project_path?: string;
  target?: string;
};

type GetProjectAutomationContextDeps = {
  forceRefresh?: boolean;
  cachedContext: ProjectAutomationContext | null;
  setCachedContext(value: ProjectAutomationContext | null): void;
  callSubsystemJson(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
};

type ResolveProjectInputsDeps = {
  getProjectAutomationContext(forceRefresh?: boolean): Promise<ProjectAutomationContext>;
  firstDefinedString(...values: Array<unknown>): string | undefined;
  env?: NodeJS.ProcessEnv;
  workspaceProjectPath?: string;
  platform?: NodeJS.Platform;
};

export function rememberExternalBuild(result: CompileProjectCodeResult): Record<string, unknown> {
  return {
    success: result.success === true,
    operation: result.operation,
    strategy: result.strategy,
    engineRoot: result.engineRoot,
    projectPath: result.projectPath,
    target: result.target,
    platform: result.platform,
    configuration: result.configuration,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    restartRequired: result.restartRequired,
    restartReasons: result.restartReasons,
    errorCategory: result.errorCategory,
    errorSummary: result.errorSummary,
    lockedFiles: result.lockedFiles,
  };
}

export async function getProjectAutomationContext(
  deps: GetProjectAutomationContextDeps,
): Promise<ProjectAutomationContext> {
  const {
    forceRefresh = false,
    cachedContext,
    setCachedContext,
    callSubsystemJson,
  } = deps;

  if (!forceRefresh && cachedContext) {
    return cachedContext;
  }

  const parsed = await callSubsystemJson('GetProjectAutomationContext', {});
  const nextContext = parsed as ProjectAutomationContext;
  setCachedContext(nextContext);
  return nextContext;
}

const cachedHeuristicEngineRoots = new Map<NodeJS.Platform, string>();

export function getHeuristicEngineCandidates(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') {
    return [
      'C:/Program Files/Epic Games/UE_5.7',
      'C:/Program Files/Epic Games/UE_5.6',
      'C:/Program Files/Epic Games/UE_5.5',
      'C:/Program Files/Epic Games/UE_5.4',
      'C:/Program Files/Epic Games/UE_5.3',
    ];
  }

  if (platform === 'darwin') {
    return [
      '/Users/Shared/Epic Games/UE_5.7',
      '/Users/Shared/Epic Games/UE_5.6',
      '/Users/Shared/Epic Games/UE_5.5',
      '/Users/Shared/Epic Games/UE_5.4',
      '/Users/Shared/Epic Games/UE_5.3',
      '/Users/Shared/EpicGames/UE_5.7',
      '/Users/Shared/EpicGames/UE_5.6',
      '/Users/Shared/EpicGames/UE_5.5',
      '/Users/Shared/EpicGames/UE_5.4',
      '/Users/Shared/EpicGames/UE_5.3',
    ];
  }

  return [];
}

export const HEURISTIC_ENGINE_CANDIDATES = getHeuristicEngineCandidates();

function getEngineMarkers(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return ['Engine/Build/BatchFiles/Build.bat'];
  }

  if (platform === 'darwin') {
    return [
      'Engine/Build/BatchFiles/Mac/Build.sh',
      'Engine/Build/BatchFiles/Build.sh',
    ];
  }

  return [
    'Engine/Build/BatchFiles/Linux/Build.sh',
    'Engine/Build/BatchFiles/Build.sh',
  ];
}

async function accessFirstMatchingMarker(root: string, markers: string[]): Promise<boolean> {
  for (const marker of markers) {
    try {
      await access(resolve(root, marker), fsConstants.F_OK);
      return true;
    } catch {
      // try the next marker
    }
  }

  return false;
}

async function probeEngineRootHeuristic(platform: NodeJS.Platform): Promise<string | undefined> {
  if (cachedHeuristicEngineRoots.has(platform)) {
    return cachedHeuristicEngineRoots.get(platform) || undefined;
  }

  for (const candidate of getHeuristicEngineCandidates(platform)) {
    if (await accessFirstMatchingMarker(candidate, getEngineMarkers(platform))) {
      cachedHeuristicEngineRoots.set(platform, candidate);
      return candidate;
    }
  }

  cachedHeuristicEngineRoots.set(platform, '');
  return undefined;
}

async function probePreferredEngineRoot(candidates: string[], platform: NodeJS.Platform): Promise<string | undefined> {
  const markers = getEngineMarkers(platform);
  for (const candidate of candidates) {
    if (await accessFirstMatchingMarker(candidate, markers)) {
      return candidate;
    }
  }

  return undefined;
}

export async function resolveProjectInputs(
  request: ProjectInputsRequest,
  deps: ResolveProjectInputsDeps,
): Promise<ResolvedProjectInputs> {
  const {
    getProjectAutomationContext,
    firstDefinedString,
    env = process.env,
    workspaceProjectPath,
    platform = process.platform,
  } = deps;

  let context: ProjectAutomationContext | null = null;
  let contextError: string | undefined;

  if (!request.engine_root || !request.project_path || !request.target) {
    try {
      context = await getProjectAutomationContext();
    } catch (error) {
      contextError = error instanceof Error ? error.message : String(error);
    }
  }

  const engineRootFromContext = firstDefinedString(context?.engineRoot);
  const projectPathFromContext = firstDefinedString(context?.projectFilePath);
  const targetFromContext = firstDefinedString(context?.editorTarget);
  const projectPathFromWorkspace = firstDefinedString(workspaceProjectPath);
  const targetFromWorkspace = projectPathFromWorkspace
    ? `${path.basename(projectPathFromWorkspace, '.uproject')}Editor`
    : undefined;
  const engineRootFromEnv = firstDefinedString(env.UE_ENGINE_ROOT);
  const projectPathFromEnv = firstDefinedString(env.UE_PROJECT_PATH);
  const targetFromEnv = firstDefinedString(env.UE_PROJECT_TARGET, env.UE_EDITOR_TARGET);
  const projectPath = firstDefinedString(request.project_path, projectPathFromContext, projectPathFromWorkspace, projectPathFromEnv);
  const target = firstDefinedString(request.target, targetFromContext, targetFromWorkspace, targetFromEnv);
  const engineAssociation = projectPath ? await readProjectEngineAssociation(projectPath) : undefined;
  const associationCandidates = buildEngineAssociationCandidates(engineAssociation, platform);

  let engineRoot = firstDefinedString(request.engine_root, engineRootFromContext, engineRootFromEnv);
  let engineRootSource: 'explicit' | 'editor_context' | 'environment' | 'filesystem_heuristic' | 'missing';

  if (request.engine_root) {
    engineRootSource = 'explicit';
  } else if (engineRootFromContext) {
    engineRootSource = 'editor_context';
  } else if (engineRootFromEnv) {
    engineRootSource = 'environment';
  } else {
    const preferredCandidate = await probePreferredEngineRoot(associationCandidates, platform);
    const heuristicRoot = preferredCandidate ?? await probeEngineRootHeuristic(platform);
    if (heuristicRoot) {
      engineRoot = heuristicRoot;
      engineRootSource = 'filesystem_heuristic';
    } else {
      engineRootSource = 'missing';
    }
  }

  return {
    engineRoot,
    projectPath,
    target,
    context,
    contextError,
    sources: {
      engineRoot: engineRootSource,
      projectPath: request.project_path ? 'explicit' : projectPathFromContext ? 'editor_context' : projectPathFromWorkspace ? 'workspace' : projectPathFromEnv ? 'environment' : 'missing',
      target: request.target ? 'explicit' : targetFromContext ? 'editor_context' : targetFromWorkspace ? 'workspace' : targetFromEnv ? 'environment' : 'missing',
    },
  };
}
