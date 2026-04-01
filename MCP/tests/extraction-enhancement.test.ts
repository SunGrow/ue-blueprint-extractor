import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  compactGenericExtraction,
  compactWidgetBlueprint,
} from '../src/compactor.js';
import { limitWidgetTreeDepth } from '../src/helpers/widget-utils.js';
import { registerWidgetExtractionTools } from '../src/tools/widget-extraction.js';
import { registerExtractionTools } from '../src/tools/extraction.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';

describe('null stripping in compactor', () => {
  it('removes null values from nested objects', () => {
    const data = {
      success: true,
      item: {
        name: 'Test',
        description: null,
        nested: {
          value: 42,
          empty: null,
        },
      },
    };

    const compacted = compactGenericExtraction(data) as typeof data;
    expect((compacted.item as Record<string, unknown>).description).toBeUndefined();
    expect((compacted.item.nested as Record<string, unknown>).empty).toBeUndefined();
    expect(compacted.item.name).toBe('Test');
    expect(compacted.item.nested.value).toBe(42);
  });

  it('removes null values from arrays of objects', () => {
    const data = {
      items: [
        { name: 'A', tag: null },
        { name: 'B', tag: 'valid' },
      ],
    };

    const compacted = compactGenericExtraction(data) as typeof data;
    expect((compacted.items[0] as Record<string, unknown>).tag).toBeUndefined();
    expect(compacted.items[1]?.tag).toBe('valid');
  });

  it('objects that become empty after null removal are cleaned up by field stripping', () => {
    const data = {
      wrapper: {
        onlyNull: null,
      },
    };

    // compactGenericExtraction runs stripNullsInPlace then stripFields which cleans empties
    const compacted = compactGenericExtraction(data) as Record<string, unknown>;
    expect(compacted.wrapper).toBeUndefined();
  });

  it('null stripping runs in compactWidgetBlueprint', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        tooltip: null,
        children: [],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.tooltip).toBeUndefined();
  });
});

describe('default widget property stripping', () => {
  it('strips bIsVariable=false from widget nodes', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        bIsVariable: false,
        children: [],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.bIsVariable).toBeUndefined();
  });

  it('preserves bIsVariable=true', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        bIsVariable: true,
        children: [],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.bIsVariable).toBe(true);
  });

  it('strips Visibility=Visible and Visibility=SelfHitTestInvisible', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        Visibility: 'Visible',
        children: [{
          name: 'Overlay',
          Visibility: 'SelfHitTestInvisible',
        }],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.Visibility).toBeUndefined();
    expect(compacted.rootWidget.children[0].Visibility).toBeUndefined();
  });

  it('preserves non-default Visibility values', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        Visibility: 'Hidden',
        children: [],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.Visibility).toBe('Hidden');
  });

  it('strips RenderOpacity=1 and RenderOpacity=1.0', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        RenderOpacity: 1,
        children: [{
          name: 'Child',
          RenderOpacity: 1.0,
        }],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.RenderOpacity).toBeUndefined();
    expect(compacted.rootWidget.children[0].RenderOpacity).toBeUndefined();
  });

  it('preserves non-default RenderOpacity', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        RenderOpacity: 0.5,
        children: [],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.RenderOpacity).toBe(0.5);
  });

  it('strips IsEnabled=true', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        IsEnabled: true,
        children: [],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.IsEnabled).toBeUndefined();
  });

  it('preserves IsEnabled=false', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        IsEnabled: false,
        children: [],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.IsEnabled).toBe(false);
  });

  it('strips defaults recursively through nested children', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        bIsVariable: false,
        RenderOpacity: 1,
        children: [{
          name: 'Panel',
          IsEnabled: true,
          Visibility: 'SelfHitTestInvisible',
          children: [{
            name: 'Text',
            bIsVariable: false,
            RenderOpacity: 0.8,
          }],
        }],
      },
    };

    const compacted = compactWidgetBlueprint(data) as any;
    expect(compacted.rootWidget.bIsVariable).toBeUndefined();
    expect(compacted.rootWidget.RenderOpacity).toBeUndefined();
    expect(compacted.rootWidget.children[0].IsEnabled).toBeUndefined();
    expect(compacted.rootWidget.children[0].Visibility).toBeUndefined();
    expect(compacted.rootWidget.children[0].children[0].bIsVariable).toBeUndefined();
    expect(compacted.rootWidget.children[0].children[0].RenderOpacity).toBe(0.8);
  });
});

