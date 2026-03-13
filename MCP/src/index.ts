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

export function createBlueprintExtractorServer(
  client: UEClientLike = new UEClient(),
  projectController: ProjectControllerLike = new ProjectController(),
) {
  const server = new McpServer({
    name: 'blueprint-extractor',
    version: '1.14.1',
  });

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
        '- Common alias policy: snake_case is the canonical MCP shape; small ergonomic aliases are accepted only where documented.',
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
        '- restart_editor requests an editor restart, then waits for Remote Control to disconnect and reconnect. save_dirty_assets remains an accepted compatibility input; explicit save_assets is the reliable persistence path.',
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

const exampleResourceBodies: Record<string, string[]> = {
  widget_blueprint: [
    'Family: widget_blueprint',
    '',
    'Recommended flow:',
    '1. create_widget_blueprint',
    '2. extract_widget_blueprint',
    '3. modify_widget_blueprint',
    '4. compile_widget_blueprint',
    '5. save_assets',
    '',
    'Example patch:',
    '{"operation":"patch_widget","widget_path":"WindowRoot/TitleBar/TitleText","properties":{"Text":"Window"},"compile_after":true}',
    '',
    'Example structural batch:',
    '{"operation":"batch","operations":[{"operation":"insert_child","parent_widget_path":"WindowRoot/ContentRoot","child_widget":{"class":"TextBlock","name":"BodyText","is_variable":true,"properties":{"Text":"Hello"}}},{"operation":"wrap_widget","widget_path":"WindowRoot/ContentRoot/BodyText","wrapper_widget":{"class":"Border","name":"BodyFrame"}}]}',
  ],
  blueprint_members: [
    'Family: blueprint_members',
    '',
    'Use create_blueprint for initial asset creation and modify_blueprint_members for targeted changes.',
    '',
    'Example patch:',
    '{"operation":"patch_variable","variable_name":"Health","payload":{"defaultValue":120.0}}',
  ],
  import_assets: [
    'Family: import_assets',
    '',
    'Recommended flow:',
    '1. import_assets or import_textures/import_meshes',
    '2. get_import_job until terminal=true',
    '3. extract imported asset if needed',
    '4. save_assets',
    '',
    'Example:',
    '{"items":[{"file_path":"C:/Temp/T_Test.png","destination_path":"/Game/Imported","destination_name":"T_Test"}]}',
  ],
  material: [
    'Family: material',
    '',
    'Recommended flow:',
    '1. create_material',
    '2. modify_material',
    '3. extract_material',
    '4. save_assets',
    '',
    'Example batch:',
    '{"settings":{"blend_mode":"BLEND_Opaque","two_sided":false},"operations":[{"operation":"add_expression","temp_id":"tex","class":"/Script/Engine.MaterialExpressionTextureSampleParameter2D","properties":{"ParameterName":"Albedo","Texture":"/Engine/EngineResources/DefaultTexture.DefaultTexture"}},{"operation":"connect_material_property","temp_id":"tex","from_output_name":"RGB","property":"MP_BaseColor"}]}',
  ],
  material_function: [
    'Family: material_function',
    '',
    'Use create_material_function with asset_kind=function, layer, or layer_blend.',
    '',
    'Example batch:',
    '{"settings":{"description":"Example function"},"operations":[{"operation":"add_expression","temp_id":"input","class":"/Script/Engine.MaterialExpressionFunctionInput","properties":{"InputName":"Color"}},{"operation":"add_expression","temp_id":"output","class":"/Script/Engine.MaterialExpressionFunctionOutput","properties":{"OutputName":"Result"}},{"operation":"connect_expressions","from_temp_id":"input","to_temp_id":"output","to_input_name":"A"}]}',
  ],
  window_ui_polish: [
    'Family: window_ui_polish',
    '',
    'Recommended flow:',
    '1. modify_widget / modify_widget_blueprint.patch_widget with is_variable',
    '2. modify_widget_blueprint with operation=patch_class_defaults',
    '3. import_fonts',
    '4. apply_widget_fonts',
    '5. compile_widget_blueprint',
    '6. save_assets',
    '7. sync_project_code (optional)',
  ],
  project_code: [
    'Family: project_code',
    '',
    'Use explicit changed_paths with sync_project_code.',
    '',
    'Example:',
    '{"changed_paths":["Source/MyGame/Private/MyActor.cpp"],"project_path":"C:/Projects/MyGame/MyGame.uproject","engine_root":"C:/Program Files/Epic Games/UE_5.7","target":"MyGameEditor"}',
  ],
  data_asset: [
    'Family: data_asset',
    '',
    'Example create:',
    '{"asset_class_path":"/Script/MyGame.MyDataAsset","properties":{"Count":3}}',
    '',
    'Example modify:',
    '{"properties":{"Count":5}}',
  ],
  behavior_tree: [
    'Family: behavior_tree',
    '',
    'Use nodePath selectors for patch_node and patch_attachment operations.',
    '',
    'Example:',
    '{"operation":"patch_node","payload":{"nodePath":"Root/Selector[0]/MoveTo","properties":{"AcceptableRadius":150.0}}}',
  ],
};

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
      resources: Object.keys(exampleResourceBodies).map((family) => ({
        uri: `blueprint://examples/${family}`,
        name: `Example: ${family}`,
        mimeType: 'text/plain',
      })),
    }),
  }),
  {
    description: 'Short example payloads and recommended flows for common write-capable families.',
  },
  async (uri, variables) => {
    const family = String(variables.family ?? '');
    const lines = exampleResourceBodies[family];
    if (!lines) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/plain',
          text: `Unknown example family: ${family}`,
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
    outputSchema: {
      extracted_count: z.number().int().min(0),
      skipped_count: z.number().int().min(0),
      total_count: z.number().int().min(0),
      output_directory: z.string(),
      manifest: z.array(cascadeManifestEntrySchema),
    },
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
      parent_class: z.string().default('UserWidget').describe(
        'Compatibility alias for the parent widget class name or path (e.g. UserWidget, CommonActivatableWidget, /Script/MyModule.MyWidgetBase)',
      ),
      parent_class_path: z.string().optional().describe(
        'Preferred explicit parent widget class path or short loaded class name.',
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
  async ({ asset_path, parent_class, parent_class_path }) => {
    try {
      const parsed = await callSubsystemJson('CreateWidgetBlueprint', {
        AssetPath: asset_path,
        ParentClass: parent_class_path ?? parent_class,
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
    description: 'Patch one widget by widget_name or widget_path. Rename via properties.name/newName/new_name; variable flags are accepted as top-level aliases.',
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
        'Optional alias for toggling the widget variable flag.',
      ),
      isVariable: z.boolean().optional().describe(
        'Optional alias for toggling the widget variable flag.',
      ),
      bIsVariable: z.boolean().optional().describe(
        'Optional alias for toggling the widget variable flag.',
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
  async ({ asset_path, widget_name, widget_path, properties, slot, is_variable, isVariable, bIsVariable, validate_only }) => {
    try {
      const widgetIdentifier = widget_path ?? widget_name;
      if (!widgetIdentifier) {
        return jsonToolError(new Error('widget_name or widget_path is required'));
      }

      const widgetOptions: Record<string, unknown> = {};
      const variableFlag = maybeBoolean(is_variable, isVariable, bIsVariable);
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
  'modify_material',
  {
    title: 'Modify Material',
    description: 'Apply compact graph and settings operations to a classic UMaterial asset.',
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
        'Optional alias for toggling the widget variable flag during patch_widget.',
      ),
      isVariable: z.boolean().optional().describe(
        'Optional alias for toggling the widget variable flag during patch_widget.',
      ),
      bIsVariable: z.boolean().optional().describe(
        'Optional alias for toggling the widget variable flag during patch_widget.',
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
    isVariable,
    bIsVariable,
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
        const variableFlag = maybeBoolean(is_variable, isVariable, bIsVariable);
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
    },
    annotations: {
      title: 'Compile Project Code',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ engine_root, project_path, target, platform, configuration, build_timeout_seconds, include_output }) => {
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
      return jsonToolSuccess({
        ...parsed,
        changedPathsAccepted: changed_paths ?? [],
        changedPathsAppliedByEditor: false,
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
      });

      cachedProjectAutomationContext = null;

      if (!wait_for_reconnect || restartRequest.success === false) {
        return jsonToolSuccess({
          ...restartRequest,
          saveDirtyAssetsAccepted: save_dirty_assets,
          saveDirtyAssetsAppliedByEditor: false,
        });
      }

      const reconnect = await projectController.waitForEditorRestart(supportsConnectionProbe(client), {
        disconnectTimeoutMs: disconnect_timeout_seconds * 1000,
        reconnectTimeoutMs: reconnect_timeout_seconds * 1000,
      });

      return jsonToolSuccess({
        ...restartRequest,
        saveDirtyAssetsAccepted: save_dirty_assets,
        saveDirtyAssetsAppliedByEditor: false,
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
