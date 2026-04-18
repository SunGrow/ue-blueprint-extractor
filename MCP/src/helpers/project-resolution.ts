import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path, { posix as posixPath, win32 as win32Path } from 'node:path';
import type { CompileProjectCodeResult } from '../project-controller.js';
import type { ProjectAutomationContext, ResolvedProjectInputs } from '../tool-context.js';
import {
  buildEngineAssociationCandidates,
  filesystemPathsEqual,
  isWindowsStylePath,
  isWslMountedWindowsPath,
  readProjectEngineAssociation,
  toHostFilesystemPath,
  toWindowsStylePath,
} from './workspace-project.js';

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

const cachedHeuristicEngineRoots = new Map<string, string>();

function getPathModule(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32Path : posixPath;
}

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

async function accessFirstMatchingMarker(
  root: string,
  markers: string[],
  targetPlatform: NodeJS.Platform,
  hostPlatform: NodeJS.Platform,
): Promise<boolean> {
  const pathModule = getPathModule(targetPlatform);
  const normalizedRoot = targetPlatform === 'win32' ? toWindowsStylePath(root) : root;
  for (const marker of markers) {
    try {
      const candidate = pathModule.resolve(normalizedRoot, marker);
      await access(toHostFilesystemPath(candidate, targetPlatform, hostPlatform), fsConstants.F_OK);
      return true;
    } catch {
      // try the next marker
    }
  }

  return false;
}

async function probeEngineRootHeuristic(
  targetPlatform: NodeJS.Platform,
  hostPlatform: NodeJS.Platform,
): Promise<string | undefined> {
  const cacheKey = `${hostPlatform}:${targetPlatform}`;
  if (cachedHeuristicEngineRoots.has(cacheKey)) {
    return cachedHeuristicEngineRoots.get(cacheKey) || undefined;
  }

  for (const candidate of getHeuristicEngineCandidates(targetPlatform)) {
    if (await accessFirstMatchingMarker(candidate, getEngineMarkers(targetPlatform), targetPlatform, hostPlatform)) {
      cachedHeuristicEngineRoots.set(cacheKey, candidate);
      return candidate;
    }
  }

  cachedHeuristicEngineRoots.set(cacheKey, '');
  return undefined;
}

async function probePreferredEngineRoot(
  candidates: Array<{ path: string; platform: NodeJS.Platform }>,
  hostPlatform: NodeJS.Platform,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await accessFirstMatchingMarker(candidate.path, getEngineMarkers(candidate.platform), candidate.platform, hostPlatform)) {
      return candidate.path;
    }
  }

  return undefined;
}

function hasConcreteAssociationCandidate(
  candidates: Array<{ path: string; platform: NodeJS.Platform }>,
): boolean {
  return candidates.some((candidate) => (
    isWindowsStylePath(candidate.path)
    || isWslMountedWindowsPath(candidate.path)
    || candidate.path.startsWith('/')
  ));
}

function matchesAssociationCandidate(
  engineRoot: string | undefined,
  candidates: Array<{ path: string; platform: NodeJS.Platform }>,
): boolean {
  if (!engineRoot) {
    return false;
  }

  return candidates.some((candidate) => filesystemPathsEqual(engineRoot, candidate.path));
}

