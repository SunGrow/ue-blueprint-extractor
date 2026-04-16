import { z } from 'zod';
import { toolResultSchema } from './tool-results.js';

// Recursive schema for widget tree nodes (used by replace_widget_tree and nested widget mutations)
export const WidgetNodeSchema: z.ZodType<any> = z.lazy(() => z.object({
  class: z.string().describe('Widget class (e.g. CanvasPanel, TextBlock).'),
  name: z.string(),
  display_label: z.string().optional().describe('Editor display label for named slots.'),
  is_variable: z.boolean().default(false).describe('Expose as BindWidget variable.'),
  slot: z.record(z.string(), z.unknown()).optional().describe('Slot properties (parent-panel-dependent).'),
  properties: z.record(z.string(), z.unknown()).optional(),
  children: z.array(WidgetNodeSchema).optional().describe('Child widgets (panels only).'),
}));

export const PropertyEntrySchema = z.object({
  name: z.string(),
  value: z.unknown(),
});

export const DataTableRowSchema = z.object({
  rowName: z.string(),
  values: z.record(z.string(), z.unknown()).optional(),
  properties: z.union([
    z.record(z.string(), z.unknown()),
    z.array(PropertyEntrySchema),
  ]).optional().describe(
    'Property map or [{name, value}] array.',
  ),
});

export const CurveInterpModeSchema = z.enum([
  'None',
  'Linear',
  'Constant',
  'Cubic',
]);

export const CurveExtrapolationSchema = z.enum([
  'None',
  'Cycle',
  'CycleWithOffset',
  'Oscillate',
  'Linear',
  'Constant',
]);

export const RichCurveKeySchema = z.object({
  time: z.number(),
  value: z.number(),
  arriveTangent: z.number().optional(),
  leaveTangent: z.number().optional(),
  interpMode: CurveInterpModeSchema.optional(),
});

export const CurveChannelSchema = z.object({
  defaultValue: z.number().nullable().optional(),
  preInfinityExtrap: CurveExtrapolationSchema.optional(),
  postInfinityExtrap: CurveExtrapolationSchema.optional(),
  keys: z.array(RichCurveKeySchema).optional(),
});

export const CurveTypeSchema = z.enum([
  'Float',
  'Vector',
  'LinearColor',
]);

export const CurveTableModeSchema = z.enum([
  'RichCurves',
  'SimpleCurves',
]);

export const CurveKeyDeleteSchema = z.object({
  channel: z.string(),
  time: z.number(),
});

export const CurveKeyUpsertSchema = z.object({
  channel: z.string(),
  key: RichCurveKeySchema,
});

export const CurveTableRowSchema = z.object({
  rowName: z.string(),
  curve: CurveChannelSchema,
});

