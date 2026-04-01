// ---------------------------------------------------------------------------
// Widget Recipe Parser
//
// Parses a markdown document describing a widget blueprint's desired end
// state into a structured recipe that the executor can run as a pipeline.
// ---------------------------------------------------------------------------

export interface WidgetRecipe {
  title?: string;
  asset: {
    path: string;
    parent?: string;
  };
  widgetTree?: string; // Raw DSL string (parsed by widget-dsl-parser at execution time)
  classDefaults?: Record<string, unknown>;
  afterSteps: ('compile' | 'capture' | 'save')[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Section types
// ---------------------------------------------------------------------------

interface RawSection {
  heading: string;
  body: string;
}

const KNOWN_SECTIONS = new Set(['asset', 'widget tree', 'class defaults', 'after']);

const VALID_AFTER_STEPS = new Set<string>(['compile', 'capture', 'save']);

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseWidgetRecipe(markdown: string): WidgetRecipe {
  const warnings: string[] = [];
  const recipe: WidgetRecipe = {
    asset: { path: '' },
    afterSteps: [],
    warnings,
  };

  if (!markdown || markdown.trim().length === 0) {
    warnings.push('Empty recipe');
    recipe.afterSteps = ['compile', 'save'];
    return recipe;
  }

  // Extract title from h1
  recipe.title = parseTitle(markdown);

  // Split into sections by ## headings
  const sections = splitSections(markdown);

  let hasAfterSection = false;

  for (const section of sections) {
    const normalizedHeading = section.heading.toLowerCase().trim();

    switch (normalizedHeading) {
      case 'asset':
        parseAssetSection(section.body, recipe, warnings);
        break;
      case 'widget tree':
        parseWidgetTreeSection(section.body, recipe);
        break;
      case 'class defaults':
        parseClassDefaultsSection(section.body, recipe, warnings);
        break;
      case 'after':
        hasAfterSection = true;
        parseAfterSection(section.body, recipe, warnings);
        break;
      default:
        if (!KNOWN_SECTIONS.has(normalizedHeading)) {
          warnings.push(`Unknown section: "${section.heading}" — skipped`);
        }
        break;
    }
  }

  // Default after steps when section is missing
  if (!hasAfterSection) {
    recipe.afterSteps = ['compile', 'save'];
  }

  return recipe;
}

// ---------------------------------------------------------------------------
// Title parser — # Recipe: Title or # Title
// ---------------------------------------------------------------------------

function parseTitle(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // Match # Recipe: Title or # Title (but not ## headings)
    const match = trimmed.match(/^#\s+(?:Recipe:\s*)?(.+)$/i);
    if (match && !trimmed.startsWith('##')) {
      return match[1].trim();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Section splitter — splits by ## headings (case-insensitive)
// ---------------------------------------------------------------------------

function splitSections(markdown: string): RawSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: RawSection[] = [];
  let currentHeading: string | null = null;
  let currentBodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^##\s+(.+)$/);

    if (headingMatch) {
      // Flush previous section
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentBodyLines.join('\n') });
      }
      currentHeading = headingMatch[1].trim();
      currentBodyLines = [];
    } else if (currentHeading !== null) {
      currentBodyLines.push(line);
    }
  }

  // Flush final section
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentBodyLines.join('\n') });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Asset section parser — key: value lines for path, parent
// ---------------------------------------------------------------------------

function parseAssetSection(body: string, recipe: WidgetRecipe, warnings: string[]): void {
  const kvPairs = parseKeyValueLines(body);

  for (const [key, value] of kvPairs) {
    const normalizedKey = key.toLowerCase().trim();
    switch (normalizedKey) {
      case 'path':
        recipe.asset.path = value;
        break;
      case 'parent':
        recipe.asset.parent = value;
        break;
      default:
        warnings.push(`Unknown Asset property: "${key}" — skipped`);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Widget Tree section parser — preserve raw DSL (indentation-significant)
// ---------------------------------------------------------------------------

function parseWidgetTreeSection(body: string, recipe: WidgetRecipe): void {
  // Trim only leading/trailing blank lines, preserving internal indentation
  const lines = body.split(/\r?\n/);

  // Find first non-blank line
  let start = 0;
  while (start < lines.length && lines[start].trim().length === 0) start++;

  // Find last non-blank line
  let end = lines.length - 1;
  while (end >= start && lines[end].trim().length === 0) end--;

  if (start > end) {
    recipe.widgetTree = undefined;
    return;
  }

  recipe.widgetTree = lines.slice(start, end + 1).join('\n');
}

// ---------------------------------------------------------------------------
// Class Defaults section parser — key: value with typed values
// ---------------------------------------------------------------------------

function parseClassDefaultsSection(
  body: string,
  recipe: WidgetRecipe,
  warnings: string[],
): void {
  const kvPairs = parseKeyValueLines(body);
  if (kvPairs.length === 0) return;

  const defaults: Record<string, unknown> = {};

  for (const [key, rawValue] of kvPairs) {
    defaults[key] = parseClassDefaultValue(rawValue);
  }

  recipe.classDefaults = defaults;
}

// ---------------------------------------------------------------------------
// After section parser — comma-separated list of steps
// ---------------------------------------------------------------------------

function parseAfterSection(body: string, recipe: WidgetRecipe, warnings: string[]): void {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    recipe.afterSteps = ['compile', 'save'];
    return;
  }

  const steps: ('compile' | 'capture' | 'save')[] = [];
  const parts = trimmed.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);

  for (const part of parts) {
    if (VALID_AFTER_STEPS.has(part)) {
      steps.push(part as 'compile' | 'capture' | 'save');
    } else {
      warnings.push(`Unknown after step: "${part}" — skipped`);
    }
  }

  recipe.afterSteps = steps.length > 0 ? steps : ['compile', 'save'];
}

// ---------------------------------------------------------------------------
// Utility: parse key: value lines from a section body
// ---------------------------------------------------------------------------

function parseKeyValueLines(body: string): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  const lines = body.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key.length > 0) {
      result.push([key, value]);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Utility: parse typed class default values
// ---------------------------------------------------------------------------

function parseClassDefaultValue(raw: string): unknown {
  // Booleans
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Numbers
  const num = Number(raw);
  if (!isNaN(num) && raw.length > 0) return num;

  // Everything else is a string (including asset paths)
  return raw;
}
