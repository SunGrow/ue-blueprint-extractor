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

type ScaffoldPinTypeInput = string | Record<string, unknown>;

type ScaffoldVariableInput = {
  name: string;
  type: ScaffoldPinTypeInput;
  default_value?: unknown;
};

type ScaffoldFunctionInput = {
  name: string;
  access?: string;
  access_specifier?: string;
};

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

const SCAFFOLD_PRIMITIVE_PIN_TYPES: Record<string, Record<string, unknown>> = {
  bool: { category: 'bool' },
  byte: { category: 'byte' },
  int: { category: 'int' },
  int64: { category: 'int64' },
  float: { category: 'real', subCategory: 'float' },
  double: { category: 'real', subCategory: 'double' },
  name: { category: 'name' },
  string: { category: 'string' },
  text: { category: 'text' },
};

function splitTopLevelTypeArguments(source: string): [string, string] | null {
  let depth = 0;
  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    if (ch === '<') {
      depth += 1;
      continue;
    }
    if (ch === '>') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === ',' && depth === 0) {
      const left = source.slice(0, index).trim();
      const right = source.slice(index + 1).trim();
      if (left.length > 0 && right.length > 0) {
        return [left, right];
      }
      return null;
    }
  }

  return null;
}

function normalizeScaffoldPinType(typeInput: ScaffoldPinTypeInput, variableName: string): Record<string, unknown> {
  if (typeof typeInput !== 'string') {
    return { ...typeInput };
  }

  const trimmed = typeInput.trim();
  if (trimmed.length === 0) {
    throw new Error(`Variable '${variableName}' requires a non-empty type.`);
  }

  const arrayMatch = trimmed.match(/^array<(.+)>$/i);
  if (arrayMatch) {
    return {
      ...normalizeScaffoldPinType(arrayMatch[1], variableName),
      containerType: 'Array',
    };
  }

  const setMatch = trimmed.match(/^set<(.+)>$/i);
  if (setMatch) {
    return {
      ...normalizeScaffoldPinType(setMatch[1], variableName),
      containerType: 'Set',
    };
  }

  const mapMatch = trimmed.match(/^map<(.+)>$/i);
  if (mapMatch) {
    const typeArgs = splitTopLevelTypeArguments(mapMatch[1]);
    if (!typeArgs) {
      throw new Error(
        `Variable '${variableName}' uses invalid map type shorthand '${trimmed}'. Use map<KeyType, ValueType> or a full pinType object.`,
      );
    }

    const [keyType, valueType] = typeArgs;
    return {
      ...normalizeScaffoldPinType(keyType, variableName),
      containerType: 'Map',
      valueType: normalizeScaffoldPinType(valueType, variableName),
    };
  }

  const normalized = SCAFFOLD_PRIMITIVE_PIN_TYPES[trimmed.toLowerCase()];
  if (normalized) {
    return { ...normalized };
  }

  const supportedTypes = Object.keys(SCAFFOLD_PRIMITIVE_PIN_TYPES).join(', ');
  throw new Error(
    `Variable '${variableName}' type '${trimmed}' is not supported as shorthand. Use one of [${supportedTypes}], array/set/map wrappers, or pass a full pinType object.`,
  );
}

function normalizeScaffoldDefaultValue(defaultValue: unknown, variableName: string): string {
  if (typeof defaultValue === 'string') {
    return defaultValue;
  }
  if (typeof defaultValue === 'number' || typeof defaultValue === 'boolean' || typeof defaultValue === 'bigint') {
    return String(defaultValue);
  }

  throw new Error(
    `Variable '${variableName}' default_value must be a string, number, or boolean. For complex Blueprint export text, pass a string literal.`,
  );
}

function normalizeScaffoldVariable(variable: ScaffoldVariableInput): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    name: variable.name,
    pinType: normalizeScaffoldPinType(variable.type, variable.name),
  };

  if (variable.default_value !== undefined) {
    normalized.defaultValue = normalizeScaffoldDefaultValue(variable.default_value, variable.name);
  }

  return normalized;
}

