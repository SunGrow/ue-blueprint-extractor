import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { maybeBoolean } from '../helpers/formatting.js';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';
import { preprocessWidgetNode } from '../helpers/widget-utils.js';
import { resolveSlotPreset } from '../helpers/slot-presets.js';
import { expandDottedProperties } from '../helpers/property-shorthand.js';
import { parseWidgetDsl } from '../helpers/widget-dsl-parser.js';
import { parseWidgetDiff } from '../helpers/widget-diff-parser.js';
import type { WidgetDiffOperation } from '../helpers/widget-diff-parser.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterWidgetStructureToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  widgetNodeSchema: z.ZodTypeAny;
};

// ---------------------------------------------------------------------------
// Shared helpers for operation-specific handlers
// ---------------------------------------------------------------------------

type MutationPayload = Record<string, unknown>;

function normalizeWidgetToolOperation(
  parsed: Record<string, unknown>,
  operation: string,
): Record<string, unknown> {
  return {
    ...parsed,
    operation,
  };
}

function buildMutationPayload(fields: Record<string, unknown>): MutationPayload {
  const payload: MutationPayload = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      payload[key] = value;
    }
  }
  return payload;
}

async function callMutationWithOptionalCompile(
  callSubsystemJson: JsonSubsystemCaller,
  asset_path: string,
  mutationOperation: string,
  resultOperation: string,
  payload: MutationPayload,
  validate_only: boolean,
  compile_after: boolean,
): Promise<ReturnType<typeof jsonToolSuccess> | ReturnType<typeof jsonToolError>> {
  try {
    const mutation = await callSubsystemJson('ModifyWidgetBlueprintStructure', {
      AssetPath: asset_path,
      Operation: mutationOperation,
      PayloadJson: JSON.stringify(payload),
      bValidateOnly: validate_only,
    });

    let compileResult: Record<string, unknown> | null = null;
    if (compile_after && !validate_only && mutation.success === true) {
      compileResult = await callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path });
    }

    const structuredContent = compileResult
      ? { ...normalizeWidgetToolOperation(mutation, resultOperation), compile: compileResult.compile ?? compileResult }
      : normalizeWidgetToolOperation(mutation, resultOperation);

    return jsonToolSuccess(structuredContent);
  } catch (error) {
    return jsonToolError(error);
  }
}

// ---------------------------------------------------------------------------
// Diff operation -> batch operation converter
// ---------------------------------------------------------------------------

