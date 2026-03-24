export function canFallbackFromLiveCoding(result: Record<string, unknown>): boolean {
  const status = typeof result.status === 'string' ? result.status.toLowerCase() : '';
  const compileResult = typeof result.compileResult === 'string' ? result.compileResult.toLowerCase() : '';
  const reason = typeof result.reason === 'string' ? result.reason.toLowerCase() : '';

  return (
    status === 'unsupported'
    || status === 'unavailable'
    || compileResult === 'unsupported'
    || compileResult === 'unavailable'
    || compileResult === 'nochanges'
    || reason === 'unsupported'
    || reason === 'unavailable'
    || result.fallbackRecommended === true
    || result.noOp === true
  );
}

export function deriveLiveCodingFallbackReason(result: Record<string, unknown>): string | undefined {
  const status = typeof result.status === 'string' ? result.status.toLowerCase() : '';
  const compileResult = typeof result.compileResult === 'string' ? result.compileResult.toLowerCase() : '';
  const existingReason = typeof result.reason === 'string' ? result.reason : undefined;

  if (compileResult === 'nochanges' || result.noOp === true) {
    return 'live_coding_reported_nochanges';
  }
  if (status === 'unsupported' || compileResult === 'unsupported') {
    return 'live_coding_unsupported';
  }
  if (status === 'unavailable' || compileResult === 'unavailable') {
    return 'live_coding_unavailable';
  }

  return existingReason;
}

export function enrichLiveCodingResult(
  result: Record<string, unknown>,
  changedPaths: string[] = [],
  lastExternalBuildContext?: Record<string, unknown> | null,
): Record<string, unknown> {
  const headerChanges = changedPaths.filter(
    (path) => /\.(h|hpp|inl)$/i.test(path.replace(/\\/g, '/')),
  );
  const warnings = Array.isArray(result.warnings)
    ? [...result.warnings.filter((value): value is string => typeof value === 'string')]
    : [];
  if (headerChanges.length > 0) {
    warnings.push(
      'Live Coding cannot add, remove, or reorder UPROPERTYs or change class layouts. '
      + 'Use compile_project_code + restart_editor for class layout changes.',
    );
  }

  const fallbackRecommended = canFallbackFromLiveCoding(result);
  const reason = deriveLiveCodingFallbackReason(result);

  return {
    ...result,
    fallbackRecommended,
    ...(reason ? { reason } : {}),
    ...(fallbackRecommended && lastExternalBuildContext ? { lastExternalBuild: lastExternalBuildContext } : {}),
    changedPathsAccepted: changedPaths,
    changedPathsAppliedByEditor: false,
    headerChangesDetected: headerChanges,
    warnings,
  };
}
