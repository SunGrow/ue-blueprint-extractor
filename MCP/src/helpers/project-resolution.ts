import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve } from 'node:path';
import type { CompileProjectCodeResult } from '../project-controller.js';
import type { ProjectAutomationContext, ResolvedProjectInputs } from '../tool-context.js';

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

let cachedHeuristicEngineRoot: string | undefined;

const HEURISTIC_ENGINE_CANDIDATES = [
  'C:/Program Files/Epic Games/UE_5.6',
  'C:/Program Files/Epic Games/UE_5.5',
  'C:/Program Files/Epic Games/UE_5.4',
  'C:/Program Files/Epic Games/UE_5.3',
];

const ENGINE_MARKER = 'Engine/Build/BatchFiles/Build.bat';

async function probeEngineRootHeuristic(): Promise<string | undefined> {
  if (cachedHeuristicEngineRoot !== undefined) {
    return cachedHeuristicEngineRoot || undefined;
  }

  for (const candidate of HEURISTIC_ENGINE_CANDIDATES) {
    try {
      await access(resolve(candidate, ENGINE_MARKER), fsConstants.F_OK);
      cachedHeuristicEngineRoot = candidate;
      return candidate;
    } catch {
      // not found, try next
    }
  }

  cachedHeuristicEngineRoot = '';
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
  const engineRootFromEnv = firstDefinedString(env.UE_ENGINE_ROOT);
  const projectPathFromEnv = firstDefinedString(env.UE_PROJECT_PATH);
  const targetFromEnv = firstDefinedString(env.UE_PROJECT_TARGET, env.UE_EDITOR_TARGET);

  let engineRoot = firstDefinedString(request.engine_root, engineRootFromContext, engineRootFromEnv);
  let engineRootSource: 'explicit' | 'editor_context' | 'environment' | 'filesystem_heuristic' | 'missing';

  if (request.engine_root) {
    engineRootSource = 'explicit';
  } else if (engineRootFromContext) {
    engineRootSource = 'editor_context';
  } else if (engineRootFromEnv) {
    engineRootSource = 'environment';
  } else {
    // Filesystem heuristic: probe common UE installation paths
    const heuristicRoot = await probeEngineRootHeuristic();
    if (heuristicRoot) {
      engineRoot = heuristicRoot;
      engineRootSource = 'filesystem_heuristic';
    } else {
      engineRootSource = 'missing';
    }
  }

  const projectPath = firstDefinedString(request.project_path, projectPathFromContext, projectPathFromEnv);
  const target = firstDefinedString(request.target, targetFromContext, targetFromEnv);

  return {
    engineRoot,
    projectPath,
    target,
    context,
    contextError,
    sources: {
      engineRoot: engineRootSource,
      projectPath: request.project_path ? 'explicit' : projectPathFromContext ? 'editor_context' : projectPathFromEnv ? 'environment' : 'missing',
      target: request.target ? 'explicit' : targetFromContext ? 'editor_context' : targetFromEnv ? 'environment' : 'missing',
    },
  };
}
