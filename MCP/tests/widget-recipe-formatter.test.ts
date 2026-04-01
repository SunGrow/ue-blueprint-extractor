import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { formatAsRecipe } from '../src/helpers/widget-recipe-formatter.js';
import { parseWidgetRecipe } from '../src/helpers/widget-recipe-parser.js';
import { parseWidgetDsl } from '../src/helpers/widget-dsl-parser.js';
import { registerWidgetExtractionTools } from '../src/tools/widget-extraction.js';
import { createToolRegistry } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const extractWidgetAnimationResultSchema = z.object({}).passthrough();

// ===========================================================================
// Part 1: formatAsRecipe unit tests
// ===========================================================================

describe('formatAsRecipe', () => {
  it('converts a simple widget tree to DSL', () => {
    const extraction = {
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Simple', extraction);

    expect(recipe).toContain('## Widget Tree');
    expect(recipe).toContain('CanvasPanel "Root"');
  });

  it('includes Asset section with path and parent', () => {
    const extraction = {
      parentClass: 'CommonActivatableWidget',
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Settings', extraction);

    expect(recipe).toContain('## Asset');
    expect(recipe).toContain('path: /Game/UI/WBP_Settings');
    expect(recipe).toContain('parent: CommonActivatableWidget');
  });

  it('omits parent line when parentClass is UserWidget', () => {
    const extraction = {
      parentClass: 'UserWidget',
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Default', extraction);

    expect(recipe).toContain('path: /Game/UI/WBP_Default');
    expect(recipe).not.toContain('parent:');
  });

  it('omits parent line when parentClass is absent', () => {
    const extraction = {
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_NoParent', extraction);

    expect(recipe).not.toContain('parent:');
  });

  it('includes Class Defaults when requested and present', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
      classDefaults: {
        MaxItems: 10,
        bEnabled: true,
        Label: 'My Widget',
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Defaults', extraction, {
      includeClassDefaults: true,
    });

    expect(recipe).toContain('## Class Defaults');
    expect(recipe).toContain('MaxItems: 10');
    expect(recipe).toContain('bEnabled: true');
    expect(recipe).toContain('Label: My Widget');
  });

  it('omits Class Defaults when not requested', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
      classDefaults: { MaxItems: 10 },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Test', extraction);

    expect(recipe).not.toContain('## Class Defaults');
  });

  it('handles nested children correctly', () => {
    const extraction = {
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
        children: [
          {
            class: 'VerticalBox',
            name: 'Content',
            children: [
              { class: 'TextBlock', name: 'Title', properties: { Text: 'Hello' } },
              { class: 'TextBlock', name: 'Subtitle' },
            ],
          },
        ],
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Nested', extraction);

    // Check indentation levels
    const lines = recipe.split('\n');
    const treeSectionIdx = lines.findIndex((l) => l === '## Widget Tree');
    expect(treeSectionIdx).toBeGreaterThan(-1);

    const treeLines = lines.slice(treeSectionIdx + 1).filter((l) => l.trim().length > 0);
    // Root at indent 0
    expect(treeLines[0]).toBe('CanvasPanel "Root"');
    // VerticalBox at indent 1
    expect(treeLines[1]).toBe('  VerticalBox "Content"');
    // TextBlocks at indent 2
    expect(treeLines[2]).toContain('    TextBlock "Title"');
    expect(treeLines[3]).toBe('    TextBlock "Subtitle"');
  });

  it('handles properties (strings, numbers, booleans)', () => {
    const extraction = {
      rootWidget: {
        class: 'TextBlock',
        name: 'Label',
        properties: {
          Text: 'Hello World',
          'Font.Size': 24,
          bAutoWrap: true,
        },
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Props', extraction);

    expect(recipe).toContain('{Text: "Hello World", Font.Size: 24, bAutoWrap: true}');
  });

  it('handles is_variable flag as [var] attribute', () => {
    const extraction = {
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
        children: [
          {
            class: 'TextBlock',
            name: 'Title',
            is_variable: true,
          },
        ],
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Var', extraction);

    expect(recipe).toContain('TextBlock "Title" [var]');
  });

  it('handles bIsVariable flag as [var] attribute', () => {
    const extraction = {
      rootWidget: {
        class: 'TextBlock',
        name: 'MyText',
        bIsVariable: true,
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_BIsVar', extraction);

    expect(recipe).toContain('TextBlock "MyText" [var]');
  });

  it('uses custom afterSteps', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_After', extraction, {
      afterSteps: ['compile', 'capture', 'save'],
    });

    expect(recipe).toContain('## After');
    expect(recipe).toContain('compile, capture, save');
  });

  it('defaults afterSteps to compile, save', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Default', extraction);

    expect(recipe).toContain('## After');
    expect(recipe).toContain('compile, save');
  });

  it('includes recipe title from asset name', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_MyWidget', extraction);

    expect(recipe).toContain('# Recipe: WBP_MyWidget');
  });

  it('handles extraction with parent_class (snake_case)', () => {
    const extraction = {
      parent_class: 'CommonActivatableWidget',
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Snake', extraction);

    expect(recipe).toContain('parent: CommonActivatableWidget');
  });

  it('handles extraction with class_defaults (snake_case)', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
      class_defaults: { Opacity: 0.75 },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_SnakeDefaults', extraction, {
      includeClassDefaults: true,
    });

    expect(recipe).toContain('## Class Defaults');
    expect(recipe).toContain('Opacity: 0.75');
  });

  it('handles node with both properties and is_variable', () => {
    const extraction = {
      rootWidget: {
        class: 'Button',
        name: 'SubmitBtn',
        is_variable: true,
        properties: { ToolTipText: 'Click to submit' },
      },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_Both', extraction);

    expect(recipe).toContain('Button "SubmitBtn" {ToolTipText: "Click to submit"} [var]');
  });

  it('skips Widget Tree section when no tree is present', () => {
    const extraction = {
      classDefaults: { MaxItems: 5 },
    };

    const recipe = formatAsRecipe('/Game/UI/WBP_NoTree', extraction, {
      includeClassDefaults: true,
    });

    expect(recipe).not.toContain('## Widget Tree');
    expect(recipe).toContain('## Class Defaults');
  });
});

// ===========================================================================
// Part 2: Round-trip tests (format -> parse -> verify)
// ===========================================================================

describe('recipe round-trip', () => {
  it('simple tree: format as recipe -> parse -> verify structure', () => {
    const extraction = {
      parentClass: 'CommonActivatableWidget',
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
        children: [
          {
            class: 'VerticalBox',
            name: 'Content',
            children: [
              { class: 'TextBlock', name: 'Title', properties: { Text: 'Settings' } },
            ],
          },
        ],
      },
    };

    const recipeText = formatAsRecipe('/Game/UI/WBP_Settings', extraction);
    const parsed = parseWidgetRecipe(recipeText);

    expect(parsed.asset.path).toBe('/Game/UI/WBP_Settings');
    expect(parsed.asset.parent).toBe('CommonActivatableWidget');
    expect(parsed.widgetTree).toBeDefined();
    expect(parsed.afterSteps).toEqual(['compile', 'save']);
    expect(parsed.warnings).toHaveLength(0);

    // Parse the DSL to verify widget tree structure
    const dslResult = parseWidgetDsl(parsed.widgetTree!);
    expect(dslResult.nodes).toHaveLength(1);

    const root = dslResult.nodes[0];
    expect(root.class).toBe('CanvasPanel');
    expect(root.name).toBe('Root');
    expect(root.children).toHaveLength(1);

    const content = root.children![0];
    expect(content.class).toBe('VerticalBox');
    expect(content.name).toBe('Content');
    expect(content.children).toHaveLength(1);

    const title = content.children![0];
    expect(title.class).toBe('TextBlock');
    expect(title.name).toBe('Title');
    expect(title.properties).toMatchObject({ Text: 'Settings' });
  });

  it('round-trip with class defaults', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
      classDefaults: {
        MaxItems: 10,
        bEnabled: true,
        Label: 'Settings',
      },
    };

    const recipeText = formatAsRecipe('/Game/UI/WBP_Defaults', extraction, {
      includeClassDefaults: true,
    });
    const parsed = parseWidgetRecipe(recipeText);

    expect(parsed.classDefaults).toEqual({
      MaxItems: 10,
      bEnabled: true,
      Label: 'Settings',
    });
  });

  it('round-trip with is_variable flag', () => {
    const extraction = {
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
        children: [
          { class: 'TextBlock', name: 'Title', is_variable: true },
        ],
      },
    };

    const recipeText = formatAsRecipe('/Game/UI/WBP_Var', extraction);
    const parsed = parseWidgetRecipe(recipeText);

    const dslResult = parseWidgetDsl(parsed.widgetTree!);
    const root = dslResult.nodes[0];
    const title = root.children![0];
    expect(title.is_variable).toBe(true);
  });

  it('round-trip with custom after steps', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
    };

    const recipeText = formatAsRecipe('/Game/UI/WBP_After', extraction, {
      afterSteps: ['compile', 'capture', 'save'],
    });
    const parsed = parseWidgetRecipe(recipeText);

    expect(parsed.afterSteps).toEqual(['compile', 'capture', 'save']);
  });

  it('round-trip with no parent class', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
    };

    const recipeText = formatAsRecipe('/Game/UI/WBP_NoParent', extraction);
    const parsed = parseWidgetRecipe(recipeText);

    expect(parsed.asset.path).toBe('/Game/UI/WBP_NoParent');
    expect(parsed.asset.parent).toBeUndefined();
  });

  it('round-trip preserves title', () => {
    const extraction = {
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
    };

    const recipeText = formatAsRecipe('/Game/UI/WBP_MyWidget', extraction);
    const parsed = parseWidgetRecipe(recipeText);

    expect(parsed.title).toBe('WBP_MyWidget');
  });
});

