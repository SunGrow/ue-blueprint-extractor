import type { ResolvedProjectInputs } from '../tool-context.js';

type ConnectionProbeCapable = {
  checkConnection?: (() => Promise<boolean>) | undefined;
};

export function supportsConnectionProbe(activeClient: ConnectionProbeCapable): (() => Promise<boolean>) | null {
  if (typeof activeClient.checkConnection === 'function') {
    return activeClient.checkConnection.bind(activeClient);
  }

  return null;
}

export function buildProjectResolutionDiagnostics(resolved: ResolvedProjectInputs): string[] {
  const diagnostics = [
    `engine_root=${resolved.sources.engineRoot}`,
    `project_path=${resolved.sources.projectPath}`,
    `target=${resolved.sources.target}`,
  ];

  if (resolved.contextError) {
    diagnostics.push(`editor_context_error=${resolved.contextError}`);
  }

  return diagnostics;
}

export function explainProjectResolutionFailure(prefix: string, resolved: ResolvedProjectInputs): Error {
  return new Error(`${prefix}; attempted explicit args -> editor context -> environment (${buildProjectResolutionDiagnostics(resolved).join(', ')})`);
}
