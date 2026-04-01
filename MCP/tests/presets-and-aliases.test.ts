import { describe, expect, it } from 'vitest';
import { expandDottedProperties } from '../src/helpers/property-shorthand.js';
import { resolveSlotPreset, getAvailableSlotPresets } from '../src/helpers/slot-presets.js';
import { resolveWidgetClassAlias, getAvailableWidgetClassAliases } from '../src/helpers/widget-class-aliases.js';
import { preprocessWidgetNode } from '../src/helpers/widget-utils.js';

describe('slot presets', () => {
  it('resolves known preset names to slot objects', () => {
    const center = resolveSlotPreset('center');
    expect(center).toEqual({
      Anchors: { Minimum: { X: 0.5, Y: 0.5 }, Maximum: { X: 0.5, Y: 0.5 } },
      Alignment: { X: 0.5, Y: 0.5 },
    });

    const fill = resolveSlotPreset('fill');
    expect(fill).toEqual({
      Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 1, Y: 1 } },
      Offsets: { Left: 0, Top: 0, Right: 0, Bottom: 0 },
    });
  });

  it('passes through object slots unchanged', () => {
    const custom = { Anchors: { Minimum: { X: 0.3, Y: 0.3 }, Maximum: { X: 0.7, Y: 0.7 } } };
    expect(resolveSlotPreset(custom)).toBe(custom);
  });

  it('returns empty object for undefined/null slot', () => {
    expect(resolveSlotPreset(undefined)).toEqual({});
    expect(resolveSlotPreset(null)).toEqual({});
  });

  it('throws for unknown preset names', () => {
    expect(() => resolveSlotPreset('nonexistent')).toThrow('Unknown slot preset: "nonexistent"');
  });

  it('returns a deep copy so nested mutations do not affect the original', () => {
    const a = resolveSlotPreset('center');
    const b = resolveSlotPreset('center');
    (a.Anchors as any).Minimum.X = 999;
    expect((b.Anchors as any).Minimum.X).toBe(0.5);
  });

  it('lists all available presets', () => {
    const presets = getAvailableSlotPresets();
    expect(presets).toContain('center');
    expect(presets).toContain('fill');
    expect(presets).toContain('top-left');
    expect(presets.length).toBeGreaterThanOrEqual(10);
  });
});

describe('widget class aliases', () => {
  it('resolves known aliases to full class names', () => {
    expect(resolveWidgetClassAlias('text')).toBe('TextBlock');
    expect(resolveWidgetClassAlias('button')).toBe('CommonButtonBase');
    expect(resolveWidgetClassAlias('vbox')).toBe('VerticalBox');
    expect(resolveWidgetClassAlias('hbox')).toBe('HorizontalBox');
    expect(resolveWidgetClassAlias('canvas')).toBe('CanvasPanel');
  });

  it('passes through full class names unchanged', () => {
    expect(resolveWidgetClassAlias('TextBlock')).toBe('TextBlock');
    expect(resolveWidgetClassAlias('CanvasPanel')).toBe('CanvasPanel');
    expect(resolveWidgetClassAlias('MyCustomWidget')).toBe('MyCustomWidget');
  });

  it('resolves case-insensitively', () => {
    expect(resolveWidgetClassAlias('TEXT')).toBe('TextBlock');
    expect(resolveWidgetClassAlias('Button')).toBe('CommonButtonBase');
    expect(resolveWidgetClassAlias('VBOX')).toBe('VerticalBox');
  });

  it('returns all aliases', () => {
    const aliases = getAvailableWidgetClassAliases();
    expect(aliases.text).toBe('TextBlock');
    expect(aliases.button).toBe('CommonButtonBase');
    expect(Object.keys(aliases).length).toBeGreaterThanOrEqual(20);
  });
});