// ===========================================================================
// Part 3: Integration with extract_widget_blueprint tool (format parameter)
// ===========================================================================

describe('extract_widget_blueprint format=recipe', () => {
  it('returns recipe markdown when format is recipe', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
        children: [
          { class: 'TextBlock', name: 'Title', properties: { Text: 'Hello' } },
        ],
      },
      parentClass: 'CommonActivatableWidget',
    }));

    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Test',
      include_class_defaults: false,
      compact: true,
      format: 'recipe',
    });

    const text = getTextContent(result as { content?: Array<{ text?: string; type: string }> });
    expect(text).toContain('# Recipe: WBP_Test');
    expect(text).toContain('## Asset');
    expect(text).toContain('path: /Game/UI/WBP_Test');
    expect(text).toContain('parent: CommonActivatableWidget');
    expect(text).toContain('## Widget Tree');
    expect(text).toContain('CanvasPanel "Root"');
    expect(text).toContain('TextBlock "Title"');
    expect(text).toContain('## After');
  });

  it('returns JSON when format is json (default)', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      rootWidget: { name: 'Root', class: 'CanvasPanel' },
    }));

    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Test',
      compact: true,
    });

    // Default format=json returns structured content
    const structured = (result as { structuredContent?: unknown }).structuredContent;
    expect(structured).toBeDefined();
  });

  it('includes class defaults in recipe when include_class_defaults is true', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      rootWidget: { class: 'CanvasPanel', name: 'Root' },
      classDefaults: { MaxItems: 10, bEnabled: true },
    }));

    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Test',
      include_class_defaults: true,
      compact: true,
      format: 'recipe',
    });

    const text = getTextContent(result as { content?: Array<{ text?: string; type: string }> });
    expect(text).toContain('## Class Defaults');
    expect(text).toContain('MaxItems: 10');
    expect(text).toContain('bEnabled: true');
  });

  it('recipe output is parseable by parseWidgetRecipe (full round-trip via tool)', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      rootWidget: {
        class: 'CanvasPanel',
        name: 'Root',
        children: [
          {
            class: 'VerticalBox',
            name: 'Content',
            children: [
              { class: 'TextBlock', name: 'Title', properties: { Text: 'Hello' }, is_variable: true },
            ],
          },
        ],
      },
      parentClass: 'CommonActivatableWidget',
      classDefaults: { MaxItems: 5 },
    }));

    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_RoundTrip',
      include_class_defaults: true,
      compact: true,
      format: 'recipe',
    });

    const recipeText = getTextContent(result as { content?: Array<{ text?: string; type: string }> });

    // Parse it back
    const parsed = parseWidgetRecipe(recipeText);
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.asset.path).toBe('/Game/UI/WBP_RoundTrip');
    expect(parsed.asset.parent).toBe('CommonActivatableWidget');
    expect(parsed.classDefaults).toEqual({ MaxItems: 5 });
    expect(parsed.afterSteps).toEqual(['compile', 'save']);

    // Parse the DSL
    const dslResult = parseWidgetDsl(parsed.widgetTree!);
    expect(dslResult.nodes).toHaveLength(1);

    const root = dslResult.nodes[0];
    expect(root.class).toBe('CanvasPanel');
    expect(root.name).toBe('Root');
    expect(root.children).toHaveLength(1);

    const content = root.children![0];
    expect(content.class).toBe('VerticalBox');
    expect(content.children).toHaveLength(1);

    const title = content.children![0];
    expect(title.class).toBe('TextBlock');
    expect(title.name).toBe('Title');
    expect(title.is_variable).toBe(true);
    expect(title.properties).toMatchObject({ Text: 'Hello' });
  });
});