export const JsonObjectSchema = z.record(z.string(), z.unknown());
export const StringMapSchema = z.record(z.string(), z.string());
export const BuildPlatformSchema = z.enum(['Win64', 'Mac', 'Linux']);
export const BuildConfigurationSchema = z.enum(['Debug', 'DebugGame', 'Development', 'Shipping', 'Test']);
export const WidgetSelectorFieldsSchema = z.object({
  widget_name: z.string().optional(),
  widget_path: z.string().optional(),
});
export const WidgetSelectorSchema = WidgetSelectorFieldsSchema.refine(
  (value) => Boolean(value.widget_name || value.widget_path),
  {
    message: 'widget_name or widget_path is required',
  },
);
export const FontImportItemSchema = z.object({
  file_path: z.string(),
  entry_name: z.string().optional(),
  replace_existing: z.boolean().optional(),
});
export const WindowFontApplicationSchema = WidgetSelectorFieldsSchema.extend({
  font_asset: z.string(),
  typeface: z.string().optional(),
  size: z.number().int().positive(),
}).refine((value) => Boolean(value.widget_name || value.widget_path), {
  message: 'widget_name or widget_path is required',
});
export const MaterialFunctionAssetKindSchema = z.enum(['function', 'layer', 'layer_blend']);
export const ExtractAssetTypeSchema = z.enum([
  'statetree',
  'data_asset',
  'data_table',
  'behavior_tree',
  'blackboard',
  'user_defined_struct',
  'user_defined_enum',
  'curve',
  'curve_table',
  'material_instance',
  'anim_sequence',
  'anim_montage',
  'blend_space',
]);
export const MaterialParameterAssociationSchema = z.enum([
  'GlobalParameter',
  'LayerParameter',
  'BlendParameter',
  'global',
  'layer',
  'blend',
]);
export const MaterialParameterSelectorSchema = z.object({
  name: z.string(),
  association: MaterialParameterAssociationSchema.optional(),
  index: z.number().int().optional(),
});
export const MaterialColorValueSchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(),
});
export const MaterialScalarParameterSchema = MaterialParameterSelectorSchema.extend({
  value: z.number(),
});
export const MaterialVectorParameterSchema = MaterialParameterSelectorSchema.extend({
  value: MaterialColorValueSchema,
});
export const MaterialTextureParameterSchema = MaterialParameterSelectorSchema.extend({
  value: z.string().nullable(),
});
export const MaterialFontParameterSchema = MaterialParameterSelectorSchema.extend({
  value: z.string().nullable(),
  fontPage: z.number().int().optional(),
});
export const MaterialStaticSwitchParameterSchema = MaterialParameterSelectorSchema.extend({
  value: z.boolean(),
});
export const MaterialLayerEntrySchema = z.object({
  layerPath: z.string().nullable().optional(),
  blendPath: z.string().nullable().optional(),
  layerGuid: z.string().optional(),
  name: z.string().optional(),
  visible: z.boolean().optional(),
});
export const MaterialLayerStackSchema = z.object({
  layers: z.array(MaterialLayerEntrySchema),
});
export const MaterialGraphOperationSchema = z.object({
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
  // Expression fields
  expression_class: z.string().optional(),
  expression_guid: z.string().optional(),
  temp_id: z.string().optional(),
  properties: JsonObjectSchema.optional(),
  node_pos_x: z.number().optional(),
  node_pos_y: z.number().optional(),
  // Connection fields
  from_expression_guid: z.string().optional(),
  from_temp_id: z.string().optional(),
  to_expression_guid: z.string().optional(),
  to_temp_id: z.string().optional(),
  from_output_name: z.string().optional(),
  from_output_index: z.number().int().min(0).optional(),
  to_input_name: z.string().optional(),
  to_input_index: z.number().int().min(0).optional(),
  // Material property
  material_property: z.string().optional(),
  // Settings
  settings: JsonObjectSchema.optional(),
  // Comment fields
  comment_text: z.string().optional(),
  comment_id: z.string().optional(),
  comment_pos_x: z.number().optional(),
  comment_pos_y: z.number().optional(),
  comment_size_x: z.number().optional(),
  comment_size_y: z.number().optional(),
  // Parameter group
  old_group_name: z.string().optional(),
  new_group_name: z.string().optional(),
  // Layer stack
  layer_stack: MaterialLayerStackSchema.optional(),
});
export const MaterialGraphOperationKindSchema = z.enum([
  'set_material_settings',
  'add_expression',
  'connect_expressions',
  'connect_material_property',
]);
export const MaterialNodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
}).strict();
export const MaterialExpressionSelectorFieldsSchema = z.object({
  expression_guid: z.string().optional(),
  temp_id: z.string().optional(),
}).strict();
export const MaterialExpressionSelectorSchema = MaterialExpressionSelectorFieldsSchema.refine(
  (value) => Boolean(value.expression_guid || value.temp_id),
  { message: 'expression_guid or temp_id is required' },
);
export const MaterialConnectionSelectorFieldsSchema = z.object({
  from_expression_guid: z.string().optional(),
  from_temp_id: z.string().optional(),
  to_expression_guid: z.string().optional(),
  to_temp_id: z.string().optional(),
  from_output_name: z.string().optional(),
  from_output_index: z.number().int().min(0).optional(),
  to_input_name: z.string().optional(),
  to_input_index: z.number().int().min(0).optional(),
}).strict();
export const MaterialConnectionSelectorSchema = MaterialConnectionSelectorFieldsSchema.refine(
  (value) => Boolean(value.from_expression_guid || value.from_temp_id),
  { message: 'from_expression_guid or from_temp_id is required' },
).refine(
  (value) => Boolean(value.to_expression_guid || value.to_temp_id),
  { message: 'to_expression_guid or to_temp_id is required' },
);