describe('dotted property expansion', () => {
  it('expands dotted keys into nested objects', () => {
    const result = expandDottedProperties({
      'ColorAndOpacity.R': 1.0,
      'ColorAndOpacity.G': 0.5,
      'ColorAndOpacity.B': 0.0,
    });
    expect(result).toEqual({
      ColorAndOpacity: { R: 1.0, G: 0.5, B: 0.0 },
    });
  });

  it('passes flat keys through unchanged', () => {
    const result = expandDottedProperties({ Text: 'Hello', FontSize: 24 });
    expect(result).toEqual({ Text: 'Hello', FontSize: 24 });
  });

  it('handles deep nesting', () => {
    const result = expandDottedProperties({ 'a.b.c.d': 42 });
    expect(result).toEqual({ a: { b: { c: { d: 42 } } } });
  });

  it('merges multiple dotted keys sharing a prefix', () => {
    const result = expandDottedProperties({
      'Margin.Left': 10,
      'Margin.Right': 20,
      'Padding.Top': 5,
    });
    expect(result).toEqual({
      Margin: { Left: 10, Right: 20 },
      Padding: { Top: 5 },
    });
  });

  it('throws on key conflict between flat value and dotted prefix', () => {
    expect(() => expandDottedProperties({ 'Margin': 'auto', 'Margin.Right': 20 })).toThrow('key conflict');
  });

  it('mixes flat and dotted keys', () => {
    const result = expandDottedProperties({
      Visibility: 'Visible',
      'RenderTransform.Translation.X': 100,
    });
    expect(result).toEqual({
      Visibility: 'Visible',
      RenderTransform: { Translation: { X: 100 } },
    });
  });
});

describe('preprocessWidgetNode', () => {
  it('resolves class aliases', () => {
    const node = preprocessWidgetNode({ class: 'text', name: 'Title' });
    expect(node.class).toBe('TextBlock');
  });

  it('resolves slot presets', () => {
    const node = preprocessWidgetNode({ class: 'TextBlock', name: 'Title', slot: 'center' });
    expect(node.slot).toEqual({
      Anchors: { Minimum: { X: 0.5, Y: 0.5 }, Maximum: { X: 0.5, Y: 0.5 } },
      Alignment: { X: 0.5, Y: 0.5 },
    });
  });

  it('expands dotted properties', () => {
    const node = preprocessWidgetNode({
      class: 'TextBlock',
      name: 'Title',
      properties: { 'ColorAndOpacity.R': 1.0, 'ColorAndOpacity.G': 0.0 },
    });
    expect(node.properties).toEqual({
      ColorAndOpacity: { R: 1.0, G: 0.0 },
    });
  });

  it('applies all transformations recursively to children', () => {
    const tree = preprocessWidgetNode({
      class: 'canvas',
      name: 'Root',
      slot: 'fill',
      children: [
        {
          class: 'text',
          name: 'Title',
          slot: 'center',
          properties: { 'Font.Size': 24 },
        },
        {
          class: 'vbox',
          name: 'Layout',
          children: [
            { class: 'image', name: 'Icon', slot: 'top-left' },
          ],
        },
      ],
    });

    expect(tree.class).toBe('CanvasPanel');
    expect(tree.slot).toEqual({
      Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 1, Y: 1 } },
      Offsets: { Left: 0, Top: 0, Right: 0, Bottom: 0 },
    });

    const children = tree.children as Record<string, unknown>[];
    expect(children[0].class).toBe('TextBlock');
    expect((children[0].slot as Record<string, unknown>).Alignment).toEqual({ X: 0.5, Y: 0.5 });
    expect(children[0].properties).toEqual({ Font: { Size: 24 } });

    expect(children[1].class).toBe('VerticalBox');
    const grandchildren = children[1].children as Record<string, unknown>[];
    expect(grandchildren[0].class).toBe('Image');
    expect(grandchildren[0].slot).toEqual({
      Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 0, Y: 0 } },
    });
  });

  it('passes through full class names, object slots, and flat properties', () => {
    const original = {
      class: 'CanvasPanel',
      name: 'Root',
      slot: { Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 1, Y: 1 } } },
      properties: { Text: 'Hello' },
    };
    const processed = preprocessWidgetNode(original);
    expect(processed.class).toBe('CanvasPanel');
    expect(processed.slot).toBe(original.slot);
    expect(processed.properties).toEqual({ Text: 'Hello' });
  });

  it('does not mutate the original node', () => {
    const original = {
      class: 'text',
      name: 'Title',
      slot: 'center',
      properties: { 'A.B': 1 },
      children: [{ class: 'image', name: 'Icon' }],
    };
    const originalClass = original.class;
    const originalSlot = original.slot;
    preprocessWidgetNode(original);
    expect(original.class).toBe(originalClass);
    expect(original.slot).toBe(originalSlot);
  });
});
