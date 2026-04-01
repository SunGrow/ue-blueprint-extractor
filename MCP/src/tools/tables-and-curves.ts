import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterTablesAndCurvesToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  dataTableRowSchema: z.ZodTypeAny;
  curveTypeSchema: z.ZodTypeAny;
  curveChannelSchema: z.ZodTypeAny;
  curveKeyDeleteSchema: z.ZodTypeAny;
  curveKeyUpsertSchema: z.ZodTypeAny;
  curveTableModeSchema: z.ZodTypeAny;
  curveTableRowSchema: z.ZodTypeAny;
};

export function registerTablesAndCurvesTools({
  server,
  callSubsystemJson,
  dataTableRowSchema,
  curveTypeSchema,
  curveChannelSchema,
  curveKeyDeleteSchema,
  curveKeyUpsertSchema,
  curveTableModeSchema,
  curveTableRowSchema,
}: RegisterTablesAndCurvesToolsOptions): void {
  server.registerTool(
    'create_data_table',
    {
      title: 'Create DataTable',
      description: 'Create a UE5 DataTable with a concrete row struct and optional initial rows.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new asset.',
        ),
        row_struct_path: z.string().describe(
          'Row struct script path.',
        ),
        rows: z.array(dataTableRowSchema).default([]).describe(
          'Initial rows.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Create DataTable',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, row_struct_path, rows, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateDataTable', {
          AssetPath: asset_path,
          RowStructPath: row_struct_path,
          RowsJson: JSON.stringify(rows ?? []),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_data_table',
    {
      title: 'Modify DataTable',
      description: 'Modify a UE5 DataTable by upserting rows, deleting rows, or replacing the full row set.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        rows: z.array(dataTableRowSchema).optional().describe(
          'Rows to upsert.',
        ),
        delete_rows: z.array(z.string()).optional().describe(
          'Row names to delete.',
        ),
        replace_rows: z.boolean().default(false).describe(
          'Clear table before applying rows.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Modify DataTable',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, rows, delete_rows, replace_rows, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ModifyDataTable', {
          AssetPath: asset_path,
          PayloadJson: JSON.stringify({
            rows: rows ?? [],
            deleteRows: delete_rows ?? [],
            replaceRows: replace_rows,
          }),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'create_curve',
    {
      title: 'Create Curve',
      description: 'Create a UE5 curve asset (Float, Vector, or LinearColor) and optionally initialize channel data.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new asset.',
        ),
        curve_type: curveTypeSchema.describe(
          'Curve asset type.',
        ),
        channels: z.record(z.string(), curveChannelSchema).default({}).describe(
          'Channel data by name.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Create Curve',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, curve_type, channels, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateCurve', {
          AssetPath: asset_path,
          CurveType: curve_type,
          ChannelsJson: JSON.stringify(channels ?? {}),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_curve',
    {
      title: 'Modify Curve',
      description: 'Modify a UE5 curve asset by patching channels and upserting or deleting individual keys.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        channels: z.record(z.string(), curveChannelSchema).optional().describe(
          'Channel patch.',
        ),
        delete_keys: z.array(curveKeyDeleteSchema).optional().describe(
          'Key deletions by channel+time.',
        ),
        upsert_keys: z.array(curveKeyUpsertSchema).optional().describe(
          'Key upserts by channel.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Modify Curve',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, channels, delete_keys, upsert_keys, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ModifyCurve', {
          AssetPath: asset_path,
          PayloadJson: JSON.stringify({
            channels: channels ?? {},
            deleteKeys: delete_keys ?? [],
            upsertKeys: upsert_keys ?? [],
          }),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'create_curve_table',
    {
      title: 'Create CurveTable',
      description: 'Create a UE5 CurveTable in RichCurves or SimpleCurves mode and optionally initialize rows.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path for the new asset.',
        ),
        curve_table_mode: curveTableModeSchema.describe(
          'Storage mode.',
        ),
        rows: z.array(curveTableRowSchema).default([]).describe(
          'Initial curve rows.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Create CurveTable',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, curve_table_mode, rows, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('CreateCurveTable', {
          AssetPath: asset_path,
          CurveTableMode: curve_table_mode,
          RowsJson: JSON.stringify(rows ?? []),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'modify_curve_table',
    {
      title: 'Modify CurveTable',
      description: 'Modify a UE5 CurveTable by upserting rows, deleting rows, or replacing the full row set.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        rows: z.array(curveTableRowSchema).optional().describe(
          'Curve rows to upsert.',
        ),
        delete_rows: z.array(z.string()).optional().describe(
          'Row names to delete.',
        ),
        replace_rows: z.boolean().default(false).describe(
          'Clear table before applying rows.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
      },
      annotations: {
        title: 'Modify CurveTable',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, rows, delete_rows, replace_rows, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('ModifyCurveTable', {
          AssetPath: asset_path,
          PayloadJson: JSON.stringify({
            rows: rows ?? [],
            deleteRows: delete_rows ?? [],
            replaceRows: replace_rows,
          }),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
