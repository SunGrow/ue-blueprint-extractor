import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerTablesAndCurvesTools } from '../src/tools/tables-and-curves.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const dataTableRowSchema = z.object({
  rowName: z.string(),
}).passthrough();
const curveTypeSchema = z.enum(['Float', 'Vector', 'LinearColor']);
const curveChannelSchema = z.object({}).passthrough();
const curveKeyDeleteSchema = z.object({
  channel: z.string(),
  time: z.number(),
}).passthrough();
const curveKeyUpsertSchema = z.object({
  channel: z.string(),
  key: z.object({}).passthrough(),
}).passthrough();
const curveTableModeSchema = z.enum(['RichCurves', 'SimpleCurves']);
const curveTableRowSchema = z.object({
  rowName: z.string(),
}).passthrough();

function setupRegistry(callSubsystemJson = vi.fn(async () => ({ success: true }))) {
  const registry = createToolRegistry();
  registerTablesAndCurvesTools({
    server: registry.server,
    callSubsystemJson,
    dataTableRowSchema,
    curveTypeSchema,
    curveChannelSchema,
    curveKeyDeleteSchema,
    curveKeyUpsertSchema,
    curveTableModeSchema,
    curveTableRowSchema,
  });
  return { registry, callSubsystemJson };
}

describe('registerTablesAndCurvesTools', () => {
  it('serializes create_data_table rows for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      rowCount: 1,
    })));

    const result = await registry.getTool('create_data_table').handler({
      asset_path: '/Game/Data/DT_Items',
      row_struct_path: '/Script/Test.ItemRow',
      rows: [{
        rowName: 'Sword',
        values: { Damage: 10 },
      }],
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateDataTable', {
      AssetPath: '/Game/Data/DT_Items',
      RowStructPath: '/Script/Test.ItemRow',
      RowsJson: JSON.stringify([{
        rowName: 'Sword',
        values: { Damage: 10 },
      }]),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      rowCount: 1,
    });
  });

  it('returns an error when curve mutation fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('curve write failed');
    }));

    const result = await registry.getTool('modify_curve').handler({
      asset_path: '/Game/Data/C_Speed',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'curve write failed',
    );
  });

  it('serializes data-table replace/delete payloads and curve key upserts separately', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async (method) => ({
      success: true,
      operation: method,
    })));

    await registry.getTool('modify_data_table').handler({
      asset_path: '/Game/Data/DT_Items',
      rows: [{
        rowName: 'Shield',
        values: { Armor: 20 },
      }],
      delete_rows: ['OldShield'],
      replace_rows: true,
      validate_only: false,
    });
    const curveResult = await registry.getTool('modify_curve').handler({
      asset_path: '/Game/Data/C_Speed',
      channels: {
        default: { defaultValue: 1 },
      },
      delete_keys: [{
        channel: 'default',
        time: 0,
      }],
      upsert_keys: [{
        channel: 'default',
        key: { time: 1, value: 2 },
      }],
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'ModifyDataTable', {
      AssetPath: '/Game/Data/DT_Items',
      PayloadJson: JSON.stringify({
        rows: [{
          rowName: 'Shield',
          values: { Armor: 20 },
        }],
        deleteRows: ['OldShield'],
        replaceRows: true,
      }),
      bValidateOnly: false,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'ModifyCurve', {
      AssetPath: '/Game/Data/C_Speed',
      PayloadJson: JSON.stringify({
        channels: {
          default: { defaultValue: 1 },
        },
        deleteKeys: [{
          channel: 'default',
          time: 0,
        }],
        upsertKeys: [{
          channel: 'default',
          key: { time: 1, value: 2 },
        }],
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(curveResult)).toMatchObject({
      success: true,
      operation: 'ModifyCurve',
    });
  });

  // --- C3: Additional Table & Curve tool tests ---

  it('returns an error when create_data_table fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('data table creation failed');
    }));

    const result = await registry.getTool('create_data_table').handler({
      asset_path: '/Game/Data/DT_Bad',
      row_struct_path: '/Script/Test.BadRow',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'data table creation failed',
    );
  });

  it('returns an error when modify_data_table fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('data table modification failed');
    }));

    const result = await registry.getTool('modify_data_table').handler({
      asset_path: '/Game/Data/DT_Items',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'data table modification failed',
    );
  });

  it('serializes create_curve payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Data/C_Speed',
    })));

    const result = await registry.getTool('create_curve').handler({
      asset_path: '/Game/Data/C_Speed',
      curve_type: 'Float',
      channels: {
        default: { defaultValue: 0, keys: [{ time: 0, value: 1 }] },
      },
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateCurve', {
      AssetPath: '/Game/Data/C_Speed',
      CurveType: 'Float',
      ChannelsJson: JSON.stringify({
        default: { defaultValue: 0, keys: [{ time: 0, value: 1 }] },
      }),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Data/C_Speed',
    });
  });

  it('returns an error when create_curve fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('curve creation failed');
    }));

    const result = await registry.getTool('create_curve').handler({
      asset_path: '/Game/Data/C_Bad',
      curve_type: 'Float',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'curve creation failed',
    );
  });

  it('serializes create_curve_table payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      assetPath: '/Game/Data/CT_Damage',
    })));

    const result = await registry.getTool('create_curve_table').handler({
      asset_path: '/Game/Data/CT_Damage',
      curve_table_mode: 'RichCurves',
      rows: [{
        rowName: 'BaseDamage',
        curve: { defaultValue: 10 },
      }],
      validate_only: true,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('CreateCurveTable', {
      AssetPath: '/Game/Data/CT_Damage',
      CurveTableMode: 'RichCurves',
      RowsJson: JSON.stringify([{
        rowName: 'BaseDamage',
        curve: { defaultValue: 10 },
      }]),
      bValidateOnly: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      assetPath: '/Game/Data/CT_Damage',
    });
  });

  it('returns an error when create_curve_table fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('curve table creation failed');
    }));

    const result = await registry.getTool('create_curve_table').handler({
      asset_path: '/Game/Data/CT_Bad',
      curve_table_mode: 'SimpleCurves',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'curve table creation failed',
    );
  });

  it('serializes modify_curve_table payloads for the subsystem', async () => {
    const { registry, callSubsystemJson } = setupRegistry(vi.fn(async () => ({
      success: true,
      operation: 'ModifyCurveTable',
    })));

    const result = await registry.getTool('modify_curve_table').handler({
      asset_path: '/Game/Data/CT_Damage',
      rows: [{
        rowName: 'BaseDamage',
        curve: { defaultValue: 20 },
      }],
      delete_rows: ['OldRow'],
      replace_rows: true,
      validate_only: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ModifyCurveTable', {
      AssetPath: '/Game/Data/CT_Damage',
      PayloadJson: JSON.stringify({
        rows: [{
          rowName: 'BaseDamage',
          curve: { defaultValue: 20 },
        }],
        deleteRows: ['OldRow'],
        replaceRows: true,
      }),
      bValidateOnly: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'ModifyCurveTable',
    });
  });

  it('returns an error when modify_curve_table fails', async () => {
    const { registry } = setupRegistry(vi.fn(async () => {
      throw new Error('curve table modification failed');
    }));

    const result = await registry.getTool('modify_curve_table').handler({
      asset_path: '/Game/Data/CT_Damage',
      validate_only: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'curve table modification failed',
    );
  });
});