function convertDiffOp(op: WidgetDiffOperation): Record<string, unknown> {
  switch (op.type) {
    case 'remove':
      return { operation: 'remove_widget', widget_name: op.target };

    case 'insert':
      return {
        operation: 'insert_child',
        parent_widget_name: op.parent,
        child_widget: op.node,
        ...(op.index !== undefined ? { index: op.index } : {}),
      };

    case 'patch':
      return buildMutationPayload({
        operation: 'patch_widget',
        widget_name: op.target,
        properties: op.properties,
        slot: op.slot,
        ...(op.is_variable !== undefined ? { is_variable: op.is_variable } : {}),
      });

    case 'replace':
      // Replace is decomposed into remove + insert at the diff level,
      // but handle it here as a fallback: emit remove.
      return { operation: 'remove_widget', widget_name: op.target };

    default:
      return { operation: 'unknown', target: op.target };
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerWidgetStructureTools({
  server,
  callSubsystemJson,
  widgetNodeSchema,
}: RegisterWidgetStructureToolsOptions): void {
  // -----------------------------------------------------------------------
  // create_widget_blueprint (unchanged)
  // -----------------------------------------------------------------------
  server.registerTool(
    'create_widget_blueprint',
    {
      title: 'Create Widget Blueprint',
      description: 'Create a WidgetBlueprint asset with an optional parent class.',
      inputSchema: {
        asset_path: z.string().describe('UE content path for the new asset.'),
        parent_class_path: z.string().default('UserWidget').describe(
          'Parent class path or short name.',
        ),
      },
      annotations: {
        title: 'Create Widget Blueprint',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, parent_class_path }) => {
      try {
        const parsed = await callSubsystemJson('CreateWidgetBlueprint', {
          AssetPath: asset_path,
          ParentClass: parent_class_path,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  // -----------------------------------------------------------------------
  // 1. replace_widget_tree
  // -----------------------------------------------------------------------
  server.registerTool(
    'replace_widget_tree',
    {
      title: 'Replace Widget Tree',
      description:
        'Destructively replace the full widget tree of an existing WidgetBlueprint.\n\n'
        + 'Example:\n'
        + '```json\n'
        + '{\n'
        + '  "asset_path": "/Game/UI/WBP_HUD",\n'
        + '  "root_widget": {\n'
        + '    "class": "CanvasPanel", "name": "Root",\n'
        + '    "children": [{ "class": "TextBlock", "name": "Title" }]\n'
        + '  }\n'
        + '}\n'
        + '```',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        root_widget: widgetNodeSchema.optional().describe(
          'Root widget node (provide this OR dsl, not both).',
        ),
        dsl: z.string().optional().describe(
          'Widget tree in indentation-based DSL format (alternative to root_widget).',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after mutation.',
        ),
      },
      annotations: {
        title: 'Replace Widget Tree',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, root_widget, dsl, validate_only, compile_after }) => {
      try {
        if (dsl && root_widget) {
          return jsonToolError(new Error('Provide either dsl or root_widget, not both'));
        }
        let processed: Record<string, unknown>;

        if (dsl) {
          const parseResult = parseWidgetDsl(dsl);
          if (parseResult.nodes.length === 0) {
            return jsonToolError(new Error('DSL produced no widget nodes'));
          }
          // DSL preprocessWidgetNode is called inside parseWidgetDsl, so result is already processed
          processed = parseResult.nodes[0] as unknown as Record<string, unknown>;
        } else if (root_widget) {
          processed = preprocessWidgetNode(root_widget as Record<string, unknown>);
        } else {
          return jsonToolError(new Error('root_widget or dsl is required'));
        }

        const mutation = await callSubsystemJson('BuildWidgetTree', {
          AssetPath: asset_path,
          WidgetTreeJson: JSON.stringify(processed),
          bValidateOnly: validate_only,
        });

        let compileResult: Record<string, unknown> | null = null;
        if (compile_after && !validate_only && mutation.success === true) {
          compileResult = await callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path });
        }

        const structuredContent = compileResult
          ? { ...normalizeWidgetToolOperation(mutation, 'replace_widget_tree'), compile: compileResult.compile ?? compileResult }
          : normalizeWidgetToolOperation(mutation, 'replace_widget_tree');

        return jsonToolSuccess(structuredContent);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  // -----------------------------------------------------------------------
  // 2. patch_widget
  // -----------------------------------------------------------------------
  server.registerTool(
    'patch_widget',
    {
      title: 'Patch Widget',
      description: 'Patch properties, slot, or variable flag on a single widget by name or path.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        widget_name: z.string().optional().describe(
          'Widget name.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path.',
        ),
        properties: z.record(z.string(), z.unknown()).optional().describe(
          'UPROPERTY values to set.',
        ),
        slot: z.record(z.string(), z.unknown()).optional().describe(
          'Slot properties.',
        ),
        is_variable: z.boolean().optional().describe(
          'Toggle variable flag.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after mutation.',
        ),
      },
      annotations: {
        title: 'Patch Widget',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, widget_name, widget_path, properties, slot, is_variable, validate_only, compile_after }) => {
      if (!widget_name && !widget_path) {
        return jsonToolError(new Error('widget_name or widget_path is required'));
      }
      const variableFlag = maybeBoolean(is_variable);
      const resolvedSlot = slot !== undefined ? resolveSlotPreset(slot) : undefined;
      const resolvedProperties = properties && typeof properties === 'object' && !Array.isArray(properties)
        ? expandDottedProperties(properties as Record<string, unknown>)
        : properties;
      const payload = buildMutationPayload({
        widget_name,
        widget_path,
        properties: resolvedProperties,
        slot: resolvedSlot,
        ...(typeof variableFlag === 'boolean' ? { is_variable: variableFlag } : {}),
      });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'patch_widget', 'patch_widget', payload, validate_only, compile_after,
      );
    },
  );

  // -----------------------------------------------------------------------
  // 3. patch_widget_class_defaults
  // -----------------------------------------------------------------------
  server.registerTool(
    'patch_widget_class_defaults',
    {
      title: 'Patch Widget Class Defaults',
      description: 'Patch the generated-class defaults of a WidgetBlueprint.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        class_defaults: z.record(z.string(), z.unknown()).describe(
          'Class default property patch.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after mutation.',
        ),
      },
      annotations: {
        title: 'Patch Widget Class Defaults',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, class_defaults, validate_only, compile_after }) => {
      const payload = buildMutationPayload({ classDefaults: class_defaults });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'patch_class_defaults', 'patch_widget_class_defaults', payload, validate_only, compile_after,
      );
    },
  );

  // -----------------------------------------------------------------------
  // 4. insert_widget_child
  // -----------------------------------------------------------------------
  server.registerTool(
    'insert_widget_child',
    {
      title: 'Insert Widget Child',
      description: 'Insert a child widget under a parent widget by name or path.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        parent_widget_name: z.string().optional().describe(
          'Parent widget name.',
        ),
        parent_widget_path: z.string().optional().describe(
          'Parent widget path.',
        ),
        child_widget: widgetNodeSchema.describe(
          'Child widget node.',
        ),
        index: z.number().int().min(0).optional().describe(
          'Insertion index.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after mutation.',
        ),
      },
      annotations: {
        title: 'Insert Widget Child',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, parent_widget_name, parent_widget_path, child_widget, index, validate_only, compile_after }) => {
      if (!parent_widget_name && !parent_widget_path) {
        return jsonToolError(new Error('parent_widget_name or parent_widget_path is required'));
      }
      const processedChild = preprocessWidgetNode(child_widget as Record<string, unknown>);
      const payload = buildMutationPayload({
        parent_widget_name,
        parent_widget_path,
        child_widget: processedChild,
        index,
      });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'insert_child', 'insert_widget_child', payload, validate_only, compile_after,
      );
    },
  );

  // -----------------------------------------------------------------------
  // 5. remove_widget
  // -----------------------------------------------------------------------
  server.registerTool(
    'remove_widget',
    {
      title: 'Remove Widget',
      description: 'Remove a widget from the widget tree by name or path.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        widget_name: z.string().optional().describe(
          'Widget name.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after mutation.',
        ),
      },
      annotations: {
        title: 'Remove Widget',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, widget_name, widget_path, validate_only, compile_after }) => {
      if (!widget_name && !widget_path) {
        return jsonToolError(new Error('widget_name or widget_path is required'));
      }
      const payload = buildMutationPayload({ widget_name, widget_path });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'remove_widget', 'remove_widget', payload, validate_only, compile_after,
      );
    },
  );

  // -----------------------------------------------------------------------
  // 6. move_widget
  // -----------------------------------------------------------------------
  server.registerTool(
    'move_widget',
    {
      title: 'Move Widget',
      description: 'Move a widget to a new parent within the widget tree.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        widget_name: z.string().optional().describe(
          'Widget name.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path.',
        ),
        new_parent_widget_name: z.string().optional().describe(
          'New parent name.',
        ),
        new_parent_widget_path: z.string().optional().describe(
          'New parent path.',
        ),
        index: z.number().int().min(0).optional().describe(
          'Insertion index at new parent.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after mutation.',
        ),
      },
      annotations: {
        title: 'Move Widget',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, widget_name, widget_path, new_parent_widget_name, new_parent_widget_path, index, validate_only, compile_after }) => {
      const payload = buildMutationPayload({
        widget_name,
        widget_path,
        new_parent_widget_name,
        new_parent_widget_path,
        index,
      });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'move_widget', 'move_widget', payload, validate_only, compile_after,
      );
    },
  );

  // -----------------------------------------------------------------------
  // 7. wrap_widget
  // -----------------------------------------------------------------------
  server.registerTool(
    'wrap_widget',
    {
      title: 'Wrap Widget',
      description: 'Wrap an existing widget inside a new panel widget.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        widget_name: z.string().optional().describe(
          'Widget name.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path.',
        ),
        wrapper_widget: widgetNodeSchema.describe(
          'Wrapper panel widget node.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after mutation.',
        ),
      },
      annotations: {
        title: 'Wrap Widget',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, widget_name, widget_path, wrapper_widget, validate_only, compile_after }) => {
      const processedWrapper = preprocessWidgetNode(wrapper_widget as Record<string, unknown>);
      const payload = buildMutationPayload({ widget_name, widget_path, wrapper_widget: processedWrapper });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'wrap_widget', 'wrap_widget', payload, validate_only, compile_after,
      );
    },
  );

  // -----------------------------------------------------------------------
  // 8. replace_widget_class
  // -----------------------------------------------------------------------
  server.registerTool(
    'replace_widget_class',
    {
      title: 'Replace Widget Class',
      description: 'Replace the class of a widget in-place, optionally preserving properties.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        widget_name: z.string().optional().describe(
          'Widget name.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path.',
        ),
        replacement_class: z.string().describe(
          'Replacement widget class.',
        ),
        preserve_properties: z.boolean().optional().describe(
          'Clear existing properties if false.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after mutation.',
        ),
      },
      annotations: {
        title: 'Replace Widget Class',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, widget_name, widget_path, replacement_class, preserve_properties, validate_only, compile_after }) => {
      const payload = buildMutationPayload({
        widget_name,
        widget_path,
        replacement_class,
        ...(typeof preserve_properties === 'boolean' ? { preserve_properties } : {}),
      });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'replace_widget_class', 'replace_widget_class', payload, validate_only, compile_after,
      );
    },
  );

  // -----------------------------------------------------------------------
  // 9. batch_widget_operations
  // -----------------------------------------------------------------------
  server.registerTool(
    'batch_widget_operations',
    {
      title: 'Batch Widget Operations',
      description: 'Execute multiple widget mutation operations in a single transactional batch.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
        operations: z.array(z.record(z.string(), z.unknown())).describe(
          'Ordered operations array.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Dry-run validation only.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after mutation.',
        ),
      },
      annotations: {
        title: 'Batch Widget Operations',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, operations, validate_only, compile_after }) => {
      const payload = buildMutationPayload({ operations });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'batch', 'batch_widget_operations', payload, validate_only, compile_after,
      );
    },
  );

  // -----------------------------------------------------------------------
  // 10. apply_widget_diff
  // -----------------------------------------------------------------------
  server.registerTool(
    'apply_widget_diff',
    {
      title: 'Apply Widget Diff',
      description:
        'Apply a unified-diff-style DSL patch to a widget blueprint. '
        + 'Computes and executes minimal operations (remove, insert, patch) from the diff.\n\n'
        + 'Diff format: lines without prefix = context (unchanged), '
        + '`-` prefix = removed, `+` prefix = added.\n\n'
        + 'Example:\n'
        + '```\n'
        + 'CanvasPanel "Root"\n'
        + '  VerticalBox "MainContent"\n'
        + '-   TextBlock "OldTitle" {Text: "Old"}\n'
        + '+   TextBlock "NewTitle" {Text: "New"} [var]\n'
        + '```',
      inputSchema: {
        asset_path: z.string().describe('UE content path.'),
        diff: z.string().describe('Widget tree diff in unified-diff DSL format.'),
        validate_only: z.boolean().default(false).describe('Dry-run validation only.'),
        compile_after: z.boolean().default(true).describe('Compile after mutations.'),
      },
      annotations: {
        title: 'Apply Widget Diff',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ asset_path, diff, validate_only, compile_after }) => {
      try {
        const diffResult = parseWidgetDiff(diff);

        if (diffResult.operations.length === 0) {
          return jsonToolSuccess({
            message: 'No changes detected',
            diff_operations: 0,
            warnings: diffResult.warnings,
          });
        }

        // Convert diff operations to batch operations
        const batchOps = diffResult.operations.map((op) => convertDiffOp(op));

        // Execute as batch via ModifyWidgetBlueprintStructure
        const mutation = await callSubsystemJson('ModifyWidgetBlueprintStructure', {
          AssetPath: asset_path,
          Operation: 'batch',
          PayloadJson: JSON.stringify({ operations: batchOps }),
          bValidateOnly: validate_only,
        });

        // Optional compile
        let compileResult: Record<string, unknown> | null = null;
        if (compile_after && !validate_only && mutation.success === true) {
          compileResult = await callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path });
        }

        return jsonToolSuccess({
          ...normalizeWidgetToolOperation(mutation, 'apply_widget_diff'),
          diff_operations: diffResult.operations.length,
          warnings: diffResult.warnings,
          ...(compileResult ? { compile: compileResult.compile ?? compileResult } : {}),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  // -----------------------------------------------------------------------
  // 11. compile_widget
  // -----------------------------------------------------------------------
  server.registerTool(
    'compile_widget',
    {
      title: 'Compile Widget',
      description: 'Compile a WidgetBlueprint and return compile diagnostics without saving.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path.',
        ),
      },
      annotations: {
        title: 'Compile Widget',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path }) => {
      try {
        const parsed = await callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path });
        return jsonToolSuccess(normalizeWidgetToolOperation(parsed, 'compile_widget'));
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

}
