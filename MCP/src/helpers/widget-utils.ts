import { expandDottedProperties } from './property-shorthand.js';
import { resolveSlotPreset } from './slot-presets.js';
import { resolveWidgetClassAlias } from './widget-class-aliases.js';

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

/**
 * Recursively preprocess a widget node tree, applying:
 * 1. Widget class alias resolution (`class` field)
 * 2. Slot preset resolution (`slot` field)
 * 3. Dotted property expansion (`properties` field)
 * 4. Recurse into `children`
 *
 * Returns a new object; the original is not mutated.
 */
export function preprocessWidgetNode(node: Record<string, unknown>): Record<string, unknown> {
  const result = { ...node };

  // 1. Resolve class alias
  if (typeof result.class === 'string') {
    result.class = resolveWidgetClassAlias(result.class);
  }

  // 2. Resolve slot preset
  if (result.slot !== undefined) {
    result.slot = resolveSlotPreset(result.slot);
  }

  // 3. Expand dotted properties
  if (result.properties !== null && typeof result.properties === 'object' && !Array.isArray(result.properties)) {
    result.properties = expandDottedProperties(result.properties as Record<string, unknown>);
  }

  // 4. Recurse into children
  if (Array.isArray(result.children)) {
    result.children = (result.children as unknown[]).map((child) => {
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        return preprocessWidgetNode(child as Record<string, unknown>);
      }
      return child;
    });
  }

  return result;
}

/**
 * Truncate a widget tree at the given depth.
 * depth=1 keeps only the root, depth=2 keeps root + direct children, etc.
 */
export function limitWidgetTreeDepth(data: Record<string, unknown>, maxDepth: number): void {
  const root = (data.rootWidget ?? data.widgetTree ?? data.tree) as Record<string, unknown> | undefined;
  if (root && typeof root === 'object') {
    truncateNode(root, 1, maxDepth);
    return;
  }

  // If no recognized tree key, treat data itself as a potential widget node
  if (Array.isArray(data.children)) {
    truncateNode(data, 1, maxDepth);
  }
}

function truncateNode(node: Record<string, unknown>, currentDepth: number, maxDepth: number): void {
  const children = node.children;
  if (!Array.isArray(children)) return;

  if (currentDepth >= maxDepth) {
    const count = children.length;
    if (count === 0) return;
    (node as Record<string, unknown>).children = { _truncated: true, childCount: count };
    return;
  }

  for (const child of children) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      truncateNode(child as Record<string, unknown>, currentDepth + 1, maxDepth);
    }
  }
}
