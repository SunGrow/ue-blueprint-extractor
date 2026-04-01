import { describe, expect, it, vi } from 'vitest';
import { parseWidgetRecipe } from '../src/helpers/widget-recipe-parser.js';
import { registerRecipeTools } from '../src/tools/recipe-tools.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import type { CompositeToolResult } from '../src/helpers/composite-patterns.js';

// ===========================================================================
// Part 1: Recipe Parser Tests
// ===========================================================================

describe('parseWidgetRecipe', () => {
  it('parses complete recipe with all sections', () => {
    const markdown = `# Recipe: Create Settings Menu

## Asset
path: /Game/UI/Screens/WBP_Settings
parent: CommonActivatableWidget

## Widget Tree
CanvasPanel "Root"
  VerticalBox "Content" [anchor=center, padding=40]
    TextBlock "Title" {Text: "Settings", Font.Size: 32}
    ScrollBox "SettingsList" [var]

## Class Defaults
SettingsListClass: /Game/UI/Elements/WBP_SettingItem

## After
compile, save
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.title).toBe('Create Settings Menu');
    expect(recipe.asset.path).toBe('/Game/UI/Screens/WBP_Settings');
    expect(recipe.asset.parent).toBe('CommonActivatableWidget');
    expect(recipe.widgetTree).toBeDefined();
    expect(recipe.widgetTree).toContain('CanvasPanel "Root"');
    expect(recipe.widgetTree).toContain('TextBlock "Title"');
    expect(recipe.classDefaults).toEqual({
      SettingsListClass: '/Game/UI/Elements/WBP_SettingItem',
    });
    expect(recipe.afterSteps).toEqual(['compile', 'save']);
    expect(recipe.warnings).toHaveLength(0);
  });

  it('parses recipe with only Asset and Widget Tree', () => {
    const markdown = `# My Widget

## Asset
path: /Game/UI/WBP_Simple

## Widget Tree
CanvasPanel "Root"
  TextBlock "Label" {Text: "Hello"}
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.title).toBe('My Widget');
    expect(recipe.asset.path).toBe('/Game/UI/WBP_Simple');
    expect(recipe.asset.parent).toBeUndefined();
    expect(recipe.widgetTree).toBeDefined();
    expect(recipe.widgetTree).toContain('CanvasPanel "Root"');
    expect(recipe.classDefaults).toBeUndefined();
    // Default after steps
    expect(recipe.afterSteps).toEqual(['compile', 'save']);
    expect(recipe.warnings).toHaveLength(0);
  });

  it('parses recipe with Class Defaults', () => {
    const markdown = `## Asset
path: /Game/UI/WBP_Test

## Class Defaults
MaxItems: 10
bEnabled: true
Label: My Widget
Opacity: 0.75
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.classDefaults).toEqual({
      MaxItems: 10,
      bEnabled: true,
      Label: 'My Widget',
      Opacity: 0.75,
    });
  });

  it('defaults After to [compile, save] when missing', () => {
    const markdown = `## Asset
path: /Game/UI/WBP_NoAfter
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.afterSteps).toEqual(['compile', 'save']);
  });

  it('warns on unknown sections', () => {
    const markdown = `## Asset
path: /Game/UI/WBP_Test

## Unknown Section
some content here

## Another Unknown
more content
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.warnings).toHaveLength(2);
    expect(recipe.warnings[0]).toContain('Unknown section');
    expect(recipe.warnings[0]).toContain('Unknown Section');
    expect(recipe.warnings[1]).toContain('Another Unknown');
  });

  it('handles missing Asset path', () => {
    const markdown = `## Asset
parent: UserWidget
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.asset.path).toBe('');
    expect(recipe.asset.parent).toBe('UserWidget');
  });

  it('handles empty recipe', () => {
    const recipe = parseWidgetRecipe('');

    expect(recipe.asset.path).toBe('');
    expect(recipe.widgetTree).toBeUndefined();
    expect(recipe.classDefaults).toBeUndefined();
    expect(recipe.afterSteps).toEqual(['compile', 'save']);
    expect(recipe.warnings).toContain('Empty recipe');
  });

  it('parses boolean and number class default values', () => {
    const markdown = `## Asset
path: /Game/UI/WBP_Test

## Class Defaults
bEnabled: true
bVisible: false
MaxCount: 42
Ratio: 3.14
Name: SomeName
Path: /Game/UI/Style
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.classDefaults).toEqual({
      bEnabled: true,
      bVisible: false,
      MaxCount: 42,
      Ratio: 3.14,
      Name: 'SomeName',
      Path: '/Game/UI/Style',
    });
  });

  it('preserves Widget Tree indentation', () => {
    const markdown = `## Asset
path: /Game/UI/WBP_Test

## Widget Tree
CanvasPanel "Root"
  VerticalBox "Content"
    TextBlock "Title"
    TextBlock "Subtitle"
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.widgetTree).toBeDefined();
    const lines = recipe.widgetTree!.split('\n');
    expect(lines).toHaveLength(4);
    // Indentation is preserved
    expect(lines[1]).toMatch(/^\s+VerticalBox/);
    expect(lines[2]).toMatch(/^\s+TextBlock "Title"/);
  });

  it('parses title from # Recipe: Title format', () => {
    const markdown = `# Recipe: My Amazing Widget

## Asset
path: /Game/UI/WBP_Amazing
`;

    const recipe = parseWidgetRecipe(markdown);
    expect(recipe.title).toBe('My Amazing Widget');
  });

  it('parses title from plain # Title format', () => {
    const markdown = `# Simple Title

## Asset
path: /Game/UI/WBP_Simple
`;

    const recipe = parseWidgetRecipe(markdown);
    expect(recipe.title).toBe('Simple Title');
  });

  it('handles After section with unknown steps', () => {
    const markdown = `## Asset
path: /Game/UI/WBP_Test

## After
compile, unknown_step, save
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.afterSteps).toEqual(['compile', 'save']);
    expect(recipe.warnings).toHaveLength(1);
    expect(recipe.warnings[0]).toContain('unknown_step');
  });

  it('handles After section with capture step', () => {
    const markdown = `## Asset
path: /Game/UI/WBP_Test

## After
compile, capture, save
`;

    const recipe = parseWidgetRecipe(markdown);
    expect(recipe.afterSteps).toEqual(['compile', 'capture', 'save']);
  });

  it('handles unknown Asset properties', () => {
    const markdown = `## Asset
path: /Game/UI/WBP_Test
parent: UserWidget
description: Some description
`;

    const recipe = parseWidgetRecipe(markdown);

    expect(recipe.asset.path).toBe('/Game/UI/WBP_Test');
    expect(recipe.asset.parent).toBe('UserWidget');
    expect(recipe.warnings).toHaveLength(1);
    expect(recipe.warnings[0]).toContain('description');
  });
});

// ===========================================================================
// Part 2: Executor Integration Tests
// ===========================================================================

function setupRegistry(callSubsystemJson: ReturnType<typeof vi.fn>) {
  const registry = createToolRegistry();
  registerRecipeTools({
    server: registry.server,
    callSubsystemJson,
    toolHelpRegistry: registry.toolHelpRegistry,
  });
  return registry;
}

describe('execute_widget_recipe', () => {
  it('executes full pipeline: create -> tree -> defaults -> compile -> save', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateWidgetBlueprint') return { success: true, assetPath: '/Game/UI/WBP_Test' };
      if (method === 'BuildWidgetTree') return { success: true };
      if (method === 'PatchWidgetClassDefaults') return { success: true };
      if (method === 'CompileWidgetBlueprint') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      if (method === 'ExtractWidgetBlueprint') return { widgetTree: { root: 'CanvasPanel' } };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('execute_widget_recipe').handler({
      recipe: `# Recipe: Test

## Asset
path: /Game/UI/WBP_Test
parent: CommonActivatableWidget

## Widget Tree
CanvasPanel "Root"
  TextBlock "Title" {Text: "Hello"}

## Class Defaults
MaxItems: 10

## After
compile, save
`,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);
    expect(parsed.operation).toBe('execute_widget_recipe');

    const stepNames = parsed.steps.map((s) => s.step);
    expect(stepNames).toContain('parse');
    expect(stepNames).toContain('create');
    expect(stepNames).toContain('build_tree');
    expect(stepNames).toContain('class_defaults');
    expect(stepNames).toContain('compile');
    expect(stepNames).toContain('save');
    expect(stepNames).toContain('extract');

    expect(parsed.steps.every((s) => s.status === 'success')).toBe(true);

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Test',
      ParentClassPath: 'CommonActivatableWidget',
    });
    expect(callSubsystemJson).toHaveBeenCalledWith('BuildWidgetTree', expect.objectContaining({
      AssetPath: '/Game/UI/WBP_Test',
    }));
    expect(callSubsystemJson).toHaveBeenCalledWith('PatchWidgetClassDefaults', expect.objectContaining({
      AssetPath: '/Game/UI/WBP_Test',
    }));
    expect(callSubsystemJson).toHaveBeenCalledWith('CompileWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Test',
    });
  });

  it('skips tree step when Widget Tree section is absent', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateWidgetBlueprint') return { success: true };
      if (method === 'CompileWidgetBlueprint') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      if (method === 'ExtractWidgetBlueprint') return { widgetTree: {} };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('execute_widget_recipe').handler({
      recipe: `## Asset
path: /Game/UI/WBP_NoTree

## After
compile, save
`,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const treeStep = parsed.steps.find((s) => s.step === 'build_tree');
    expect(treeStep).toBeDefined();
    expect(treeStep!.status).toBe('skipped');

    expect(callSubsystemJson).not.toHaveBeenCalledWith('BuildWidgetTree', expect.anything());
  });

  it('skips defaults step when Class Defaults section is absent', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateWidgetBlueprint') return { success: true };
      if (method === 'BuildWidgetTree') return { success: true };
      if (method === 'CompileWidgetBlueprint') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      if (method === 'ExtractWidgetBlueprint') return { widgetTree: {} };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('execute_widget_recipe').handler({
      recipe: `## Asset
path: /Game/UI/WBP_NoDefaults

## Widget Tree
CanvasPanel "Root"

## After
compile, save
`,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const defaultsStep = parsed.steps.find((s) => s.step === 'class_defaults');
    expect(defaultsStep).toBeDefined();
    expect(defaultsStep!.status).toBe('skipped');

    expect(callSubsystemJson).not.toHaveBeenCalledWith('PatchWidgetClassDefaults', expect.anything());
  });

  it('handles compile failure gracefully with partial state', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateWidgetBlueprint') return { success: true };
      if (method === 'BuildWidgetTree') return { success: true };
      if (method === 'CompileWidgetBlueprint') throw new Error('Compilation failed: unresolved bindings');
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('execute_widget_recipe').handler({
      recipe: `## Asset
path: /Game/UI/WBP_CompileFail

## Widget Tree
CanvasPanel "Root"
  TextBlock "Title"

## After
compile, save
`,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);

    const compileStep = parsed.steps.find((s) => s.step === 'compile');
    expect(compileStep).toBeDefined();
    expect(compileStep!.status).toBe('failure');
    expect(compileStep!.message).toContain('Compilation failed');

    expect(parsed.partial_state).toBeDefined();
    expect(parsed.partial_state!.completed_steps).toContain('create');
    expect(parsed.partial_state!.completed_steps).toContain('build_tree');
    expect(parsed.partial_state!.failed_step).toBe('compile');

    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it('returns extraction result on success', async () => {
    const extractionData = {
      widgetTree: { root: 'CanvasPanel', children: [] },
      className: 'WBP_Test_C',
    };

    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateWidgetBlueprint') return { success: true };
      if (method === 'CompileWidgetBlueprint') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      if (method === 'ExtractWidgetBlueprint') return extractionData;
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('execute_widget_recipe').handler({
      recipe: `## Asset
path: /Game/UI/WBP_Test

## After
compile, save
`,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const extractStep = parsed.steps.find((s) => s.step === 'extract');
    expect(extractStep).toBeDefined();
    expect(extractStep!.status).toBe('success');
    expect(extractStep!.data).toMatchObject(extractionData);
  });

  it('returns error when recipe has no asset path', async () => {
    const callSubsystemJson = vi.fn();

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('execute_widget_recipe').handler({
      recipe: `## Widget Tree
CanvasPanel "Root"
`,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);
    expect((result as { isError?: boolean }).isError).toBe(true);

    // No subsystem calls should have been made
    expect(callSubsystemJson).not.toHaveBeenCalled();
  });

  it('handles create failure', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateWidgetBlueprint') throw new Error('Asset already exists');
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('execute_widget_recipe').handler({
      recipe: `## Asset
path: /Game/UI/WBP_Existing
`,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(false);

    const createStep = parsed.steps.find((s) => s.step === 'create');
    expect(createStep).toBeDefined();
    expect(createStep!.status).toBe('failure');
    expect(createStep!.message).toContain('Asset already exists');
  });

  it('defaults parent to UserWidget when not specified', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateWidgetBlueprint') return { success: true };
      if (method === 'CompileWidgetBlueprint') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      if (method === 'ExtractWidgetBlueprint') return { widgetTree: {} };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);

    await registry.getTool('execute_widget_recipe').handler({
      recipe: `## Asset
path: /Game/UI/WBP_NoParent

## After
compile, save
`,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_NoParent',
      ParentClassPath: 'UserWidget',
    });
  });

  it('includes parser warnings in parse step', async () => {
    const callSubsystemJson = vi.fn(async (method: string) => {
      if (method === 'CreateWidgetBlueprint') return { success: true };
      if (method === 'CompileWidgetBlueprint') return { success: true };
      if (method === 'SaveAssets') return { success: true };
      if (method === 'ExtractWidgetBlueprint') return { widgetTree: {} };
      return {};
    });

    const registry = setupRegistry(callSubsystemJson);

    const result = await registry.getTool('execute_widget_recipe').handler({
      recipe: `## Asset
path: /Game/UI/WBP_Test

## Bogus Section
whatever

## After
compile, save
`,
    });

    const parsed = parseDirectToolResult(result) as CompositeToolResult;
    expect(parsed.success).toBe(true);

    const parseStep = parsed.steps.find((s) => s.step === 'parse');
    expect(parseStep).toBeDefined();
    expect(parseStep!.status).toBe('success');
    expect(parseStep!.message).toContain('warning');
    expect((parseStep!.data as { warnings: string[] }).warnings).toHaveLength(1);
  });
});
