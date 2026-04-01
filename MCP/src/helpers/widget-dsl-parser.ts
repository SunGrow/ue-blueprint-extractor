import { preprocessWidgetNode } from './widget-utils.js';
import { resolveSlotPreset } from './slot-presets.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedWidgetNode {
  class: string;
  name: string;
  is_variable?: boolean;
  slot?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  children?: ParsedWidgetNode[];
}

export interface DslParseResult {
  nodes: ParsedWidgetNode[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface StackEntry {
  node: ParsedWidgetNode;
  indent: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseWidgetDsl(dsl: string): DslParseResult {
  const warnings: string[] = [];
  const rawLines = dsl.split(/\r?\n/);
  const roots: ParsedWidgetNode[] = [];
  const stack: StackEntry[] = [];
  let autoNameCounter = 0;

  const genName = (className: string) => `${className}_${autoNameCounter++}`;

  let indentUnit = -1; // detected from first indented line

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    const raw = rawLines[lineIdx];
    const trimmed = raw.trimEnd();

    // skip blank lines and comments
    if (trimmed.length === 0 || trimmed.trimStart().startsWith('#')) continue;

    // normalize tabs to 2 spaces for consistent indentation handling
    const normalized = trimmed.replace(/\t/g, '  ');

    // measure leading whitespace
    const stripped = normalized.trimStart();
    const leadingSpaces = normalized.length - stripped.length;

    // detect indent unit from first indented line
    if (leadingSpaces > 0 && indentUnit < 0) {
      indentUnit = leadingSpaces;
    }

    // compute indent level
    let indentLevel = 0;
    if (leadingSpaces > 0) {
      if (indentUnit <= 0) {
        // indentUnit not yet determined — treat as level 0 with warning
        warnings.push(`Line ${lineNum}: indentation before any reference indent detected; treating as root level`);
      } else {
        if (leadingSpaces % indentUnit !== 0) {
          warnings.push(`Line ${lineNum}: inconsistent indentation (${leadingSpaces} spaces, expected multiple of ${indentUnit})`);
        }
        indentLevel = Math.round(leadingSpaces / (indentUnit > 0 ? indentUnit : 2));
      }
    }

    // parse the line content
    const parsed = parseLine(stripped, lineNum, warnings, genName);
    if (!parsed) continue; // unparseable — warning already emitted

    // build tree via indent stack
    // pop stack until we find the parent (indent strictly less than ours)
    while (stack.length > 0 && stack[stack.length - 1].indent >= indentLevel) {
      stack.pop();
    }

    if (stack.length === 0) {
      // root node
      roots.push(parsed);
    } else {
      // child of the top of stack
      const parent = stack[stack.length - 1].node;
      if (!parent.children) parent.children = [];
      parent.children.push(parsed);
    }

    stack.push({ node: parsed, indent: indentLevel });
  }

  // post-process via preprocessWidgetNode (resolves aliases, slot presets, dotted properties)
  const processed = roots.map((root) =>
    preprocessWidgetNode(root as unknown as Record<string, unknown>) as unknown as ParsedWidgetNode,
  );

  return { nodes: processed, warnings };
}

// ---------------------------------------------------------------------------
// Line parser
// ---------------------------------------------------------------------------

function parseLine(line: string, lineNum: number, warnings: string[], genName: (cls: string) => string): ParsedWidgetNode | null {
  let cursor = 0;

  // 1. Parse ClassName (required) — word characters up to first space, quote, brace, or bracket
  const classMatch = line.match(/^[\w]+/);
  if (!classMatch) {
    warnings.push(`Line ${lineNum}: could not parse widget class name`);
    return null;
  }
  const className = classMatch[0];
  cursor = classMatch[0].length;

  // skip whitespace
  cursor = skipWs(line, cursor);

  // 2. Parse optional "InstanceName"
  let instanceName: string | undefined;
  if (cursor < line.length && line[cursor] === '"') {
    const nameEnd = line.indexOf('"', cursor + 1);
    if (nameEnd < 0) {
      warnings.push(`Line ${lineNum}: unterminated quoted name`);
      instanceName = line.slice(cursor + 1);
      cursor = line.length;
    } else {
      instanceName = line.slice(cursor + 1, nameEnd);
      cursor = nameEnd + 1;
    }
    cursor = skipWs(line, cursor);
  }

  // 3. Parse optional {properties} and [attributes] in any order
  let properties: Record<string, unknown> | undefined;
  let attributes: string | undefined;

  for (let pass = 0; pass < 2; pass++) {
    if (cursor >= line.length) break;

    if (line[cursor] === '{' && properties === undefined) {
      const result = extractBalancedBraces(line, cursor, lineNum, warnings);
      if (result) {
        const propStr = result.content;
        properties = parsePropertiesBlock(propStr, lineNum, warnings);
        cursor = result.end;
        cursor = skipWs(line, cursor);
      } else {
        break;
      }
    } else if (line[cursor] === '[' && attributes === undefined) {
      const bracketEnd = line.indexOf(']', cursor + 1);
      if (bracketEnd < 0) {
        warnings.push(`Line ${lineNum}: unterminated attributes block`);
        attributes = line.slice(cursor + 1);
        cursor = line.length;
      } else {
        attributes = line.slice(cursor + 1, bracketEnd);
        cursor = bracketEnd + 1;
      }
      cursor = skipWs(line, cursor);
    } else {
      break;
    }
  }

  // build the node
  const node: ParsedWidgetNode = {
    class: className,
    name: instanceName ?? genName(className),
  };

  // apply attributes
  if (attributes !== undefined) {
    applyAttributes(node, attributes, lineNum, warnings);
  }

  // apply properties
  if (properties !== undefined && Object.keys(properties).length > 0) {
    node.properties = properties;
  }

  return node;
}

// ---------------------------------------------------------------------------
// Properties block parser — JSON5-like: {Key: Value, Key2: Value2}
// Handles nested braces, quoted strings, and colons in values.
// ---------------------------------------------------------------------------

function parsePropertiesBlock(
  block: string,
  lineNum: number,
  warnings: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const trimmed = block.trim();
  if (trimmed.length === 0) return result;

  const entries = splitTopLevelCommas(trimmed);

  for (const entry of entries) {
    const kv = entry.trim();
    if (kv.length === 0) continue;

    // Find the FIRST colon that separates key from value.
    // Keys are unquoted identifiers (may contain dots), values may contain colons (e.g. asset paths).
    const colonIdx = findKeyValueSeparator(kv);
    if (colonIdx < 0) {
      warnings.push(`Line ${lineNum}: could not parse property entry: "${kv}"`);
      continue;
    }

    const key = kv.slice(0, colonIdx).trim();
    const rawValue = kv.slice(colonIdx + 1).trim();
    result[key] = parsePropertyValue(rawValue, lineNum, warnings);
  }

  return result;
}

/**
 * Find the colon separating key from value in a `Key: Value` pair.
 * Keys are simple identifiers (word chars + dots), so the first colon
 * not inside quotes or braces is the separator.
 */
function findKeyValueSeparator(kv: string): number {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < kv.length; i++) {
    const ch = kv[i];
    if (inQuote) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') { depth--; continue; }
    if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

function parsePropertyValue(raw: string, lineNum: number, warnings: string[]): unknown {
  // Quoted string
  if (raw.startsWith('"')) {
    const end = raw.lastIndexOf('"');
    if (end <= 0) {
      warnings.push(`Line ${lineNum}: unterminated string value: ${raw}`);
      return raw.slice(1);
    }
    // Unescape \" and \\ sequences
    return raw.slice(1, end).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Null
  if (raw === 'null') return null;

  // Nested object
  if (raw.startsWith('{')) {
    const inner = extractBalancedBracesFromValue(raw);
    if (inner !== null) {
      return parsePropertiesBlock(inner, lineNum, warnings);
    }
    warnings.push(`Line ${lineNum}: malformed nested object: ${raw}`);
    return raw;
  }

  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw.length > 0) return num;

  // Fallback: unquoted string (e.g. asset paths like /Game/UI/Style:StyleName)
  return raw;
}

// ---------------------------------------------------------------------------
// Attributes parser — [var, anchor=center, halign=left, padding=10]
// ---------------------------------------------------------------------------

function applyAttributes(
  node: ParsedWidgetNode,
  attrs: string,
  lineNum: number,
  warnings: string[],
): void {
  const rawParts = attrs.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

  // Merge bare-number parts back into the preceding key=value part.
  // This handles `padding=5,10,15,20` being split into ["padding=5","10","15","20"].
  const parts: string[] = [];
  for (const part of rawParts) {
    if (parts.length > 0 && !part.includes('=') && /^\d/.test(part)) {
      // Looks like a continuation of a multi-value attribute
      parts[parts.length - 1] += ',' + part;
    } else {
      parts.push(part);
    }
  }

  for (const part of parts) {
    const eqIdx = part.indexOf('=');

    if (eqIdx < 0) {
      // flag-style attribute
      const flag = part.toLowerCase();
      if (flag === 'var' || flag === 'variable') {
        node.is_variable = true;
      } else {
        warnings.push(`Line ${lineNum}: unknown flag attribute: "${part}"`);
      }
      continue;
    }

    const rawKey = part.slice(0, eqIdx).trim();
    const key = rawKey.toLowerCase();
    const value = part.slice(eqIdx + 1).trim();

    switch (key) {
      case 'anchor': {
        try {
          node.slot = { ...(node.slot ?? {}), ...resolveSlotPreset(value) };
        } catch (err) {
          warnings.push(`Line ${lineNum}: ${(err as Error).message}`);
        }
        break;
      }
      case 'halign': {
        if (!node.properties) node.properties = {};
        node.properties['HorizontalAlignment'] = normalizeAlignment(value);
        break;
      }
      case 'valign': {
        if (!node.properties) node.properties = {};
        node.properties['VerticalAlignment'] = normalizeAlignment(value);
        break;
      }
      case 'padding': {
        if (!node.properties) node.properties = {};
        node.properties['Padding'] = parsePaddingValue(value);
        break;
      }
      default: {
        // treat as slot property — preserve original key casing
        if (!node.slot) node.slot = {};
        const parsed = parseInlineValue(value);
        node.slot[rawKey] = parsed;
        break;
      }
    }
  }
}

function normalizeAlignment(value: string): string {
  const map: Record<string, string> = {
    left: 'HAlign_Left',
    center: 'HAlign_Center',
    right: 'HAlign_Right',
    top: 'VAlign_Top',
    bottom: 'VAlign_Bottom',
    fill: 'HAlign_Fill',
  };
  return map[value.toLowerCase()] ?? value;
}

function parsePaddingValue(value: string): unknown {
  const parts = value.split(',').map((s) => s.trim());
  if (parts.length === 1) {
    const n = Number(parts[0]);
    return isNaN(n) ? value : { Left: n, Top: n, Right: n, Bottom: n };
  }
  if (parts.length === 4) {
    return {
      Top: Number(parts[0]) || 0,
      Right: Number(parts[1]) || 0,
      Bottom: Number(parts[2]) || 0,
      Left: Number(parts[3]) || 0,
    };
  }
  return value;
}

function parseInlineValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!isNaN(num) && value.length > 0) return num;
  return value;
}

// ---------------------------------------------------------------------------
// Utility: balanced-brace extraction
// ---------------------------------------------------------------------------

function extractBalancedBraces(
  line: string,
  start: number,
  lineNum: number,
  warnings: string[],
): { content: string; end: number } | null {
  if (line[start] !== '{') return null;

  let depth = 0;
  let inQuote = false;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return { content: line.slice(start + 1, i), end: i + 1 };
      }
    }
  }

  warnings.push(`Line ${lineNum}: unterminated properties block`);
  return { content: line.slice(start + 1), end: line.length };
}

function extractBalancedBracesFromValue(raw: string): string | null {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuote) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return raw.slice(1, i);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Utility: split top-level commas (respecting nested braces and quotes)
// ---------------------------------------------------------------------------

function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') { depth--; continue; }
    if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function skipWs(s: string, pos: number): number {
  while (pos < s.length && (s[pos] === ' ' || s[pos] === '\t')) pos++;
  return pos;
}

/**
 * @deprecated No longer needed — counter is now local to each parseWidgetDsl call.
 * Kept for backward compatibility with existing test imports.
 */
export function resetAutoNameCounter(): void {
  // no-op: counter is now local to each parseWidgetDsl call
}
