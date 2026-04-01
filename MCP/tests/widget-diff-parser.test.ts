import { describe, expect, it, beforeEach } from 'vitest';
import { parseWidgetDiff } from '../src/helpers/widget-diff-parser.js';
import type { WidgetDiffOperation } from '../src/helpers/widget-diff-parser.js';
import { resetAutoNameCounter } from '../src/helpers/widget-dsl-parser.js';

beforeEach(() => {
  resetAutoNameCounter();
});

// ---------------------------------------------------------------------------
// Helper to find operations by type and target
// ---------------------------------------------------------------------------

function findOp(ops: WidgetDiffOperation[], type: string, target: string): WidgetDiffOperation | undefined {
  return ops.find((op) => op.type === type && op.target === target);
}

// ---------------------------------------------------------------------------
// Basic diff parsing
// ---------------------------------------------------------------------------

describe('parseWidgetDiff — basic parsing', () => {
  it('parses a diff with only additions', () => {
    const diff = [
      'CanvasPanel "Root"',
      '+   TextBlock "NewTitle" {Text: "Hello"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('insert');
    expect(result.operations[0].target).toBe('NewTitle');
    expect(result.operations[0].parent).toBe('Root');
  });

  it('parses a diff with only removals', () => {
    const diff = [
      'CanvasPanel "Root"',
      '- TextBlock "OldTitle" {Text: "Bye"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('remove');
    expect(result.operations[0].target).toBe('OldTitle');
  });

  it('parses a diff with additions and removals', () => {
    const diff = [
      'CanvasPanel "Root"',
      '- TextBlock "OldTitle" {Text: "Old"}',
      '+ TextBlock "NewTitle" {Text: "New"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    // Should have a removal and an insertion
    const removeOp = findOp(result.operations, 'remove', 'OldTitle');
    const insertOp = findOp(result.operations, 'insert', 'NewTitle');
    expect(removeOp).toBeDefined();
    expect(insertOp).toBeDefined();
  });

  it('handles context-only diff (no changes)', () => {
    const diff = [
      'CanvasPanel "Root"',
      '  TextBlock "Title" {Text: "Hello"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    expect(result.operations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Operation generation
// ---------------------------------------------------------------------------

describe('parseWidgetDiff — operation generation', () => {
  it('generates remove operations for deleted widgets', () => {
    const diff = [
      'VerticalBox "Root"',
      '- TextBlock "DeleteMe" {Text: "Gone"}',
      '  TextBlock "KeepMe" {Text: "Stay"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    const removeOps = result.operations.filter((op) => op.type === 'remove');
    expect(removeOps).toHaveLength(1);
    expect(removeOps[0].target).toBe('DeleteMe');
  });

  it('generates insert operations for added widgets', () => {
    const diff = [
      'VerticalBox "Root"',
      '  TextBlock "Existing" {Text: "Here"}',
      '+ TextBlock "NewWidget" {Text: "Added"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    const insertOps = result.operations.filter((op) => op.type === 'insert');
    expect(insertOps).toHaveLength(1);
    expect(insertOps[0].target).toBe('NewWidget');
    expect(insertOps[0].parent).toBe('Root');
    expect(insertOps[0].node).toBeDefined();
    expect(insertOps[0].node!.class).toBe('TextBlock');
    expect(insertOps[0].node!.name).toBe('NewWidget');
  });

  it('generates patch operations for modified properties', () => {
    const diff = [
      'VerticalBox "Root"',
      '- TextBlock "Title" {Text: "Old"}',
      '+ TextBlock "Title" {Text: "New"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    const patchOps = result.operations.filter((op) => op.type === 'patch');
    expect(patchOps).toHaveLength(1);
    expect(patchOps[0].target).toBe('Title');
    expect(patchOps[0].properties).toEqual({ Text: 'New' });
  });

  it('handles added children under existing parent', () => {
    const diff = [
      'CanvasPanel "Root"',
      '  VerticalBox "Content"',
      '+     TextBlock "NewChild" {Text: "Hello"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    const insertOps = result.operations.filter((op) => op.type === 'insert');
    expect(insertOps).toHaveLength(1);
    expect(insertOps[0].target).toBe('NewChild');
    expect(insertOps[0].parent).toBe('Content');
  });

  it('handles nested additions (parent + children added together)', () => {
    const diff = [
      'CanvasPanel "Root"',
      '+   HorizontalBox "ButtonRow"',
      '+     CommonButtonBase "SettingsBtn" {Text: "Settings"}',
      '+     CommonButtonBase "QuitBtn" {Text: "Quit"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    // The parent HorizontalBox is inserted with its children
    const insertOps = result.operations.filter((op) => op.type === 'insert');
    expect(insertOps).toHaveLength(1);
    expect(insertOps[0].target).toBe('ButtonRow');
    expect(insertOps[0].parent).toBe('Root');
    // Children should be nested inside the node
    expect(insertOps[0].node!.children).toBeDefined();
    const children = insertOps[0].node!.children as Array<Record<string, unknown>>;
    expect(children).toHaveLength(2);
    expect(children[0].name).toBe('SettingsBtn');
    expect(children[1].name).toBe('QuitBtn');
  });
});

// ---------------------------------------------------------------------------
// Complex scenarios
// ---------------------------------------------------------------------------

describe('parseWidgetDiff — complex scenarios', () => {
  it('parses the plan example (replace title + add button row)', () => {
    const diff = [
      'CanvasPanel "Root"',
      '  VerticalBox "MainContent"',
      '-   TextBlock "OldTitle" {Text: "Old"}',
      '+   TextBlock "NewTitle" {Text: "New", Font.Size: 28} [var]',
      '    CommonButtonBase "PlayBtn"',
      '+   HorizontalBox "ButtonRow"',
      '+     CommonButtonBase "SettingsBtn" {Text: "Settings"}',
      '+     CommonButtonBase "QuitBtn" {Text: "Quit"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);

    // Should have: remove OldTitle, insert NewTitle, insert ButtonRow (with children)
    const removeOp = findOp(result.operations, 'remove', 'OldTitle');
    const insertTitle = findOp(result.operations, 'insert', 'NewTitle');
    const insertRow = findOp(result.operations, 'insert', 'ButtonRow');

    expect(removeOp).toBeDefined();
    expect(insertTitle).toBeDefined();
    expect(insertTitle!.node!.properties).toEqual({ Text: 'New', Font: { Size: 28 } });
    expect(insertTitle!.node!.is_variable).toBe(true);

    expect(insertRow).toBeDefined();
    expect(insertRow!.parent).toBe('MainContent');
    const rowChildren = insertRow!.node!.children as Array<Record<string, unknown>>;
    expect(rowChildren).toHaveLength(2);
    expect(rowChildren[0].name).toBe('SettingsBtn');
    expect(rowChildren[1].name).toBe('QuitBtn');
  });

  it('handles property-only changes (no structural changes)', () => {
    const diff = [
      'VerticalBox "Root"',
      '- TextBlock "Title" {Text: "Old", Font.Size: 18}',
      '+ TextBlock "Title" {Text: "New", Font.Size: 24}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('patch');
    expect(result.operations[0].target).toBe('Title');
    expect(result.operations[0].properties).toEqual({ Text: 'New', Font: { Size: 24 } });
  });

  it('handles slot changes via attributes', () => {
    const diff = [
      'CanvasPanel "Root"',
      '- TextBlock "Title" [anchor=center]',
      '+ TextBlock "Title" [anchor=fill]',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('patch');
    expect(result.operations[0].target).toBe('Title');
    expect(result.operations[0].slot).toBeDefined();
  });

  it('preserves operation order (removals before patches before insertions)', () => {
    const diff = [
      'VerticalBox "Root"',
      '- TextBlock "Remove1"',
      '+ TextBlock "Add1"',
      '- TextBlock "Title" {Text: "Old"}',
      '+ TextBlock "Title" {Text: "New"}',
      '+ TextBlock "Add2"',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    // Verify ordering: removes first, then patches, then inserts
    const typeOrder = result.operations.map((op) => op.type);
    const removeIdx = typeOrder.indexOf('remove');
    const patchIdx = typeOrder.indexOf('patch');
    const insertIdx = typeOrder.indexOf('insert');

    if (removeIdx >= 0 && patchIdx >= 0) {
      expect(removeIdx).toBeLessThan(patchIdx);
    }
    if (patchIdx >= 0 && insertIdx >= 0) {
      expect(patchIdx).toBeLessThan(insertIdx);
    }
    if (removeIdx >= 0 && insertIdx >= 0) {
      expect(removeIdx).toBeLessThan(insertIdx);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('parseWidgetDiff — edge cases', () => {
  it('returns empty operations for identical before/after', () => {
    const diff = [
      'CanvasPanel "Root"',
      '  TextBlock "Title" {Text: "Same"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    expect(result.operations).toHaveLength(0);
  });

  it('handles empty diff string', () => {
    const result = parseWidgetDiff('');
    expect(result.operations).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles diff with only context lines', () => {
    const diff = [
      'CanvasPanel "Root"',
      '  VerticalBox "Content"',
      '    TextBlock "Title" {Text: "Hello"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    expect(result.operations).toHaveLength(0);
  });

  it('handles whitespace-only diff string', () => {
    const result = parseWidgetDiff('   \n  \n  ');
    expect(result.operations).toHaveLength(0);
  });

  it('handles diff with space-indented context lines alongside additions', () => {
    const diff = [
      'CanvasPanel "Root"',
      '  VerticalBox "Content"',
      '+     TextBlock "NewTitle" {Text: "Added"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('insert');
    expect(result.operations[0].target).toBe('NewTitle');
    expect(result.operations[0].parent).toBe('Content');
  });

  it('handles is_variable flag change', () => {
    const diff = [
      'VerticalBox "Root"',
      '- TextBlock "Title" {Text: "Hello"}',
      '+ TextBlock "Title" {Text: "Hello"} [var]',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('patch');
    expect(result.operations[0].is_variable).toBe(true);
  });

  it('handles adding multiple siblings at once', () => {
    const diff = [
      'VerticalBox "Root"',
      '+ TextBlock "A" {Text: "First"}',
      '+ TextBlock "B" {Text: "Second"}',
      '+ TextBlock "C" {Text: "Third"}',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    const insertOps = result.operations.filter((op) => op.type === 'insert');
    expect(insertOps).toHaveLength(3);
    expect(insertOps.map((op) => op.target)).toEqual(['A', 'B', 'C']);
  });

  it('handles removing all children from a parent', () => {
    const diff = [
      'VerticalBox "Root"',
      '- TextBlock "A"',
      '- TextBlock "B"',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    const removeOps = result.operations.filter((op) => op.type === 'remove');
    expect(removeOps).toHaveLength(2);
    expect(removeOps.map((op) => op.target)).toEqual(['A', 'B']);
  });

  it('generates correct index for inserted widgets', () => {
    const diff = [
      'VerticalBox "Root"',
      '  TextBlock "First"',
      '+ TextBlock "Inserted" {Text: "Middle"}',
      '  TextBlock "Last"',
    ].join('\n');

    const result = parseWidgetDiff(diff);
    const insertOps = result.operations.filter((op) => op.type === 'insert');
    expect(insertOps).toHaveLength(1);
    expect(insertOps[0].target).toBe('Inserted');
    expect(insertOps[0].index).toBe(1);
  });
});
