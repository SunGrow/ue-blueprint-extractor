import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  safeCall,
  compositeSuccess,
  compositePartialFailure,
  type CompositeStepResult,
  type CompositeToolResult,
} from '../helpers/composite-patterns.js';
import { parseWidgetDsl } from '../helpers/widget-dsl-parser.js';
import { parseWidgetDiff } from '../helpers/widget-diff-parser.js';
import { jsonToolSuccess } from '../helpers/subsystem.js';
import type { ToolHelpEntry } from '../helpers/tool-help.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterCompositeWorkflowToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
  toolHelpRegistry: Map<string, ToolHelpEntry>;
};

const EXECUTION: CompositeToolResult['execution'] = {
  mode: 'immediate',
  task_support: 'optional',
};

function compositeResult(composite: CompositeToolResult, options?: { isError?: boolean }) {
  const result = jsonToolSuccess(composite as unknown as Record<string, unknown>);
  if (options?.isError) {
    return { ...result, isError: true };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPartialState(steps: CompositeStepResult[], failedStep: string, editorState: string): CompositeToolResult['partial_state'] {
  return {
    completed_steps: steps.filter(s => s.status === 'success').map(s => s.step),
    failed_step: failedStep,
    editor_state: editorState,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCompositeWorkflowTools({
  server,
  callSubsystemJson,
  toolHelpRegistry,
}: RegisterCompositeWorkflowToolsOptions): void {

  // =========================================================================
  // Tool 1: create_menu_screen
  // =========================================================================

  server.registerTool(
    'create_menu_screen',
    {
      title: 'Create Menu Screen',
      description:
        'Create a widget blueprint, populate its widget tree from DSL, optionally patch class defaults, compile, and save — all in one call.',
      inputSchema: {
        asset_path: z.string().describe('UE content path for the new widget.'),
        parent_class: z.string().default('CommonActivatableWidget').describe('Parent widget class.'),
        dsl: z.string().describe('Widget tree in DSL format.'),
        class_defaults: z.record(z.string(), z.unknown()).optional().describe('Class default overrides.'),
      },
      annotations: {
        title: 'Create Menu Screen',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { asset_path, parent_class, dsl, class_defaults } = args as {
        asset_path: string;
        parent_class: string;
        dsl: string;
        class_defaults?: Record<string, unknown>;
      };

      const steps: CompositeStepResult[] = [];

      // Step 1: Create widget blueprint
      const createResult = await safeCall(() =>
        callSubsystemJson('CreateWidgetBlueprint', {
          AssetPath: asset_path,
          ParentClassPath: parent_class,
        }),
      );

      if (!createResult.ok) {
        steps.push({ step: 'create', status: 'failure', message: createResult.error.message });
        return compositeResult(
          compositePartialFailure('create_menu_screen', steps, 'create',
            buildPartialState(steps, 'create', 'No mutations performed; editor state unchanged'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'create', status: 'success', message: `Created ${asset_path}`, data: createResult.value });

      // Step 2: Build widget tree from DSL
      const dslResult = parseWidgetDsl(dsl);
      const buildResult = await safeCall(() =>
        callSubsystemJson('BuildWidgetTree', {
          AssetPath: asset_path,
          TreeJson: JSON.stringify(dslResult.nodes),
        }),
      );

      if (!buildResult.ok) {
        steps.push({ step: 'build_tree', status: 'failure', message: buildResult.error.message });
        return compositeResult(
          compositePartialFailure('create_menu_screen', steps, 'build_tree',
            buildPartialState(steps, 'build_tree', 'Widget blueprint created but tree not populated'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({
        step: 'build_tree', status: 'success',
        message: `Built tree with ${dslResult.nodes.length} root node(s)`,
        data: buildResult.value,
        ...(dslResult.warnings.length > 0 ? { diagnostics: dslResult.warnings.map(w => ({ severity: 'warning', message: w })) } : {}),
      });

      // Step 3: Patch class defaults (optional)
      if (class_defaults && Object.keys(class_defaults).length > 0) {
        const defaultsResult = await safeCall(() =>
          callSubsystemJson('ModifyWidgetBlueprintStructure', {
            AssetPath: asset_path,
            Operation: 'patch_class_defaults',
            PayloadJson: JSON.stringify(class_defaults),
            bValidateOnly: false,
          }),
        );

        if (!defaultsResult.ok) {
          steps.push({ step: 'class_defaults', status: 'failure', message: defaultsResult.error.message });
          return compositeResult(
            compositePartialFailure('create_menu_screen', steps, 'class_defaults',
              buildPartialState(steps, 'class_defaults', 'Widget tree built but class defaults not applied'),
              EXECUTION),
            { isError: true },
          );
        }
        steps.push({ step: 'class_defaults', status: 'success', data: defaultsResult.value });
      } else {
        steps.push({ step: 'class_defaults', status: 'skipped', message: 'No class defaults provided' });
      }

      // Step 4: Compile
      const compileResult = await safeCall(() =>
        callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path }),
      );

      if (!compileResult.ok) {
        steps.push({ step: 'compile', status: 'failure', message: compileResult.error.message });
        return compositeResult(
          compositePartialFailure('create_menu_screen', steps, 'compile',
            buildPartialState(steps, 'compile', 'Widget tree built but compilation failed; unsaved'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'compile', status: 'success', data: compileResult.value });

      // Step 5: Save
      const saveResult = await safeCall(() =>
        callSubsystemJson('SaveAssets', { AssetPaths: JSON.stringify([asset_path]) }),
      );

      if (!saveResult.ok) {
        steps.push({ step: 'save', status: 'failure', message: saveResult.error.message });
        return compositeResult(
          compositePartialFailure('create_menu_screen', steps, 'save',
            buildPartialState(steps, 'save', 'Widget compiled but save failed; changes in editor only'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'save', status: 'success' });

      return compositeResult(compositeSuccess('create_menu_screen', steps, EXECUTION));
    },
  );

  toolHelpRegistry.set('create_menu_screen', {
    title: 'Create Menu Screen',
    description: 'Create a widget blueprint, populate its widget tree from DSL, optionally patch class defaults, compile, and save — all in one call.',
    inputSchema: {} as Record<string, z.ZodTypeAny>,
    outputSchema: z.object({}).passthrough(),
  });

  // =========================================================================
  // Tool 2: apply_widget_patch
  // =========================================================================

  server.registerTool(
    'apply_widget_patch',
    {
      title: 'Apply Widget Patch',
      description:
        'Extract the current widget tree, apply a unified-diff DSL patch, compile, optionally save, and return the final widget state.',
      inputSchema: {
        asset_path: z.string().describe('UE content path.'),
        diff: z.string().describe('Widget tree diff in unified-diff DSL format.'),
        save: z.boolean().default(false).describe('Save after successful compile.'),
      },
      annotations: {
        title: 'Apply Widget Patch',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { asset_path, diff, save } = args as {
        asset_path: string;
        diff: string;
        save: boolean;
      };

      const steps: CompositeStepResult[] = [];

      // Step 1: Extract current state
      const extractResult = await safeCall(() =>
        callSubsystemJson('ExtractWidgetBlueprint', {
          AssetPath: asset_path,
          bIncludeClassDefaults: false,
        }),
      );

      if (!extractResult.ok) {
        steps.push({ step: 'extract', status: 'failure', message: extractResult.error.message });
        return compositeResult(
          compositePartialFailure('apply_widget_patch', steps, 'extract',
            buildPartialState(steps, 'extract', 'No mutations performed; editor state unchanged'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'extract', status: 'success', message: 'Extracted current widget tree' });

      // Step 2: Parse diff and apply operations
      const diffResult = parseWidgetDiff(diff);
      if (diffResult.operations.length === 0) {
        steps.push({ step: 'apply_diff', status: 'success', message: 'No changes detected in diff' });
        steps.push({ step: 'compile', status: 'skipped', message: 'No changes to compile' });
        if (save) {
          steps.push({ step: 'save', status: 'skipped', message: 'No changes to save' });
        }
        steps.push({ step: 'extract_result', status: 'success', data: extractResult.value });
        return compositeResult(compositeSuccess('apply_widget_patch', steps, EXECUTION));
      }

      // Convert diff operations to batch operations
      const batchOps = diffResult.operations.map((op) => convertDiffOp(op));

      const applyResult = await safeCall(() =>
        callSubsystemJson('ModifyWidgetBlueprintStructure', {
          AssetPath: asset_path,
          Operation: 'batch',
          PayloadJson: JSON.stringify({ operations: batchOps }),
          bValidateOnly: false,
        }),
      );

      if (!applyResult.ok) {
        steps.push({ step: 'apply_diff', status: 'failure', message: applyResult.error.message });
        return compositeResult(
          compositePartialFailure('apply_widget_patch', steps, 'apply_diff',
            buildPartialState(steps, 'apply_diff', 'Diff operations failed; widget may be partially mutated'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({
        step: 'apply_diff', status: 'success',
        message: `Applied ${diffResult.operations.length} operation(s)`,
        data: applyResult.value,
        ...(diffResult.warnings.length > 0 ? { diagnostics: diffResult.warnings.map(w => ({ severity: 'warning', message: w })) } : {}),
      });

      // Step 3: Compile
      const compileResult = await safeCall(() =>
        callSubsystemJson('CompileWidgetBlueprint', { AssetPath: asset_path }),
      );

      if (!compileResult.ok) {
        steps.push({ step: 'compile', status: 'failure', message: compileResult.error.message });
        return compositeResult(
          compositePartialFailure('apply_widget_patch', steps, 'compile',
            buildPartialState(steps, 'compile', 'Diff applied but compilation failed; unsaved'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'compile', status: 'success', data: compileResult.value });

      // Step 4: Save (optional)
      if (save) {
        const saveResult = await safeCall(() =>
          callSubsystemJson('SaveAssets', { AssetPaths: JSON.stringify([asset_path]) }),
        );

        if (!saveResult.ok) {
          steps.push({ step: 'save', status: 'failure', message: saveResult.error.message });
          return compositeResult(
            compositePartialFailure('apply_widget_patch', steps, 'save',
              buildPartialState(steps, 'save', 'Diff applied and compiled but save failed'),
              EXECUTION),
            { isError: true },
          );
        }
        steps.push({ step: 'save', status: 'success' });
      } else {
        steps.push({ step: 'save', status: 'skipped', message: 'save=false' });
      }

      // Step 5: Extract final state
      const extractFinalResult = await safeCall(() =>
        callSubsystemJson('ExtractWidgetBlueprint', {
          AssetPath: asset_path,
          bIncludeClassDefaults: false,
        }),
      );

      if (!extractFinalResult.ok) {
        steps.push({ step: 'extract_result', status: 'failure', message: extractFinalResult.error.message });
        return compositeResult(
          compositePartialFailure('apply_widget_patch', steps, 'extract_result',
            buildPartialState(steps, 'extract_result', 'Diff applied and compiled but final extraction failed'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'extract_result', status: 'success', data: extractFinalResult.value });

      return compositeResult(compositeSuccess('apply_widget_patch', steps, EXECUTION));
    },
  );

  toolHelpRegistry.set('apply_widget_patch', {
    title: 'Apply Widget Patch',
    description: 'Extract the current widget tree, apply a unified-diff DSL patch, compile, optionally save, and return the final widget state.',
    inputSchema: {} as Record<string, z.ZodTypeAny>,
    outputSchema: z.object({}).passthrough(),
  });

  // =========================================================================
  // Tool 3: create_material_setup
  // =========================================================================

  server.registerTool(
    'create_material_setup',
    {
      title: 'Create Material Setup',
      description:
        'Create a material, configure domain/blend mode/shading model, optionally apply graph operations, compile, and save — all in one call.',
      inputSchema: {
        asset_path: z.string().describe('UE content path for the new material.'),
        domain: z.string().default('Surface').describe('Material domain.'),
        blend_mode: z.string().default('Opaque').describe('Blend mode.'),
        shading_model: z.string().default('DefaultLit').describe('Shading model.'),
        operations: z.array(z.record(z.string(), z.unknown())).optional().describe('Material graph operations to apply.'),
      },
      annotations: {
        title: 'Create Material Setup',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { asset_path, domain, blend_mode, shading_model, operations } = args as {
        asset_path: string;
        domain: string;
        blend_mode: string;
        shading_model: string;
        operations?: Array<Record<string, unknown>>;
      };

      const steps: CompositeStepResult[] = [];

      // Step 1: Create material
      const createResult = await safeCall(() =>
        callSubsystemJson('CreateMaterial', { AssetPath: asset_path }),
      );

      if (!createResult.ok) {
        steps.push({ step: 'create', status: 'failure', message: createResult.error.message });
        return compositeResult(
          compositePartialFailure('create_material_setup', steps, 'create',
            buildPartialState(steps, 'create', 'No mutations performed; editor state unchanged'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'create', status: 'success', message: `Created ${asset_path}`, data: createResult.value });

      // Step 2: Set material properties (domain, blend mode, shading model)
      const settingsResult = await safeCall(() =>
        callSubsystemJson('MaterialGraphOperation', {
          AssetPath: asset_path,
          Operation: 'set_material_properties',
          PayloadJson: JSON.stringify({
            MaterialDomain: domain,
            BlendMode: blend_mode,
            ShadingModel: shading_model,
          }),
        }),
      );

      if (!settingsResult.ok) {
        steps.push({ step: 'settings', status: 'failure', message: settingsResult.error.message });
        return compositeResult(
          compositePartialFailure('create_material_setup', steps, 'settings',
            buildPartialState(steps, 'settings', 'Material created but properties not set'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'settings', status: 'success', data: settingsResult.value });

      // Step 3: Apply graph operations (optional)
      if (operations && operations.length > 0) {
        const graphOpsResult = await safeCall(() =>
          callSubsystemJson('ModifyMaterial', {
            AssetPath: asset_path,
            OperationsJson: JSON.stringify(operations),
          }),
        );

        if (!graphOpsResult.ok) {
          steps.push({ step: 'graph_ops', status: 'failure', message: graphOpsResult.error.message });
          return compositeResult(
            compositePartialFailure('create_material_setup', steps, 'graph_ops',
              buildPartialState(steps, 'graph_ops', 'Material created and settings applied but graph operations failed'),
              EXECUTION),
            { isError: true },
          );
        }
        steps.push({ step: 'graph_ops', status: 'success', message: `Applied ${operations.length} operation(s)`, data: graphOpsResult.value });
      } else {
        steps.push({ step: 'graph_ops', status: 'skipped', message: 'No graph operations provided' });
      }

      // Step 4: Compile
      const compileResult = await safeCall(() =>
        callSubsystemJson('CompileMaterialAsset', { AssetPath: asset_path }),
      );

      if (!compileResult.ok) {
        steps.push({ step: 'compile', status: 'failure', message: compileResult.error.message });
        return compositeResult(
          compositePartialFailure('create_material_setup', steps, 'compile',
            buildPartialState(steps, 'compile', 'Material configured but compilation failed; unsaved'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'compile', status: 'success', data: compileResult.value });

      // Step 5: Save
      const saveResult = await safeCall(() =>
        callSubsystemJson('SaveAssets', { AssetPaths: JSON.stringify([asset_path]) }),
      );

      if (!saveResult.ok) {
        steps.push({ step: 'save', status: 'failure', message: saveResult.error.message });
        return compositeResult(
          compositePartialFailure('create_material_setup', steps, 'save',
            buildPartialState(steps, 'save', 'Material compiled but save failed; changes in editor only'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'save', status: 'success' });

      return compositeResult(compositeSuccess('create_material_setup', steps, EXECUTION));
    },
  );

  toolHelpRegistry.set('create_material_setup', {
    title: 'Create Material Setup',
    description: 'Create a material, configure domain/blend mode/shading model, optionally apply graph operations, compile, and save — all in one call.',
    inputSchema: {} as Record<string, z.ZodTypeAny>,
    outputSchema: z.object({}).passthrough(),
  });

  // =========================================================================
  // Tool 4: scaffold_blueprint
  // =========================================================================

  server.registerTool(
    'scaffold_blueprint',
    {
      title: 'Scaffold Blueprint',
      description:
        'Create a blueprint asset, add variables and function stubs, and save — all in one call.',
      inputSchema: {
        asset_path: z.string().describe('UE content path for the new blueprint.'),
        parent_class: z.string().default('Actor').describe('Parent class.'),
        variables: z.array(z.object({
          name: z.string(),
          type: z.string(),
          default_value: z.unknown().optional(),
        })).optional().describe('Variables to add.'),
        functions: z.array(z.object({
          name: z.string(),
          access: z.string().optional(),
        })).optional().describe('Function stubs to add.'),
      },
      annotations: {
        title: 'Scaffold Blueprint',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { asset_path, parent_class, variables, functions } = args as {
        asset_path: string;
        parent_class: string;
        variables?: Array<{ name: string; type: string; default_value?: unknown }>;
        functions?: Array<{ name: string; access?: string }>;
      };

      const steps: CompositeStepResult[] = [];

      // Step 1: Create blueprint
      const createResult = await safeCall(() =>
        callSubsystemJson('CreateBlueprint', {
          AssetPath: asset_path,
          ParentClassPath: parent_class,
          PayloadJson: JSON.stringify({}),
          bValidateOnly: false,
        }),
      );

      if (!createResult.ok) {
        steps.push({ step: 'create', status: 'failure', message: createResult.error.message });
        return compositeResult(
          compositePartialFailure('scaffold_blueprint', steps, 'create',
            buildPartialState(steps, 'create', 'No mutations performed; editor state unchanged'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'create', status: 'success', message: `Created ${asset_path}`, data: createResult.value });

      // Step 2: Add members (variables + functions)
      const hasVariables = variables && variables.length > 0;
      const hasFunctions = functions && functions.length > 0;

      if (hasVariables || hasFunctions) {
        const memberOps: Array<Record<string, unknown>> = [];

        if (hasVariables) {
          for (const v of variables) {
            memberOps.push({
              operation: 'add_variable',
              name: v.name,
              type: v.type,
              ...(v.default_value !== undefined ? { default_value: v.default_value } : {}),
            });
          }
        }

        if (hasFunctions) {
          for (const f of functions) {
            memberOps.push({
              operation: 'add_function',
              name: f.name,
              ...(f.access ? { access: f.access } : {}),
            });
          }
        }

        const membersResult = await safeCall(() =>
          callSubsystemJson('ModifyBlueprintMembers', {
            AssetPath: asset_path,
            OperationsJson: JSON.stringify(memberOps),
          }),
        );

        if (!membersResult.ok) {
          steps.push({ step: 'add_members', status: 'failure', message: membersResult.error.message });
          return compositeResult(
            compositePartialFailure('scaffold_blueprint', steps, 'add_members',
              buildPartialState(steps, 'add_members', 'Blueprint created but members not added'),
              EXECUTION),
            { isError: true },
          );
        }
        steps.push({
          step: 'add_members', status: 'success',
          message: `Added ${memberOps.length} member(s)`,
          data: membersResult.value,
        });
      } else {
        steps.push({ step: 'add_members', status: 'skipped', message: 'No variables or functions provided' });
      }

      // Step 3: Save
      const saveResult = await safeCall(() =>
        callSubsystemJson('SaveAssets', { AssetPaths: JSON.stringify([asset_path]) }),
      );

      if (!saveResult.ok) {
        steps.push({ step: 'save', status: 'failure', message: saveResult.error.message });
        return compositeResult(
          compositePartialFailure('scaffold_blueprint', steps, 'save',
            buildPartialState(steps, 'save', 'Blueprint scaffolded but save failed; changes in editor only'),
            EXECUTION),
          { isError: true },
        );
      }
      steps.push({ step: 'save', status: 'success' });

      return compositeResult(compositeSuccess('scaffold_blueprint', steps, EXECUTION));
    },
  );

  toolHelpRegistry.set('scaffold_blueprint', {
    title: 'Scaffold Blueprint',
    description: 'Create a blueprint asset, add variables and function stubs, and save — all in one call.',
    inputSchema: {} as Record<string, z.ZodTypeAny>,
    outputSchema: z.object({}).passthrough(),
  });
}

// ---------------------------------------------------------------------------
// Diff operation -> batch operation converter (mirrors widget-structure.ts)
// ---------------------------------------------------------------------------

function convertDiffOp(op: { type: string; target: string; parent?: string; index?: number; node?: Record<string, unknown>; properties?: Record<string, unknown>; slot?: Record<string, unknown>; is_variable?: boolean }): Record<string, unknown> {
  switch (op.type) {
    case 'remove':
      return { operation: 'remove_widget', widget_name: op.target };

    case 'insert':
      return {
        operation: 'insert_child',
        parent_name: op.parent ?? '',
        index: op.index ?? -1,
        widget: op.node ?? { class: 'TextBlock', name: op.target },
      };

    case 'patch':
      return {
        operation: 'patch_widget',
        widget_name: op.target,
        ...(op.properties ? { properties: op.properties } : {}),
        ...(op.slot ? { slot: op.slot } : {}),
        ...(op.is_variable !== undefined ? { is_variable: op.is_variable } : {}),
      };

    case 'replace':
      return {
        operation: 'replace_widget',
        widget_name: op.target,
        widget: op.node ?? { class: 'TextBlock', name: op.target },
      };

    default:
      return { operation: op.type, widget_name: op.target };
  }
}
