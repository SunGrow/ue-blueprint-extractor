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

  const engineRoot = firstDefinedString(request.engine_root, engineRootFromContext, engineRootFromEnv);
  const projectPath = firstDefinedString(request.project_path, projectPathFromContext, projectPathFromEnv);
  const target = firstDefinedString(request.target, targetFromContext, targetFromEnv);

  return {
    engineRoot,
    projectPath,
    target,
    context,
    contextError,
    sources: {
      engineRoot: request.engine_root ? 'explicit' : engineRootFromContext ? 'editor_context' : engineRootFromEnv ? 'environment' : 'missing',
      projectPath: request.project_path ? 'explicit' : projectPathFromContext ? 'editor_context' : projectPathFromEnv ? 'environment' : 'missing',
      target: request.target ? 'explicit' : targetFromContext ? 'editor_context' : targetFromEnv ? 'environment' : 'missing',
    },
  };
}
