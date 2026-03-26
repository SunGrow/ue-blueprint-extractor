import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { maybeBoolean } from '../helpers/formatting.js';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterWidgetStructureToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  widgetNodeSchema: z.ZodTypeAny;
  widgetBlueprintMutationOperationSchema: z.ZodTypeAny;
};

// ---------------------------------------------------------------------------
// Shared helpers for operation-specific handlers
// ---------------------------------------------------------------------------

type MutationPayload = Record<string, unknown>;

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
  operation: string,
  payload: MutationPayload,
  validate_only: boolean,
  compile_after: boolean,
): Promise<ReturnType<typeof jsonToolSuccess> | ReturnType<typeof jsonToolError>> {
  try {
    const mutation = await callSubsystemJson('ModifyWidgetBlueprintStructure', {
      AssetPath: asset_path,
      Operation: operation,
      PayloadJson: JSON.stringify(payload),
      bValidateOnly: validate_only,
    });

    let compileResult: Record<string, unknown> | null = null;
    if (compile_after && !validate_only && mutation.success === true) {
      compileResult = await callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path });
    }

    const structuredContent = compileResult
      ? { ...mutation, compile: compileResult.compile ?? compileResult }
      : mutation;

    return jsonToolSuccess(structuredContent);
  } catch (error) {
    return jsonToolError(error);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerWidgetStructureTools({
  server,
  callSubsystemJson,
  widgetNodeSchema,
  widgetBlueprintMutationOperationSchema,
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
        asset_path: z.string().describe(
          'UE content path for the new WidgetBlueprint (e.g. /Game/UI/WBP_MyWidget)',
        ),
        parent_class_path: z.string().default('UserWidget').describe(
          'Parent widget class path or short loaded class name.',
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
          'UE content path to an existing WidgetBlueprint',
        ),
        root_widget: widgetNodeSchema.describe(
          'Root widget of the tree hierarchy',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
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
    async ({ asset_path, root_widget, validate_only, compile_after }) => {
      try {
        const mutation = await callSubsystemJson('BuildWidgetTree', {
          AssetPath: asset_path,
          WidgetTreeJson: JSON.stringify(root_widget),
          bValidateOnly: validate_only,
        });

        let compileResult: Record<string, unknown> | null = null;
        if (compile_after && !validate_only && mutation.success === true) {
          compileResult = await callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path });
        }

        const structuredContent = compileResult
          ? { ...mutation, compile: compileResult.compile ?? compileResult }
          : mutation;

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
          'UE content path to the WidgetBlueprint',
        ),
        widget_name: z.string().optional().describe(
          'Widget name to patch.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path to patch. Safer than widget_name after structural edits.',
        ),
        properties: z.record(z.string(), z.unknown()).optional().describe(
          'Widget UPROPERTY values to set.',
        ),
        slot: z.record(z.string(), z.unknown()).optional().describe(
          'Slot properties to set.',
        ),
        is_variable: z.boolean().optional().describe(
          'Toggle the widget variable flag.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
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
      const payload = buildMutationPayload({
        widget_name,
        widget_path,
        properties,
        slot,
        ...(typeof variableFlag === 'boolean' ? { is_variable: variableFlag } : {}),
      });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'patch_widget', payload, validate_only, compile_after,
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
          'UE content path to the WidgetBlueprint',
        ),
        class_defaults: z.record(z.string(), z.unknown()).describe(
          'Generated-class default property patch.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
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
        callSubsystemJson, asset_path, 'patch_class_defaults', payload, validate_only, compile_after,
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
          'UE content path to the WidgetBlueprint',
        ),
        parent_widget_name: z.string().optional().describe(
          'Parent widget selector by name.',
        ),
        parent_widget_path: z.string().optional().describe(
          'Parent widget selector by path.',
        ),
        child_widget: widgetNodeSchema.describe(
          'Child widget node to insert.',
        ),
        index: z.number().int().min(0).optional().describe(
          'Optional child insertion index.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
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
      const payload = buildMutationPayload({
        parent_widget_name,
        parent_widget_path,
        child_widget,
        index,
      });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'insert_child', payload, validate_only, compile_after,
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
          'UE content path to the WidgetBlueprint',
        ),
        widget_name: z.string().optional().describe(
          'Widget name to remove.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path to remove.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
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
        callSubsystemJson, asset_path, 'remove_widget', payload, validate_only, compile_after,
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
          'UE content path to the WidgetBlueprint',
        ),
        widget_name: z.string().optional().describe(
          'Widget name to move.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path to move.',
        ),
        new_parent_widget_name: z.string().optional().describe(
          'Destination parent selector by name.',
        ),
        new_parent_widget_path: z.string().optional().describe(
          'Destination parent selector by path.',
        ),
        index: z.number().int().min(0).optional().describe(
          'Optional insertion index at the new parent.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
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
        callSubsystemJson, asset_path, 'move_widget', payload, validate_only, compile_after,
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
          'UE content path to the WidgetBlueprint',
        ),
        widget_name: z.string().optional().describe(
          'Widget name to wrap.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path to wrap.',
        ),
        wrapper_widget: widgetNodeSchema.describe(
          'Wrapper widget node. Must be a panel widget.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
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
      const payload = buildMutationPayload({ widget_name, widget_path, wrapper_widget });
      return callMutationWithOptionalCompile(
        callSubsystemJson, asset_path, 'wrap_widget', payload, validate_only, compile_after,
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
          'UE content path to the WidgetBlueprint',
        ),
        widget_name: z.string().optional().describe(
          'Widget name to replace.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget path to replace.',
        ),
        replacement_class: z.string().describe(
          'Concrete replacement widget class.',
        ),
        preserve_properties: z.boolean().optional().describe(
          'When false, clear existing widget properties.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
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
        callSubsystemJson, asset_path, 'replace_widget_class', payload, validate_only, compile_after,
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
          'UE content path to the WidgetBlueprint',
        ),
        operations: z.array(z.record(z.string(), z.unknown())).describe(
          'Array of operation objects to execute in order.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
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
        callSubsystemJson, asset_path, 'batch', payload, validate_only, compile_after,
      );
    },
  );

  // -----------------------------------------------------------------------
  // 10. compile_widget
  // -----------------------------------------------------------------------
  server.registerTool(
    'compile_widget',
    {
      title: 'Compile Widget',
      description: 'Compile a WidgetBlueprint and return compile diagnostics without saving.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the WidgetBlueprint to compile',
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
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  // -----------------------------------------------------------------------
  // modify_widget_blueprint — dispatch alias (backward-compatible)
  // -----------------------------------------------------------------------
  server.registerTool(
    'modify_widget_blueprint',
    {
      title: 'Modify Widget Blueprint',
      description:
        '[DEPRECATED: use operation-specific tools instead] '
        + 'Dispatch alias that routes to replace_widget_tree, patch_widget, patch_widget_class_defaults, '
        + 'insert_widget_child, remove_widget, move_widget, wrap_widget, replace_widget_class, '
        + 'batch_widget_operations, or compile_widget based on the operation field.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the WidgetBlueprint',
        ),
        operation: widgetBlueprintMutationOperationSchema.describe(
          'WidgetBlueprint mutation mode.',
        ),
        root_widget: widgetNodeSchema.optional().describe(
          'Required for operation="replace_tree".',
        ),
        widget_name: z.string().optional().describe(
          'Optional widget selector by name.',
        ),
        widget_path: z.string().optional().describe(
          'Optional widget selector by slash-delimited path.',
        ),
        parent_widget_name: z.string().optional().describe(
          'Parent widget selector by name for insert_child.',
        ),
        parent_widget_path: z.string().optional().describe(
          'Parent widget selector by path for insert_child.',
        ),
        new_parent_widget_name: z.string().optional().describe(
          'Destination parent selector by name for move_widget.',
        ),
        new_parent_widget_path: z.string().optional().describe(
          'Destination parent selector by path for move_widget.',
        ),
        child_widget: widgetNodeSchema.optional().describe(
          'Child widget payload for insert_child.',
        ),
        wrapper_widget: widgetNodeSchema.optional().describe(
          'Wrapper widget payload for wrap_widget. Must be a panel widget.',
        ),
        replacement_class: z.string().optional().describe(
          'Concrete replacement class for replace_widget_class.',
        ),
        preserve_properties: z.boolean().optional().describe(
          'When false, clear existing widget properties during replace_widget_class.',
        ),
        index: z.number().int().min(0).optional().describe(
          'Optional child insertion or move index.',
        ),
        properties: z.record(z.string(), z.unknown()).optional().describe(
          'Property patch for patch_widget or replace_widget_class.',
        ),
        slot: z.record(z.string(), z.unknown()).optional().describe(
          'Slot patch for patch_widget or move_widget.',
        ),
        class_defaults: z.record(z.string(), z.unknown()).optional().describe(
          'Generated-class default patch for operation="patch_class_defaults".',
        ),
        is_variable: z.boolean().optional().describe(
          'Toggle the widget variable flag during patch_widget.',
        ),
        operations: z.array(z.record(z.string(), z.unknown())).optional().describe(
          'Nested operations for operation="batch".',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate only and return diagnostics without changing the asset.',
        ),
        compile_after: z.boolean().default(false).describe(
          'Compile after a successful mutation and include compile results.',
        ),
      },
      annotations: {
        title: 'Modify Widget Blueprint',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      asset_path,
      operation,
      root_widget,
      widget_name,
      widget_path,
      parent_widget_name,
      parent_widget_path,
      new_parent_widget_name,
      new_parent_widget_path,
      child_widget,
      wrapper_widget,
      replacement_class,
      preserve_properties,
      index,
      properties,
      slot,
      class_defaults,
      is_variable,
      operations,
      validate_only,
      compile_after,
    }) => {
      try {
        let mutation: Record<string, unknown>;

        if (operation === 'replace_tree') {
          if (!root_widget) {
            return jsonToolError(new Error('root_widget is required for operation="replace_tree"'));
          }
          mutation = await callSubsystemJson('BuildWidgetTree', {
            AssetPath: asset_path,
            WidgetTreeJson: JSON.stringify(root_widget),
            bValidateOnly: validate_only,
          });
        } else if (operation === 'compile') {
          mutation = await callSubsystemJson('CompileWidgetBlueprint', {
            AssetPath: asset_path,
          });
        } else {
          const payload: Record<string, unknown> = {};
          if (widget_name) payload.widget_name = widget_name;
          if (widget_path) payload.widget_path = widget_path;
          if (parent_widget_name) payload.parent_widget_name = parent_widget_name;
          if (parent_widget_path) payload.parent_widget_path = parent_widget_path;
          if (new_parent_widget_name) payload.new_parent_widget_name = new_parent_widget_name;
          if (new_parent_widget_path) payload.new_parent_widget_path = new_parent_widget_path;
          if (child_widget) payload.child_widget = child_widget;
          if (wrapper_widget) payload.wrapper_widget = wrapper_widget;
          if (replacement_class) payload.replacement_class = replacement_class;
          if (typeof preserve_properties === 'boolean') payload.preserve_properties = preserve_properties;
          if (typeof index === 'number') payload.index = index;
          if (properties) payload.properties = properties;
          if (slot) payload.slot = slot;
          if (class_defaults) payload.classDefaults = class_defaults;
          const variableFlag = maybeBoolean(is_variable);
          if (typeof variableFlag === 'boolean') payload.is_variable = variableFlag;
          if (operations) payload.operations = operations;

          mutation = await callSubsystemJson('ModifyWidgetBlueprintStructure', {
            AssetPath: asset_path,
            Operation: operation,
            PayloadJson: JSON.stringify(payload),
            bValidateOnly: validate_only,
          });
        }

        let compileResult: Record<string, unknown> | null = null;
        if (compile_after && !validate_only && operation !== 'compile' && mutation.success === true) {
          compileResult = await callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path });
        }

        const structuredContent = compileResult
          ? { ...mutation, compile: compileResult.compile ?? compileResult }
          : mutation;

        return jsonToolSuccess(structuredContent);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  // -----------------------------------------------------------------------
  // Legacy standalone tools — kept as-is for backward compatibility.
  // The alias registration in register-server-tools.ts will wire these
  // old names to the new operation-specific tools.
  // -----------------------------------------------------------------------

  // build_widget_tree (legacy standalone, kept for backward compat)
  server.registerTool(
    'build_widget_tree',
    {
      title: 'Build Widget Tree',
      description: '[DEPRECATED: use replace_widget_tree] Destructively replace the full widget tree of an existing WidgetBlueprint.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to an existing WidgetBlueprint',
        ),
        root_widget: widgetNodeSchema.describe(
          'Root widget of the tree hierarchy',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Build Widget Tree',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, root_widget, validate_only }) => {
      try {
        const parsed = await callSubsystemJson('BuildWidgetTree', {
          AssetPath: asset_path,
          WidgetTreeJson: JSON.stringify(root_widget),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  // modify_widget (legacy standalone, kept for backward compat)
  server.registerTool(
    'modify_widget',
    {
      title: 'Modify Widget',
      description: '[DEPRECATED: use patch_widget] Patch one widget by widget_name or widget_path using snake_case payload fields.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the WidgetBlueprint',
        ),
        widget_name: z.string().optional().describe(
          'Widget name to modify.',
        ),
        widget_path: z.string().optional().describe(
          'Slash-delimited widget_path to modify. Safer than widget_name after structural edits.',
        ),
        properties: z.record(z.string(), z.unknown()).optional().describe(
          'Widget UPROPERTY values to set',
        ),
        slot: z.record(z.string(), z.unknown()).optional().describe(
          'Slot properties to set',
        ),
        is_variable: z.boolean().optional().describe(
          'Toggle the widget variable flag.',
        ),
        validate_only: z.boolean().default(false).describe(
          'Validate without changing the asset.',
        ),
      },
      annotations: {
        title: 'Modify Widget',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path, widget_name, widget_path, properties, slot, is_variable, validate_only }) => {
      try {
        const widgetIdentifier = widget_path ?? widget_name;
        if (!widgetIdentifier) {
          return jsonToolError(new Error('widget_name or widget_path is required'));
        }

        const widgetOptions: Record<string, unknown> = {};
        const variableFlag = maybeBoolean(is_variable);
        if (typeof variableFlag === 'boolean') {
          widgetOptions.is_variable = variableFlag;
        }

        const parsed = await callSubsystemJson('ModifyWidget', {
          AssetPath: asset_path,
          WidgetName: widgetIdentifier,
          PropertiesJson: JSON.stringify(properties ?? {}),
          SlotJson: JSON.stringify(slot ?? {}),
          WidgetOptionsJson: JSON.stringify(widgetOptions),
          bValidateOnly: validate_only,
        });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  // compile_widget_blueprint (legacy standalone, kept for backward compat)
  server.registerTool(
    'compile_widget_blueprint',
    {
      title: 'Compile Widget Blueprint',
      description: '[DEPRECATED: use compile_widget] Compile a WidgetBlueprint and return compile diagnostics without saving.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the WidgetBlueprint to compile',
        ),
      },
      annotations: {
        title: 'Compile Widget Blueprint',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_path }) => {
      try {
        const parsed = await callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path });
        return jsonToolSuccess(parsed);
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