describe('limitWidgetTreeDepth', () => {
  it('depth=1 truncates root children', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        children: [
          { name: 'A', children: [{ name: 'A1' }] },
          { name: 'B' },
        ],
      },
    };

    limitWidgetTreeDepth(data, 1);
    expect(data.rootWidget.children).toEqual({ _truncated: true, childCount: 2 });
  });

  it('depth=2 keeps direct children but truncates grandchildren', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        children: [
          { name: 'A', children: [{ name: 'A1' }, { name: 'A2' }] },
          { name: 'B', children: [] },
        ],
      },
    };

    limitWidgetTreeDepth(data, 2);
    const children = data.rootWidget.children as any[];
    expect(children[0].name).toBe('A');
    expect(children[0].children).toEqual({ _truncated: true, childCount: 2 });
    expect(children[1].name).toBe('B');
    expect(children[1].children).toEqual([]);
  });

  it('depth=3 preserves two levels of children', () => {
    const data = {
      rootWidget: {
        name: 'Root',
        children: [{
          name: 'A',
          children: [{
            name: 'A1',
            children: [{ name: 'A1a' }, { name: 'A1b' }],
          }],
        }],
      },
    };

    limitWidgetTreeDepth(data, 3);
    const a = (data.rootWidget.children as any[])[0];
    const a1 = a.children[0];
    expect(a1.name).toBe('A1');
    expect(a1.children).toEqual({ _truncated: true, childCount: 2 });
  });

  it('handles widgetTree key', () => {
    const data = {
      widgetTree: {
        name: 'Root',
        children: [{ name: 'C1' }],
      },
    } as Record<string, unknown>;

    limitWidgetTreeDepth(data, 1);
    expect((data.widgetTree as any).children).toEqual({ _truncated: true, childCount: 1 });
  });

  it('handles tree key', () => {
    const data = {
      tree: {
        name: 'Root',
        children: [{ name: 'C1' }],
      },
    } as Record<string, unknown>;

    limitWidgetTreeDepth(data, 1);
    expect((data.tree as any).children).toEqual({ _truncated: true, childCount: 1 });
  });

  it('treats data as node when no recognized tree key but children present', () => {
    const data = {
      name: 'Root',
      children: [{ name: 'C1' }, { name: 'C2' }],
    } as Record<string, unknown>;

    limitWidgetTreeDepth(data, 1);
    expect(data.children).toEqual({ _truncated: true, childCount: 2 });
  });

  it('does nothing when no children are present', () => {
    const data = {
      rootWidget: { name: 'Root' },
    };

    limitWidgetTreeDepth(data, 1);
    expect(data.rootWidget).toEqual({ name: 'Root' });
  });

  it('integrates with extract_widget_blueprint via depth parameter', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      rootWidget: {
        name: 'Root',
        children: [
          { name: 'A', children: [{ name: 'A1' }] },
          { name: 'B' },
        ],
      },
    }));

    const extractWidgetAnimationResultSchema = z.object({}).passthrough();
    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Test',
      compact: false,
      depth: 1,
    });

    const parsed = parseDirectToolResult(result) as any;
    expect(parsed.rootWidget.children).toEqual({ _truncated: true, childCount: 2 });
  });
});

describe('fields filtering', () => {
  it('filters extract_widget_blueprint to requested keys', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      rootWidget: { name: 'Root', children: [] },
      compile: { status: 'ok' },
      bindings: { b1: 'val' },
      animations: ['anim1'],
    }));

    const extractWidgetAnimationResultSchema = z.object({}).passthrough();
    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Test',
      compact: false,
      fields: ['rootWidget', 'compile'],
    });

    const parsed = parseDirectToolResult(result) as any;
    expect(parsed.rootWidget).toBeDefined();
    expect(parsed.compile).toBeDefined();
    expect(parsed.success).toBe(true); // success is always preserved
    expect(parsed.bindings).toBeUndefined();
    expect(parsed.animations).toBeUndefined();
  });

  it('filters extract_blueprint to requested keys', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      success: true,
      blueprint: {
        className: 'BP_Test',
        variables: [{ name: 'Health' }],
        functions: [{ name: 'EventGraph' }],
      },
    }));

    const scopeEnum = z.enum(['Full', 'Variables', 'FunctionsShallow', 'ClassLevel']).default('Variables');
    const extractAssetTypeSchema = z.enum(['data_asset']);
    const cascadeResultSchema = z.object({}).passthrough();

    registerExtractionTools({
      server: registry.server,
      callSubsystemJson,
      scopeEnum,
      extractAssetTypeSchema,
      cascadeResultSchema,
    });

    const result = await registry.getTool('extract_blueprint').handler({
      asset_path: '/Game/BP_Test',
      compact: false,
      fields: ['blueprint'],
    });

    const parsed = parseDirectToolResult(result) as any;
    expect(parsed.blueprint).toBeDefined();
    expect(parsed.success).toBe(true);
  });

  it('returns empty filtered result when no fields match', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      rootWidget: { name: 'Root' },
      compile: {},
    }));

    const extractWidgetAnimationResultSchema = z.object({}).passthrough();
    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Test',
      compact: false,
      fields: ['nonexistent'],
    });

    const parsed = parseDirectToolResult(result) as any;
    expect(parsed.rootWidget).toBeUndefined();
    expect(parsed.compile).toBeUndefined();
  });

  it('fields filtering happens after compaction but before depth limiting', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      rootWidget: {
        name: 'Root',
        displayLabel: 'Root',
        visibility: 'Visible',
        properties: {},
        children: [
          { name: 'A', children: [{ name: 'A1' }] },
        ],
      },
      compile: { messages: [] },
      bindings: {},
      animations: [],
    }));

    const extractWidgetAnimationResultSchema = z.object({}).passthrough();
    registerWidgetExtractionTools({
      server: registry.server,
      callSubsystemJson,
      extractWidgetAnimationResultSchema,
    });

    const result = await registry.getTool('extract_widget_blueprint').handler({
      asset_path: '/Game/UI/WBP_Test',
      compact: true,
      fields: ['rootWidget'],
      depth: 1,
    });

    const parsed = parseDirectToolResult(result) as any;
    // fields filter kept rootWidget
    expect(parsed.rootWidget).toBeDefined();
    // compaction removed empty bindings/animations (but fields filter also excluded them)
    expect(parsed.bindings).toBeUndefined();
    // depth=1 truncated children
    expect(parsed.rootWidget.children).toEqual({ _truncated: true, childCount: 1 });
  });
});