function normalizeScaffoldFunction(func: ScaffoldFunctionInput): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    graphName: func.name,
  };

  const accessSpecifier = func.access_specifier ?? func.access;
  if (accessSpecifier) {
    normalized.accessSpecifier = accessSpecifier;
  }

  return normalized;
}

function buildScaffoldCreatePayload(
  variables?: ScaffoldVariableInput[],
  functions?: ScaffoldFunctionInput[],
): { payload: Record<string, unknown>; memberCount: number } {
  const payload: Record<string, unknown> = {};
  let memberCount = 0;

  if (variables && variables.length > 0) {
    payload.variables = variables.map(normalizeScaffoldVariable);
    memberCount += variables.length;
  }

  if (functions && functions.length > 0) {
    payload.functionStubs = functions.map(normalizeScaffoldFunction);
    memberCount += functions.length;
  }

  return { payload, memberCount };
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
      if (dslResult.nodes.length === 0) {
        steps.push({ step: 'build_tree', status: 'failure', message: 'DSL produced no widget nodes' });
        return compositeResult(
          compositePartialFailure('create_menu_screen', steps, 'build_tree',
            buildPartialState(steps, 'build_tree', 'Widget blueprint created but DSL produced no widget tree'),
            EXECUTION),
          { isError: true },
        );
      }
      const buildResult = await safeCall(() =>
        callSubsystemJson('BuildWidgetTree', {
          AssetPath: asset_path,
          WidgetTreeJson: JSON.stringify(dslResult.nodes[0]),
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
            PayloadJson: JSON.stringify({ classDefaults: class_defaults }),
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
        callSubsystemJson('ModifyMaterial', {
          AssetPath: asset_path,
          PayloadJson: JSON.stringify({
            operations: [{
              operation: 'set_material_settings',
              settings: {
                materialDomain: domain,
                blendMode: blend_mode,
                shadingModel: shading_model,
              },
            }],
          }),
          bValidateOnly: false,
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
            PayloadJson: JSON.stringify({ operations }),
            bValidateOnly: false,
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
        parent_class: z.string().default('/Script/Engine.Actor').describe('Parent class path.'),
        variables: z.array(z.object({
          name: z.string(),
          type: z.union([z.string(), z.record(z.string(), z.unknown())]).describe(
            'Primitive shorthand (e.g. int, float, array<int>) or a full extractor pinType object.',
          ),
          default_value: z.unknown().optional(),
        })).optional().describe('Variables to add.'),
        functions: z.array(z.object({
          name: z.string(),
          access: z.string().optional(),
          access_specifier: z.string().optional(),
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
        variables?: ScaffoldVariableInput[];
        functions?: ScaffoldFunctionInput[];
      };

      const steps: CompositeStepResult[] = [];
      let createPayload: Record<string, unknown> = {};
      let scaffoldMemberCount = 0;

      try {
        const normalizedPayload = buildScaffoldCreatePayload(variables, functions);
        createPayload = normalizedPayload.payload;
        scaffoldMemberCount = normalizedPayload.memberCount;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push({ step: 'create', status: 'failure', message });
        return compositeResult(
          compositePartialFailure('scaffold_blueprint', steps, 'create',
            buildPartialState(steps, 'create', 'No mutations performed; scaffold payload validation failed'),
            EXECUTION),
          { isError: true },
        );
      }

      // Step 1: Create blueprint
      const createResult = await safeCall(() =>
        callSubsystemJson('CreateBlueprint', {
          AssetPath: asset_path,
          ParentClassPath: parent_class,
          PayloadJson: JSON.stringify(createPayload),
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

      // Step 2: Report member seeding status
      if (scaffoldMemberCount > 0) {
        steps.push({
          step: 'add_members',
          status: 'success',
          message: `Applied ${scaffoldMemberCount} member(s) during blueprint creation`,
          data: {
            memberCount: scaffoldMemberCount,
          },
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
