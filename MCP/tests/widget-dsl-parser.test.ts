import { describe, expect, it, beforeEach } from 'vitest';
import { parseWidgetDsl, resetAutoNameCounter } from '../src/helpers/widget-dsl-parser.js';
import type { ParsedWidgetNode } from '../src/helpers/widget-dsl-parser.js';

beforeEach(() => {
  resetAutoNameCounter();
});

describe('parseWidgetDsl', () => {
  // ---------------------------------------------------------------------------
  // Basic parsing
  // ---------------------------------------------------------------------------

  it('parses a single widget line', () => {
    const result = parseWidgetDsl('CanvasPanel');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].class).toBe('CanvasPanel');
    expect(result.nodes[0].name).toBe('CanvasPanel_0');
    expect(result.warnings).toHaveLength(0);
  });

  it('parses widget with quoted name', () => {
    const result = parseWidgetDsl('CanvasPanel "Root"');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].class).toBe('CanvasPanel');
    expect(result.nodes[0].name).toBe('Root');
  });

  it('parses widget with properties block', () => {
    const result = parseWidgetDsl('TextBlock "Title" {Text: "Hello World", FontSize: 24}');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].properties).toEqual({
      Text: 'Hello World',
      FontSize: 24,
    });
  });

  it('parses widget with attributes block', () => {
    const result = parseWidgetDsl('TextBlock "Title" [var, anchor=center]');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].is_variable).toBe(true);
    expect(result.nodes[0].slot).toBeDefined();
  });

  it('parses widget with all parts: class, name, props, attrs', () => {
    const result = parseWidgetDsl('TextBlock "Title" {Text: "Main Menu", Font.Size: 24} [var]');
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0];
    expect(node.class).toBe('TextBlock');
    expect(node.name).toBe('Title');
    expect(node.is_variable).toBe(true);
    // Font.Size gets expanded by preprocessWidgetNode into Font: { Size: 24 }
    expect(node.properties).toEqual({ Text: 'Main Menu', Font: { Size: 24 } });
  });

  // ---------------------------------------------------------------------------
  // Hierarchy
  // ---------------------------------------------------------------------------

  it('builds parent-child from indentation', () => {
    const dsl = [
      'CanvasPanel "Root"',
      '  TextBlock "Title"',
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].children).toHaveLength(1);
    expect(result.nodes[0].children![0].name).toBe('Title');
  });

  it('handles multiple root nodes', () => {
    const dsl = [
      'CanvasPanel "Root1"',
      'CanvasPanel "Root2"',
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].name).toBe('Root1');
    expect(result.nodes[1].name).toBe('Root2');
  });

  it('handles deep nesting (3+ levels)', () => {
    const dsl = [
      'CanvasPanel "Root"',
      '  VerticalBox "Content"',
      '    HorizontalBox "Row"',
      '      TextBlock "Label"',
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.nodes).toHaveLength(1);
    const root = result.nodes[0];
    expect(root.children).toHaveLength(1);
    const content = root.children![0];
    expect(content.children).toHaveLength(1);
    const row = content.children![0];
    expect(row.children).toHaveLength(1);
    expect(row.children![0].name).toBe('Label');
  });

  it('handles siblings at same indent', () => {
    const dsl = [
      'VerticalBox "Root"',
      '  TextBlock "Title"',
      '  TextBlock "Subtitle"',
      '  TextBlock "Footer"',
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].children).toHaveLength(3);
    expect(result.nodes[0].children![0].name).toBe('Title');
    expect(result.nodes[0].children![1].name).toBe('Subtitle');
    expect(result.nodes[0].children![2].name).toBe('Footer');
  });

  it('handles dedent back to earlier level', () => {
    const dsl = [
      'VerticalBox "Root"',
      '  HorizontalBox "Row1"',
      '    TextBlock "A"',
      '  HorizontalBox "Row2"',
      '    TextBlock "B"',
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.nodes).toHaveLength(1);
    const root = result.nodes[0];
    expect(root.children).toHaveLength(2);
    expect(root.children![0].name).toBe('Row1');
    expect(root.children![0].children).toHaveLength(1);
    expect(root.children![0].children![0].name).toBe('A');
    expect(root.children![1].name).toBe('Row2');
    expect(root.children![1].children).toHaveLength(1);
    expect(root.children![1].children![0].name).toBe('B');
  });

  // ---------------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------------

  it('parses string values', () => {
    const result = parseWidgetDsl('TextBlock "T" {Text: "Hello"}');
    expect(result.nodes[0].properties!.Text).toBe('Hello');
  });

  it('parses number values', () => {
    const result = parseWidgetDsl('Spacer "S" {Size: 24}');
    expect(result.nodes[0].properties!.Size).toBe(24);
  });

  it('parses boolean values', () => {
    const result = parseWidgetDsl('TextBlock "T" {bIsVariable: true, bHidden: false}');
    expect(result.nodes[0].properties!.bIsVariable).toBe(true);
    expect(result.nodes[0].properties!.bHidden).toBe(false);
  });

  it('parses dotted property paths', () => {
    const result = parseWidgetDsl('TextBlock "T" {Font.Size: 24, Font.Family: "Roboto"}');
    // preprocessWidgetNode expands dotted properties
    expect(result.nodes[0].properties).toEqual({
      Font: { Size: 24, Family: 'Roboto' },
    });
  });

  it('parses nested object properties', () => {
    const result = parseWidgetDsl('Border "B" {Padding: {Left: 10, Right: 10}}');
    expect(result.nodes[0].properties).toEqual({
      Padding: { Left: 10, Right: 10 },
    });
  });

  it('handles colons in string values (asset paths)', () => {
    const result = parseWidgetDsl('Image "Img" {Brush: "/Game/UI/Style:StyleName"}');
    expect(result.nodes[0].properties!.Brush).toBe('/Game/UI/Style:StyleName');
  });

  // ---------------------------------------------------------------------------
  // Attributes
  // ---------------------------------------------------------------------------

  it('[var] sets is_variable=true', () => {
    const result = parseWidgetDsl('TextBlock "T" [var]');
    expect(result.nodes[0].is_variable).toBe(true);
  });

  it('[variable] sets is_variable=true', () => {
    const result = parseWidgetDsl('TextBlock "T" [variable]');
    expect(result.nodes[0].is_variable).toBe(true);
  });

  it('[anchor=center] sets slot preset', () => {
    const result = parseWidgetDsl('TextBlock "T" [anchor=center]');
    expect(result.nodes[0].slot).toEqual({
      Anchors: { Minimum: { X: 0.5, Y: 0.5 }, Maximum: { X: 0.5, Y: 0.5 } },
      Alignment: { X: 0.5, Y: 0.5 },
    });
  });

  it('[anchor=fill] sets slot preset', () => {
    const result = parseWidgetDsl('CanvasPanel "Root" [anchor=fill]');
    expect(result.nodes[0].slot).toEqual({
      Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 1, Y: 1 } },
      Offsets: { Left: 0, Top: 0, Right: 0, Bottom: 0 },
    });
  });

  it('multiple attributes comma-separated', () => {
    const result = parseWidgetDsl('TextBlock "T" [var, anchor=center]');
    expect(result.nodes[0].is_variable).toBe(true);
    expect(result.nodes[0].slot).toBeDefined();
    expect(result.nodes[0].slot!.Alignment).toEqual({ X: 0.5, Y: 0.5 });
  });

  it('[halign=center] sets HorizontalAlignment property', () => {
    const result = parseWidgetDsl('TextBlock "T" [halign=center]');
    expect(result.nodes[0].properties!.HorizontalAlignment).toBe('HAlign_Center');
  });

  it('[valign=top] sets VerticalAlignment property', () => {
    const result = parseWidgetDsl('TextBlock "T" [valign=top]');
    expect(result.nodes[0].properties!.VerticalAlignment).toBe('VAlign_Top');
  });

  it('[padding=10] sets uniform padding', () => {
    const result = parseWidgetDsl('VerticalBox "V" [padding=10]');
    expect(result.nodes[0].properties!.Padding).toEqual({
      Left: 10, Top: 10, Right: 10, Bottom: 10,
    });
  });

  it('[padding=T,R,B,L] sets per-side padding', () => {
    const result = parseWidgetDsl('VerticalBox "V" [padding=5,10,15,20]');
    expect(result.nodes[0].properties!.Padding).toEqual({
      Top: 5, Right: 10, Bottom: 15, Left: 20,
    });
  });

  it('unknown key=value attributes go to slot', () => {
    const result = parseWidgetDsl('TextBlock "T" [FillWeight=2]');
    expect(result.nodes[0].slot).toEqual({ FillWeight: 2 });
  });

  // ---------------------------------------------------------------------------
  // Aliases & presets integration
  // ---------------------------------------------------------------------------

  it('resolves class aliases (text -> TextBlock)', () => {
    const result = parseWidgetDsl('text "T"');
    expect(result.nodes[0].class).toBe('TextBlock');
  });

  it('resolves class aliases (button -> CommonButtonBase)', () => {
    const result = parseWidgetDsl('button "Btn"');
    expect(result.nodes[0].class).toBe('CommonButtonBase');
  });

  it('resolves class aliases (vbox -> VerticalBox)', () => {
    const result = parseWidgetDsl('vbox "Layout"');
    expect(result.nodes[0].class).toBe('VerticalBox');
  });

  it('resolves slot presets from [anchor=...]', () => {
    const result = parseWidgetDsl('text "T" [anchor=top-left]');
    expect(result.nodes[0].slot).toEqual({
      Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 0, Y: 0 } },
    });
  });

  it('expands dotted properties', () => {
    const result = parseWidgetDsl('text "T" {ColorAndOpacity.R: 1.0, ColorAndOpacity.G: 0.5}');
    expect(result.nodes[0].properties).toEqual({
      ColorAndOpacity: { R: 1.0, G: 0.5 },
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('skips blank lines and comments', () => {
    const dsl = [
      '# This is a comment',
      '',
      'CanvasPanel "Root"',
      '  # Another comment',
      '  TextBlock "Title"',
      '',
      '  TextBlock "Subtitle"',
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].children).toHaveLength(2);
  });

  it('handles empty input', () => {
    const result = parseWidgetDsl('');
    expect(result.nodes).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles whitespace-only input', () => {
    const result = parseWidgetDsl('   \n  \n  ');
    expect(result.nodes).toHaveLength(0);
  });

  it('handles trailing whitespace', () => {
    const result = parseWidgetDsl('TextBlock "Title"   ');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].name).toBe('Title');
  });

  it('warns on inconsistent indentation', () => {
    const dsl = [
      'CanvasPanel "Root"',
      '  TextBlock "A"',
      '   TextBlock "B"',  // 3 spaces — inconsistent with 2-space unit
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes('inconsistent indentation'))).toBe(true);
  });

  it('auto-generates names when not provided', () => {
    const result = parseWidgetDsl('TextBlock\nSpacer');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].name).toBe('TextBlock_0');
    expect(result.nodes[1].name).toBe('Spacer_1');
  });

  it('handles properties block before attributes block', () => {
    const result = parseWidgetDsl('TextBlock "T" {Text: "Hi"} [var]');
    expect(result.nodes[0].properties).toEqual({ Text: 'Hi' });
    expect(result.nodes[0].is_variable).toBe(true);
  });

  it('handles attributes block before properties block', () => {
    const result = parseWidgetDsl('TextBlock "T" [var] {Text: "Hi"}');
    expect(result.nodes[0].properties).toEqual({ Text: 'Hi' });
    expect(result.nodes[0].is_variable).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Full integration — plan example (main menu)
  // ---------------------------------------------------------------------------

  it('parses the plan example (main menu)', () => {
    const dsl = [
      'CanvasPanel "Root"',
      '  VerticalBox "MainContent" [anchor=center]',
      '    TextBlock "Title" {Text: "Main Menu", Font.Size: 24} [var]',
      '    Spacer {Size.Y: 20}',
      '    CommonButtonBase "PlayBtn" {Text: "Play"} [var]',
      '    CommonButtonBase "SettingsBtn" {Text: "Settings"} [var]',
      '    CommonButtonBase "QuitBtn" {Text: "Quit"} [var]',
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.warnings).toHaveLength(0);
    expect(result.nodes).toHaveLength(1);

    const root = result.nodes[0];
    expect(root.class).toBe('CanvasPanel');
    expect(root.name).toBe('Root');
    expect(root.children).toHaveLength(1);

    const mainContent = root.children![0];
    expect(mainContent.class).toBe('VerticalBox');
    expect(mainContent.name).toBe('MainContent');
    // anchor=center resolved to slot preset
    expect(mainContent.slot).toEqual({
      Anchors: { Minimum: { X: 0.5, Y: 0.5 }, Maximum: { X: 0.5, Y: 0.5 } },
      Alignment: { X: 0.5, Y: 0.5 },
    });
    expect(mainContent.children).toHaveLength(5);

    // Title
    const title = mainContent.children![0];
    expect(title.class).toBe('TextBlock');
    expect(title.name).toBe('Title');
    expect(title.is_variable).toBe(true);
    expect(title.properties).toEqual({
      Text: 'Main Menu',
      Font: { Size: 24 },
    });

    // Spacer — auto-generated name after preprocessWidgetNode alias resolution
    const spacer = mainContent.children![1];
    expect(spacer.class).toBe('Spacer');
    expect(spacer.properties).toEqual({ Size: { Y: 20 } });

    // Play button
    const playBtn = mainContent.children![2];
    expect(playBtn.class).toBe('CommonButtonBase');
    expect(playBtn.name).toBe('PlayBtn');
    expect(playBtn.is_variable).toBe(true);
    expect(playBtn.properties).toEqual({ Text: 'Play' });

    // Settings button
    const settingsBtn = mainContent.children![3];
    expect(settingsBtn.class).toBe('CommonButtonBase');
    expect(settingsBtn.name).toBe('SettingsBtn');
    expect(settingsBtn.is_variable).toBe(true);
    expect(settingsBtn.properties).toEqual({ Text: 'Settings' });

    // Quit button
    const quitBtn = mainContent.children![4];
    expect(quitBtn.class).toBe('CommonButtonBase');
    expect(quitBtn.name).toBe('QuitBtn');
    expect(quitBtn.is_variable).toBe(true);
    expect(quitBtn.properties).toEqual({ Text: 'Quit' });
  });

  // ---------------------------------------------------------------------------
  // Aliases in the full tree
  // ---------------------------------------------------------------------------

  it('resolves aliases within a nested tree', () => {
    const dsl = [
      'canvas "Root"',
      '  vbox "Layout"',
      '    text "Label" {Text: "Hello"}',
      '    button "Go" {Text: "Click"} [var]',
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].class).toBe('CanvasPanel');
    const layout = result.nodes[0].children![0];
    expect(layout.class).toBe('VerticalBox');
    expect(layout.children![0].class).toBe('TextBlock');
    expect(layout.children![1].class).toBe('CommonButtonBase');
    expect(layout.children![1].is_variable).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Tab-based indentation detection
  // ---------------------------------------------------------------------------

  it('handles 4-space indentation units', () => {
    const dsl = [
      'CanvasPanel "Root"',
      '    TextBlock "A"',
      '    TextBlock "B"',
      '        Spacer "C"',
    ].join('\n');

    const result = parseWidgetDsl(dsl);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].children).toHaveLength(2);
    expect(result.nodes[0].children![0].name).toBe('A');
    expect(result.nodes[0].children![1].name).toBe('B');
    expect(result.nodes[0].children![1].children).toHaveLength(1);
    expect(result.nodes[0].children![1].children![0].name).toBe('C');
  });
});