export const EnhancedInputValueTypeSchema = z.enum(['boolean', 'axis_1d', 'axis_2d', 'axis_3d']);
export const InputMappingSchema = z.object({
  action: z.string(),
  key: z.string(),
}).strict();

export const ImportItemCommonSchema = z.object({
  file_path: z.string().optional(),
  url: z.string().optional(),
  filename: z.string().optional(),
  headers: StringMapSchema.optional(),
  destination_path: z.string().optional(),
  destination_name: z.string().optional(),
  asset_path: z.string().optional(),
  replace_existing: z.boolean().optional(),
  replace_existing_settings: z.boolean().optional(),
});

export const TextureImportOptionsSchema = z.object({
  compression_settings: z.string().optional(),
  lod_group: z.string().optional(),
  s_rgb: z.boolean().optional(),
  srgb: z.boolean().optional(),
  virtual_texture_streaming: z.boolean().optional(),
  flip_green_channel: z.boolean().optional(),
});

export const MeshImportOptionsSchema = z.object({
  mesh_type: z.string().optional(),
  import_materials: z.boolean().optional(),
  import_textures: z.boolean().optional(),
  import_animations: z.boolean().optional(),
  combine_meshes: z.boolean().optional(),
  generate_collision: z.boolean().optional(),
  skeleton_path: z.string().optional(),
});

export const ImportPayloadSchema = z.object({
  items: z.array(ImportItemCommonSchema),
});

export const TextureImportPayloadSchema = z.object({
  items: z.array(ImportItemCommonSchema.extend({
    options: TextureImportOptionsSchema.optional(),
  })),
});

export const MeshImportPayloadSchema = z.object({
  items: z.array(ImportItemCommonSchema.extend({
    options: MeshImportOptionsSchema.optional(),
  })),
});

export const ImportDiagnosticSchema = z.object({
  severity: z.string(),
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});

export const ImportJobItemSchema = z.object({
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
});

export const ImportJobSchema = toolResultSchema.extend({
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
});

export const ImportJobListSchema = toolResultSchema.extend({
  includeCompleted: z.boolean(),
  jobCount: z.number().int().min(0),
  jobs: z.array(ImportJobSchema),
});

export const UserDefinedStructMutationOperationSchema = z.enum([
  'replace_fields',
  'patch_field',
  'rename_field',
  'remove_field',
  'reorder_fields',
]);

export const UserDefinedEnumMutationOperationSchema = z.enum([
  'replace_entries',
  'rename_entry',
  'remove_entry',
  'reorder_entries',
]);

export const BlackboardMutationOperationSchema = z.enum([
  'replace_keys',
  'patch_key',
  'remove_key',
  'set_parent',
]);

export const BehaviorTreeMutationOperationSchema = z.enum([
  'replace_tree',
  'patch_node',
  'patch_attachment',
  'set_blackboard',
]);

export const StateTreeMutationOperationSchema = z.enum([
  'replace_tree',
  'patch_state',
  'patch_editor_node',
  'patch_transition',
  'set_schema',
  'set_bindings',
  'add_binding',
  'remove_binding',
]);

