#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { UEClient } from './ue-client.js';
import { compactBlueprint } from './compactor.js';
import {
  ProjectController,
  type ProjectControllerLike,
  type BuildConfiguration,
  type BuildPlatform,
} from './project-controller.js';

export type UEClientLike = Pick<UEClient, 'callSubsystem'> & Partial<Pick<UEClient, 'checkConnection'>>;

const serverInstructions = [
  'Blueprint Extractor MCP v2 exposes explicit snake_case tool arguments, prompt workflows, and structured JSON tool results.',
  'Use search_assets before extract_* tools when the exact asset path is not already known.',
  'For UI redesign work, inspect the current HUD, transition widgets, and class defaults before replacing widget trees.',
  'Write tools mutate the running editor but do not save automatically. Call save_assets after successful mutations you want to persist.',
  'Prefer validate_only=true the first time you author a new asset family or payload shape.',
  'Use the composable material tools for settings, node creation, node connection, and root-property binding. Treat modify_material and modify_material_function as advanced escape hatches.',
  'Use create_input_action, modify_input_action, create_input_mapping_context, and modify_input_mapping_context for Enhanced Input authoring. Generic data asset mutation is intentionally rejected for those asset classes.',
  'Successful tool results mirror the same JSON in structuredContent and text. Recoverable execution failures return isError=true with code, message, recoverable, and next_steps.',
].join('\n');

const taskAwareTools = new Set([
  'compile_project_code',
  'trigger_live_coding',
  'restart_editor',
  'sync_project_code',
  'import_assets',
  'reimport_assets',
  'get_import_job',
  'list_import_jobs',
  'import_textures',
  'import_meshes',
]);

type ToolExample = {
  title: string;
  tool: string;
  arguments: Record<string, unknown>;
};

type ExampleFamily = {
  summary: string;
  recommended_flow: string[];
  examples: ToolExample[];
};

type PromptCatalogEntry = {
  title: string;
  description: string;
  args: Record<string, z.ZodTypeAny>;
  buildPrompt: (args: Record<string, unknown>) => string;
};

export const exampleCatalog: Record<string, ExampleFamily> = {
  widget_blueprint: {
    summary: 'Inspect the current widget, apply the smallest structural change that solves the layout problem, compile, then save.',
    recommended_flow: [
      'extract_widget_blueprint',
      'modify_widget_blueprint',
      'compile_widget_blueprint',
      'save_assets',
    ],
    examples: [
      {
        title: 'patch_title_text',
        tool: 'modify_widget_blueprint',
        arguments: {
          asset_path: '/Game/UI/WBP_Window',
          operation: 'patch_widget',
          widget_path: 'WindowRoot/TitleBar/TitleText',
          properties: { Text: 'Window' },
          compile_after: true,
        },
      },
      {
        title: 'insert_body_text',
        tool: 'modify_widget_blueprint',
        arguments: {
          asset_path: '/Game/UI/WBP_Window',
          operation: 'batch',
          operations: [
            {
              operation: 'insert_child',
              parent_widget_path: 'WindowRoot/ContentRoot',
              child_widget: {
                class: 'TextBlock',
                name: 'BodyText',
                is_variable: true,
                properties: { Text: 'Hello' },
              },
            },
          ],
        },
      },
    ],
  },
  material: {
    summary: 'Use the composable material tools first. They emit the same graph operations under the hood without exposing the full batch DSL.',
    recommended_flow: [
      'create_material',
      'set_material_settings',
      'add_material_expression',
      'bind_material_property',
      'extract_material',
      'save_assets',
    ],
    examples: [
      {
        title: 'set_opaque_defaults',
        tool: 'set_material_settings',
        arguments: {
          asset_path: '/Game/Materials/M_ButtonBase',
          settings: {
            blend_mode: 'BLEND_Opaque',
            two_sided: false,
          },
        },
      },
      {
        title: 'add_albedo_sampler',
        tool: 'add_material_expression',
        arguments: {
          asset_path: '/Game/Materials/M_ButtonBase',
          expression_class: '/Script/Engine.MaterialExpressionTextureSampleParameter2D',
          expression_name: 'AlbedoSample',
          expression_properties: {
            ParameterName: 'Albedo',
            Texture: '/Engine/EngineResources/DefaultTexture.DefaultTexture',
          },
          node_position: {
            x: -480,
            y: -120,
          },
        },
      },
      {
        title: 'bind_base_color',
        tool: 'bind_material_property',
        arguments: {
          asset_path: '/Game/Materials/M_ButtonBase',
          from_expression: 'AlbedoSample',
          from_output_name: 'RGB',
          material_property: 'MP_BaseColor',
        },
      },
    ],
  },
  enhanced_input: {
    summary: 'Author InputAction and InputMappingContext assets through the dedicated Enhanced Input tools, not the generic DataAsset path.',
    recommended_flow: [
      'create_input_action',
      'create_input_mapping_context',
      'modify_input_mapping_context',
      'save_assets',
    ],
    examples: [
      {
        title: 'create_jump_action',
        tool: 'create_input_action',
        arguments: {
          asset_path: '/Game/Input/IA_Jump',
          value_type: 'boolean',
          properties: {
            action_description: 'Jump action',
            consume_input: true,
          },
        },
      },
      {
        title: 'bind_spacebar_to_jump',
        tool: 'modify_input_mapping_context',
        arguments: {
          asset_path: '/Game/Input/IMC_Player',
          replace_mappings: true,
          mappings: [
            {
              action: '/Game/Input/IA_Jump.IA_Jump',
              key: 'SpaceBar',
            },
          ],
        },
      },
    ],
  },
  window_ui_polish: {
    summary: 'Use the thin sequencing helper when a screen change touches variable flags, class defaults, compile/save, and optional code sync in one flow.',
    recommended_flow: [
      'extract_widget_blueprint',
      'apply_window_ui_changes',
      'extract_widget_blueprint',
    ],
    examples: [
      {
        title: 'window_polish_pass',
        tool: 'apply_window_ui_changes',
        arguments: {
          asset_path: '/Game/UI/WBP_Window',
          variable_widgets: [
            {
              widget_path: 'WindowRoot/TitleBar/TitleText',
              is_variable: true,
            },
          ],
          class_defaults: {
            ActiveTitleBarMaterial: '/Game/UI/MI_TitleBarActive.MI_TitleBarActive',
          },
          compile_after: true,
          save_after: true,
        },
      },
    ],
  },
  project_code: {
    summary: 'Use explicit changed_paths so build-vs-live-coding decisions stay deterministic.',
    recommended_flow: [
      'get_project_automation_context',
      'sync_project_code',
    ],
    examples: [
      {
        title: 'sync_cpp_change',
        tool: 'sync_project_code',
        arguments: {
          changed_paths: [
            'Source/MyGame/Private/MyActor.cpp',
          ],
          project_path: 'C:/Projects/MyGame/MyGame.uproject',
          engine_root: 'C:/Program Files/Epic Games/UE_5.7',
          target: 'MyGameEditor',
        },
      },
    ],
  },
};

export const promptCatalog: Record<string, PromptCatalogEntry> = {
  design_menu_screen: {
    title: 'Design Menu Screen',
    description: 'Plan a safe WidgetBlueprint menu redesign that inspects the current UI before rewriting structure.',
    args: {
      widget_asset_path: z.string(),
      design_goal: z.string(),
      parent_class_path: z.string().optional(),
      existing_hud_asset_path: z.string().optional(),
      existing_transition_asset_path: z.string().optional(),
    },
    buildPrompt: ({
      widget_asset_path,
      design_goal,
      parent_class_path,
      existing_hud_asset_path,
      existing_transition_asset_path,
    }) => [
      `Design a WidgetBlueprint menu screen for ${widget_asset_path}.`,
      `Goal: ${design_goal}.`,
      parent_class_path ? `Expected parent class: ${parent_class_path}.` : 'Choose the narrowest appropriate parent widget class.',
      existing_hud_asset_path ? `Inspect the existing HUD first: ${existing_hud_asset_path}.` : 'Inspect the current HUD wiring before replacing the screen.',
      existing_transition_asset_path ? `Inspect the transition asset first: ${existing_transition_asset_path}.` : 'Inspect transition widgets and activatable-window flow before redesigning layout.',
      'Produce a concrete widget-tree plan, required BindWidget names, class-default changes, and compile/save steps.',
      'Prefer centered_overlay, common_menu_shell, or activatable_window patterns over ad-hoc CanvasPanel placement.',
    ].join('\n'),
  },
  author_material_button_style: {
    title: 'Author Material Button Style',
    description: 'Plan a composable material authoring pass for a button style using the v2 material tools.',
    args: {
      asset_path: z.string(),
      visual_goal: z.string(),
      texture_asset_path: z.string().optional(),
    },
    buildPrompt: ({ asset_path, visual_goal, texture_asset_path }) => [
      `Author a button-style material at ${asset_path}.`,
      `Visual goal: ${visual_goal}.`,
      texture_asset_path ? `Use texture asset: ${texture_asset_path}.` : 'Only use engine-default texture assets if no project texture is available.',
      'Prefer set_material_settings, add_material_expression, connect_material_expressions, and bind_material_property.',
      'Only fall back to modify_material if the smaller tools cannot express the required graph operation.',
    ].join('\n'),
  },
  wire_hud_widget_classes: {
    title: 'Wire HUD Widget Classes',
    description: 'Plan widget-class and class-default wiring for HUD-style assets.',
    args: {
      hud_asset_path: z.string(),
      widget_class_path: z.string(),
      class_default_property: z.string(),
    },
    buildPrompt: ({ hud_asset_path, widget_class_path, class_default_property }) => [
      `Wire widget class defaults for ${hud_asset_path}.`,
      `Target widget class: ${widget_class_path}.`,
      `Class default property: ${class_default_property}.`,
      'Inspect the current Blueprint members and class defaults first.',
      'Return the smallest set of modify_blueprint_members or modify_widget_blueprint.patch_class_defaults calls needed to complete the wiring.',
    ].join('\n'),
  },
  debug_widget_compile_errors: {
    title: 'Debug Widget Compile Errors',
    description: 'Turn WidgetBlueprint compile output into a concrete recovery plan.',
    args: {
      widget_asset_path: z.string(),
      compile_summary_json: z.string().optional(),
    },
    buildPrompt: ({ widget_asset_path, compile_summary_json }) => [
      `Debug WidgetBlueprint compile failures for ${widget_asset_path}.`,
      compile_summary_json ? `Compile summary:\n${compile_summary_json}` : 'Start by compiling the widget blueprint and inspecting compile diagnostics.',
      'Check for BindWidget type/name mismatches, abstract widget classes in the tree, and stale class-default references.',
      'Return the minimal follow-up extract/modify/compile sequence needed to fix the compile state.',
    ].join('\n'),
  },
};

export function createBlueprintExtractorServer(
  client: UEClientLike = new UEClient(),
  projectController: ProjectControllerLike = new ProjectController(),
) {
  const server = new McpServer({
    name: 'blueprint-extractor',
    version: '2.0.0',
  }, {
    instructions: serverInstructions,
  });

  const v2ToolResultSchema = z.object({
    success: z.boolean(),
    operation: z.string(),
    code: z.string().optional(),
    message: z.string().optional(),
    recoverable: z.boolean().optional(),
    next_steps: z.array(z.string()).optional(),
    diagnostics: z.array(z.object({
      severity: z.string().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
      path: z.string().optional(),
    }).passthrough()).optional(),
    execution: z.object({
      mode: z.enum(['immediate', 'task_aware']),
      task_support: z.enum(['optional', 'required', 'forbidden']),
      status: z.string().optional(),
      progress_message: z.string().optional(),
    }).optional(),
  }).passthrough();

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function tryParseJsonText(text: string | undefined): unknown {
    if (!text) {
      return undefined;
    }

    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  function extractTextContent(result: unknown): string | undefined {
    if (!isRecord(result) || !Array.isArray(result.content)) {
      return undefined;
    }

    const entry = result.content.find((candidate) => isRecord(candidate) && candidate.type === 'text');
    return isRecord(entry) && typeof entry.text === 'string' ? entry.text : undefined;
  }

  function extractToolPayload(result: unknown): unknown {
    if (isRecord(result) && 'structuredContent' in result) {
      return result.structuredContent;
    }

    if (isRecord(result) && Array.isArray(result.content)) {
      const text = extractTextContent(result);
      const parsed = tryParseJsonText(text);
      if (parsed !== undefined) {
        return parsed;
      }

      if (text) {
        return { message: text };
      }
    }

    return result;
  }

  function defaultNextSteps(toolName: string, payload?: Record<string, unknown>): string[] {
    if (toolName === 'compile_widget_blueprint') {
      return [
        'Inspect compile.messages and diagnostics for the first failing widget or property.',
        'Re-extract the widget blueprint before applying the next structural patch.',
        'Check BindWidget names/types and any abstract classes referenced by the widget tree.',
      ];
    }

    if (taskAwareTools.has(toolName)) {
      return [
        'Inspect the returned execution.status and diagnostics before retrying.',
        'Poll the task-oriented status tool again if the operation is still running.',
      ];
    }

    if (payload?.validateOnly === true) {
      return [
        'Fix the reported validation issues and rerun the same call.',
      ];
    }

    return [
      'Inspect diagnostics and validation details, then retry the same operation.',
      'Use validate_only=true first if the tool supports it and you need more actionable failures.',
    ];
  }

  function inferExecutionMetadata(toolName: string, payload?: Record<string, unknown>) {
    const taskSupport = taskAwareTools.has(toolName) ? 'optional' : 'forbidden';
    const mode = taskSupport === 'optional' ? 'task_aware' : 'immediate';
    const status = typeof payload?.status === 'string'
      ? payload.status
      : typeof payload?.compileResult === 'string'
        ? payload.compileResult
        : payload?.terminal === false
          ? 'running'
          : 'completed';
    const progressMessage = typeof payload?.reason === 'string'
      ? payload.reason
      : typeof payload?.summary === 'string'
        ? payload.summary
        : undefined;

    return {
      mode,
      task_support: taskSupport,
      status,
      ...(progressMessage ? { progress_message: progressMessage } : {}),
    };
  }

  function normalizeToolError(
    toolName: string,
    payloadOrError: unknown,
    existingResult?: Record<string, unknown>,
  ) {
    const payload = isRecord(payloadOrError) ? { ...payloadOrError } : {};
    const diagnostics = Array.isArray(payload.diagnostics)
      ? payload.diagnostics
      : [];
    const firstDiagnostic = diagnostics.find((candidate) => (
      isRecord(candidate)
      && typeof candidate.message === 'string'
      && candidate.message.length > 0
    ));
    const message = typeof payload.message === 'string'
      ? payload.message
      : typeof payload.error === 'string'
        ? payload.error
        : (isRecord(firstDiagnostic) && typeof firstDiagnostic.message === 'string')
          ? firstDiagnostic.message
        : payloadOrError instanceof Error
          ? payloadOrError.message
          : typeof payloadOrError === 'string'
            ? payloadOrError.replace(/^Error:\s*/, '')
            : `Tool '${toolName}' failed.`;
    const envelope: Record<string, unknown> = {
      ...payload,
      success: false,
      operation: typeof payload.operation === 'string' ? payload.operation : toolName,
      code: typeof payload.code === 'string'
        ? payload.code
        : (isRecord(firstDiagnostic) && typeof firstDiagnostic.code === 'string' && firstDiagnostic.code.length > 0)
          ? firstDiagnostic.code
          : 'tool_execution_failed',
      message,
      recoverable: typeof payload.recoverable === 'boolean' ? payload.recoverable : true,
      next_steps: Array.isArray(payload.next_steps) ? payload.next_steps : defaultNextSteps(toolName, payload),
      execution: inferExecutionMetadata(toolName, payload),
    };

    if (diagnostics.length > 0) {
      envelope.diagnostics = diagnostics;
    }

    return {
      ...(existingResult ?? {}),
      content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
      structuredContent: envelope,
      isError: true,
    };
  }

  function normalizeToolSuccess(toolName: string, payload: unknown) {
    const basePayload: Record<string, unknown> = isRecord(payload) ? { ...payload } : { data: payload };
    const success = typeof basePayload.success === 'boolean' ? basePayload.success : true;

    if (!success) {
      return normalizeToolError(toolName, basePayload);
    }

    const envelope: Record<string, unknown> = {
      ...basePayload,
      success: true,
      operation: typeof basePayload.operation === 'string' ? basePayload.operation : toolName,
      execution: inferExecutionMetadata(toolName, basePayload),
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
      structuredContent: envelope,
    };
  }

  const rawRegisterTool = server.registerTool.bind(server) as typeof server.registerTool;
  (server as typeof server & { registerTool: typeof server.registerTool }).registerTool = ((name, config, cb) => {
    return (rawRegisterTool as any)(name, {
      ...config,
      outputSchema: config.outputSchema ?? v2ToolResultSchema,
    }, async (args: unknown, extra: unknown) => {
      try {
        const result = await (cb as (args: unknown, extra: unknown) => Promise<unknown> | unknown)(args, extra);
        if (isRecord(result) && result.isError === true) {
          return normalizeToolError(name, extractToolPayload(result), result);
        }

        return normalizeToolSuccess(name, extractToolPayload(result));
      } catch (error) {
        return normalizeToolError(name, error);
      }
    });
  }) as typeof server.registerTool;

// Shared scope enum with detailed descriptions
const scopeEnum = z.enum([
  'ClassLevel',
  'Variables',
  'Components',
  'FunctionsShallow',
  'Full',
  'FullWithBytecode',
]);

const cascadeManifestEntrySchema = z.object({
  assetPath: z.string(),
  assetType: z.string(),
  outputFile: z.string().optional(),
  depth: z.number().int().min(0),
  status: z.string(),
  error: z.string().optional(),
});

const CascadeResultSchema = v2ToolResultSchema.extend({
  extracted_count: z.number().int().min(0),
  skipped_count: z.number().int().min(0),
  total_count: z.number().int().min(0),
  output_directory: z.string(),
  manifest: z.array(cascadeManifestEntrySchema),
}).passthrough();

// Resource: extraction scope reference (static docs — app-controlled read-only context)
server.resource(
  'extraction-scopes',
  'blueprint://scopes',
  {
    description: 'Reference for Blueprint extraction scopes: what each level includes, typical sizes, and when to use.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extraction Scopes',
        '',
        'Each scope includes everything from the previous level:',
        '',
        '| Scope             | Adds                                              | Typical Size  | Use When                                      |',
        '|-------------------|---------------------------------------------------|---------------|-----------------------------------------------|',
        '| ClassLevel        | Parent class, interfaces, class flags, metadata   | 1-2 KB        | Checking inheritance or interface list         |',
        '| Variables         | All variables with types, defaults, flags          | 2-10 KB       | Understanding data model (DEFAULT)             |',
        '| Components        | SCS component tree with property overrides vs CDO. For WidgetBlueprints: widget tree hierarchy with layout and bindings  | 5-20 KB       | Analyzing component composition                |',
        '| FunctionsShallow  | Function and event graph names only                | 5-25 KB       | Listing available functions before deep dive   |',
        '| Full              | Complete graph nodes, pins, and connections         | 20-500+ KB    | Understanding graph logic and execution flow   |',
        '| FullWithBytecode  | Raw bytecode hex dump per function                 | Largest        | Low-level analysis (rarely needed)             |',
        '',
        'Start with the narrowest scope that answers your question.',
        'Full scope on complex Blueprints can exceed 200KB and will be truncated.',
        '',
        'Note: Scopes only apply to Blueprint extraction (extract_blueprint and extract_cascade).',
        'DataAsset, DataTable, and StateTree always extract fully — no scope parameter is needed.',
      ].join('\n'),
    }],
  }),
);

