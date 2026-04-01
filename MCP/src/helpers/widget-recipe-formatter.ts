// ---------------------------------------------------------------------------
// Widget Recipe Formatter
//
// Converts extraction data back to the markdown recipe format that
// parseWidgetRecipe can parse (round-trip compatibility).
// ---------------------------------------------------------------------------

export interface RecipeFormatOptions {
  includeClassDefaults?: boolean;
  afterSteps?: string[];
}

// Fields that are structural (not user properties) and should be excluded
// from the DSL {properties} block.
const STRUCTURAL_FIELDS = new Set([
  'class',
  'Class',
  'name',
  'Name',
  'children',
  'Children',
  'slot',
  'Slot',
  'is_variable',
  'bIsVariable',
  'displayLabel',
  'visibility',
  'Visibility',
  'properties',
]);

export function formatAsRecipe(
  assetPath: string,
  extraction: Record<string, unknown>,
  options?: RecipeFormatOptions,
): string {
  const lines: string[] = [];

  // # Recipe: <asset name>
  const assetName = assetPath.split('/').pop() ?? assetPath;
  lines.push(`# Recipe: ${assetName}`);
  lines.push('');

  // ## Asset
  lines.push('## Asset');
  lines.push(`path: ${assetPath}`);
  const parentClass = extraction.parentClass ?? extraction.parent_class;
  if (parentClass && parentClass !== 'UserWidget') {
    lines.push(`parent: ${parentClass}`);
  }
  lines.push('');

  // ## Widget Tree (convert to DSL format)
  const tree = extraction.rootWidget ?? extraction.widgetTree ?? extraction.tree;
  if (tree && typeof tree === 'object') {
    lines.push('## Widget Tree');
    lines.push(widgetNodeToDsl(tree as Record<string, unknown>, 0));
    lines.push('');
  }

  // ## Class Defaults (if requested and present)
  if (options?.includeClassDefaults) {
    const defaults = extraction.classDefaults ?? extraction.class_defaults;
    if (defaults && typeof defaults === 'object') {
      const entries = Object.entries(defaults as Record<string, unknown>);
      if (entries.length > 0) {
        lines.push('## Class Defaults');
        for (const [key, value] of entries) {
          lines.push(`${key}: ${formatValue(value)}`);
        }
        lines.push('');
      }
    }
  }

  // ## After
  const steps = options?.afterSteps ?? ['compile', 'save'];
  lines.push('## After');
  lines.push(steps.join(', '));

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Widget node -> DSL text
// ---------------------------------------------------------------------------

function widgetNodeToDsl(node: Record<string, unknown>, depth: number): string {
  const indent = '  '.repeat(depth);
  const parts: string[] = [];

  // Class name
  parts.push(String(node.class ?? node.Class ?? 'Unknown'));

  // Instance name (quoted)
  const name = node.name ?? node.Name;
  if (name) parts.push(`"${name}"`);

  // Properties block
  const props = extractProperties(node);
  if (props && Object.keys(props).length > 0) {
    parts.push(`{${formatPropertiesInline(props)}}`);
  }

  // Attributes
  const attrs: string[] = [];
  if (node.is_variable || node.bIsVariable) attrs.push('var');
  if (attrs.length > 0) parts.push(`[${attrs.join(', ')}]`);

  const line = indent + parts.join(' ');
  const childLines: string[] = [line];

  // Recurse into children
  const children = node.children ?? node.Children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object') {
        childLines.push(widgetNodeToDsl(child as Record<string, unknown>, depth + 1));
      }
    }
  }

  return childLines.join('\n');
}

// ---------------------------------------------------------------------------
// Extract meaningful properties from a widget node
// ---------------------------------------------------------------------------

function extractProperties(node: Record<string, unknown>): Record<string, unknown> | undefined {
  // The extraction format typically has a `properties` sub-object with widget
  // property values. If present, use it directly.
  const propsObj = node.properties;
  if (propsObj && typeof propsObj === 'object' && !Array.isArray(propsObj)) {
    const entries = Object.entries(propsObj as Record<string, unknown>);
    if (entries.length > 0) {
      return propsObj as Record<string, unknown>;
    }
  }

  // Fallback: collect non-structural fields from the node itself
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRUCTURAL_FIELDS.has(key)) continue;
    if (value === undefined || value === null) continue;
    result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Format properties as inline Key: Value pairs
// ---------------------------------------------------------------------------

function formatPropertiesInline(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    parts.push(`${key}: ${formatDslValue(value)}`);
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Format a value for DSL property blocks
// ---------------------------------------------------------------------------

function formatDslValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Format a value for Class Defaults section (key: value lines)
// ---------------------------------------------------------------------------

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