export const AnimSequenceMutationOperationSchema = z.enum([
  'replace_notifies',
  'patch_notify',
  'replace_sync_markers',
  'replace_curve_metadata',
]);

export const AnimMontageMutationOperationSchema = z.enum([
  'replace_notifies',
  'patch_notify',
  'replace_sections',
  'replace_slots',
]);

export const BlendSpaceMutationOperationSchema = z.enum([
  'replace_samples',
  'patch_sample',
  'set_axes',
]);

export const BlueprintMemberMutationOperationSchema = z.enum([
  'replace_variables',
  'add_variables',
  'patch_variable',
  'replace_components',
  'patch_component',
  'add_component',
  'replace_function_stubs',
  'reparent',
  'patch_class_defaults',
  'compile',
]);

export const BlueprintGraphMutationOperationSchema = z.enum([
  'upsert_function_graphs',
  'append_function_call_to_sequence',
  'insert_exec_nodes',
  'add_animgraph_nodes',
  'connect_animgraph_pins',
  'compile',
]);

export const UserDefinedStructFieldSchema = z.object({
  guid: z.string().optional(),
  name: z.string().optional(),
  friendlyName: z.string().optional(),
  pinType: JsonObjectSchema.optional(),
  metadata: JsonObjectSchema.optional(),
  defaultValue: z.unknown().optional(),
});

export const UserDefinedEnumEntrySchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
});

export const BlackboardKeySchema = z.object({
  entryName: z.string().optional(),
  name: z.string().optional(),
  keyTypePath: z.string().optional(),
  baseClass: z.string().optional(),
  enumType: z.string().optional(),
  enumName: z.string().optional(),
  properties: JsonObjectSchema.optional(),
});

export const BehaviorTreeNodeSelectorSchema = z.object({
  nodePath: z.string().optional(),
});

export const StateTreeStateSelectorSchema = z.object({
  stateId: z.string().optional(),
  id: z.string().optional(),
  statePath: z.string().optional(),
  path: z.string().optional(),
  stateName: z.string().optional(),
  name: z.string().optional(),
});

export const StateTreeEditorNodeSelectorSchema = z.object({
  editorNodeId: z.string().optional(),
  id: z.string().optional(),
});

export const StateTreeTransitionSelectorSchema = z.object({
  transitionId: z.string().optional(),
  id: z.string().optional(),
});

const PropertyPathValueSchema = z.union([
  z.string().describe('Shorthand: "structGuid:Property.SubProp[Index]".'),
  z.object({
    structId: z.string().optional(),
    segments: z.array(z.object({
      name: z.string(),
      arrayIndex: z.number().int().optional(),
      instanceStruct: z.string().optional(),
    })),
  }).describe('Full path object with structId and segments.'),
]);

export const PropertyPathBindingSchema = z.object({
  sourcePath: PropertyPathValueSchema,
  targetPath: PropertyPathValueSchema,
});

export const StateTreeBindingsObjectSchema = z.object({
  propertyBindings: z.array(PropertyPathBindingSchema),
}).describe('StateTree property bindings container.');

export const AnimationNotifySelectorSchema = z.object({
  notifyId: z.string().optional(),
  notifyGuid: z.string().optional(),
  notifyName: z.string().optional(),
  notifyIndex: z.number().int().min(0).optional(),
  trackIndex: z.number().int().min(0).optional(),
  trackName: z.string().optional(),
});

export const BlendParameterSchema = z.object({
  name: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  gridNum: z.number().int().optional(),
  interpolationType: z.string().optional(),
  snapToGrid: z.boolean().optional(),
  wrapInput: z.boolean().optional(),
});

export const BlendSpaceSampleSchema = z.object({
  sampleIndex: z.number().int().min(0).optional(),
  animation: z.string().optional(),
  animSequence: z.string().optional(),
  sampleValue: JsonObjectSchema.optional(),
});