server.resource(
  'write-capabilities',
  'blueprint://write-capabilities',
  {
    description: 'Reference for explicit-save authoring workflows, write-result shape, and currently supported write-capable asset families.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extractor Write Capabilities',
        '',
        'General rules:',
        '- Write tools mutate assets in the running UE editor and return structured diagnostics.',
        '- Writes do NOT auto-save packages. Call save_assets after successful mutations you want to persist.',
        '- Write responses include: success, operation, assetPath, assetClass, changedObjects, dirtyPackages, diagnostics, and optional validation/compile summaries.',
        '',
        'Current write-capable families:',
        '- WidgetBlueprint: create_widget_blueprint, build_widget_tree, modify_widget, modify_widget_blueprint, compile_widget_blueprint',
        '- DataAsset: create_data_asset, modify_data_asset',
        '- DataTable: create_data_table, modify_data_table',
        '- Curve: create_curve, modify_curve',
        '- CurveTable: create_curve_table, modify_curve_table',
        '- Material graph assets: extract_material, create_material, modify_material, extract_material_function, create_material_function, modify_material_function, compile_material_asset',
        '- MaterialInstance: create_material_instance, modify_material_instance',
        '- UserDefinedStruct: create_user_defined_struct, modify_user_defined_struct',
        '- UserDefinedEnum: create_user_defined_enum, modify_user_defined_enum',
        '- Blackboard: create_blackboard, modify_blackboard',
        '- BehaviorTree: create_behavior_tree, modify_behavior_tree',
        '- StateTree: create_state_tree, modify_state_tree',
        '- AnimSequence: create_anim_sequence, modify_anim_sequence',
        '- AnimMontage: create_anim_montage, modify_anim_montage',
        '- BlendSpace: create_blend_space, modify_blend_space',
        '- Blueprint members: create_blueprint, modify_blueprint_members, modify_blueprint_graphs',
        '- Project automation context: get_project_automation_context',
        '- Shared persistence: save_assets',
        '- Host/editor orchestration: compile_project_code, trigger_live_coding, restart_editor, sync_project_code, apply_window_ui_changes',
        '',
        'Supported selectors and operation surfaces:',
        '- UserDefinedStruct: field selector by guid or name; operations replace_fields, patch_field, rename_field, remove_field, reorder_fields.',
        '- UserDefinedEnum: entry selector by name; operations replace_entries, rename_entry, remove_entry, reorder_entries.',
        '- Blackboard: key selector by entryName; operations replace_keys, patch_key, remove_key, set_parent.',
        '- BehaviorTree: node selector by nodePath; operations replace_tree, patch_node, patch_attachment, set_blackboard.',
        '- StateTree: selectors by stateId/statePath, editorNodeId, or transitionId; operations replace_tree, patch_state, patch_editor_node, patch_transition, set_schema.',
        '- AnimSequence: notify selector by notifyId/notifyGuid with notifyIndex or track metadata as fallback; operations replace_notifies, patch_notify, replace_sync_markers, replace_curve_metadata.',
        '- AnimMontage: notify selector by notifyId/notifyGuid with notifyIndex or track metadata as fallback; operations replace_notifies, patch_notify, replace_sections, replace_slots.',
        '- BlendSpace: sample selector by sampleIndex; operations replace_samples, patch_sample, set_axes.',
        '- Blueprint members: selectors by variableName, componentName, and functionName; operations replace_variables, patch_variable, replace_components, patch_component, replace_function_stubs, patch_class_defaults, compile.',
        '- Blueprint graphs: operation upsert_function_graphs preserves unrelated graphs; append_function_call_to_sequence patches an existing sequence-style initializer without replacing the whole graph.',
        '',
        'WidgetBlueprint guidance:',
        '- build_widget_tree is the destructive bootstrap path for whole-tree replacement.',
        '- extract_widget_blueprint returns a compact authoring snapshot with widgetPath annotations and additive packagePath/objectPath fields.',
        '- modify_widget supports direct widget_name or widget_path patches for one widget.',
        '- modify_widget_blueprint is the primary structural API: replace_tree, patch_widget, patch_class_defaults, insert_child, remove_widget, move_widget, wrap_widget, replace_widget_class, batch, or compile.',
        '- compile_widget_blueprint validates the asset but still does not save it.',
        '- apply_window_ui_changes is a thin MCP helper that sequences variable-flag updates, class defaults, optional font work, compile/save, and optional code sync.',
        '',
        'Explicit deferrals:',
        '- Blueprint graph authoring is explicit and opt-in via modify_blueprint_graphs; generic arbitrary graph synthesis is still intentionally bounded to targeted graph operations.',
        '- Material graph authoring currently targets the classic material ecosystem; there is no first-class Substrate-specific DSL yet.',
        '- No ControlRig, IK controller, or live world editing surfaces.',
        '- Animation authoring is limited to metadata, sections, slots, samples, notifies, sync markers, and curve metadata; raw authored track synthesis is out of scope.',
      ].join('\n'),
    }],
  }),
);

server.resource(
  'import-capabilities',
  'blueprint://import-capabilities',
  {
    description: 'Reference for async asset import payloads, job polling, status fields, and specialized texture or mesh option keys.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extractor Import Capabilities',
        '',
        'General rules:',
        '- Import tools enqueue async jobs in the running UE editor and return a job status object immediately.',
        '- Poll get_import_job with the returned jobId until terminal=true, or use list_import_jobs to inspect multiple jobs.',
        '- Import responses do NOT auto-save packages. Call save_assets after a successful terminal job if you want packages persisted.',
        '- Import payloads are passed through as subsystem JSON with an items array. The MCP layer preserves snake_case field names.',
        '',
        'Shared item fields:',
        '- file_path or url: exactly one source per item.',
        '- filename: optional suggested filename for URL sources.',
        '- headers: optional string map for URL downloads.',
        '- destination_path: target package path such as /Game/Imported.',
        '- destination_name: optional asset name override.',
        '- asset_path: optional explicit object path.',
        '- replace_existing, replace_existing_settings: optional overwrite flags.',
        '',
        'Texture item options:',
        '- compression_settings, lod_group, s_rgb/srgb, virtual_texture_streaming, flip_green_channel.',
        '',
        'Mesh item options:',
        '- mesh_type: "static" or "skeletal".',
        '- import_materials, import_textures, import_animations, combine_meshes, generate_collision.',
        '- skeleton_path is required for skeletal mesh imports.',
        '',
        'Job status payload fields:',
        '- success, operation, status, terminal, validateOnly, createdAt, startedAt, completedAt, jobId.',
        '- itemCount, acceptedItemCount, failedItemCount, importedObjects, dirtyPackages, diagnostics.',
        '- items[] entries include index, status, source path/url, destination info, importedObjects, dirtyPackages, and diagnostics.',
        '',
        'Known status values:',
        '- Job: queued, running, succeeded, partial_success, failed.',
        '- Item: queued, downloading, staged, importing, succeeded, failed.',
      ].join('\n'),
    }],
  }),
);

server.resource(
  'authoring-conventions',
  'blueprint://authoring-conventions',
  {
    description: 'Short reference for explicit-save write flows, validate_only behavior, and compact authoring habits.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extractor Authoring Conventions',
        '',
        '- Prefer validate_only=true before the first write to a new asset family or payload shape.',
        '- Writes mutate the live editor but do not save automatically; call save_assets when you want disk persistence.',
        '- Use the narrowest mutation tool that fits: patch one widget/member first, replace whole trees only when structure is changing broadly.',
        '- Keep payloads small by sending only changed fields, not full extracted objects, unless the tool explicitly expects a full replacement payload.',
        '- Re-extract after mutation when you need confirmation; do not assume UE normalized fields exactly as sent.',
        '- For multi-step widget work, prefer extract_widget_blueprint -> modify_widget_blueprint -> compile_widget_blueprint -> save_assets.',
        '- For code orchestration, pass explicit changed_paths to sync_project_code instead of relying on source-control inference.',
      ].join('\n'),
    }],
  }),
);

server.resource(
  'selector-conventions',
  'blueprint://selector-conventions',
  {
    description: 'Selector naming and addressing conventions across write-capable families.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extractor Selector Conventions',
        '',
        '- WidgetBlueprints: use widget_path for nested widgets when practical; use widget_name for flat or unique-tree edits.',
        '- BehaviorTree: use nodePath.',
        '- StateTree: use statePath/stateId, editorNodeId, or transitionId.',
        '- Blueprint members: use variableName, componentName, and functionName.',
        '- Anim assets: prefer stable notifyId/notifyGuid and sampleIndex selectors over array-position assumptions.',
        '- When a tool supports both name and path selectors, path is the safer choice after structural edits.',
        '- Public MCP inputs use one canonical snake_case shape. Do not rely on legacy aliases.',
        '- sync_project_code requires explicit changed_paths; it does not infer them from source control state.',
      ].join('\n'),
    }],
  }),
);

server.resource(
  'widget-best-practices',
  'blueprint://widget-best-practices',
  {
    description: 'UE/CommonUI-focused widget authoring guidance for Claude/Codex-driven Blueprint creation.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extractor Widget Best Practices',
        '',
        '- C++ owns widget logic and BindWidget fields; Blueprint owns layout and styling.',
        '- Use concrete widget classes in trees. Do not instantiate abstract bases such as UserWidget or CommonButtonBase.',
        '- Prefer CommonActivatableWidget as the root parent for CommonUI screens and windows.',
        '- Prefer VerticalBox, HorizontalBox, Overlay, Border, SizeBox, ScrollBox, and NamedSlot over CanvasPanel unless absolute positioning is required.',
        '- Keep styling centralized. Reuse fonts, colors, and button classes instead of repeating large inline property blobs.',
        '- Prefer event-driven updates and explicit setter functions over heavy property bindings or per-frame tick work.',
        '- Use TSubclassOf + CreateWidget only for truly dynamic repeated elements. Keep authored static layout in the Widget Blueprint tree.',
      ].join('\n'),
    }],
  }),
);

server.resource(
  'material-graph-guidance',
  'blueprint://material-graph-guidance',
  {
    description: 'Classic material graph guidance for materials, functions, layers, blends, and instance parity.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extractor Material Graph Guidance',
        '',
        'Supported assets:',
        '- UMaterial',
        '- UMaterialFunction',
        '- UMaterialFunctionMaterialLayer',
        '- UMaterialFunctionMaterialLayerBlend',
        '- UMaterialInstanceConstant parity via create_material_instance / modify_material_instance',
        '',
        'Stable selectors:',
        '- Expressions use expression_guid.',
        '- New expressions may be referenced within one batch by temp_id, then read back from tempIdMap.',
        '- Material root properties use engine enum names such as MP_BaseColor, MP_Normal, and MP_EmissiveColor.',
        '',
        'Primary operations:',
        '- add_expression, duplicate_expression, delete_expression, set_expression_properties, move_expression',
        '- connect_expressions, disconnect_expression_input',
        '- connect_material_property, disconnect_material_property',
        '- add_comment, delete_comment',
        '- rename_parameter_group, set_material_settings, set_layer_stack',
        '',
        'Defaults:',
        '- Extraction is compact by default; set verbose=true only when you need more authored property detail.',
        '- Mutations compile after apply unless compile_after=false.',
        '- Writes do not save packages automatically; call save_assets after successful mutations.',
        '',
        'Current limits:',
        '- No first-class Substrate authoring DSL yet. Substrate nodes still extract as generic expressions.',
        '- MaterialFunction assets use FunctionInput and FunctionOutput nodes as graph entry/exit points instead of material root-property bindings.',
      ].join('\n'),
    }],
  }),
);

server.resource(
  'font-role-guidance',
  'blueprint://font-roles',
  {
    description: 'Compact UI font-role guidance for project-owned runtime fonts and widget application payloads.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extractor Font Roles',
        '',
        '- Use explicit font file paths as the stable import contract; do not rely on installed-font name lookup.',
        '- Import project-owned UFontFace assets, then optionally synthesize/update a runtime UFont for widget use.',
        '- Apply fonts to widgets through compact payloads: widget selector + font_asset + typeface + size.',
        '',
        'Suggested roles:',
        '- title: typeface=Bold, size=18-24',
        '- button: typeface=Bold or Semibold, size=12-16',
        '- body: typeface=Regular, size=10-14',
        '- caption: typeface=Regular, size=9-11',
        '',
        'Keep font styling centralized in shared assets instead of repeating large FSlateFontInfo blobs.',
      ].join('\n'),
    }],
  }),
);

server.resource(
  'project-automation-guidance',
  'blueprint://project-automation',
  {
    description: 'Host/editor project automation guidance for build, Live Coding, restart, and reconnect flows.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extractor Project Automation',
        '',
        '- get_project_automation_context returns the editor-derived engine root, project file path, and editor target that project-control tools use as their first fallback.',
        '- compile_project_code runs an external UBT build from the MCP host.',
        '- compile_project_code and sync_project_code resolve engine_root, project_path, and target in this order: explicit args -> editor context -> environment.',
        '- trigger_live_coding requests an editor-side Live Coding compile and is only supported on Windows-focused setups. changed_paths remains an accepted compatibility input but the current editor-side trigger ignores it.',
        '- restart_editor requests an editor restart, then waits for Remote Control to disconnect and reconnect. When save_dirty_assets is true, all dirty packages are saved before the restart to prevent modal save dialogs.',
        '- sync_project_code requires explicit changed_paths and chooses Live Coding vs build_and_restart deterministically.',
        '',
        'build_and_restart is forced for:',
        '- .h/.hpp/.inl/.generated.h changes',
        '- .Build.cs, .Target.cs, .uplugin, .uproject changes',
        '- explicit force_rebuild=true',
        '',
        'Generic Live Coding Failure is not auto-promoted into a rebuild. The caller receives the failure result directly.',
      ].join('\n'),
    }],
  }),
);

const widgetPatternBodies: Record<string, string[]> = {
  activatable_window: [
    'Pattern: activatable_window',
    '',
    'Parent class:',
    '- CommonActivatableWidget',
    '',
    'Recommended hierarchy:',
    '- VerticalBox WindowRoot',
    '- HorizontalBox TitleBar',
    '- NamedSlot or Border ContentRoot',
    '- Optional HorizontalBox FooterActions',
    '',
    'Common BindWidget names:',
    '- TitleBar, TitleText, CloseButton, ContentRoot',
    '',
    'Avoid:',
    '- Abstract button classes in the tree',
    '- CanvasPanel-driven desktop layout unless absolute placement is required',
  ],
  modal_dialog: [
    'Pattern: modal_dialog',
    '',
    'Parent class:',
    '- CommonActivatableWidget',
    '',
    'Recommended hierarchy:',
    '- Overlay RootOverlay',
    '- Border DialogFrame',
    '- VerticalBox DialogBody',
    '- HorizontalBox ActionRow',
    '',
    'Common BindWidget names:',
    '- DialogTitle, BodyText, ConfirmButton, CancelButton',
  ],
  centered_overlay: [
    'Pattern: centered_overlay',
    '',
    'Parent class:',
    '- CommonActivatableWidget or UserWidget',
    '',
    'Recommended hierarchy:',
    '- Overlay RootOverlay',
    '- Image or Border Backdrop',
    '- SizeBox CenteredFrame',
    '- VerticalBox FrameBody',
    '',
    'Use this for menu shells that need a centered focal panel with dimmed background.',
  ],
  common_menu_shell: [
    'Pattern: common_menu_shell',
    '',
    'Parent class:',
    '- CommonActivatableWidget',
    '',
    'Recommended hierarchy:',
    '- VerticalBox Root',
    '- HorizontalBox HeaderRow',
    '- Overlay MainContent',
    '- HorizontalBox FooterActions',
    '',
    'Common BindWidget names:',
    '- ScreenTitle, BackButton, PrimaryActionButton, SecondaryActionButton',
  ],
  settings_panel: [
    'Pattern: settings_panel',
    '',
    'Parent class:',
    '- UserWidget or CommonActivatableWidget',
    '',
    'Recommended hierarchy:',
    '- VerticalBox Root',
    '- HorizontalBox HeaderRow',
    '- ScrollBox SettingsList',
    '- HorizontalBox FooterButtons',
    '',
    'Use NamedSlot or dedicated row widgets for extendable content.',
  ],
  list_detail: [
    'Pattern: list_detail',
    '',
    'Recommended hierarchy:',
    '- HorizontalBox Root',
    '- Border ListPane',
    '- Border DetailPane',
    '- ScrollBox/ListView in the list pane',
    '',
    'Avoid deep nested CanvasPanel composition for responsive list/detail screens.',
  ],
  toolbar_header: [
    'Pattern: toolbar_header',
    '',
    'Recommended hierarchy:',
    '- HorizontalBox HeaderRow',
    '- Left aligned title/info cluster',
    '- Spacer fill',
    '- Right aligned action buttons',
    '',
    'Common BindWidget names:',
    '- TitleText, SubtitleText, PrimaryButton, SecondaryButton',
  ],
};

server.resource(
  'examples',
  new ResourceTemplate('blueprint://examples/{family}', {
    list: async () => ({
      resources: Object.keys(exampleCatalog).map((family) => ({
        uri: `blueprint://examples/${family}`,
        name: `Example: ${family}`,
        mimeType: 'text/plain',
      })),
    }),
  }),
  {
    description: 'Schema-backed v2 example payloads and recommended flows for common authoring families.',
  },
  async (uri, variables) => {
    const family = String(variables.family ?? '');
    const entry = exampleCatalog[family];
    if (!entry) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/plain',
          text: `Unknown example family: ${family}`,
        }],
      };
    }

    const lines = [
      `Family: ${family}`,
      '',
      entry.summary,
      '',
      'Recommended flow:',
      ...entry.recommended_flow.map((toolName, index) => `${index + 1}. ${toolName}`),
      ...entry.examples.flatMap((example) => [
        '',
        `Example: ${example.title}`,
        `tool: ${example.tool}`,
        JSON.stringify(example.arguments, null, 2),
      ]),
    ];

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: lines.join('\n'),
      }],
    };
  },
);

server.resource(
  'widget-patterns',
  new ResourceTemplate('blueprint://widget-patterns/{pattern}', {
    list: async () => ({
      resources: Object.keys(widgetPatternBodies).map((pattern) => ({
        uri: `blueprint://widget-patterns/${pattern}`,
        name: `Widget pattern: ${pattern}`,
        mimeType: 'text/plain',
      })),
    }),
  }),
  {
    description: 'LLM-friendly widget composition patterns mapped to concrete UMG/CommonUI structures.',
  },
  async (uri, variables) => {
    const pattern = String(variables.pattern ?? '');
    const lines = widgetPatternBodies[pattern];
    if (!lines) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/plain',
          text: `Unknown widget pattern: ${pattern}`,
        }],
      };
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: lines.join('\n'),
      }],
    };
  },
);

