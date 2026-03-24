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

export function registerWidgetStructureTools({
  server,
  callSubsystemJson,
  widgetNodeSchema,
  widgetBlueprintMutationOperationSchema,
}: RegisterWidgetStructureToolsOptions): void {
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

  server.registerTool(
    'build_widget_tree',
    {
      title: 'Build Widget Tree',
      description: 'Destructively replace the full widget tree of an existing WidgetBlueprint.',
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

  server.registerTool(
    'modify_widget',
    {
      title: 'Modify Widget',
      description: 'Patch one widget by widget_name or widget_path using snake_case payload fields.',
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

  server.registerTool(
    'modify_widget_blueprint',
    {
      title: 'Modify Widget Blueprint',
      description: 'Primary widget-authoring tool for compact structural and patch operations.',
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

  server.registerTool(
    'compile_widget_blueprint',
    {
      title: 'Compile Widget Blueprint',
      description: 'Compile a WidgetBlueprint and return compile diagnostics without saving.',
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
