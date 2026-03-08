#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { UEClient } from './ue-client.js';
import { compactBlueprint } from './compactor.js';

const client = new UEClient();

const server = new McpServer({
  name: 'blueprint-extractor',
  version: '1.8.0',
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
      const result = await client.callSubsystem('ExtractMaterialInstance', { AssetPath: asset_path });
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
- Filter by class to narrow results: "Blueprint" (default), "AnimBlueprint", "WidgetBlueprint", "StateTree", "BehaviorTree", "Blackboard", "DataAsset", "DataTable", "UserDefinedStruct", "UserDefinedEnum", "Curve", "CurveTable", "MaterialInstance", "AnimSequence", "AnimMontage", "BlendSpace", or empty string for all.

RETURNS: JSON array of objects with path, name, and class for each matching asset.`,
    inputSchema: {
      query: z.string().describe(
        'Search term to match against asset names. Partial matches work (e.g. "Player" finds "BP_PlayerCharacter").',
      ),
      class_filter: z.string().default('Blueprint').describe(
        'Filter by asset class. Common values: "Blueprint", "AnimBlueprint", "WidgetBlueprint", "StateTree", "BehaviorTree", "Blackboard", "DataAsset", "DataTable", "UserDefinedStruct", "UserDefinedEnum", "Curve", "CurveTable", "MaterialInstance", "AnimSequence", "AnimMontage", "BlendSpace", or "" for all asset types.',
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
  is_variable: z.boolean().default(false).describe('Mark as variable for BindWidget access from C++'),
  slot: z.record(z.string(), z.unknown()).optional().describe('Slot properties (type depends on parent panel)'),
  properties: z.record(z.string(), z.unknown()).optional().describe('Widget UPROPERTY values to set'),
  children: z.array(WidgetNodeSchema).optional().describe('Child widgets (only valid for panel widgets)'),
}));

// Tool 8: create_widget_blueprint
server.registerTool(
  'create_widget_blueprint',
  {
    title: 'Create Widget Blueprint',
    description: `Create a new UE5 WidgetBlueprint asset with a specified parent class.

USAGE: Provide the content path where the asset should be created and optionally a parent class.
Default parent is UserWidget. For CommonUI widgets use CommonActivatableWidget, CommonButtonBase, etc.

RETURNS: JSON with success status, asset path, and parent class name.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path for the new WidgetBlueprint (e.g. /Game/UI/WBP_MyWidget)',
      ),
      parent_class: z.string().default('UserWidget').describe(
        'Parent class name (e.g. UserWidget, CommonActivatableWidget, CommonButtonBase)',
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
  async ({ asset_path, parent_class }) => {
    try {
      const result = await client.callSubsystem('CreateWidgetBlueprint', {
        AssetPath: asset_path,
        ParentClass: parent_class,
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

// Tool 9: build_widget_tree
server.registerTool(
  'build_widget_tree',
  {
    title: 'Build Widget Tree',
    description: `Build or replace the entire widget hierarchy of an existing WidgetBlueprint from a JSON tree description.

WARNING: This REPLACES the existing widget tree — all current widgets will be removed.

USAGE: Provide the asset path and a root_widget object describing the full tree recursively.
Each widget node has: class, name, is_variable, slot (optional), properties (optional), children (optional).

RETURNS: JSON with success status, widget count, and any errors.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to an existing WidgetBlueprint',
      ),
      root_widget: WidgetNodeSchema.describe(
        'Root widget of the tree hierarchy',
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
  async ({ asset_path, root_widget }) => {
    try {
      const result = await client.callSubsystem('BuildWidgetTree', {
        AssetPath: asset_path,
        WidgetTreeJson: JSON.stringify(root_widget),
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

// Tool 10: modify_widget
server.registerTool(
  'modify_widget',
  {
    title: 'Modify Widget',
    description: `Modify properties and/or slot configuration of an existing widget within a WidgetBlueprint.

USAGE: Specify the asset path, widget name, and the properties/slot values to change.
Only specified properties are modified — others remain unchanged.

RETURNS: JSON with success status, widget name, class, and any errors.`,
    inputSchema: {
      asset_path: z.string().describe(
        'UE content path to the WidgetBlueprint',
      ),
      widget_name: z.string().describe(
        'Name of the widget to modify (as shown in the widget tree)',
      ),
      properties: z.record(z.string(), z.unknown()).optional().describe(
        'Widget UPROPERTY values to set',
      ),
      slot: z.record(z.string(), z.unknown()).optional().describe(
        'Slot properties to set',
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
  async ({ asset_path, widget_name, properties, slot }) => {
    try {
      const result = await client.callSubsystem('ModifyWidget', {
        AssetPath: asset_path,
        WidgetName: widget_name,
        PropertiesJson: JSON.stringify(properties ?? {}),
        SlotJson: JSON.stringify(slot ?? {}),
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

// Tool 11: compile_widget_blueprint
server.registerTool(
  'compile_widget_blueprint',
  {
    title: 'Compile Widget Blueprint',
    description: `Compile a WidgetBlueprint and return any errors or warnings.

USAGE: Call after building or modifying a widget tree to verify compilation.

RETURNS: JSON with success status, compilation status, error count, warning count, and error details.`,
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
      const result = await client.callSubsystem('CompileWidgetBlueprint', { AssetPath: asset_path });
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
