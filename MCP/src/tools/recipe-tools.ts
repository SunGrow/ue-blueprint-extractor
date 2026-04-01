import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  safeCall,
  compositeSuccess,
  compositeError,
  compositePartialFailure,
  type CompositeStepResult,
  type CompositeToolResult,
} from '../helpers/composite-patterns.js';
import { parseWidgetDsl } from '../helpers/widget-dsl-parser.js';
import { parseWidgetRecipe } from '../helpers/widget-recipe-parser.js';
import { jsonToolSuccess } from '../helpers/subsystem.js';
import type { ToolHelpEntry } from '../helpers/tool-help.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterRecipeToolsOptions = {
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

function compositeErrorResult(composite: CompositeToolResult, errorText: string) {
  return {
    content: [{ type: 'text' as const, text: errorText }],
    structuredContent: composite as unknown as Record<string, unknown>,
    isError: true,
  };
}

export function registerRecipeTools({
  server,
  callSubsystemJson,
  toolHelpRegistry,
}: RegisterRecipeToolsOptions): void {
  server.registerTool(
    'execute_widget_recipe',
    {
      title: 'Execute Widget Recipe',
      description:
        'Execute a markdown widget recipe that describes the desired end state. Creates the widget, builds the tree, patches defaults, compiles, and saves — all in one call.',
      inputSchema: {
        recipe: z.string().describe('Markdown recipe string.'),
      },
      annotations: {
        title: 'Execute Widget Recipe',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ recipe }: { recipe: string }) => {
      const parsed = parseWidgetRecipe(recipe);

      if (!parsed.asset.path) {
        const steps: CompositeStepResult[] = [
          { step: 'parse', status: 'failure', message: 'Recipe missing required ## Asset section with path' },
        ];
        return compositeErrorResult(
          compositeError('execute_widget_recipe', steps, 'parse', EXECUTION),
          'Error: Recipe missing required ## Asset section with path',
        );
      }

      const steps: CompositeStepResult[] = [];

      // Step 0: Parse warnings
      if (parsed.warnings.length > 0) {
        steps.push({
          step: 'parse',
          status: 'success',
          message: `Parsed with ${parsed.warnings.length} warning(s)`,
          data: { warnings: parsed.warnings } as unknown as Record<string, unknown>,
        });
      } else {
        steps.push({ step: 'parse', status: 'success', message: 'Recipe parsed successfully' });
      }

      // Step 1: Create widget blueprint
      const createResult = await safeCall(() =>
        callSubsystemJson('CreateWidgetBlueprint', {
          AssetPath: parsed.asset.path,
          ParentClassPath: parsed.asset.parent ?? 'UserWidget',
        }),
      );
      if (createResult.ok) {
        steps.push({ step: 'create', status: 'success', message: `Created ${parsed.asset.path}`, data: createResult.value });
      } else {
        steps.push({ step: 'create', status: 'failure', message: createResult.error.message });
        return compositeErrorResult(
          compositeError('execute_widget_recipe', steps, 'create', EXECUTION),
          `Error: Failed to create widget — ${createResult.error.message}`,
        );
      }

      // Step 2: Build widget tree (if provided)
      if (parsed.widgetTree) {
        const dslResult = parseWidgetDsl(parsed.widgetTree);
        if (dslResult.nodes.length > 0) {
          const treeResult = await safeCall(() =>
            callSubsystemJson('BuildWidgetTree', {
              AssetPath: parsed.asset.path,
              WidgetTreeJson: JSON.stringify(dslResult.nodes[0]),
            }),
          );
          if (treeResult.ok) {
            steps.push({
              step: 'build_tree',
              status: 'success',
              message: 'Widget tree built',
              data: treeResult.value,
            });
          } else {
            steps.push({ step: 'build_tree', status: 'failure', message: treeResult.error.message });
            return compositeResult(
              compositePartialFailure(
                'execute_widget_recipe',
                steps,
                'build_tree',
                {
                  completed_steps: steps.filter((s) => s.status === 'success').map((s) => s.step),
                  failed_step: 'build_tree',
                  editor_state: `Widget ${parsed.asset.path} created but tree build failed`,
                },
                EXECUTION,
              ),
              { isError: true },
            );
          }

          // Append DSL warnings if any
          if (dslResult.warnings.length > 0) {
            const lastTreeStep = steps[steps.length - 1];
            if (lastTreeStep.data) {
              lastTreeStep.data['dsl_warnings'] = dslResult.warnings;
            }
          }
        }
      } else {
        steps.push({ step: 'build_tree', status: 'skipped', message: 'No Widget Tree section' });
      }

      // Step 3: Patch class defaults (if provided)
      if (parsed.classDefaults && Object.keys(parsed.classDefaults).length > 0) {
        const defaultsResult = await safeCall(() =>
          callSubsystemJson('PatchWidgetClassDefaults', {
            AssetPath: parsed.asset.path,
            ClassDefaultsJson: JSON.stringify(parsed.classDefaults),
          }),
        );
        if (defaultsResult.ok) {
          steps.push({
            step: 'class_defaults',
            status: 'success',
            message: 'Class defaults patched',
            data: defaultsResult.value,
          });
        } else {
          steps.push({ step: 'class_defaults', status: 'failure', message: defaultsResult.error.message });
          return compositeResult(
            compositePartialFailure(
              'execute_widget_recipe',
              steps,
              'class_defaults',
              {
                completed_steps: steps.filter((s) => s.status === 'success').map((s) => s.step),
                failed_step: 'class_defaults',
                editor_state: `Widget ${parsed.asset.path} created and tree built but class defaults failed`,
              },
              EXECUTION,
            ),
            { isError: true },
          );
        }
      } else {
        steps.push({ step: 'class_defaults', status: 'skipped', message: 'No Class Defaults section' });
      }

      // Step 4+: Execute after steps
      for (const afterStep of parsed.afterSteps) {
        if (afterStep === 'compile') {
          const compileResult = await safeCall(() =>
            callSubsystemJson('CompileWidgetBlueprint', {
              AssetPath: parsed.asset.path,
            }),
          );
          if (compileResult.ok) {
            steps.push({ step: 'compile', status: 'success', message: 'Compiled', data: compileResult.value });
          } else {
            steps.push({ step: 'compile', status: 'failure', message: compileResult.error.message });
            return compositeResult(
              compositePartialFailure(
                'execute_widget_recipe',
                steps,
                'compile',
                {
                  completed_steps: steps.filter((s) => s.status === 'success').map((s) => s.step),
                  failed_step: 'compile',
                  editor_state: `Widget ${parsed.asset.path} created but compilation failed`,
                },
                EXECUTION,
              ),
              { isError: true },
            );
          }
        } else if (afterStep === 'capture') {
          const captureResult = await safeCall(() =>
            callSubsystemJson('CaptureWidgetPreview', {
              AssetPath: parsed.asset.path,
            }),
          );
          if (captureResult.ok) {
            steps.push({ step: 'capture', status: 'success', message: 'Captured preview', data: captureResult.value });
          } else {
            // Capture failure is non-fatal — continue pipeline
            steps.push({ step: 'capture', status: 'failure', message: captureResult.error.message });
          }
        } else if (afterStep === 'save') {
          const saveResult = await safeCall(() =>
            callSubsystemJson('SaveAssets', {
              AssetPaths: JSON.stringify([parsed.asset.path]),
            }),
          );
          if (saveResult.ok) {
            steps.push({ step: 'save', status: 'success', message: 'Saved', data: saveResult.value });
          } else {
            steps.push({ step: 'save', status: 'failure', message: saveResult.error.message });
            return compositeResult(
              compositePartialFailure(
                'execute_widget_recipe',
                steps,
                'save',
                {
                  completed_steps: steps.filter((s) => s.status === 'success').map((s) => s.step),
                  failed_step: 'save',
                  editor_state: `Widget ${parsed.asset.path} created and compiled but save failed`,
                },
                EXECUTION,
              ),
              { isError: true },
            );
          }
        }
      }

      // Final extraction
      const extractResult = await safeCall(() =>
        callSubsystemJson('ExtractWidgetBlueprint', {
          AssetPath: parsed.asset.path,
          bIncludeClassDefaults: !!parsed.classDefaults,
        }),
      );

      if (extractResult.ok) {
        steps.push({
          step: 'extract',
          status: 'success',
          message: 'Extracted final state',
          data: extractResult.value,
        });
      } else {
        // Extraction failure after successful pipeline is non-fatal
        steps.push({ step: 'extract', status: 'failure', message: extractResult.error.message });
      }

      return compositeResult(compositeSuccess('execute_widget_recipe', steps, EXECUTION));
    },
  );

  toolHelpRegistry.set('execute_widget_recipe', {
    title: 'Execute Widget Recipe',
    description:
      'Execute a markdown widget recipe that describes the desired end state. Creates the widget, builds the tree, patches defaults, compiles, and saves — all in one call.',
    inputSchema: {} as Record<string, z.ZodTypeAny>,
    outputSchema: z.object({}).passthrough(),
  });
}
