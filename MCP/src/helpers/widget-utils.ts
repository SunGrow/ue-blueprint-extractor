export function buildGeneratedBlueprintClassPath(assetPathOrObjectPath: string): string {
  const trimmed = assetPathOrObjectPath.trim();
  if (trimmed.endsWith('_C')) {
    return trimmed;
  }

  const objectPath = trimmed.includes('.')
    ? trimmed
    : `${trimmed}.${trimmed.split('/').pop() ?? ''}`;
  return `${objectPath}_C`;
}

export function getWidgetIdentifier(widgetName?: string, widgetPath?: string): string | null {
  return widgetPath ?? widgetName ?? null;
}