server.registerResource(
  'unsupported-surfaces',
  'blueprint://unsupported-surfaces',
  {
    description: 'Explicit v2 unsupported or intentionally bounded surfaces.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Blueprint Extractor v2 Unsupported Surfaces',
        '',
        '- Generic create_data_asset and modify_data_asset reject Enhanced Input asset classes. Use the dedicated InputAction/InputMappingContext tools instead.',
        '- modify_material and modify_material_function remain available but are advanced escape hatches, not the primary authoring workflow.',
        '- There is still no first-class Substrate graph DSL.',
        '- Raw authored animation track synthesis is out of scope. Animation authoring remains metadata-oriented.',
        '- World editing and runtime actor manipulation are out of scope for this server.',
      ].join('\n'),
    }],
  }),
);

server.registerResource(
  'ui-redesign-workflow',
  'blueprint://ui-redesign-workflow',
  {
    description: 'Safe workflow for redesigning a UI screen without losing existing wiring.',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/plain',
      text: [
        'Safe UI Redesign Workflow',
        '',
        '1. search_assets and extract the current HUD, transition widgets, and target screen widgets.',
        '2. Inspect class defaults, BindWidget names, and current activatable-window flow before replacing any widget tree.',
        '3. Choose a preset layout pattern such as centered_overlay, common_menu_shell, activatable_window, or list_detail.',
        '4. Apply the smallest modify_widget_blueprint patch possible. Only use build_widget_tree or replace_tree when broad structure must change.',
        '5. Compile immediately after structural changes, then save only after the compile result is clean.',
      ].join('\n'),
    }],
  }),
);

for (const [name, prompt] of Object.entries(promptCatalog)) {
  server.registerPrompt(
    name,
    {
      title: prompt.title,
      description: prompt.description,
      argsSchema: prompt.args,
    },
    async (args) => ({
      description: prompt.description,
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: prompt.buildPrompt(args),
        },
      }],
    }),
  );
}

async function callSubsystemJson(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callSubsystem(method, params);
  const parsed = JSON.parse(result) as Record<string, unknown>;
  if (typeof parsed.error === 'string' && parsed.error.length > 0) {
    throw new Error(parsed.error);
  }
  return parsed;
}

function jsonToolSuccess(parsed: unknown, options: { compact?: boolean } = {}) {
  const compact = options.compact ?? true;
  return {
    content: [{ type: 'text' as const, text: compact ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2) }],
    structuredContent: parsed as Record<string, unknown>,
  };
}

function jsonToolError(e: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}

function maybeBoolean(...values: Array<unknown>): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }

  return undefined;
}

function getWidgetIdentifier(widgetName?: string, widgetPath?: string): string | null {
  return widgetPath ?? widgetName ?? null;
}

function canFallbackFromLiveCoding(result: Record<string, unknown>): boolean {
  const status = typeof result.status === 'string' ? result.status.toLowerCase() : '';
  const compileResult = typeof result.compileResult === 'string' ? result.compileResult.toLowerCase() : '';
  const reason = typeof result.reason === 'string' ? result.reason.toLowerCase() : '';

  return (
    status === 'unsupported'
    || status === 'unavailable'
    || compileResult === 'unsupported'
    || compileResult === 'unavailable'
    || reason === 'unsupported'
    || reason === 'unavailable'
    || result.fallbackRecommended === true
  );
}

function supportsConnectionProbe(activeClient: UEClientLike): (() => Promise<boolean>) | null {
  if (typeof activeClient.checkConnection === 'function') {
    return activeClient.checkConnection.bind(activeClient);
  }

  return null;
}

type ProjectAutomationContext = {
  success?: boolean;
  operation?: string;
  projectName?: string;
  projectFilePath?: string;
  projectDir?: string;
  engineDir?: string;
  engineRoot?: string;
  editorTarget?: string;
  hostPlatform?: string;
  supportsLiveCoding?: boolean;
  liveCodingAvailable?: boolean;
  liveCodingEnabled?: boolean;
  liveCodingStarted?: boolean;
  liveCodingError?: string;
};

type ProjectInputSource = 'explicit' | 'editor_context' | 'environment' | 'missing';

type ResolvedProjectInputs = {
  engineRoot?: string;
  projectPath?: string;
  target?: string;
  context: ProjectAutomationContext | null;
  contextError?: string;
  sources: {
    engineRoot: ProjectInputSource;
    projectPath: ProjectInputSource;
    target: ProjectInputSource;
  };
};

let cachedProjectAutomationContext: ProjectAutomationContext | null = null;

function firstDefinedString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

async function getProjectAutomationContext(forceRefresh = false): Promise<ProjectAutomationContext> {
  if (!forceRefresh && cachedProjectAutomationContext) {
    return cachedProjectAutomationContext;
  }

  const parsed = await callSubsystemJson('GetProjectAutomationContext', {});
  cachedProjectAutomationContext = parsed as ProjectAutomationContext;
  return cachedProjectAutomationContext;
}

async function resolveProjectInputs(
  request: {
    engine_root?: string;
    project_path?: string;
    target?: string;
  },
): Promise<ResolvedProjectInputs> {
  let context: ProjectAutomationContext | null = null;
  let contextError: string | undefined;

  if (!request.engine_root || !request.project_path || !request.target) {
    try {
      context = await getProjectAutomationContext();
    } catch (error) {
      contextError = error instanceof Error ? error.message : String(error);
    }
  }

  const engineRootFromContext = firstDefinedString(context?.engineRoot);
  const projectPathFromContext = firstDefinedString(context?.projectFilePath);
  const targetFromContext = firstDefinedString(context?.editorTarget);
  const engineRootFromEnv = firstDefinedString(process.env.UE_ENGINE_ROOT);
  const projectPathFromEnv = firstDefinedString(process.env.UE_PROJECT_PATH);
  const targetFromEnv = firstDefinedString(process.env.UE_PROJECT_TARGET, process.env.UE_EDITOR_TARGET);

  const engineRoot = firstDefinedString(request.engine_root, engineRootFromContext, engineRootFromEnv);
  const projectPath = firstDefinedString(request.project_path, projectPathFromContext, projectPathFromEnv);
  const target = firstDefinedString(request.target, targetFromContext, targetFromEnv);

  return {
    engineRoot,
    projectPath,
    target,
    context,
    contextError,
    sources: {
      engineRoot: request.engine_root ? 'explicit' : engineRootFromContext ? 'editor_context' : engineRootFromEnv ? 'environment' : 'missing',
      projectPath: request.project_path ? 'explicit' : projectPathFromContext ? 'editor_context' : projectPathFromEnv ? 'environment' : 'missing',
      target: request.target ? 'explicit' : targetFromContext ? 'editor_context' : targetFromEnv ? 'environment' : 'missing',
    },
  };
}

function buildProjectResolutionDiagnostics(resolved: ResolvedProjectInputs): string[] {
  const diagnostics = [
    `engine_root=${resolved.sources.engineRoot}`,
    `project_path=${resolved.sources.projectPath}`,
    `target=${resolved.sources.target}`,
  ];

  if (resolved.contextError) {
    diagnostics.push(`editor_context_error=${resolved.contextError}`);
  }

  return diagnostics;
}

function explainProjectResolutionFailure(prefix: string, resolved: ResolvedProjectInputs): Error {
  return new Error(`${prefix}; attempted explicit args -> editor context -> environment (${buildProjectResolutionDiagnostics(resolved).join(', ')})`);
}