function buildEngineRootConflict(
  engineAssociation: string | undefined,
  candidates: Array<{ path: string; platform: NodeJS.Platform }>,
  implicitRoots: Array<{ source: 'editor_context' | 'environment'; path: string }>,
): string | undefined {
  if (!engineAssociation || implicitRoots.length === 0) {
    return undefined;
  }

  const roots = implicitRoots.map(({ source, path }) => `${source}:${path}`).join(', ');
  const concreteCandidates = candidates
    .map((candidate) => candidate.path)
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .filter((candidate) => (
      isWindowsStylePath(candidate)
      || isWslMountedWindowsPath(candidate)
      || candidate.startsWith('/')
    ));

  return concreteCandidates.length > 0
    ? `project EngineAssociation "${engineAssociation}" conflicts with implicit engine roots (${roots}); expected one of ${concreteCandidates.join(' | ')}`
    : `project EngineAssociation "${engineAssociation}" conflicts with implicit engine roots (${roots})`;
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
  const windowsWorkspaceHint = [request.engine_root, request.project_path, projectPathFromWorkspace, projectPathFromEnv]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some((value) => isWindowsStylePath(value) || isWslMountedWindowsPath(value));
  const heuristicPlatforms: NodeJS.Platform[] = windowsWorkspaceHint && platform !== 'win32'
    ? ['win32', platform]
    : [platform];
  const associationCandidates = heuristicPlatforms.flatMap((candidatePlatform) => (
    buildEngineAssociationCandidates(engineAssociation, candidatePlatform).map((candidate) => ({
      path: candidate,
      platform: candidatePlatform,
    }))
  ));
  const associationIsConcrete = hasConcreteAssociationCandidate(associationCandidates);
  const matchingContextEngineRoot = associationIsConcrete && matchesAssociationCandidate(engineRootFromContext, associationCandidates)
    ? engineRootFromContext
    : undefined;
  const matchingEnvEngineRoot = associationIsConcrete && matchesAssociationCandidate(engineRootFromEnv, associationCandidates)
    ? engineRootFromEnv
    : undefined;
  const conflictingImplicitRoots = associationIsConcrete
    ? [
      ...(engineRootFromContext && !matchingContextEngineRoot ? [{ source: 'editor_context' as const, path: engineRootFromContext }] : []),
      ...(engineRootFromEnv && !matchingEnvEngineRoot ? [{ source: 'environment' as const, path: engineRootFromEnv }] : []),
    ]
    : [];

  let engineRoot = firstDefinedString(request.engine_root, engineRootFromContext, engineRootFromEnv);
  let engineRootSource: 'explicit' | 'editor_context' | 'environment' | 'project_association' | 'filesystem_heuristic' | 'missing';
  let engineRootConflict: string | undefined;

  if (request.engine_root) {
    engineRootSource = 'explicit';
  } else if (associationIsConcrete) {
    const preferredCandidate = await probePreferredEngineRoot(associationCandidates, platform);
    if (matchingContextEngineRoot) {
      engineRoot = matchingContextEngineRoot;
      engineRootSource = 'editor_context';
    } else if (matchingEnvEngineRoot) {
      engineRoot = matchingEnvEngineRoot;
      engineRootSource = 'environment';
    } else if (preferredCandidate) {
      engineRoot = preferredCandidate;
      engineRootSource = 'project_association';
    } else {
      engineRoot = undefined;
      engineRootSource = 'missing';
      engineRootConflict = buildEngineRootConflict(engineAssociation, associationCandidates, conflictingImplicitRoots);
    }
  } else if (engineRootFromContext) {
    engineRootSource = 'editor_context';
  } else if (engineRootFromEnv) {
    engineRootSource = 'environment';
  } else {
    let heuristicRoot: string | undefined;
    if (!heuristicRoot) {
      for (const candidatePlatform of heuristicPlatforms) {
        heuristicRoot = await probeEngineRootHeuristic(candidatePlatform, platform);
        if (heuristicRoot) {
          break;
        }
      }
    }
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
    projectEngineAssociation: engineAssociation,
    engineRootConflict,
    sources: {
      engineRoot: engineRootSource,
      projectPath: request.project_path ? 'explicit' : projectPathFromContext ? 'editor_context' : projectPathFromWorkspace ? 'workspace' : projectPathFromEnv ? 'environment' : 'missing',
      target: request.target ? 'explicit' : targetFromContext ? 'editor_context' : targetFromWorkspace ? 'workspace' : targetFromEnv ? 'environment' : 'missing',
    },
  };
}
