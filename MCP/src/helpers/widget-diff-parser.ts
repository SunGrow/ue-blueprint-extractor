import { parseWidgetDsl } from './widget-dsl-parser.js';
import type { ParsedWidgetNode } from './widget-dsl-parser.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WidgetDiffOperation {
  type: 'remove' | 'insert' | 'patch' | 'replace';
  /** Widget being operated on (name or path) */
  target: string;
  /** Parent widget for insert operations */
  parent?: string;
  /** Index within parent for insert operations */
  index?: number;
  /** New widget node for insert/replace operations */
  node?: Record<string, unknown>;
  /** Property patches for patch operations */
  properties?: Record<string, unknown>;
  /** Slot changes for patch operations */
  slot?: Record<string, unknown>;
  /** Variable flag change for patch operations */
  is_variable?: boolean;
}

export interface WidgetDiffResult {
  operations: WidgetDiffOperation[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseWidgetDiff(diff: string): WidgetDiffResult {
  const warnings: string[] = [];
  const operations: WidgetDiffOperation[] = [];

  if (!diff || diff.trim().length === 0) {
    return { operations, warnings };
  }

  const lines = diff.split(/\r?\n/);

  // Classify each line and strip prefix to recover original DSL
  const beforeLines: string[] = [];
  const afterLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip completely empty lines — pass to both sides to maintain blank-line structure
    if (line.trim().length === 0) {
      beforeLines.push('');
      afterLines.push('');
      continue;
    }

    const firstChar = line[0];

    if (firstChar === '-') {
      // Removal line — replace the `-` prefix with a space to preserve indentation depth.
      // The prefix occupies one column of the original indentation.
      const restored = ' ' + line.slice(1);
      beforeLines.push(restored);
    } else if (firstChar === '+') {
      // Addition line — replace the `+` prefix with a space to preserve indentation depth.
      const restored = ' ' + line.slice(1);
      afterLines.push(restored);
    } else {
      // Context line (no prefix, or any other character including space) — goes into both as-is.
      // We do NOT strip a leading space because DSL lines use indentation that starts with spaces,
      // and stripping would corrupt the indent structure.
      beforeLines.push(line);
      afterLines.push(line);
    }
  }

  // Parse both DSL trees
  const beforeDsl = beforeLines.join('\n');
  const afterDsl = afterLines.join('\n');

  const beforeResult = parseWidgetDsl(beforeDsl);
  const afterResult = parseWidgetDsl(afterDsl);

  // Forward parse warnings
  for (const w of beforeResult.warnings) {
    warnings.push(`before: ${w}`);
  }
  for (const w of afterResult.warnings) {
    warnings.push(`after: ${w}`);
  }

  // Diff the two trees
  diffChildren(beforeResult.nodes, afterResult.nodes, '', operations, warnings);

  // Sort operations: removals first, then patches, then insertions
  const order: Record<WidgetDiffOperation['type'], number> = {
    remove: 0,
    patch: 1,
    replace: 2,
    insert: 3,
  };
  operations.sort((a, b) => order[a.type] - order[b.type]);

  return { operations, warnings };
}

// ---------------------------------------------------------------------------
// Tree diffing
// ---------------------------------------------------------------------------

function diffChildren(
  beforeChildren: ParsedWidgetNode[],
  afterChildren: ParsedWidgetNode[],
  parentName: string,
  ops: WidgetDiffOperation[],
  warnings: string[],
): void {
  // Build name->node maps for both sides
  const beforeMap = new Map<string, ParsedWidgetNode>();
  for (const child of beforeChildren) {
    if (beforeMap.has(child.name)) {
      warnings.push(`Duplicate widget name in before tree: "${child.name}"`);
    }
    beforeMap.set(child.name, child);
  }

  const afterMap = new Map<string, ParsedWidgetNode>();
  for (const child of afterChildren) {
    if (afterMap.has(child.name)) {
      warnings.push(`Duplicate widget name in after tree: "${child.name}"`);
    }
    afterMap.set(child.name, child);
  }

  // Removals: in before but not in after
  for (const [name] of beforeMap) {
    if (!afterMap.has(name)) {
      ops.push({ type: 'remove', target: name });
    }
  }

  // Additions and patches: walk after list for ordering
  for (let i = 0; i < afterChildren.length; i++) {
    const afterNode = afterChildren[i];
    const beforeNode = beforeMap.get(afterNode.name);

    if (!beforeNode) {
      // New node — insert at this index
      ops.push({
        type: 'insert',
        target: afterNode.name,
        parent: parentName,
        index: i,
        node: nodeToRecord(afterNode),
      });
    } else {
      // Existing node — check for property/slot/variable changes
      const propDiff = diffProperties(beforeNode.properties, afterNode.properties);
      const slotDiff = diffProperties(beforeNode.slot, afterNode.slot);
      const varChanged = (beforeNode.is_variable ?? false) !== (afterNode.is_variable ?? false);

      if (propDiff || slotDiff || varChanged) {
        ops.push({
          type: 'patch',
          target: afterNode.name,
          ...(propDiff ? { properties: propDiff } : {}),
          ...(slotDiff ? { slot: slotDiff } : {}),
          ...(varChanged ? { is_variable: afterNode.is_variable ?? false } : {}),
        });
      }

      // Recurse into children
      diffChildren(
        beforeNode.children ?? [],
        afterNode.children ?? [],
        afterNode.name,
        ops,
        warnings,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Property diffing — produces only changed/added keys from the "after" side
// ---------------------------------------------------------------------------

function diffProperties(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  // No properties on either side — no diff
  if (!before && !after) return null;

  // Properties added from nothing
  if (!before && after) return { ...after };

  // Properties removed entirely — not tracked (additive-only)
  if (before && !after) return null;

  // Both present — compare key by key
  const result: Record<string, unknown> = {};
  let hasChanges = false;

  for (const [key, afterVal] of Object.entries(after!)) {
    const beforeVal = before![key];

    if (!deepEqual(beforeVal, afterVal)) {
      result[key] = afterVal;
      hasChanges = true;
    }
  }

  return hasChanges ? result : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeToRecord(node: ParsedWidgetNode): Record<string, unknown> {
  const result: Record<string, unknown> = {
    class: node.class,
    name: node.name,
  };
  if (node.is_variable) result.is_variable = true;
  if (node.slot && Object.keys(node.slot).length > 0) result.slot = node.slot;
  if (node.properties && Object.keys(node.properties).length > 0) result.properties = node.properties;
  if (node.children && node.children.length > 0) {
    result.children = node.children.map(nodeToRecord);
  }
  return result;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a)) {
      const bArr = b as unknown[];
      if (a.length !== bArr.length) return false;
      return a.every((val, idx) => deepEqual(val, bArr[idx]));
    }

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