// Tool 1: extract_blueprint
server.registerTool(
  'extract_blueprint',
  {
    title: 'Extract Blueprint',
    description: `Extract a UE5 Blueprint asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first to find the correct asset path if you don't already have it.
- Start with the narrowest scope that answers your question — each level includes everything from the previous:
  * ClassLevel — parent class, interfaces, class flags, metadata (~1-2KB)
  * Variables — + all variables with types, defaults, flags (~2-10KB)
  * Components — + SCS component tree with property overrides (~5-20KB). For WidgetBlueprints, also includes the widget tree hierarchy with bindings.
  * FunctionsShallow — + function/event graph names only (~5-25KB)
  * Full — + complete graph nodes, pins, and connections (~20-500KB+)
  * FullWithBytecode — + raw bytecode hex dump (largest, rarely needed)
- Only escalate to Full when you need to understand graph logic (node connections, pin values, execution flow).
- Full scope on complex Blueprints can exceed 200KB and will be truncated. If truncated, use a narrower scope or inspect specific functions via the graph names from FunctionsShallow.
- Use FunctionsShallow scope first to get graph names, then request specific graphs with graph_filter to reduce output size.
- Use compact=true to reduce JSON size by ~50-70% for LLM consumption.

RETURNS: JSON object with the extracted Blueprint data at the requested scope level.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Blueprint asset. Must start with /Game/ (e.g. /Game/Blueprints/BP_Character). Use search_assets to find paths.',
      ),
      scope: scopeEnum.default('Variables').describe(
        'Extraction depth. Start with ClassLevel or Variables — only use Full when you need graph/node details.',
      ),
      graph_filter: z.array(z.string()).optional().describe(
        'Filter to specific graphs by name. Use FunctionsShallow scope first to discover graph names, then pass the names you want here. Empty/omitted = extract all graphs. Example: ["EventGraph", "CalculateDamage"]',
      ),
      compact: z.boolean().default(false).describe(
        'When true, strips low-value fields and minifies JSON to reduce size by ~50-70%. Removes: pinId, posX/posY, graphGuid, autogeneratedDefaultValue, nodeComment (when empty), empty connections, empty default_value, empty sub_category. Replaces full exec pin type objects with the string "exec".',
      ),
    },
    annotations: {
      title: 'Extract Blueprint',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path, scope, graph_filter, compact }) => {
    try {
      const result = await client.callSubsystem('ExtractBlueprint', {
        AssetPath: asset_path,
        Scope: scope,
        GraphFilter: graph_filter ? graph_filter.join(',') : '',
      });
      let parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      if (compact) {
        parsed = compactBlueprint(parsed);
      }
      const text = compact ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
      if (text.length > 200_000) {
        return { content: [{ type: 'text' as const, text: `Warning: Response is ${(text.length / 1024).toFixed(0)}KB — consider using a narrower scope (ClassLevel, Variables, or FunctionsShallow).\n\n${text.substring(0, 200_000)}...\n[TRUNCATED]` }] };
      }
      return { content: [{ type: 'text' as const, text }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 2: extract_statetree
server.registerTool(
  'extract_statetree',
  {
    title: 'Extract StateTree',
    description: `Extract a UE5 StateTree asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first to find the asset path if needed (filter by class "StateTree").
- Returns the full state hierarchy: states, tasks, conditions, transitions, evaluators, and linked assets.
- Response size depends on StateTree complexity — typically 10-100KB.

RETURNS: JSON object with schema, state hierarchy, tasks, conditions, transitions, and linked assets.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to a StateTree asset (e.g. /Game/AI/ST_BotBehavior). Use search_assets with class_filter "StateTree" to find paths.',
      ),
    },
    annotations: {
      title: 'Extract StateTree',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractStateTree', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 3: extract_dataasset
server.registerTool(
  'extract_dataasset',
  {
    title: 'Extract DataAsset',
    description: `Extract a UE5 DataAsset to structured JSON. Serializes all user-defined UPROPERTY fields using UE reflection.

USAGE GUIDELINES:
- Use search_assets first with class_filter "DataAsset" or a specific DataAsset subclass name to find the asset path.
- Returns all user-defined properties with their types and current values.
- Works with any UDataAsset or UPrimaryDataAsset subclass.

RETURNS: JSON object with the DataAsset's class info and all property values.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the DataAsset (e.g. /Game/Data/DA_ItemDatabase). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract DataAsset',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractDataAsset', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 4: extract_datatable
server.registerTool(
  'extract_datatable',
  {
    title: 'Extract DataTable',
    description: `Extract a UE5 DataTable asset to structured JSON. Includes the row struct schema and all row data.

USAGE GUIDELINES:
- Use search_assets first with class_filter "DataTable" to find the asset path.
- Returns the row struct type, property schema, row count, and all row data with names and values.
- Useful for understanding game data tables (items, abilities, stats, etc.).

RETURNS: JSON object with row struct info, schema, and all rows.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the DataTable (e.g. /Game/Data/DT_WeaponStats). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract DataTable',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractDataTable', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      const text = JSON.stringify(parsed, null, 2);
      if (text.length > 200_000) {
        return { content: [{ type: 'text' as const, text: `Warning: Response is ${(text.length / 1024).toFixed(0)}KB — large DataTable.\n\n${text.substring(0, 200_000)}...\n[TRUNCATED]` }] };
      }
      return { content: [{ type: 'text' as const, text }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 5: extract_behavior_tree
server.registerTool(
  'extract_behavior_tree',
  {
    title: 'Extract BehaviorTree',
    description: `Extract a UE5 BehaviorTree asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "BehaviorTree" if you need to discover the asset path.
- Returns the full node hierarchy including root decorators, child decorators, decorator logic, services, task/composite nodes, and the linked blackboard asset.
- Useful for understanding AI decision flow without opening the editor graph.

RETURNS: JSON object with the BehaviorTree hierarchy, node properties, and blackboard reference.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the BehaviorTree asset (e.g. /Game/AI/BT_MainAI). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract BehaviorTree',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractBehaviorTree', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 6: extract_blackboard
server.registerTool(
  'extract_blackboard',
  {
    title: 'Extract Blackboard',
    description: `Extract a UE5 Blackboard asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "Blackboard" or "BlackboardData" to find the asset path.
- Returns the effective key list, including inherited parent keys and local overrides.
- Key entries include type information and key-type-specific properties such as base class or enum binding.

RETURNS: JSON object with parent blackboard info and effective key definitions.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Blackboard asset (e.g. /Game/AI/BB_MainAI). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract Blackboard',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractBlackboard', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 7: extract_user_defined_struct
server.registerTool(
  'extract_user_defined_struct',
  {
    title: 'Extract UserDefinedStruct',
    description: `Extract a UE5 UserDefinedStruct asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "UserDefinedStruct" to find the asset path.
- Returns field metadata, pin types, struct status, GUID, and typed default values from the struct default instance.
- Useful when DataTables or Blueprint variables depend on project-defined struct schemas.

RETURNS: JSON object with struct metadata and field definitions.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the UserDefinedStruct asset (e.g. /Game/Data/S_ItemData). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract UserDefinedStruct',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractUserDefinedStruct', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 8: extract_user_defined_enum
server.registerTool(
  'extract_user_defined_enum',
  {
    title: 'Extract UserDefinedEnum',
    description: `Extract a UE5 UserDefinedEnum asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "UserDefinedEnum" to find the asset path.
- Returns the enum entries, display names, and numeric values, excluding the auto-generated MAX sentinel.
- Useful when gameplay data, DataAssets, or Blueprint logic refer to project enums.

RETURNS: JSON object with enum metadata and entry list.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the UserDefinedEnum asset (e.g. /Game/Data/E_ItemRarity). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract UserDefinedEnum',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractUserDefinedEnum', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 9: extract_curve
server.registerTool(
  'extract_curve',
  {
    title: 'Extract Curve',
    description: `Extract a UE5 curve asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "Curve" to find curve assets such as CurveFloat, CurveVector, or CurveLinearColor.
- Returns per-channel keys, tangents, interpolation modes, and default/extrapolation settings.
- Useful for gameplay tuning curves, UI animation curves, and authored scalar/vector ramps.

RETURNS: JSON object with curve type and channel key data.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the curve asset (e.g. /Game/Data/C_DamageOverTime). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract Curve',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractCurve', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 10: extract_curvetable
server.registerTool(
  'extract_curvetable',
  {
    title: 'Extract CurveTable',
    description: `Extract a UE5 CurveTable asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "CurveTable" to find the asset path.
- Returns row names plus the per-row curve data for rich or simple curve tables.
- Useful for difficulty scaling, balance curves, and time/value tables authored in spreadsheet form.

RETURNS: JSON object with curve table mode and all rows.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the CurveTable asset (e.g. /Game/Data/CT_DifficultyScaling). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract CurveTable',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractCurveTable', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 11: extract_material_instance
server.registerTool(
  'extract_material_instance',
  {
    title: 'Extract MaterialInstance',
    description: `Extract a UE5 MaterialInstance asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "MaterialInstance" to find the asset path.
- Returns the parent material chain, base material, scalar/vector/texture parameters, runtime virtual texture parameters, font parameters, and static switch states.
- Useful for understanding authored look-dev overrides without opening the material editor.

RETURNS: JSON object with effective MaterialInstance parameter values.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the MaterialInstance asset (e.g. /Game/Materials/MI_Character_Skin). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract MaterialInstance',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const parsed = await callSubsystemJson('ExtractMaterialInstance', { AssetPath: asset_path });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'extract_material',
  {
    title: 'Extract Material',
    description: 'Extract a compact classic material graph snapshot.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Material asset.',
      ),
      verbose: z.boolean().default(false).describe(
        'When true, include a more verbose property snapshot for expressions and comments.',
      ),
    },
    annotations: {
      title: 'Extract Material',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path, verbose }) => {
    try {
      const parsed = await callSubsystemJson('ExtractMaterial', {
        AssetPath: asset_path,
        bVerbose: verbose,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'extract_material_function',
  {
    title: 'Extract Material Function',
    description: 'Extract a compact graph snapshot for a material function, layer, or layer blend asset.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the MaterialFunction-family asset.',
      ),
      verbose: z.boolean().default(false).describe(
        'When true, include a more verbose property snapshot for expressions and comments.',
      ),
    },
    annotations: {
      title: 'Extract Material Function',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path, verbose }) => {
    try {
      const parsed = await callSubsystemJson('ExtractMaterialFunction', {
        AssetPath: asset_path,
        bVerbose: verbose,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

// Tool 12: extract_anim_sequence
server.registerTool(
  'extract_anim_sequence',
  {
    title: 'Extract AnimSequence',
    description: `Extract a UE5 AnimSequence asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "AnimSequence" to find the asset path.
- Returns runtime-stable animation data: length, sample count, sampling rate, additive settings, notifies, authored sync markers, and runtime curve tracks.
- Useful for inspecting authored animation events and metadata without touching editor-only data models.

RETURNS: JSON object with AnimSequence metadata, notifies, sync markers, and curves.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the AnimSequence asset (e.g. /Game/Animations/AS_Walk). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract AnimSequence',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractAnimSequence', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 13: extract_anim_montage
server.registerTool(
  'extract_anim_montage',
  {
    title: 'Extract AnimMontage',
    description: `Extract a UE5 AnimMontage asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "AnimMontage" to find the asset path.
- Returns slot tracks, animation segments, montage sections, branching-point notifies, and standard notifies.
- Useful for understanding combat, traversal, and layered animation sequencing.

RETURNS: JSON object with montage structure, slots, sections, and notify data.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the AnimMontage asset (e.g. /Game/Animations/AM_Attack). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract AnimMontage',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractAnimMontage', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 14: extract_blend_space
server.registerTool(
  'extract_blend_space',
  {
    title: 'Extract BlendSpace',
    description: `Extract a UE5 BlendSpace asset to structured JSON.

USAGE GUIDELINES:
- Use search_assets first with class_filter "BlendSpace" to find the asset path.
- Returns axis definitions, sample count, sample coordinates, and referenced animations for 1D or 2D blend spaces.
- Useful for locomotion, aim offset, and directional blending analysis.

RETURNS: JSON object with BlendSpace axes and sample definitions.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the BlendSpace asset (e.g. /Game/Animations/BS_Locomotion). Use search_assets to find paths.',
      ),
    },
    annotations: {
      title: 'Extract BlendSpace',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const result = await client.callSubsystem('ExtractBlendSpace', { AssetPath: asset_path });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 15: extract_cascade
server.registerTool(
  'extract_cascade',
  {
    title: 'Extract Cascade',
    description: `Extract multiple assets (Blueprint, AnimBlueprint, StateTree, BehaviorTree, Blackboard, DataAsset, DataTable, UserDefinedStruct, UserDefinedEnum, Curve, CurveTable, MaterialInstance, AnimSequence, AnimMontage, BlendSpace) with automatic reference following for supported dependency chains. Follows parent classes, interfaces, component classes, Blueprint references, blackboard links, material instance parents, and animation references up to max_depth levels deep.

USAGE GUIDELINES:
- Use when you need to understand an asset AND its dependencies (parent Blueprints, referenced Blueprints, etc.).
- Results are written to files on disk (in the project's configured output directory), NOT returned inline — the response contains a manifest summary with output filenames.
- For a single asset without dependencies, prefer the specific extract_* tool for that asset type.
- Cycle-safe: won't extract the same asset twice.

RETURNS: Summary with extracted_count, output_directory path, and a per-asset manifest. Read the output files to inspect the data.`,
    inputSchema: {
      asset_paths: z.array(z.string()).describe(
        'Array of UE content paths to extract (e.g. ["/Game/Blueprints/BP_Character", "/Game/Blueprints/BP_Weapon"])',
      ),
      scope: scopeEnum.default('Full').describe(
        'Extraction depth applied to all assets. Full is the default since cascade is typically used for deep analysis.',
      ),
      max_depth: z.number().int().min(0).max(10).default(3).describe(
        'How many levels deep to follow references (0 = only the listed assets, 3 = default)',
      ),
      graph_filter: z.array(z.string()).optional().describe(
        'Filter to specific graphs by name. Use FunctionsShallow scope first to discover graph names, then pass the names you want here. Empty/omitted = extract all graphs. Example: ["EventGraph", "CalculateDamage"]',
      ),
    },
    outputSchema: CascadeResultSchema,
    annotations: {
      title: 'Extract Cascade',
      readOnlyHint: false, // writes files to disk
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_paths, scope, max_depth, graph_filter }) => {
    try {
      const result = await client.callSubsystem('ExtractCascade', {
        AssetPathsJson: JSON.stringify(asset_paths),
        Scope: scope,
        MaxDepth: max_depth,
        GraphFilter: graph_filter ? graph_filter.join(',') : '',
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      const manifest = Array.isArray(parsed.manifest)
        ? parsed.manifest
        : Array.isArray(parsed.assets)
          ? parsed.assets
          : [];

      const totalCount = typeof parsed.total_count === 'number' ? parsed.total_count : manifest.length;
      const extractedCount = typeof parsed.extracted_count === 'number'
        ? parsed.extracted_count
        : manifest.filter((asset: any) => asset?.status === 'extracted').length;
      const skippedCount = typeof parsed.skipped_count === 'number'
        ? parsed.skipped_count
        : manifest.filter((asset: any) => asset?.status === 'skipped').length;

      const structuredContent = {
        extracted_count: extractedCount,
        skipped_count: skippedCount,
        total_count: totalCount,
        output_directory: typeof parsed.output_directory === 'string' ? parsed.output_directory : '',
        manifest,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 6: search_assets
server.registerTool(
  'search_assets',
  {
    title: 'Search Assets',
    description: `Search for UE5 assets by name. This is a lightweight lookup — use it FIRST to find correct asset paths before calling any extract_* tool.

USAGE GUIDELINES:
- Always call this before any extract_* tool if you don't already have the exact asset path.
- Searches asset names (not full paths) — partial matches work (e.g. "Character" finds "BP_Character").
- Filter by class to narrow results: "Blueprint" (default), "AnimBlueprint", "WidgetBlueprint", "StateTree", "BehaviorTree", "Blackboard", "DataAsset", "DataTable", "UserDefinedStruct", "UserDefinedEnum", "Curve", "CurveTable", "Material", "MaterialFunction", "MaterialInstance", "AnimSequence", "AnimMontage", "BlendSpace", or empty string for all.

RETURNS: JSON array of objects with path, name, and class for each matching asset.`,
    inputSchema: {
      query: z.string().describe(
        'Search term to match against asset names. Partial matches work (e.g. "Player" finds "BP_PlayerCharacter").',
      ),
      class_filter: z.string().default('Blueprint').describe(
        'Filter by asset class. Common values: "Blueprint", "AnimBlueprint", "WidgetBlueprint", "StateTree", "BehaviorTree", "Blackboard", "DataAsset", "DataTable", "UserDefinedStruct", "UserDefinedEnum", "Curve", "CurveTable", "Material", "MaterialFunction", "MaterialInstance", "AnimSequence", "AnimMontage", "BlendSpace", or "" for all asset types.',
      ),
      max_results: z.number().int().min(1).max(200).default(50).describe(
        'Maximum number of results to return. Lower values keep the response small and the query fast.',
      ),
    },
    annotations: {
      title: 'Search Assets',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, class_filter, max_results }) => {
    try {
      const result = await client.callSubsystem('SearchAssets', { Query: query, ClassFilter: class_filter, MaxResults: max_results });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed.results ?? [], null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Tool 7: list_assets
server.registerTool(
  'list_assets',
  {
    title: 'List Assets',
    description: `List UE5 assets under a package path. Use this to browse directory contents when you don't know asset names. If you know (part of) the asset name, prefer search_assets instead — it's faster and doesn't require knowing the directory.

When recursive=false, subdirectories are included in the results with class "Folder" — use this to browse the content tree structure.

RETURNS: JSON array of objects with path, name, and class for each asset (and subfolder when non-recursive) in the directory.`,
    inputSchema: {
      package_path: z.string().describe(
        'UE package path to list (e.g. /Game/Blueprints, /Game/AI). Use /Game to list from the Content root.',
      ),
      recursive: z.boolean().default(true).describe(
        'Whether to include assets in subdirectories.',
      ),
      class_filter: z.string().default('').describe(
        'Filter by asset class (e.g. "Blueprint", "StateTree"). Empty string returns all asset types.',
      ),
    },
    annotations: {
      title: 'List Assets',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ package_path, recursive, class_filter }) => {
    try {
      const result = await client.callSubsystem('ListAssets', {
        PackagePath: package_path,
        bRecursive: recursive,
        ClassFilter: class_filter,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// Recursive schema for widget tree nodes (used by build_widget_tree)
const WidgetNodeSchema: z.ZodType<any> = z.lazy(() => z.object({
  class: z.string().describe('Widget class name (e.g. CanvasPanel, TextBlock, CommonButtonBase, VerticalBox)'),
  name: z.string().describe('Widget instance name (used for BindWidget matching)'),
  display_label: z.string().optional().describe('Optional display label used by the editor for named slots or readable hierarchy labels.'),
  is_variable: z.boolean().default(false).describe('Mark as variable for BindWidget access from C++'),
  slot: z.record(z.string(), z.unknown()).optional().describe('Slot properties (type depends on parent panel)'),
  properties: z.record(z.string(), z.unknown()).optional().describe('Widget UPROPERTY values to set'),
  children: z.array(WidgetNodeSchema).optional().describe('Child widgets (only valid for panel widgets)'),
}));

const WidgetBlueprintMutationOperationSchema = z.enum([
  'replace_tree',
  'patch_widget',
  'patch_class_defaults',
  'insert_child',
  'remove_widget',
  'move_widget',
  'wrap_widget',
  'replace_widget_class',
  'batch',
  'compile',
]);

const PropertyEntrySchema = z.object({
  name: z.string(),
  value: z.unknown(),
});

const DataTableRowSchema = z.object({
  rowName: z.string().describe('Row name/key in the table.'),
  values: z.record(z.string(), z.unknown()).optional().describe(
    'Optional row values object keyed by property name.',
  ),
  properties: z.union([
    z.record(z.string(), z.unknown()),
    z.array(PropertyEntrySchema),
  ]).optional().describe(
    'Optional row property payload. Accepts either a property map or the extractor-style [{name, value}] array.',
  ),
});

const CurveInterpModeSchema = z.enum([
  'None',
  'Linear',
  'Constant',
  'Cubic',
]);

const CurveExtrapolationSchema = z.enum([
  'None',
  'Cycle',
  'CycleWithOffset',
  'Oscillate',
  'Linear',
  'Constant',
]);

const RichCurveKeySchema = z.object({
  time: z.number(),
  value: z.number(),
  arriveTangent: z.number().optional(),
  leaveTangent: z.number().optional(),
  interpMode: CurveInterpModeSchema.optional(),
});

const CurveChannelSchema = z.object({
  defaultValue: z.number().nullable().optional(),
  preInfinityExtrap: CurveExtrapolationSchema.optional(),
  postInfinityExtrap: CurveExtrapolationSchema.optional(),
  keys: z.array(RichCurveKeySchema).optional(),
});

const CurveTypeSchema = z.enum([
  'Float',
  'Vector',
  'LinearColor',
]);

const CurveTableModeSchema = z.enum([
  'RichCurves',
  'SimpleCurves',
]);

const CurveKeyDeleteSchema = z.object({
  channel: z.string(),
  time: z.number(),
});

const CurveKeyUpsertSchema = z.object({
  channel: z.string(),
  key: RichCurveKeySchema,
});

const CurveTableRowSchema = z.object({
  rowName: z.string(),
  curve: CurveChannelSchema,
});

const JsonObjectSchema = z.record(z.string(), z.unknown());
const StringMapSchema = z.record(z.string(), z.string());
const BuildPlatformSchema = z.enum(['Win64', 'Mac', 'Linux']);
const BuildConfigurationSchema = z.enum(['Debug', 'DebugGame', 'Development', 'Shipping', 'Test']);
const WidgetSelectorFieldsSchema = z.object({
  widget_name: z.string().optional(),
  widget_path: z.string().optional(),
});
const WidgetSelectorSchema = WidgetSelectorFieldsSchema.refine((value) => Boolean(value.widget_name || value.widget_path), {
  message: 'widget_name or widget_path is required',
});
const FontImportItemSchema = z.object({
  file_path: z.string(),
  entry_name: z.string().optional(),
  replace_existing: z.boolean().optional(),
});
const WindowFontApplicationSchema = WidgetSelectorFieldsSchema.extend({
  font_asset: z.string(),
  typeface: z.string().optional(),
  size: z.number().int().positive(),
}).refine((value) => Boolean(value.widget_name || value.widget_path), {
  message: 'widget_name or widget_path is required',
});
const MaterialFunctionAssetKindSchema = z.enum(['function', 'layer', 'layer_blend']);
const MaterialParameterAssociationSchema = z.enum([
  'GlobalParameter',
  'LayerParameter',
  'BlendParameter',
  'global',
  'layer',
  'blend',
]);
const MaterialParameterSelectorSchema = z.object({
  name: z.string(),
  association: MaterialParameterAssociationSchema.optional(),
  index: z.number().int().optional(),
}).passthrough();
const MaterialColorValueSchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(),
});
const MaterialScalarParameterSchema = MaterialParameterSelectorSchema.extend({
  value: z.number(),
});
const MaterialVectorParameterSchema = MaterialParameterSelectorSchema.extend({
  value: MaterialColorValueSchema,
});
const MaterialTextureParameterSchema = MaterialParameterSelectorSchema.extend({
  value: z.string().nullable(),
});
const MaterialFontParameterSchema = MaterialParameterSelectorSchema.extend({
  value: z.string().nullable(),
  fontPage: z.number().int().optional(),
});
const MaterialStaticSwitchParameterSchema = MaterialParameterSelectorSchema.extend({
  value: z.boolean(),
});
const MaterialLayerEntrySchema = z.object({
  layerPath: z.string().nullable().optional(),
  blendPath: z.string().nullable().optional(),
  layerGuid: z.string().optional(),
  name: z.string().optional(),
  visible: z.boolean().optional(),
}).passthrough();
const MaterialLayerStackSchema = z.object({
  layers: z.array(MaterialLayerEntrySchema),
}).passthrough();
const MaterialGraphOperationSchema = z.object({
  operation: z.enum([
    'add_expression',
    'duplicate_expression',
    'delete_expression',
    'set_expression_properties',
    'move_expression',
    'connect_expressions',
    'disconnect_expression_input',
    'connect_material_property',
    'disconnect_material_property',
    'add_comment',
    'delete_comment',
    'rename_parameter_group',
    'set_material_settings',
    'set_layer_stack',
  ]),
}).passthrough();
const MaterialGraphPayloadSchema = z.object({
  settings: JsonObjectSchema.optional(),
  compile_after: z.boolean().optional(),
  layout_after: z.boolean().optional(),
  operations: z.array(MaterialGraphOperationSchema).default([]),
}).passthrough();
const MaterialNodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
}).strict();
const MaterialExpressionSelectorFieldsSchema = z.object({
  expression_guid: z.string().optional(),
  temp_id: z.string().optional(),
}).strict();
const MaterialExpressionSelectorSchema = MaterialExpressionSelectorFieldsSchema.refine(
  (value) => Boolean(value.expression_guid || value.temp_id),
  { message: 'expression_guid or temp_id is required' },
);
const MaterialConnectionSelectorFieldsSchema = z.object({
  from_expression_guid: z.string().optional(),
  from_temp_id: z.string().optional(),
  to_expression_guid: z.string().optional(),
  to_temp_id: z.string().optional(),
  from_output_name: z.string().optional(),
  from_output_index: z.number().int().min(0).optional(),
  to_input_name: z.string().optional(),
  to_input_index: z.number().int().min(0).optional(),
}).strict();
const MaterialConnectionSelectorSchema = MaterialConnectionSelectorFieldsSchema.refine(
  (value) => Boolean(value.from_expression_guid || value.from_temp_id),
  { message: 'from_expression_guid or from_temp_id is required' },
).refine(
  (value) => Boolean(value.to_expression_guid || value.to_temp_id),
  { message: 'to_expression_guid or to_temp_id is required' },
);

const EnhancedInputValueTypeSchema = z.enum(['boolean', 'axis_1d', 'axis_2d', 'axis_3d']);
const InputMappingSchema = z.object({
  action: z.string(),
  key: z.string(),
}).strict();

const ImportItemCommonSchema = z.object({
  file_path: z.string().optional(),
  url: z.string().optional(),
  filename: z.string().optional(),
  headers: StringMapSchema.optional(),
  destination_path: z.string().optional(),
  destination_name: z.string().optional(),
  asset_path: z.string().optional(),
  replace_existing: z.boolean().optional(),
  replace_existing_settings: z.boolean().optional(),
}).passthrough();

const TextureImportOptionsSchema = z.object({
  compression_settings: z.string().optional(),
  lod_group: z.string().optional(),
  s_rgb: z.boolean().optional(),
  srgb: z.boolean().optional(),
  virtual_texture_streaming: z.boolean().optional(),
  flip_green_channel: z.boolean().optional(),
}).passthrough();

const MeshImportOptionsSchema = z.object({
  mesh_type: z.string().optional(),
  import_materials: z.boolean().optional(),
  import_textures: z.boolean().optional(),
  import_animations: z.boolean().optional(),
  combine_meshes: z.boolean().optional(),
  generate_collision: z.boolean().optional(),
  skeleton_path: z.string().optional(),
}).passthrough();

const ImportPayloadSchema = z.object({
  items: z.array(ImportItemCommonSchema),
}).passthrough();

const TextureImportPayloadSchema = z.object({
  items: z.array(ImportItemCommonSchema.extend({
    options: TextureImportOptionsSchema.optional(),
  }).passthrough()),
}).passthrough();

const MeshImportPayloadSchema = z.object({
  items: z.array(ImportItemCommonSchema.extend({
    options: MeshImportOptionsSchema.optional(),
  }).passthrough()),
}).passthrough();

const ImportDiagnosticSchema = z.object({
  severity: z.string(),
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
}).passthrough();

const ImportJobItemSchema = z.object({
  index: z.number().int().min(0),
  status: z.string(),
  filePath: z.string().optional(),
  url: z.string().optional(),
  assetPath: z.string().optional(),
  destinationPath: z.string().optional(),
  destinationName: z.string().optional(),
  stagedFilePath: z.string().optional(),
  importedObjects: z.array(z.string()),
  dirtyPackages: z.array(z.string()),
  diagnostics: z.array(ImportDiagnosticSchema),
}).passthrough();

const ImportJobSchema = z.object({
  success: z.boolean(),
  operation: z.string(),
  status: z.string(),
  terminal: z.boolean(),
  validateOnly: z.boolean(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  jobId: z.string().optional(),
  itemCount: z.number().int().min(0),
  acceptedItemCount: z.number().int().min(0),
  failedItemCount: z.number().int().min(0),
  items: z.array(ImportJobItemSchema),
  importedObjects: z.array(z.string()),
  dirtyPackages: z.array(z.string()),
  diagnostics: z.array(ImportDiagnosticSchema),
}).passthrough();

const ImportJobListSchema = z.object({
  success: z.boolean(),
  operation: z.string(),
  includeCompleted: z.boolean(),
  jobCount: z.number().int().min(0),
  jobs: z.array(ImportJobSchema),
}).passthrough();

const UserDefinedStructMutationOperationSchema = z.enum([
  'replace_fields',
  'patch_field',
  'rename_field',
  'remove_field',
  'reorder_fields',
]);

const UserDefinedEnumMutationOperationSchema = z.enum([
  'replace_entries',
  'rename_entry',
  'remove_entry',
  'reorder_entries',
]);

const BlackboardMutationOperationSchema = z.enum([
  'replace_keys',
  'patch_key',
  'remove_key',
  'set_parent',
]);

const BehaviorTreeMutationOperationSchema = z.enum([
  'replace_tree',
  'patch_node',
  'patch_attachment',
  'set_blackboard',
]);

const StateTreeMutationOperationSchema = z.enum([
  'replace_tree',
  'patch_state',
  'patch_editor_node',
  'patch_transition',
  'set_schema',
]);

const AnimSequenceMutationOperationSchema = z.enum([
  'replace_notifies',
  'patch_notify',
  'replace_sync_markers',
  'replace_curve_metadata',
]);

const AnimMontageMutationOperationSchema = z.enum([
  'replace_notifies',
  'patch_notify',
  'replace_sections',
  'replace_slots',
]);

const BlendSpaceMutationOperationSchema = z.enum([
  'replace_samples',
  'patch_sample',
  'set_axes',
]);

const BlueprintMemberMutationOperationSchema = z.enum([
  'replace_variables',
  'patch_variable',
  'replace_components',
  'patch_component',
  'replace_function_stubs',
  'patch_class_defaults',
  'compile',
]);

const BlueprintGraphMutationOperationSchema = z.enum([
  'upsert_function_graphs',
  'append_function_call_to_sequence',
  'compile',
]);

const UserDefinedStructFieldSchema = z.object({
  guid: z.string().optional(),
  name: z.string().optional(),
  friendlyName: z.string().optional(),
  pinType: JsonObjectSchema.optional(),
  metadata: JsonObjectSchema.optional(),
  defaultValue: z.unknown().optional(),
}).passthrough();

const UserDefinedEnumEntrySchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
}).passthrough();

const BlackboardKeySchema = z.object({
  entryName: z.string().optional(),
  name: z.string().optional(),
  keyTypePath: z.string().optional(),
  baseClass: z.string().optional(),
  enumType: z.string().optional(),
  enumName: z.string().optional(),
  properties: JsonObjectSchema.optional(),
}).passthrough();

const BehaviorTreeNodeSelectorSchema = z.object({
  nodePath: z.string().optional(),
}).passthrough();

const StateTreeStateSelectorSchema = z.object({
  stateId: z.string().optional(),
  id: z.string().optional(),
  statePath: z.string().optional(),
  path: z.string().optional(),
  stateName: z.string().optional(),
  name: z.string().optional(),
}).passthrough();

const StateTreeEditorNodeSelectorSchema = z.object({
  editorNodeId: z.string().optional(),
  id: z.string().optional(),
}).passthrough();

const StateTreeTransitionSelectorSchema = z.object({
  transitionId: z.string().optional(),
  id: z.string().optional(),
}).passthrough();

const AnimationNotifySelectorSchema = z.object({
  notifyId: z.string().optional(),
  notifyGuid: z.string().optional(),
  notifyName: z.string().optional(),
  notifyIndex: z.number().int().min(0).optional(),
  trackIndex: z.number().int().min(0).optional(),
  trackName: z.string().optional(),
}).passthrough();

const BlendParameterSchema = z.object({
  name: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  gridNum: z.number().int().optional(),
  interpolationType: z.string().optional(),
  snapToGrid: z.boolean().optional(),
  wrapInput: z.boolean().optional(),
}).passthrough();

const BlendSpaceSampleSchema = z.object({
  sampleIndex: z.number().int().min(0).optional(),
  animation: z.string().optional(),
  animSequence: z.string().optional(),
  sampleValue: JsonObjectSchema.optional(),
}).passthrough();

// Tool 8: create_widget_blueprint
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
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'extract_widget_blueprint',
  {
    title: 'Extract Widget Blueprint',
    description: 'Read a compact widget-authoring snapshot with widget tree, bindings, animations, compile status, and optional class defaults.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the WidgetBlueprint.',
      ),
      include_class_defaults: z.boolean().default(false).describe(
        'When true, also include Blueprint generated-class defaults so widget-template state and class defaults can be distinguished.',
      ),
    },
    annotations: {
      title: 'Extract Widget Blueprint',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path, include_class_defaults }) => {
    try {
      const parsed = await callSubsystemJson('ExtractWidgetBlueprint', {
        AssetPath: asset_path,
        bIncludeClassDefaults: include_class_defaults,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

// Tool 9: build_widget_tree
server.registerTool(
  'build_widget_tree',
  {
    title: 'Build Widget Tree',
    description: 'Destructively replace the full widget tree of an existing WidgetBlueprint.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to an existing WidgetBlueprint',
      ),
      root_widget: WidgetNodeSchema.describe(
        'Root widget of the tree hierarchy',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the widget tree without changing the asset.',
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
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

// Tool 10: modify_widget
server.registerTool(
  'modify_widget',
  {
    title: 'Modify Widget',
    description: 'Patch one widget by widget_name or widget_path. The v2 contract accepts only snake_case fields such as properties.new_name and is_variable.',
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
        'When true, validate the patch without changing the asset.',
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
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

// Tool 11: compile_widget_blueprint
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
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_data_asset',
  {
    title: 'Create DataAsset',
    description: `Create a concrete UE5 DataAsset asset and optionally initialize top-level editable properties.

USAGE:
- Provide a content path for the new asset and a concrete UDataAsset subclass path.
- properties is optional and applies a reflected property patch to the new asset.
- Set validate_only=true to preflight the class and property payload without creating the asset.

RETURNS: JSON with mutation diagnostics, dirtyPackages, and the created asset class. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new DataAsset (e.g. /Game/Data/DA_NewItem)',
      ),
      asset_class_path: z.string().describe(
        'Concrete UDataAsset subclass path or class object path (e.g. /Script/MyModule.MyDataAssetClass or /Game/Blueprints/BP_MyDataAssetClass.BP_MyDataAssetClass_C).',
      ),
      properties: z.record(z.string(), z.unknown()).optional().describe(
        'Optional top-level editable property payload to apply after creation.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the class and property payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create DataAsset',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, asset_class_path, properties, validate_only }) => {
    try {
      const result = await client.callSubsystem('CreateDataAsset', {
        AssetPath: asset_path,
        AssetClassPath: asset_class_path,
        PropertiesJson: JSON.stringify(properties ?? {}),
        bValidateOnly: validate_only,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }],
        structuredContent: parsed,
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.registerTool(
  'modify_data_asset',
  {
    title: 'Modify DataAsset',
    description: `Apply a reflected property patch to an existing UE5 DataAsset.

USAGE:
- Provide the asset path and a properties object containing editable top-level property values.
- Set validate_only=true to check the patch without mutating the asset.
- This tool is best for property-driven DataAssets; use extract_dataasset first to inspect the current schema and values.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the DataAsset to modify.',
      ),
      properties: z.record(z.string(), z.unknown()).describe(
        'Top-level editable property patch payload.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the property payload without mutating the asset.',
      ),
    },
    annotations: {
      title: 'Modify DataAsset',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, properties, validate_only }) => {
    try {
      const result = await client.callSubsystem('ModifyDataAsset', {
        AssetPath: asset_path,
        PropertiesJson: JSON.stringify(properties ?? {}),
        bValidateOnly: validate_only,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }],
        structuredContent: parsed,
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.registerTool(
  'create_input_action',
  {
    title: 'Create Input Action',
    description: 'Create a dedicated Enhanced InputAction asset with a user-friendly value_type and optional editable properties.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new InputAction asset.',
      ),
      value_type: EnhancedInputValueTypeSchema.default('boolean').describe(
        'Human-friendly input value type.',
      ),
      properties: JsonObjectSchema.optional().describe(
        'Optional editable InputAction properties such as action_description, consume_input, trigger_when_paused, or reserve_all_mappings.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the create payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create Input Action',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, value_type, properties, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateInputAction', {
        AssetPath: asset_path,
        ValueType: value_type,
        PropertiesJson: JSON.stringify(properties ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_input_action',
  {
    title: 'Modify Input Action',
    description: 'Modify a dedicated Enhanced InputAction asset without using the generic DataAsset reflection path.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the InputAction asset.',
      ),
      value_type: EnhancedInputValueTypeSchema.optional().describe(
        'Optional human-friendly input value type override.',
      ),
      properties: JsonObjectSchema.optional().describe(
        'Optional editable InputAction properties such as action_description, consume_input, trigger_when_paused, or reserve_all_mappings.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the modification payload without mutating the asset.',
      ),
    },
    annotations: {
      title: 'Modify Input Action',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, value_type, properties, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyInputAction', {
        AssetPath: asset_path,
        ValueType: value_type ?? '',
        PropertiesJson: JSON.stringify(properties ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_input_mapping_context',
  {
    title: 'Create Input Mapping Context',
    description: 'Create an Enhanced InputMappingContext with dedicated mapping authoring instead of generic DataAsset reflection.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new InputMappingContext asset.',
      ),
      properties: JsonObjectSchema.optional().describe(
        'Optional editable InputMappingContext properties such as context_description or registration_tracking_mode.',
      ),
      mappings: z.array(InputMappingSchema).default([]).describe(
        'Optional initial action/key mappings.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the create payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create Input Mapping Context',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, properties, mappings, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateInputMappingContext', {
        AssetPath: asset_path,
        PropertiesJson: JSON.stringify(properties ?? {}),
        MappingsJson: JSON.stringify(mappings),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_input_mapping_context',
  {
    title: 'Modify Input Mapping Context',
    description: 'Modify an Enhanced InputMappingContext with explicit mappings instead of the generic DataAsset reflection path.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the InputMappingContext asset.',
      ),
      properties: JsonObjectSchema.optional().describe(
        'Optional editable InputMappingContext properties such as context_description or registration_tracking_mode.',
      ),
      replace_mappings: z.boolean().default(false).describe(
        'When true, clear existing mappings before applying the provided mappings.',
      ),
      mappings: z.array(InputMappingSchema).default([]).describe(
        'Mappings to add to the context.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the modification payload without mutating the asset.',
      ),
    },
    annotations: {
      title: 'Modify Input Mapping Context',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, properties, replace_mappings, mappings, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyInputMappingContext', {
        AssetPath: asset_path,
        PropertiesJson: JSON.stringify(properties ?? {}),
        ReplaceMappings: replace_mappings,
        MappingsJson: JSON.stringify(mappings),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_data_table',
  {
    title: 'Create DataTable',
    description: `Create a UE5 DataTable with a concrete row struct and optional initial rows.

USAGE:
- Provide the new asset path and a row struct path.
- rows accepts either values objects or extractor-style properties arrays.
- Set validate_only=true to validate the row struct and rows without creating the asset.

RETURNS: JSON with validation summary, rowStructType, rowCount, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new DataTable (e.g. /Game/Data/DT_Items).',
      ),
      row_struct_path: z.string().describe(
        'Script struct path for the row type (e.g. /Script/MyModule.MyTableRow).',
      ),
      rows: z.array(DataTableRowSchema).default([]).describe(
        'Optional initial rows. Each row accepts either values or properties.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the row struct and rows without creating the asset.',
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
      const result = await client.callSubsystem('CreateDataTable', {
        AssetPath: asset_path,
        RowStructPath: row_struct_path,
        RowsJson: JSON.stringify(rows ?? []),
        bValidateOnly: validate_only,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }],
        structuredContent: parsed,
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.registerTool(
  'modify_data_table',
  {
    title: 'Modify DataTable',
    description: `Modify a UE5 DataTable by upserting rows, deleting rows, or replacing the full row set.

USAGE:
- rows upserts row payloads. Existing row values are preserved for omitted fields.
- delete_rows removes rows by name.
- replace_rows clears the table before applying rows.
- Set validate_only=true to check the payload without mutating the asset.

RETURNS: JSON with validation summary, rowCount, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the DataTable to modify.',
      ),
      rows: z.array(DataTableRowSchema).optional().describe(
        'Optional row upsert payload.',
      ),
      delete_rows: z.array(z.string()).optional().describe(
        'Optional row names to delete.',
      ),
      replace_rows: z.boolean().default(false).describe(
        'When true, clear the table before applying rows.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without mutating the asset.',
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
      const result = await client.callSubsystem('ModifyDataTable', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify({
          rows: rows ?? [],
          deleteRows: delete_rows ?? [],
          replaceRows: replace_rows,
        }),
        bValidateOnly: validate_only,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }],
        structuredContent: parsed,
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.registerTool(
  'create_curve',
  {
    title: 'Create Curve',
    description: `Create a UE5 curve asset (Float, Vector, or LinearColor) and optionally initialize channel data.

USAGE:
- Provide the new asset path and curve_type.
- channels should follow the extractor shape: default for Float, x/y/z for Vector, r/g/b/a for LinearColor.
- Set validate_only=true to verify the channel payload without creating the asset.

RETURNS: JSON with curveType, validation summary, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new curve asset.',
      ),
      curve_type: CurveTypeSchema.describe(
        'Concrete curve asset type to create.',
      ),
      channels: z.record(z.string(), CurveChannelSchema).default({}).describe(
        'Optional channel payload keyed by channel name.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the channel payload without creating the asset.',
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
      const result = await client.callSubsystem('CreateCurve', {
        AssetPath: asset_path,
        CurveType: curve_type,
        ChannelsJson: JSON.stringify(channels ?? {}),
        bValidateOnly: validate_only,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }],
        structuredContent: parsed,
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.registerTool(
  'modify_curve',
  {
    title: 'Modify Curve',
    description: `Modify a UE5 curve asset by patching channels and upserting or deleting individual keys.

USAGE:
- channels replaces the specified channel payloads using the extractor shape.
- delete_keys removes keys by channel and time.
- upsert_keys inserts or updates keys by channel and time.
- Set validate_only=true to verify the payload without mutating the asset.

RETURNS: JSON with curveType, validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the curve asset to modify.',
      ),
      channels: z.record(z.string(), CurveChannelSchema).optional().describe(
        'Optional channel patch payload.',
      ),
      delete_keys: z.array(CurveKeyDeleteSchema).optional().describe(
        'Optional key deletions by channel and time.',
      ),
      upsert_keys: z.array(CurveKeyUpsertSchema).optional().describe(
        'Optional key upserts by channel.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without mutating the asset.',
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
      const result = await client.callSubsystem('ModifyCurve', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify({
          channels: channels ?? {},
          deleteKeys: delete_keys ?? [],
          upsertKeys: upsert_keys ?? [],
        }),
        bValidateOnly: validate_only,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }],
        structuredContent: parsed,
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.registerTool(
  'create_curve_table',
  {
    title: 'Create CurveTable',
    description: `Create a UE5 CurveTable in RichCurves or SimpleCurves mode and optionally initialize rows.

USAGE:
- Provide the new asset path and curve_table_mode.
- rows accepts extractor-shaped curve rows with rowName and curve.
- Set validate_only=true to verify the mode and rows without creating the asset.

RETURNS: JSON with curveTableMode, rowCount, validation summary, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new CurveTable.',
      ),
      curve_table_mode: CurveTableModeSchema.describe(
        'CurveTable storage mode.',
      ),
      rows: z.array(CurveTableRowSchema).default([]).describe(
        'Optional initial curve rows.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mode and rows without creating the asset.',
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
      const result = await client.callSubsystem('CreateCurveTable', {
        AssetPath: asset_path,
        CurveTableMode: curve_table_mode,
        RowsJson: JSON.stringify(rows ?? []),
        bValidateOnly: validate_only,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }],
        structuredContent: parsed,
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.registerTool(
  'modify_curve_table',
  {
    title: 'Modify CurveTable',
    description: `Modify a UE5 CurveTable by upserting rows, deleting rows, or replacing the full row set.

USAGE:
- rows upserts row payloads. Existing rows are preserved for omitted fields.
- delete_rows removes rows by name.
- replace_rows clears the table before applying rows.
- Set validate_only=true to check the payload without mutating the asset.

RETURNS: JSON with curveTableMode, rowCount, validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the CurveTable to modify.',
      ),
      rows: z.array(CurveTableRowSchema).optional().describe(
        'Optional curve row upsert payload.',
      ),
      delete_rows: z.array(z.string()).optional().describe(
        'Optional row names to delete.',
      ),
      replace_rows: z.boolean().default(false).describe(
        'When true, clear the table before applying rows.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without mutating the asset.',
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
      const result = await client.callSubsystem('ModifyCurveTable', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify({
          rows: rows ?? [],
          deleteRows: delete_rows ?? [],
          replaceRows: replace_rows,
        }),
        bValidateOnly: validate_only,
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }],
        structuredContent: parsed,
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.registerTool(
  'create_material_instance',
  {
    title: 'Create MaterialInstance',
    description: `Create a UE5 MaterialInstanceConstant from a parent material or material instance.

USAGE:
- Provide the new asset path and the parent material path.
- Set validate_only=true to verify the parent material path without creating the asset.

RETURNS: JSON with diagnostics, dirtyPackages, and parentMaterial. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new material instance (e.g. /Game/Materials/MI_NewSurface).',
      ),
      parent_material_path: z.string().describe(
        'UE content path to the parent material or material instance.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the parent material path without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create MaterialInstance',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, parent_material_path, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateMaterialInstance', {
        AssetPath: asset_path,
        ParentMaterialPath: parent_material_path,
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_material_instance',
  {
    title: 'Modify MaterialInstance',
    description: `Modify a UE5 MaterialInstanceConstant by reparenting it or applying scalar/vector/texture/static-switch parameter overrides.

USAGE:
- Provide any subset of parentMaterial, scalarParameters, vectorParameters, textureParameters, and staticSwitchParameters.
- Set validate_only=true to verify the payload without mutating the asset.
- textureParameters entries may set value to null to clear a texture override.

RETURNS: JSON with validation summary, diagnostics, and dirtyPackages. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the MaterialInstanceConstant to modify.',
      ),
      parentMaterial: z.string().optional().describe(
        'Optional new parent material or material instance path.',
      ),
      scalarParameters: z.array(MaterialScalarParameterSchema).optional().describe(
        'Optional scalar override list.',
      ),
      vectorParameters: z.array(MaterialVectorParameterSchema).optional().describe(
        'Optional vector override list.',
      ),
      textureParameters: z.array(MaterialTextureParameterSchema).optional().describe(
        'Optional texture override list. Set value to null to clear an override.',
      ),
      runtimeVirtualTextureParameters: z.array(MaterialTextureParameterSchema).optional().describe(
        'Optional runtime virtual texture override list.',
      ),
      sparseVolumeTextureParameters: z.array(MaterialTextureParameterSchema).optional().describe(
        'Optional sparse volume texture override list.',
      ),
      fontParameters: z.array(MaterialFontParameterSchema).optional().describe(
        'Optional font override list. Set value to null to clear an override.',
      ),
      staticSwitchParameters: z.array(MaterialStaticSwitchParameterSchema).optional().describe(
        'Optional static switch override list.',
      ),
      layerStack: MaterialLayerStackSchema.optional().describe(
        'Optional full replacement payload for the classic material layer stack override.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without mutating the asset.',
      ),
    },
    annotations: {
      title: 'Modify MaterialInstance',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, validate_only, ...payload }) => {
    try {
      const parsed = await callSubsystemJson('ModifyMaterialInstance', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_material',
  {
    title: 'Create Material',
    description: 'Create a classic UMaterial asset with optional initial texture and settings.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new Material asset.',
      ),
      initial_texture_path: z.string().optional().describe(
        'Optional texture path for the factory’s initial texture slot.',
      ),
      settings: JsonObjectSchema.optional().describe(
        'Optional material settings payload such as material_domain, blend_mode, shading_model, two_sided, or usage_flags.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the create payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create Material',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, initial_texture_path, settings, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateMaterial', {
        AssetPath: asset_path,
        InitialTexturePath: initial_texture_path ?? '',
        SettingsJson: JSON.stringify(settings ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'set_material_settings',
  {
    title: 'Set Material Settings',
    description: 'Primary v2 material-authoring tool for applying top-level material settings without using the full batch DSL.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Material asset.',
      ),
      settings: JsonObjectSchema.describe(
        'Top-level material settings payload such as material_domain, blend_mode, shading_model, two_sided, or usage_flags.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the settings patch without mutating the material.',
      ),
    },
    annotations: {
      title: 'Set Material Settings',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path, settings, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyMaterial', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify({
          settings,
          operations: [{
            operation: 'set_material_settings',
            settings,
          }],
        } satisfies z.infer<typeof MaterialGraphPayloadSchema>),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'add_material_expression',
  {
    title: 'Add Material Expression',
    description: 'Primary v2 material-authoring tool for adding one expression node to a classic Material graph.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Material asset.',
      ),
      expression_class: z.string().describe(
        'Loaded class path for the material expression, such as /Script/Engine.MaterialExpressionVectorParameter.',
      ),
      expression_name: z.string().optional().describe(
        'Stable temporary id for the created expression within this call result. Reuse the returned expression_guid for later calls.',
      ),
      expression_properties: JsonObjectSchema.optional().describe(
        'Optional reflected property patch applied to the new expression.',
      ),
      node_position: MaterialNodePositionSchema.optional().describe(
        'Editor graph position for the new node.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the add-expression request without mutating the material.',
      ),
    },
    annotations: {
      title: 'Add Material Expression',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, expression_class, expression_name, expression_properties, node_position, validate_only }) => {
    try {
      const operation = {
        operation: 'add_expression' as const,
        expression_class,
      } as Record<string, unknown> & { operation: 'add_expression' };
      if (expression_name) {
        operation.temp_id = expression_name;
      }
      if (expression_properties) {
        operation.properties = expression_properties;
      }
      if (node_position) {
        operation.node_pos_x = node_position.x;
        operation.node_pos_y = node_position.y;
      }

      const parsed = await callSubsystemJson('ModifyMaterial', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify({
          operations: [operation],
        } satisfies z.infer<typeof MaterialGraphPayloadSchema>),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'connect_material_expressions',
  {
    title: 'Connect Material Expressions',
    description: 'Primary v2 material-authoring tool for wiring one expression output into another expression input.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Material asset.',
      ),
      ...MaterialConnectionSelectorFieldsSchema.shape,
      validate_only: z.boolean().default(false).describe(
        'When true, validate the requested connection without mutating the material.',
      ),
    },
    annotations: {
      title: 'Connect Material Expressions',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, validate_only, ...connection }) => {
    try {
      const parsed = await callSubsystemJson('ModifyMaterial', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify({
          operations: [{
            operation: 'connect_expressions',
            ...connection,
          }],
        } satisfies z.infer<typeof MaterialGraphPayloadSchema>),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'bind_material_property',
  {
    title: 'Bind Material Property',
    description: 'Primary v2 material-authoring tool for binding one expression output to a root material property.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Material asset.',
      ),
      from_expression_guid: z.string().optional().describe(
        'Guid of the source expression from extract_material or a previous add_material_expression call.',
      ),
      from_temp_id: z.string().optional().describe(
        'Temporary id returned by add_material_expression in the same authoring session.',
      ),
      from_output_name: z.string().optional().describe(
        'Optional named output on the source expression.',
      ),
      from_output_index: z.number().int().min(0).optional().describe(
        'Optional numeric output index on the source expression.',
      ),
      material_property: z.string().describe(
        'Material property enum name such as MP_BaseColor or MP_Roughness.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the property binding without mutating the material.',
      ),
    },
    annotations: {
      title: 'Bind Material Property',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, validate_only, ...binding }) => {
    try {
      const parsed = await callSubsystemJson('ModifyMaterial', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify({
          operations: [{
            operation: 'connect_material_property',
            ...binding,
          }],
        } satisfies z.infer<typeof MaterialGraphPayloadSchema>),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_material',
  {
    title: 'Modify Material',
    description: 'Advanced material escape hatch. Apply compact graph and settings operations to a classic UMaterial asset when the smaller v2 material tools are insufficient.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Material asset.',
      ),
      settings: JsonObjectSchema.optional().describe(
        'Optional top-level material settings payload applied before operations.',
      ),
      compile_after: z.boolean().optional().describe(
        'Override the default compile-after-mutate behavior.',
      ),
      layout_after: z.boolean().optional().describe(
        'When true, run the editor layout pass after mutations.',
      ),
      operations: z.array(MaterialGraphOperationSchema).default([]).describe(
        'Ordered material graph operations.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without mutating the asset.',
      ),
    },
    annotations: {
      title: 'Modify Material',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, validate_only, ...payload }) => {
    try {
      const parsed = await callSubsystemJson('ModifyMaterial', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload satisfies z.infer<typeof MaterialGraphPayloadSchema>),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_material_function',
  {
    title: 'Create Material Function',
    description: 'Create a material function, material layer, or material layer blend asset.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new MaterialFunction-family asset.',
      ),
      asset_kind: MaterialFunctionAssetKindSchema.default('function').describe(
        'Choose function, layer, or layer_blend.',
      ),
      settings: JsonObjectSchema.optional().describe(
        'Optional function settings such as description, expose_to_library, preview_blend_mode, or library_categories.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the create payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create Material Function',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, asset_kind, settings, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateMaterialFunction', {
        AssetPath: asset_path,
        AssetKind: asset_kind,
        SettingsJson: JSON.stringify(settings ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_material_function',
  {
    title: 'Modify Material Function',
    description: 'Apply compact graph and settings operations to a material function, layer, or layer blend asset.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the MaterialFunction-family asset.',
      ),
      settings: JsonObjectSchema.optional().describe(
        'Optional top-level function settings applied before operations.',
      ),
      compile_after: z.boolean().optional().describe(
        'Override the default compile-after-mutate behavior.',
      ),
      layout_after: z.boolean().optional().describe(
        'When true, run the editor layout pass after mutations.',
      ),
      operations: z.array(MaterialGraphOperationSchema).default([]).describe(
        'Ordered material graph operations.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without mutating the asset.',
      ),
    },
    annotations: {
      title: 'Modify Material Function',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, validate_only, ...payload }) => {
    try {
      const parsed = await callSubsystemJson('ModifyMaterialFunction', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload satisfies z.infer<typeof MaterialGraphPayloadSchema>),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'compile_material_asset',
  {
    title: 'Compile Material Asset',
    description: 'Recompile or refresh a material, material function-family asset, or material instance without saving it.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the material-family asset.',
      ),
    },
    annotations: {
      title: 'Compile Material Asset',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_path }) => {
    try {
      const parsed = await callSubsystemJson('CompileMaterialAsset', {
        AssetPath: asset_path,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
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
      operation: WidgetBlueprintMutationOperationSchema.describe(
        'WidgetBlueprint mutation mode.',
      ),
      root_widget: WidgetNodeSchema.optional().describe(
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
      child_widget: WidgetNodeSchema.optional().describe(
        'Child widget payload for insert_child.',
      ),
      wrapper_widget: WidgetNodeSchema.optional().describe(
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
        'When true, only validate the requested mutation and return diagnostics without modifying the asset.',
      ),
      compile_after: z.boolean().default(false).describe(
        'When true, compile after replace_tree or patch_widget and include compile results.',
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
        if (class_defaults) payload.class_defaults = class_defaults;
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
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'get_project_automation_context',
  {
    title: 'Get Project Automation Context',
    description: 'Read the current editor-derived project, engine, and target context used by project-control tools.',
    inputSchema: {},
    annotations: {
      title: 'Get Project Automation Context',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const parsed = await getProjectAutomationContext(true);
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'compile_project_code',
  {
    title: 'Compile Project Code',
    description: 'Run an external UBT build from the MCP host for the current project/editor target.',
    inputSchema: {
      engine_root: z.string().optional().describe(
        'Optional Unreal Engine root. Falls back to UE_ENGINE_ROOT.',
      ),
      project_path: z.string().optional().describe(
        'Optional .uproject path. Falls back to UE_PROJECT_PATH.',
      ),
      target: z.string().optional().describe(
        'Optional build target such as MyGameEditor. Falls back to UE_PROJECT_TARGET or UE_EDITOR_TARGET.',
      ),
      platform: BuildPlatformSchema.optional().describe(
        'Optional build platform. Defaults from the host OS.',
      ),
      configuration: BuildConfigurationSchema.optional().describe(
        'Optional build configuration. Defaults to Development.',
      ),
      build_timeout_seconds: z.number().int().positive().optional().describe(
        'Optional build timeout in seconds. Defaults to 1800.',
      ),
      include_output: z.boolean().default(false).describe(
        'When true, include full stdout and stderr in the result. Failure cases include output automatically.',
      ),
      clear_uht_cache: z.boolean().default(false).describe(
        'When true, delete UHT cache files (.uhtpath, .uhtsettings) from Intermediate/ before building so that Unreal Header Tool regenerates headers for any new or changed UPROPERTYs.',
      ),
    },
    annotations: {
      title: 'Compile Project Code',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ engine_root, project_path, target, platform, configuration, build_timeout_seconds, include_output, clear_uht_cache }) => {
    try {
      const resolved = await resolveProjectInputs({ engine_root, project_path, target });
      const parsed = await projectController.compileProjectCode({
        engineRoot: resolved.engineRoot,
        projectPath: resolved.projectPath,
        target: resolved.target,
        platform: platform as BuildPlatform | undefined,
        configuration: configuration as BuildConfiguration | undefined,
        buildTimeoutMs: typeof build_timeout_seconds === 'number' ? build_timeout_seconds * 1000 : undefined,
        includeOutput: include_output,
        clearUhtCache: clear_uht_cache,
      });
      return jsonToolSuccess({
        ...parsed,
        inputResolution: {
          engineRoot: resolved.sources.engineRoot,
          projectPath: resolved.sources.projectPath,
          target: resolved.sources.target,
          contextError: resolved.contextError,
        },
      });
    } catch (e) {
      const resolved = await resolveProjectInputs({ engine_root, project_path, target });
      return jsonToolError(explainProjectResolutionFailure(e instanceof Error ? e.message : String(e), resolved));
    }
  },
);

server.registerTool(
  'trigger_live_coding',
  {
    title: 'Trigger Live Coding',
    description: 'Request an editor-side Live Coding compile. Unsupported host platforms return a structured unsupported result.',
    inputSchema: {
      changed_paths: z.array(z.string()).optional().describe(
        'Optional explicit changed paths to pass through to the editor-side automation surface.',
      ),
      wait_for_completion: z.boolean().default(true).describe(
        'When true, request a synchronous/terminal Live Coding result from the editor-side method.',
      ),
    },
    annotations: {
      title: 'Trigger Live Coding',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ changed_paths, wait_for_completion }) => {
    try {
      if (!projectController.liveCodingSupported) {
        return jsonToolSuccess({
          success: false,
          operation: 'trigger_live_coding',
          status: 'unsupported',
          supported: false,
          reason: 'Host-side Live Coding automation is only supported on Windows.',
        });
      }

      const parsed = await callSubsystemJson('TriggerLiveCoding', {
        bEnableForSession: true,
        bWaitForCompletion: wait_for_completion,
      });

      const headerChanges = (changed_paths ?? []).filter(
        (p: string) => /\.(h|hpp|inl)$/i.test(p.replace(/\\/g, '/')),
      );
      const warnings: string[] = [];
      if (headerChanges.length > 0) {
        warnings.push(
          'Live Coding cannot add, remove, or reorder UPROPERTYs or change class layouts. '
          + 'Use compile_project_code + restart_editor for class layout changes.',
        );
      }

      return jsonToolSuccess({
        ...parsed,
        changedPathsAccepted: changed_paths ?? [],
        changedPathsAppliedByEditor: false,
        headerChangesDetected: headerChanges,
        warnings,
      });
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'restart_editor',
  {
    title: 'Restart Editor',
    description: 'Request an editor restart, then wait for Remote Control to disconnect and reconnect.',
    inputSchema: {
      save_dirty_assets: z.boolean().default(true).describe(
        'When true, ask the editor-side restart path to save dirty assets before relaunching.',
      ),
      wait_for_reconnect: z.boolean().default(true).describe(
        'When true, wait for the editor to disconnect and reconnect before returning.',
      ),
      disconnect_timeout_seconds: z.number().int().positive().default(60).describe(
        'Maximum seconds to wait for the editor to disconnect after the restart request.',
      ),
      reconnect_timeout_seconds: z.number().int().positive().default(180).describe(
        'Maximum seconds to wait for Remote Control to return after the editor restarts.',
      ),
    },
    annotations: {
      title: 'Restart Editor',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ save_dirty_assets, wait_for_reconnect, disconnect_timeout_seconds, reconnect_timeout_seconds }) => {
    try {
      const restartRequest = await callSubsystemJson('RestartEditor', {
        bWarn: false,
        bSaveDirtyAssets: save_dirty_assets,
      });

      cachedProjectAutomationContext = null;

      if (!wait_for_reconnect || restartRequest.success === false) {
        return jsonToolSuccess({
          ...restartRequest,
          saveDirtyAssetsAccepted: save_dirty_assets,
          saveDirtyAssetsAppliedByEditor: save_dirty_assets,
        });
      }

      const reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
        disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
        reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
      });

      return jsonToolSuccess({
        ...restartRequest,
        saveDirtyAssetsAccepted: save_dirty_assets,
        saveDirtyAssetsAppliedByEditor: save_dirty_assets,
        reconnect,
        success: restartRequest.success !== false && reconnect.success,
      });
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'sync_project_code',
  {
    title: 'Sync Project Code',
    description: 'Use explicit changed_paths to choose Live Coding vs build-and-restart. Generic Live Coding failure does not auto-fallback.',
    inputSchema: {
      changed_paths: z.array(z.string()).min(1).describe(
        'Explicit changed file paths. This tool does not infer them from source control.',
      ),
      force_rebuild: z.boolean().default(false).describe(
        'When true, force the build-and-restart path regardless of changed_paths.',
      ),
      engine_root: z.string().optional().describe(
        'Optional Unreal Engine root. Falls back to UE_ENGINE_ROOT.',
      ),
      project_path: z.string().optional().describe(
        'Optional .uproject path. Falls back to UE_PROJECT_PATH.',
      ),
      target: z.string().optional().describe(
        'Optional build target such as MyGameEditor. Falls back to UE_PROJECT_TARGET or UE_EDITOR_TARGET.',
      ),
      platform: BuildPlatformSchema.optional().describe(
        'Optional build platform. Defaults from the host OS.',
      ),
      configuration: BuildConfigurationSchema.optional().describe(
        'Optional build configuration. Defaults to Development.',
      ),
      save_dirty_assets: z.boolean().default(true).describe(
        'When true, ask the editor restart path to save dirty assets before relaunching.',
      ),
      save_asset_paths: z.array(z.string()).optional().describe(
        'Optional explicit asset paths to save through save_assets before the editor restart.',
      ),
      build_timeout_seconds: z.number().int().positive().optional().describe(
        'Optional external build timeout in seconds. Defaults to 1800.',
      ),
      disconnect_timeout_seconds: z.number().int().positive().default(60).describe(
        'Maximum seconds to wait for the editor to disconnect after a restart request.',
      ),
      reconnect_timeout_seconds: z.number().int().positive().default(180).describe(
        'Maximum seconds to wait for Remote Control to return after the editor restarts.',
      ),
      include_output: z.boolean().default(false).describe(
        'When true, include full build stdout and stderr in the result. Failure cases include output automatically.',
      ),
      clear_uht_cache: z.boolean().default(false).describe(
        'When true, delete UHT cache files (.uhtpath, .uhtsettings) from Intermediate/ before building so that Unreal Header Tool regenerates headers for any new or changed UPROPERTYs.',
      ),
    },
    annotations: {
      title: 'Sync Project Code',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({
    changed_paths,
    force_rebuild,
    engine_root,
    project_path,
    target,
    platform,
    configuration,
    save_dirty_assets,
    save_asset_paths,
    build_timeout_seconds,
    disconnect_timeout_seconds,
    reconnect_timeout_seconds,
    include_output,
    clear_uht_cache,
  }) => {
    try {
      const plan = projectController.classifyChangedPaths(changed_paths, force_rebuild);
      const resolvedProjectInputs = await resolveProjectInputs({ engine_root, project_path, target });
      const structuredResult: Record<string, unknown> = {
        success: false,
        operation: 'sync_project_code',
        changedPaths: changed_paths,
        plan,
        inputResolution: {
          engineRoot: resolvedProjectInputs.sources.engineRoot,
          projectPath: resolvedProjectInputs.sources.projectPath,
          target: resolvedProjectInputs.sources.target,
          contextError: resolvedProjectInputs.contextError,
        },
      };

      if (plan.strategy === 'live_coding') {
        if (!projectController.liveCodingSupported) {
          structuredResult.plan = {
            strategy: 'build_and_restart',
            restartRequired: true,
            reasons: ['live_coding_unsupported_on_host'],
          };
        } else {
          const liveCoding = await callSubsystemJson('TriggerLiveCoding', {
            bEnableForSession: true,
            bWaitForCompletion: true,
          });

          if (!canFallbackFromLiveCoding(liveCoding)) {
            return jsonToolSuccess({
              success: liveCoding.success === true,
              operation: 'sync_project_code',
              strategy: 'live_coding',
              changedPaths: changed_paths,
              plan,
              liveCoding,
            });
          }

          structuredResult.liveCoding = liveCoding;
          structuredResult.plan = {
            strategy: 'build_and_restart',
            restartRequired: true,
            reasons: [...plan.reasons, 'live_coding_precondition_failed'],
          };
        }
      }

      const build = await projectController.compileProjectCode({
        engineRoot: resolvedProjectInputs.engineRoot,
        projectPath: resolvedProjectInputs.projectPath,
        target: resolvedProjectInputs.target,
        platform: platform as BuildPlatform | undefined,
        configuration: configuration as BuildConfiguration | undefined,
        buildTimeoutMs: typeof build_timeout_seconds === 'number' ? build_timeout_seconds * 1000 : undefined,
        includeOutput: include_output,
        clearUhtCache: clear_uht_cache,
      });

      structuredResult.strategy = 'build_and_restart';
      structuredResult.build = build;

      if (!build.success) {
        return jsonToolSuccess(structuredResult);
      }

      if (Array.isArray(save_asset_paths) && save_asset_paths.length > 0) {
        const saveResult = await callSubsystemJson('SaveAssets', {
          AssetPathsJson: JSON.stringify(save_asset_paths),
        });
        structuredResult.save = saveResult;
        if (saveResult.success === false) {
          return jsonToolSuccess(structuredResult);
        }
      }

      const restartRequest = await callSubsystemJson('RestartEditor', {
        bWarn: false,
        bSaveDirtyAssets: save_dirty_assets,
      });
      cachedProjectAutomationContext = null;
      structuredResult.restartRequest = restartRequest;
      structuredResult.restartRequestSaveDirtyAssetsAccepted = save_dirty_assets;
      if (restartRequest.success === false) {
        return jsonToolSuccess(structuredResult);
      }

      const reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
        disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
        reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
      });
      structuredResult.reconnect = reconnect;
      structuredResult.success = reconnect.success;
      return jsonToolSuccess(structuredResult);
    } catch (e) {
      const resolved = await resolveProjectInputs({ engine_root, project_path, target });
      return jsonToolError(explainProjectResolutionFailure(e instanceof Error ? e.message : String(e), resolved));
    }
  },
);

server.registerTool(
  'apply_window_ui_changes',
  {
    title: 'Apply Window UI Changes',
    description: 'Thin helper that applies variable flags, class defaults, font work, compile/save, and optional code sync in one ordered flow.',
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the WidgetBlueprint to update.',
      ),
      variable_widgets: z.array(WidgetSelectorFieldsSchema.extend({
        is_variable: z.boolean().default(true),
      }).refine((value) => Boolean(value.widget_name || value.widget_path), {
        message: 'widget_name or widget_path is required',
      })).default([]).describe(
        'Optional widget selectors to toggle as variables before the compile/save pass.',
      ),
      class_defaults: z.record(z.string(), z.unknown()).optional().describe(
        'Optional widget Blueprint generated-class defaults to patch.',
      ),
      font_import: z.object({
        destination_path: z.string(),
        font_asset_path: z.string().optional(),
        items: z.array(FontImportItemSchema).min(1),
      }).optional().describe(
        'Optional explicit-file-path font import payload passed through to ImportFonts.',
      ),
      font_applications: z.array(WindowFontApplicationSchema).optional().describe(
        'Optional compact font applications passed through to ApplyWidgetFonts.',
      ),
      compile_after: z.boolean().default(true).describe(
        'When true, compile the widget Blueprint after the requested mutations.',
      ),
      save_after: z.boolean().default(true).describe(
        'When true, save the widget asset and any explicit extra save paths after a successful compile.',
      ),
      save_asset_paths: z.array(z.string()).optional().describe(
        'Optional extra asset paths to save with the widget asset.',
      ),
      sync_project_code: z.object({
        changed_paths: z.array(z.string()).min(1),
        force_rebuild: z.boolean().default(false).optional(),
        engine_root: z.string().optional(),
        project_path: z.string().optional(),
        target: z.string().optional(),
        platform: BuildPlatformSchema.optional(),
        configuration: BuildConfigurationSchema.optional(),
        save_dirty_assets: z.boolean().default(true).optional(),
        build_timeout_seconds: z.number().int().positive().optional(),
        disconnect_timeout_seconds: z.number().int().positive().default(60).optional(),
        reconnect_timeout_seconds: z.number().int().positive().default(180).optional(),
        include_output: z.boolean().default(false).optional(),
        clear_uht_cache: z.boolean().default(false).optional(),
      }).optional().describe(
        'Optional project-code sync step to run after the widget asset work succeeds.',
      ),
    },
    annotations: {
      title: 'Apply Window UI Changes',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({
    asset_path,
    variable_widgets,
    class_defaults,
    font_import,
    font_applications,
    compile_after,
    save_after,
    save_asset_paths,
    sync_project_code,
  }) => {
    try {
      const steps: Array<Record<string, unknown>> = [];

      for (const selector of variable_widgets) {
        const widgetIdentifier = getWidgetIdentifier(selector.widget_name, selector.widget_path);
        if (!widgetIdentifier) {
          return jsonToolError(new Error('variable_widgets entries require widget_name or widget_path'));
        }

        const result = await callSubsystemJson('ModifyWidget', {
          AssetPath: asset_path,
          WidgetName: widgetIdentifier,
          PropertiesJson: JSON.stringify({}),
          SlotJson: JSON.stringify({}),
          WidgetOptionsJson: JSON.stringify({ is_variable: selector.is_variable }),
          bValidateOnly: false,
        });
        steps.push({
          step: 'mark_widget_variable',
          selector,
          result,
        });
        if (result.success === false) {
          return jsonToolSuccess({
            success: false,
            operation: 'apply_window_ui_changes',
            stoppedAt: 'mark_widget_variable',
            steps,
          });
        }
      }

      if (class_defaults) {
        const result = await callSubsystemJson('ModifyWidgetBlueprintStructure', {
          AssetPath: asset_path,
          Operation: 'patch_class_defaults',
          PayloadJson: JSON.stringify({ class_defaults }),
          bValidateOnly: false,
        });
        steps.push({
          step: 'patch_class_defaults',
          result,
        });
        if (result.success === false) {
          return jsonToolSuccess({
            success: false,
            operation: 'apply_window_ui_changes',
            stoppedAt: 'patch_class_defaults',
            steps,
          });
        }
      }

      if (font_import) {
        const result = await callSubsystemJson('ImportFonts', {
          PayloadJson: JSON.stringify(font_import),
          bValidateOnly: false,
        });
        steps.push({
          step: 'import_fonts',
          result,
        });
        if (result.success === false) {
          return jsonToolSuccess({
            success: false,
            operation: 'apply_window_ui_changes',
            stoppedAt: 'import_fonts',
            steps,
          });
        }
      }

      if (font_applications && font_applications.length > 0) {
        const result = await callSubsystemJson('ApplyWidgetFonts', {
          AssetPath: asset_path,
          PayloadJson: JSON.stringify({ applications: font_applications }),
          bValidateOnly: false,
        });
        steps.push({
          step: 'apply_widget_fonts',
          result,
        });
        if (result.success === false) {
          return jsonToolSuccess({
            success: false,
            operation: 'apply_window_ui_changes',
            stoppedAt: 'apply_widget_fonts',
            steps,
          });
        }
      }

      if (compile_after) {
        const result = await callSubsystemJson('CompileWidgetBlueprint', {
          AssetPath: asset_path,
        });
        steps.push({
          step: 'compile_widget_blueprint',
          result,
        });
        if (result.success === false) {
          return jsonToolSuccess({
            success: false,
            operation: 'apply_window_ui_changes',
            stoppedAt: 'compile_widget_blueprint',
            steps,
          });
        }
      }

      if (save_after) {
        const assetPaths = new Set<string>([asset_path]);
        for (const extraPath of save_asset_paths ?? []) {
          assetPaths.add(extraPath);
        }
        if (font_import?.font_asset_path) {
          assetPaths.add(font_import.font_asset_path);
        }

        const result = await callSubsystemJson('SaveAssets', {
          AssetPathsJson: JSON.stringify(Array.from(assetPaths)),
        });
        steps.push({
          step: 'save_assets',
          result,
        });
        if (result.success === false) {
          return jsonToolSuccess({
            success: false,
            operation: 'apply_window_ui_changes',
            stoppedAt: 'save_assets',
            steps,
          });
        }
      }

      if (sync_project_code) {
        const syncPlan = projectController.classifyChangedPaths(
          sync_project_code.changed_paths,
          sync_project_code.force_rebuild ?? false,
        );
        const resolvedProjectInputs = await resolveProjectInputs({
          engine_root: sync_project_code.engine_root,
          project_path: sync_project_code.project_path,
          target: sync_project_code.target,
        });
        let needsBuildRestart = syncPlan.strategy === 'build_and_restart' || !projectController.liveCodingSupported;

        if (syncPlan.strategy === 'live_coding' && projectController.liveCodingSupported) {
          const liveCoding = await callSubsystemJson('TriggerLiveCoding', {
            bEnableForSession: true,
            bWaitForCompletion: true,
          });
          if (!canFallbackFromLiveCoding(liveCoding)) {
            steps.push({
              step: 'sync_project_code',
              strategy: 'live_coding',
              result: liveCoding,
            });
            if (liveCoding.success === false) {
              return jsonToolSuccess({
                success: false,
                operation: 'apply_window_ui_changes',
                stoppedAt: 'sync_project_code',
                steps,
              });
            }
          } else {
            steps.push({
              step: 'sync_project_code_precheck',
              strategy: 'live_coding',
              result: liveCoding,
            });
            needsBuildRestart = true;
          }
        }

        if (needsBuildRestart) {
          const build = await projectController.compileProjectCode({
            engineRoot: resolvedProjectInputs.engineRoot,
            projectPath: resolvedProjectInputs.projectPath,
            target: resolvedProjectInputs.target,
            platform: sync_project_code.platform as BuildPlatform | undefined,
            configuration: sync_project_code.configuration as BuildConfiguration | undefined,
            buildTimeoutMs: typeof sync_project_code.build_timeout_seconds === 'number'
              ? sync_project_code.build_timeout_seconds * 1000
              : undefined,
            includeOutput: sync_project_code.include_output ?? false,
            clearUhtCache: sync_project_code.clear_uht_cache ?? false,
          });
          steps.push({
            step: 'compile_project_code',
            result: build,
            inputResolution: {
              engineRoot: resolvedProjectInputs.sources.engineRoot,
              projectPath: resolvedProjectInputs.sources.projectPath,
              target: resolvedProjectInputs.sources.target,
              contextError: resolvedProjectInputs.contextError,
            },
          });
          if (!build.success) {
            return jsonToolSuccess({
              success: false,
              operation: 'apply_window_ui_changes',
              stoppedAt: 'compile_project_code',
              steps,
            });
          }

          const restartRequest = await callSubsystemJson('RestartEditor', {
            bWarn: false,
            bSaveDirtyAssets: sync_project_code.save_dirty_assets ?? true,
          });
          cachedProjectAutomationContext = null;
          const reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
            disconnectTimeoutMs: (sync_project_code.disconnect_timeout_seconds ?? 60) * 1000,
            reconnectTimeoutMs: (sync_project_code.reconnect_timeout_seconds ?? 180) * 1000,
          });
          steps.push({
            step: 'sync_project_code',
            strategy: 'build_and_restart',
            restartRequest,
            saveDirtyAssetsAccepted: sync_project_code.save_dirty_assets ?? true,
            reconnect,
          });
          if (restartRequest.success === false || !reconnect.success) {
            return jsonToolSuccess({
              success: false,
              operation: 'apply_window_ui_changes',
              stoppedAt: 'sync_project_code',
              steps,
            });
          }
        }
      }

      return jsonToolSuccess({
        success: true,
        operation: 'apply_window_ui_changes',
        steps,
      });
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_user_defined_struct',
  {
    title: 'Create UserDefinedStruct',
    description: `Create a UE5 UserDefinedStruct asset from extractor-shaped field definitions.

USAGE:
- payload may be the direct struct payload or the extractor wrapper { userDefinedStruct: { ... } }.
- fields should follow the extractor shape, including pinType, metadata, and defaultValue.
- Set validate_only=true to preflight the payload without creating the asset.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new UserDefinedStruct asset.',
      ),
      payload: JsonObjectSchema.default({}).describe(
        'Extractor-shaped UserDefinedStruct payload. Accepts either { fields: [...] } or { userDefinedStruct: { fields: [...] } }.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the field payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create UserDefinedStruct',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateUserDefinedStruct', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_user_defined_struct',
  {
    title: 'Modify UserDefinedStruct',
    description: `Modify a UE5 UserDefinedStruct with field-level authoring operations.

USAGE:
- operation="replace_fields": payload.fields replaces the full field list using extractor-shaped definitions.
- operation="patch_field" or "rename_field": payload identifies the field by guid or name.
- operation="remove_field": payload identifies the field by guid or name.
- operation="reorder_fields": payload.fieldOrder supplies the desired field order.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the UserDefinedStruct to modify.',
      ),
      operation: UserDefinedStructMutationOperationSchema.describe(
        'Field-level mutation operation to apply.',
      ),
      payload: z.object({
        userDefinedStruct: z.object({
          fields: z.array(UserDefinedStructFieldSchema).optional(),
        }).passthrough().optional(),
        fields: z.array(UserDefinedStructFieldSchema).optional(),
        field: UserDefinedStructFieldSchema.optional(),
        guid: z.string().optional(),
        name: z.string().optional(),
        fieldName: z.string().optional(),
        newName: z.string().optional(),
        fieldOrder: z.array(z.string()).optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Field selectors accept guid or name.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify UserDefinedStruct',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyUserDefinedStruct', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_user_defined_enum',
  {
    title: 'Create UserDefinedEnum',
    description: `Create a UE5 UserDefinedEnum asset from extractor-shaped entry payloads.

USAGE:
- payload may be the direct enum payload or the extractor wrapper { userDefinedEnum: { ... } }.
- entries should follow the extractor shape with name and optional displayName.
- Set validate_only=true to preflight the payload without creating the asset.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new UserDefinedEnum asset.',
      ),
      payload: z.object({
        userDefinedEnum: z.object({
          entries: z.array(UserDefinedEnumEntrySchema).optional(),
        }).passthrough().optional(),
        entries: z.array(UserDefinedEnumEntrySchema).optional(),
      }).passthrough().default({}).describe(
        'Extractor-shaped UserDefinedEnum payload.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the entry payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create UserDefinedEnum',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateUserDefinedEnum', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_user_defined_enum',
  {
    title: 'Modify UserDefinedEnum',
    description: `Modify a UE5 UserDefinedEnum with entry-level authoring operations.

USAGE:
- operation="replace_entries": payload.entries replaces the full entry list.
- operation="rename_entry" or "remove_entry": payload selects an entry by name.
- operation="reorder_entries": payload.entries supplies the desired ordered entry list.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the UserDefinedEnum to modify.',
      ),
      operation: UserDefinedEnumMutationOperationSchema.describe(
        'Entry-level mutation operation to apply.',
      ),
      payload: z.object({
        userDefinedEnum: z.object({
          entries: z.array(UserDefinedEnumEntrySchema).optional(),
        }).passthrough().optional(),
        entries: z.array(UserDefinedEnumEntrySchema).optional(),
        name: z.string().optional(),
        entryName: z.string().optional(),
        newName: z.string().optional(),
        displayName: z.string().optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Entry selectors use name.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify UserDefinedEnum',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyUserDefinedEnum', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_blackboard',
  {
    title: 'Create Blackboard',
    description: `Create a UE5 BlackboardData asset from extractor-shaped key payloads.

USAGE:
- payload may be direct key data or the extractor wrapper { blackboard: { ... } }.
- keys should use extractor fields such as entryName, keyTypePath, baseClass, enumType, enumName, description, category, instanceSync, and properties.
- Set validate_only=true to preflight the payload without creating the asset.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new BlackboardData asset.',
      ),
      payload: z.object({
        blackboard: z.object({
          parentBlackboard: z.string().optional(),
          keys: z.array(BlackboardKeySchema).optional(),
        }).passthrough().optional(),
        parentBlackboard: z.string().optional(),
        keys: z.array(BlackboardKeySchema).optional(),
      }).passthrough().default({}).describe(
        'Extractor-shaped Blackboard payload.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the blackboard payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create Blackboard',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateBlackboard', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_blackboard',
  {
    title: 'Modify Blackboard',
    description: `Modify a UE5 BlackboardData asset with declarative key operations.

USAGE:
- operation="replace_keys": payload.keys replaces the local key list using extractor-shaped entries.
- operation="patch_key" or "remove_key": payload selects a key by entryName and may update keyTypePath or reflected properties.
- operation="set_parent": payload.parentBlackboard sets or clears the parent blackboard.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the BlackboardData asset to modify.',
      ),
      operation: BlackboardMutationOperationSchema.describe(
        'Blackboard mutation operation to apply.',
      ),
      payload: z.object({
        blackboard: z.object({
          parentBlackboard: z.string().optional(),
          keys: z.array(BlackboardKeySchema).optional(),
        }).passthrough().optional(),
        parentBlackboard: z.string().optional(),
        keys: z.array(BlackboardKeySchema).optional(),
        entryName: z.string().optional(),
        name: z.string().optional(),
        key: BlackboardKeySchema.optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Key selectors use entryName.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify Blackboard',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyBlackboard', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_behavior_tree',
  {
    title: 'Create BehaviorTree',
    description: `Create a UE5 BehaviorTree asset from extractor-shaped tree payloads.

USAGE:
- payload may be the direct tree payload or the extractor wrapper { behaviorTree: { ... } }.
- rootNode should use extractor-shaped node objects, including nodeClassPath, properties, decorators, services, and child ordering.
- Set validate_only=true to preflight the tree without creating the asset.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new BehaviorTree asset.',
      ),
      payload: z.object({
        behaviorTree: JsonObjectSchema.optional(),
        blackboardAsset: z.string().optional(),
        rootNode: JsonObjectSchema.optional(),
      }).passthrough().default({}).describe(
        'Extractor-shaped BehaviorTree payload.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the tree payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create BehaviorTree',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateBehaviorTree', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_behavior_tree',
  {
    title: 'Modify BehaviorTree',
    description: `Modify a UE5 BehaviorTree with declarative subtree and attachment operations.

USAGE:
- operation="replace_tree": payload rootNode replaces the full tree using extractor-shaped node objects.
- operation="patch_node" or "patch_attachment": payload selects by nodePath and applies reflected property changes.
- operation="set_blackboard": payload.blackboardAsset updates the linked blackboard asset.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the BehaviorTree asset to modify.',
      ),
      operation: BehaviorTreeMutationOperationSchema.describe(
        'BehaviorTree mutation operation to apply.',
      ),
      payload: z.object({
        behaviorTree: JsonObjectSchema.optional(),
        selector: BehaviorTreeNodeSelectorSchema.optional(),
        nodePath: z.string().optional(),
        blackboardAsset: z.string().optional(),
        rootNode: JsonObjectSchema.optional(),
        node: JsonObjectSchema.optional(),
        attachment: JsonObjectSchema.optional(),
        properties: JsonObjectSchema.optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Targeted edits use nodePath.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify BehaviorTree',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyBehaviorTree', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_state_tree',
  {
    title: 'Create StateTree',
    description: `Create a UE5 StateTree asset from extractor-shaped editor data.

USAGE:
- payload may be the direct tree payload or the extractor wrapper { stateTree: { ... } }.
- schema is optional but recommended; states, evaluators, globalTasks, and transitions should follow extractor shapes.
- Set validate_only=true to preflight the payload without creating the asset.

RETURNS: JSON with validation and compile summaries, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new StateTree asset.',
      ),
      payload: z.object({
        stateTree: JsonObjectSchema.optional(),
        schema: z.string().optional(),
        states: z.array(JsonObjectSchema).optional(),
        evaluators: z.array(JsonObjectSchema).optional(),
        globalTasks: z.array(JsonObjectSchema).optional(),
      }).passthrough().default({}).describe(
        'Extractor-shaped StateTree payload.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate and compile the payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create StateTree',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateStateTree', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_state_tree',
  {
    title: 'Modify StateTree',
    description: `Modify a UE5 StateTree with declarative tree, state, editor-node, and transition operations.

USAGE:
- operation="replace_tree": payload uses the extractor-shaped StateTree object.
- operation="patch_state": payload selects a state by stateId or statePath and applies extractor-shaped state data.
- operation="patch_editor_node": payload selects by editorNodeId and patches nodeStructType, instanceProperties, or nodeProperties.
- operation="patch_transition": payload selects by transitionId and patches target, timing, or conditions.
- operation="set_schema": payload.schema changes the StateTree schema class.

RETURNS: JSON with validation and compile summaries, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the StateTree asset to modify.',
      ),
      operation: StateTreeMutationOperationSchema.describe(
        'StateTree mutation operation to apply.',
      ),
      payload: z.object({
        stateTree: JsonObjectSchema.optional(),
        schema: z.string().optional(),
        state: JsonObjectSchema.optional(),
        editorNode: JsonObjectSchema.optional(),
        transition: JsonObjectSchema.optional(),
        selector: z.union([
          StateTreeStateSelectorSchema,
          StateTreeEditorNodeSelectorSchema,
          StateTreeTransitionSelectorSchema,
        ]).optional(),
        stateId: z.string().optional(),
        statePath: z.string().optional(),
        editorNodeId: z.string().optional(),
        transitionId: z.string().optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Selectors support stateId/statePath, editorNodeId, and transitionId.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate and compile the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify StateTree',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyStateTree', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_anim_sequence',
  {
    title: 'Create AnimSequence',
    description: `Create a UE5 AnimSequence asset from extractor-shaped metadata payloads.

USAGE:
- payload may be the direct sequence payload or the extractor wrapper { animSequence: { ... } }.
- payload must include skeleton or skeletonPath on create. previewMesh is optional.
- notifies, syncMarkers, and curves follow the extractor shape.
- Set validate_only=true to preflight the payload without creating the asset.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new AnimSequence asset.',
      ),
      payload: z.object({
        animSequence: JsonObjectSchema.optional(),
        skeleton: z.string().optional(),
        skeletonPath: z.string().optional(),
        previewMesh: z.string().optional(),
        previewSkeletalMesh: z.string().optional(),
        notifies: z.array(JsonObjectSchema).optional(),
        syncMarkers: z.array(JsonObjectSchema).optional(),
        curves: z.array(JsonObjectSchema).optional(),
      }).passthrough().default({}).describe(
        'Extractor-shaped AnimSequence payload.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create AnimSequence',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateAnimSequence', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_anim_sequence',
  {
    title: 'Modify AnimSequence',
    description: `Modify a UE5 AnimSequence by replacing or patching notifies, sync markers, and curve metadata.

USAGE:
- operation="replace_notifies": payload.notifies replaces the authored notify list.
- operation="patch_notify": payload selects a notify by notifyId or notifyGuid, with index or track metadata as fallback.
- operation="replace_sync_markers": payload.syncMarkers replaces authored sync markers.
- operation="replace_curve_metadata": payload.curves replaces authored curve metadata.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the AnimSequence asset to modify.',
      ),
      operation: AnimSequenceMutationOperationSchema.describe(
        'AnimSequence mutation operation to apply.',
      ),
      payload: z.object({
        animSequence: JsonObjectSchema.optional(),
        selector: AnimationNotifySelectorSchema.optional(),
        notify: JsonObjectSchema.optional(),
        notifies: z.array(JsonObjectSchema).optional(),
        syncMarkers: z.array(JsonObjectSchema).optional(),
        curves: z.array(JsonObjectSchema).optional(),
        notifyId: z.string().optional(),
        notifyGuid: z.string().optional(),
        notifyIndex: z.number().int().min(0).optional(),
        trackIndex: z.number().int().min(0).optional(),
        trackName: z.string().optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Notify selectors prefer notifyId or notifyGuid and fall back to notifyIndex/track metadata.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify AnimSequence',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyAnimSequence', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_anim_montage',
  {
    title: 'Create AnimMontage',
    description: `Create a UE5 AnimMontage asset from extractor-shaped metadata payloads.

USAGE:
- payload may be the direct montage payload or the extractor wrapper { animMontage: { ... } }.
- payload should include sourceAnimation or skeleton on create. previewMesh is optional.
- notifies, sections, and slots follow the extractor shape.
- Set validate_only=true to preflight the payload without creating the asset.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new AnimMontage asset.',
      ),
      payload: z.object({
        animMontage: JsonObjectSchema.optional(),
        sourceAnimation: z.string().optional(),
        sourceAnimSequence: z.string().optional(),
        skeleton: z.string().optional(),
        skeletonPath: z.string().optional(),
        previewMesh: z.string().optional(),
        previewSkeletalMesh: z.string().optional(),
        notifies: z.array(JsonObjectSchema).optional(),
        sections: z.array(JsonObjectSchema).optional(),
        slots: z.array(JsonObjectSchema).optional(),
      }).passthrough().default({}).describe(
        'Extractor-shaped AnimMontage payload.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create AnimMontage',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateAnimMontage', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_anim_montage',
  {
    title: 'Modify AnimMontage',
    description: `Modify a UE5 AnimMontage by replacing or patching notifies, sections, and slot tracks.

USAGE:
- operation="replace_notifies": payload.notifies replaces montage notifies.
- operation="patch_notify": payload selects a notify by notifyId or notifyGuid, with index or track metadata as fallback.
- operation="replace_sections": payload.sections replaces section ordering and next-section links.
- operation="replace_slots": payload.slots replaces authored slot tracks and referenced animation segments.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the AnimMontage asset to modify.',
      ),
      operation: AnimMontageMutationOperationSchema.describe(
        'AnimMontage mutation operation to apply.',
      ),
      payload: z.object({
        animMontage: JsonObjectSchema.optional(),
        selector: AnimationNotifySelectorSchema.optional(),
        notify: JsonObjectSchema.optional(),
        notifies: z.array(JsonObjectSchema).optional(),
        sections: z.array(JsonObjectSchema).optional(),
        slots: z.array(JsonObjectSchema).optional(),
        notifyId: z.string().optional(),
        notifyGuid: z.string().optional(),
        notifyIndex: z.number().int().min(0).optional(),
        trackIndex: z.number().int().min(0).optional(),
        trackName: z.string().optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Notify selectors prefer notifyId or notifyGuid and fall back to notifyIndex/track metadata.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify AnimMontage',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyAnimMontage', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_blend_space',
  {
    title: 'Create BlendSpace',
    description: `Create a UE5 BlendSpace or BlendSpace1D asset from extractor-shaped sample and axis payloads.

USAGE:
- payload may be the direct blend-space payload or the extractor wrapper { blendSpace: { ... } }.
- payload must include skeleton or skeletonPath on create. Set is1D=true for BlendSpace1D.
- axisX, axisY, and samples follow the extractor shape.
- Set validate_only=true to preflight the payload without creating the asset.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new BlendSpace asset.',
      ),
      payload: z.object({
        blendSpace: JsonObjectSchema.optional(),
        skeleton: z.string().optional(),
        skeletonPath: z.string().optional(),
        previewMesh: z.string().optional(),
        previewSkeletalMesh: z.string().optional(),
        is1D: z.boolean().optional(),
        axisX: BlendParameterSchema.optional(),
        axisY: BlendParameterSchema.optional(),
        samples: z.array(BlendSpaceSampleSchema).optional(),
      }).passthrough().default({}).describe(
        'Extractor-shaped BlendSpace payload.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create BlendSpace',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateBlendSpace', {
        AssetPath: asset_path,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_blend_space',
  {
    title: 'Modify BlendSpace',
    description: `Modify a UE5 BlendSpace by replacing or patching samples and axis definitions.

USAGE:
- operation="replace_samples": payload.samples replaces the authored sample list.
- operation="patch_sample": payload selects a sample by sampleIndex and patches sampleValue or animation.
- operation="set_axes": payload.axisX and payload.axisY patch axis definitions and interpolation settings.

RETURNS: JSON with validation summary, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the BlendSpace asset to modify.',
      ),
      operation: BlendSpaceMutationOperationSchema.describe(
        'BlendSpace mutation operation to apply.',
      ),
      payload: z.object({
        blendSpace: JsonObjectSchema.optional(),
        selector: z.object({
          sampleIndex: z.number().int().min(0).optional(),
        }).passthrough().optional(),
        sample: BlendSpaceSampleSchema.optional(),
        sampleIndex: z.number().int().min(0).optional(),
        samples: z.array(BlendSpaceSampleSchema).optional(),
        axisX: BlendParameterSchema.optional(),
        axisY: BlendParameterSchema.optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Sample selectors use sampleIndex.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify BlendSpace',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyBlendSpace', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'create_blueprint',
  {
    title: 'Create Blueprint',
    description: `Create a UE5 Blueprint asset with optional variables, component templates, function stubs, class defaults, and compile.

USAGE:
- parent_class_path is required and should resolve to the Blueprint parent class.
- payload may be the direct Blueprint payload or the extractor wrapper { blueprint: { ... } }.
- payload supports variables, rootComponents, functionStubs/functions, and classDefaults.
- Set validate_only=true to preflight the payload without creating the asset.

RETURNS: JSON with validation and compile summaries, dirtyPackages, and diagnostics. The asset is not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new Blueprint asset.',
      ),
      parent_class_path: z.string().describe(
        'Parent class path for the new Blueprint (e.g. /Script/Engine.Actor or /Game/Blueprints/BP_BaseActor.BP_BaseActor_C).',
      ),
      payload: z.object({
        blueprint: JsonObjectSchema.optional(),
        variables: z.array(JsonObjectSchema).optional(),
        rootComponents: z.array(JsonObjectSchema).optional(),
        functionStubs: z.array(JsonObjectSchema).optional(),
        functions: z.array(JsonObjectSchema).optional(),
        classDefaults: JsonObjectSchema.optional(),
      }).passthrough().default({}).describe(
        'Optional extractor-shaped Blueprint member payload.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the payload without creating the asset.',
      ),
    },
    annotations: {
      title: 'Create Blueprint',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, parent_class_path, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('CreateBlueprint', {
        AssetPath: asset_path,
        ParentClassPath: parent_class_path,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_blueprint_members',
  {
    title: 'Modify Blueprint Members',
    description: `Modify Blueprint member authoring surfaces without synthesizing arbitrary graphs.

USAGE:
- operation="replace_variables" or "replace_components": payload replaces the full variable or component set using extractor-shaped entries.
- operation="patch_variable": payload selects by variableName or name and patches metadata/defaults.
- operation="patch_component": payload selects by componentName or name and patches component defaults or hierarchy fields.
- operation="replace_function_stubs": payload.functionStubs or payload.functions replaces function shell graphs.
- operation="patch_class_defaults": payload.classDefaults or payload.properties patches generated-class defaults.
- operation="compile": validates and recompiles the Blueprint without saving it.

RETURNS: JSON with validation and compile summaries, dirtyPackages, and diagnostics. Changes are not saved until save_assets is called.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Blueprint asset to modify.',
      ),
      operation: BlueprintMemberMutationOperationSchema.describe(
        'Blueprint member mutation operation to apply.',
      ),
      payload: z.object({
        blueprint: JsonObjectSchema.optional(),
        variables: z.array(JsonObjectSchema).optional(),
        variable: JsonObjectSchema.optional(),
        variableName: z.string().optional(),
        rootComponents: z.array(JsonObjectSchema).optional(),
        components: JsonObjectSchema.optional(),
        component: JsonObjectSchema.optional(),
        componentName: z.string().optional(),
        functionStubs: z.array(JsonObjectSchema).optional(),
        functions: z.array(JsonObjectSchema).optional(),
        functionName: z.string().optional(),
        classDefaults: JsonObjectSchema.optional(),
        properties: JsonObjectSchema.optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Selectors use variableName, componentName, and functionName.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify Blueprint Members',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyBlueprintMembers', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'modify_blueprint_graphs',
  {
    title: 'Modify Blueprint Graphs',
    description: `Modify explicit Blueprint graph authoring surfaces with rollback-safe apply semantics.

USAGE:
- operation="upsert_function_graphs": payload.functionGraphs or payload.functions adds or replaces only the named function graphs. Existing unrelated graphs are preserved.
- operation="append_function_call_to_sequence": payload targets one existing graph and appends a function call node to a sequence node.
- operation="compile": validates and recompiles the Blueprint graph state without saving it.

RETURNS: JSON with validation and compile summaries, dirtyPackages, diagnostics, and rollback diagnostics when an apply/compile failure forced the package to reload from disk.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the Blueprint asset to modify.',
      ),
      operation: BlueprintGraphMutationOperationSchema.describe(
        'Blueprint graph mutation operation to apply.',
      ),
      payload: z.object({
        functionGraphs: z.array(JsonObjectSchema).optional(),
        functions: z.array(JsonObjectSchema).optional(),
        graphName: z.string().optional(),
        functionName: z.string().optional(),
        ownerClass: z.string().optional(),
        sequenceNodeTitle: z.string().optional(),
        posX: z.number().optional(),
        posY: z.number().optional(),
      }).passthrough().default({}).describe(
        'Operation payload. Function-graph upserts accept extractor-adjacent graph objects keyed by graphName/functionName/name.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mutation without changing the asset.',
      ),
    },
    annotations: {
      title: 'Modify Blueprint Graphs',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ asset_path, operation, payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ModifyBlueprintGraphs', {
        AssetPath: asset_path,
        Operation: operation,
        PayloadJson: JSON.stringify(payload ?? {}),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'save_assets',
  {
    title: 'Save Assets',
    description: `Persist dirty UE asset packages explicitly.

USAGE:
- Call after one or more successful write operations to save those dirty packages to disk.
- Pass the asset paths you want to persist. The tool resolves the owning packages and saves them.
- Read-only extraction tools do not require this.

RETURNS: JSON with success status, dirtyPackages, changedObjects, diagnostics, and saved=true when all requested packages were saved.`,
    inputSchema: {
      asset_paths: z.array(z.string()).describe(
        'Array of UE content paths to save (e.g. ["/Game/UI/WBP_MainMenu", "/Game/Data/DA_Items"]).',
      ),
    },
    annotations: {
      title: 'Save Assets',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ asset_paths }) => {
    try {
      const parsed = await callSubsystemJson('SaveAssets', {
        AssetPathsJson: JSON.stringify(asset_paths),
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'import_assets',
  {
    title: 'Import Assets',
    description: `Enqueue an async asset import job using subsystem JSON passthrough payloads.

USAGE:
- Provide payload.items with one or more file_path or url sources plus destination_path or asset_path.
- Poll get_import_job with the returned jobId until terminal=true.
- Set validate_only=true to validate the payload without importing.

RETURNS: JSON job status with jobId, terminal flag, status counters, per-item diagnostics, dirtyPackages, and importedObjects.`,
    inputSchema: {
      payload: ImportPayloadSchema.describe(
        'Subsystem passthrough payload object. Requires an items array and preserves snake_case import fields.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the import payload without importing.',
      ),
    },
    outputSchema: ImportJobSchema,
    annotations: {
      title: 'Import Assets',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ImportAssets', {
        PayloadJson: JSON.stringify(payload),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'reimport_assets',
  {
    title: 'Reimport Assets',
    description: `Enqueue an async reimport job using subsystem JSON passthrough payloads.

USAGE:
- Provide payload.items describing existing imported assets plus replacement file_path or url sources.
- Poll get_import_job with the returned jobId until terminal=true.
- Set validate_only=true to validate the payload without reimporting.

RETURNS: JSON job status with jobId, terminal flag, status counters, per-item diagnostics, dirtyPackages, and importedObjects.`,
    inputSchema: {
      payload: ImportPayloadSchema.describe(
        'Subsystem passthrough payload object for reimport jobs. Requires an items array and preserves snake_case import fields.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the reimport payload without reimporting.',
      ),
    },
    outputSchema: ImportJobSchema,
    annotations: {
      title: 'Reimport Assets',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ReimportAssets', {
        PayloadJson: JSON.stringify(payload),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'get_import_job',
  {
    title: 'Get Import Job',
    description: `Retrieve the current status for one async import job by id.

USAGE:
- Call after import_assets, reimport_assets, import_textures, or import_meshes.
- Continue polling until terminal=true.

RETURNS: JSON job status with per-item states, diagnostics, dirtyPackages, and importedObjects.`,
    inputSchema: {
      job_id: z.string().describe(
        'Job id returned by an import tool.',
      ),
    },
    outputSchema: ImportJobSchema,
    annotations: {
      title: 'Get Import Job',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ job_id }) => {
    try {
      const parsed = await callSubsystemJson('GetImportJob', {
        JobId: job_id,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'list_import_jobs',
  {
    title: 'List Import Jobs',
    description: `List async import jobs known to the subsystem.

USAGE:
- Default behavior can omit completed jobs to focus on active work.
- Set include_completed=true to inspect historical terminal jobs.

RETURNS: JSON passthrough summary of import jobs tracked by the subsystem.`,
    inputSchema: {
      include_completed: z.boolean().default(false).describe(
        'When true, include completed terminal jobs in the listing.',
      ),
    },
    outputSchema: ImportJobListSchema,
    annotations: {
      title: 'List Import Jobs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ include_completed }) => {
    try {
      const parsed = await callSubsystemJson('ListImportJobs', {
        bIncludeCompleted: include_completed,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'import_textures',
  {
    title: 'Import Textures',
    description: `Enqueue an async texture import job with texture-specific option passthrough.

USAGE:
- Provide payload.items with file_path or url sources plus destination_path or asset_path.
- Texture item options support compression_settings, lod_group, s_rgb/srgb, virtual_texture_streaming, and flip_green_channel.
- Poll get_import_job with the returned jobId until terminal=true.

RETURNS: JSON job status with jobId, terminal flag, status counters, per-item diagnostics, dirtyPackages, and importedObjects.`,
    inputSchema: {
      payload: TextureImportPayloadSchema.describe(
        'Subsystem passthrough payload object for texture imports. Requires an items array and preserves snake_case texture option keys.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the texture import payload without importing.',
      ),
    },
    outputSchema: ImportJobSchema,
    annotations: {
      title: 'Import Textures',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ImportTextures', {
        PayloadJson: JSON.stringify(payload),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

server.registerTool(
  'import_meshes',
  {
    title: 'Import Meshes',
    description: `Enqueue an async mesh import job with mesh-specific option passthrough.

USAGE:
- Provide payload.items with file_path or url sources plus destination_path or asset_path.
- Mesh item options support mesh_type, import_materials, import_textures, import_animations, combine_meshes, generate_collision, and skeleton_path.
- Poll get_import_job with the returned jobId until terminal=true.

RETURNS: JSON job status with jobId, terminal flag, status counters, per-item diagnostics, dirtyPackages, and importedObjects.`,
    inputSchema: {
      payload: MeshImportPayloadSchema.describe(
        'Subsystem passthrough payload object for mesh imports. Requires an items array and preserves snake_case mesh option keys.',
      ),
      validate_only: z.boolean().default(false).describe(
        'When true, validate the mesh import payload without importing.',
      ),
    },
    outputSchema: ImportJobSchema,
    annotations: {
      title: 'Import Meshes',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ payload, validate_only }) => {
    try {
      const parsed = await callSubsystemJson('ImportMeshes', {
        PayloadJson: JSON.stringify(payload),
        bValidateOnly: validate_only,
      });
      return jsonToolSuccess(parsed);
    } catch (e) {
      return jsonToolError(e);
    }
  },
);

  return server;
}

// Start server
async function main() {
  const server = createBlueprintExtractorServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
