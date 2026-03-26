/**
 * Next-step hints registry.
 *
 * Maps every primary tool name to a `HintConfig` containing short suggestions
 * the normalizer can append to success / error envelopes so the LLM consumer
 * knows what to do next without re-reading documentation.
 */

export type HintConfig = {
  on_success: string[];
  on_error: string[];
  scope_suggestion?: string;
};

// ---------------------------------------------------------------------------
// Helper factories for category-level defaults
// ---------------------------------------------------------------------------

function extractionHints(
  toolName: string,
  extras?: Partial<HintConfig>,
): HintConfig {
  return {
    on_success: extras?.on_success ?? [
      `Use the corresponding modify tool to edit the extracted data.`,
      'Use extract_cascade for dependency analysis.',
    ],
    on_error: extras?.on_error ?? [
      'Verify asset path with search_assets.',
      'Check editor connection with wait_for_editor.',
    ],
    scope_suggestion: extras?.scope_suggestion,
  };
}

function creationHints(
  extractTool: string,
  modifyTool?: string,
  extras?: Partial<HintConfig>,
): HintConfig {
  const successHints = [
    `Use ${extractTool} to verify the created asset.`,
  ];
  if (modifyTool) {
    successHints.push(`Use ${modifyTool} to further configure.`);
  }
  successHints.push('Use save_assets to persist changes.');

  return {
    on_success: extras?.on_success ?? successHints,
    on_error: extras?.on_error ?? [
      'Check if asset already exists with search_assets.',
      'Verify the parent path with list_assets.',
    ],
    scope_suggestion: extras?.scope_suggestion,
  };
}

function modificationHints(
  extractTool: string,
  extras?: Partial<HintConfig>,
): HintConfig {
  return {
    on_success: extras?.on_success ?? [
      'Use save_assets to persist changes.',
      `Use ${extractTool} to verify the result.`,
    ],
    on_error: extras?.on_error ?? [
      `Use ${extractTool} to inspect the current state before retrying.`,
      'Use validate_only=true first to preview failures.',
    ],
    scope_suggestion: extras?.scope_suggestion,
  };
}

function verificationHints(
  extras?: Partial<HintConfig>,
): HintConfig {
  return {
    on_success: extras?.on_success ?? [
      'Use compare_capture_to_reference to diff against a baseline.',
      'Continue with the next verification step.',
    ],
    on_error: extras?.on_error ?? [
      'Ensure the widget blueprint compiles first with compile_widget.',
      'Check editor connection with wait_for_editor.',
    ],
    scope_suggestion: extras?.scope_suggestion ?? 'verification',
  };
}

function listingHints(
  extractTool: string,
  extras?: Partial<HintConfig>,
): HintConfig {
  return {
    on_success: extras?.on_success ?? [
      `Use ${extractTool} on specific results for details.`,
      'Refine filters to narrow results.',
    ],
    on_error: extras?.on_error ?? [
      'Broaden search criteria.',
      'Check editor connection with wait_for_editor.',
    ],
    scope_suggestion: extras?.scope_suggestion,
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const NEXT_STEP_HINTS_REGISTRY: Map<string, HintConfig> = new Map<string, HintConfig>([

  // =========================================================================
  // Core / Extraction tools
  // =========================================================================

  ['extract_blueprint', {
    on_success: [
      'Use modify_blueprint_members to edit properties or components.',
      'Use extract_cascade for dependency analysis.',
      'Use modify_blueprint_graphs to edit graph logic.',
    ],
    on_error: [
      'Verify asset path with search_assets.',
      'Check editor connection with wait_for_editor.',
    ],
  }],

  ['extract_asset', {
    on_success: [
      'Use the corresponding modify tool for the asset type to make changes.',
      'Use extract_cascade for dependency chain analysis.',
    ],
    on_error: [
      'Verify asset path with search_assets.',
      'Ensure the asset_type matches the actual asset class.',
    ],
  }],

  ['extract_material', {
    on_success: [
      'Use material_graph_operation to add or wire nodes.',
      'Use modify_material for batch graph operations.',
      'Use compile_material_asset to verify shader compilation.',
    ],
    on_error: [
      'Verify asset path with search_assets.',
      'Ensure asset_kind matches (material, function, layer, layer_blend).',
    ],
    scope_suggestion: 'material_authoring',
  }],

  ['extract_cascade', {
    on_success: [
      'Inspect the manifest for dependency paths.',
      'Use extract_blueprint or extract_material on individual assets for deeper detail.',
    ],
    on_error: [
      'Verify asset paths with search_assets.',
      'Reduce max_depth if the cascade is too large.',
    ],
  }],

  ['search_assets', {
    on_success: [
      'Use extract_asset or extract_blueprint on results for details.',
      'Use find_and_extract for combined search and extraction.',
    ],
    on_error: [
      'Broaden search criteria.',
      'Check path with list_assets.',
    ],
  }],

  ['list_assets', {
    on_success: [
      'Use extract_asset on specific results for details.',
      'Use search_assets for name-based filtering.',
    ],
    on_error: [
      'Verify the package_path exists.',
      'Check editor connection with wait_for_editor.',
    ],
  }],

  ['save_assets', {
    on_success: [
      'Assets are persisted to disk.',
      'Use extract_blueprint or extract_asset to confirm saved state.',
    ],
    on_error: [
      'Check that asset paths are valid with search_assets.',
      'Ensure no assets are locked by another process.',
    ],
  }],

  ['get_tool_help', {
    on_success: [
      'Review the schema and examples, then call the tool.',
      'Use activate_workflow_scope to load the tool family if needed.',
    ],
    on_error: [
      'Check the tool name spelling.',
      'Use activate_workflow_scope to ensure the tool is loaded.',
    ],
  }],

  ['activate_workflow_scope', {
    on_success: [
      'The requested tool family is now available.',
      'Use get_tool_help for detailed usage of newly available tools.',
    ],
    on_error: [
      'Check available scope names: widget_authoring, material_authoring, blueprint_authoring, schema_ai_authoring, animation_authoring, data_tables, import, automation_testing, verification.',
    ],
  }],

  ['find_and_extract', {
    on_success: [
      'Use the corresponding modify tool to make changes.',
      'Use extract_cascade for dependency analysis.',
    ],
    on_error: [
      'Broaden search criteria.',
      'Use search_assets and extract separately for more control.',
    ],
  }],

  // =========================================================================
  // Project control tools
  // =========================================================================

  ['wait_for_editor', {
    on_success: [
      'Editor is connected. Proceed with the blocked tool call.',
      'Use get_project_automation_context for project details.',
    ],
    on_error: [
      'Retry wait_for_editor if the editor is still starting.',
      'Use restart_editor to relaunch a crashed editor.',
    ],
  }],

  ['compile_project_code', {
    on_success: [
      'Review compile diagnostics for warnings.',
      'Use trigger_live_coding for faster iterative recompiles.',
    ],
    on_error: [
      'Fix reported compile errors in C++ source.',
      'Use sync_project_code to refresh project files first.',
    ],
  }],

  ['restart_editor', {
    on_success: [
      'Use wait_for_editor to confirm the editor is back online.',
    ],
    on_error: [
      'Check for processes blocking the restart.',
      'Verify engine installation with get_project_automation_context.',
    ],
  }],

  ['sync_project_code', {
    on_success: [
      'Use compile_project_code to rebuild after syncing.',
      'Use trigger_live_coding for a hot-reload instead.',
    ],
    on_error: [
      'Verify project paths with get_project_automation_context.',
      'Check editor connection with wait_for_editor.',
    ],
  }],

  ['trigger_live_coding', {
    on_success: [
      'Live coding patch applied. Verify behavior in the editor.',
      'Use extract_blueprint to confirm updated logic.',
    ],
    on_error: [
      'Use compile_project_code for a full rebuild instead.',
      'Check editor connection with wait_for_editor.',
    ],
    scope_suggestion: 'blueprint_authoring',
  }],

  ['get_project_automation_context', {
    on_success: [
      'Use the returned paths to configure project-level operations.',
      'Use compile_project_code or run_automation_tests next.',
    ],
    on_error: [
      'Check editor connection with wait_for_editor.',
    ],
  }],

  // =========================================================================
  // Widget extraction tools
  // =========================================================================

  ['extract_widget_blueprint', extractionHints('extract_widget_blueprint', {
    on_success: [
      'Use patch_widget or replace_widget_tree to modify the widget.',
      'Use compile_widget_blueprint to check for errors.',
      'Use capture_widget_preview for visual verification.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['extract_widget_animation', extractionHints('extract_widget_animation', {
    on_success: [
      'Use modify_widget_animation to edit tracks.',
      'Use capture_widget_motion_checkpoints to verify animation visually.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['extract_commonui_button_style', extractionHints('extract_commonui_button_style', {
    on_success: [
      'Use modify_commonui_button_style to edit the style.',
      'Use apply_commonui_button_style to apply it to buttons.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  // =========================================================================
  // Widget structure tools
  // =========================================================================

  ['create_widget_blueprint', creationHints(
    'extract_widget_blueprint', 'build_widget_tree', {
      on_success: [
        'Use build_widget_tree to populate the widget tree.',
        'Use extract_widget_blueprint to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'widget_authoring',
    },
  )],

  ['build_widget_tree', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use compile_widget_blueprint to verify the tree compiles.',
      'Use extract_widget_blueprint to inspect the result.',
      'Use save_assets to persist.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['replace_widget_tree', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use compile_widget_blueprint to verify the new tree.',
      'Use extract_widget_blueprint to inspect the result.',
      'Use save_assets to persist.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['patch_widget', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_widget_blueprint to verify the patch.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['patch_widget_class_defaults', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_widget_blueprint to verify class defaults.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['insert_widget_child', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_widget_blueprint to verify the insertion.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['remove_widget', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_widget_blueprint to verify the removal.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['move_widget', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_widget_blueprint to verify the new position.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['wrap_widget', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_widget_blueprint to verify the wrapper.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['replace_widget_class', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use compile_widget_blueprint to verify the class change.',
      'Use extract_widget_blueprint to inspect the result.',
      'Use save_assets to persist.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['batch_widget_operations', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use compile_widget_blueprint to verify the batch result.',
      'Use extract_widget_blueprint to inspect changes.',
      'Use save_assets to persist.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['compile_widget', {
    on_success: [
      'Review compile messages for warnings.',
      'Use save_assets to persist if no errors.',
      'Use capture_widget_preview for visual verification.',
    ],
    on_error: [
      'Use extract_widget_blueprint to inspect the widget state.',
      'Fix reported issues and recompile.',
    ],
    scope_suggestion: 'widget_authoring',
  }],

  ['modify_widget_blueprint', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use operation-specific tools (patch_widget, replace_widget_tree, etc.) instead.',
      'Use save_assets to persist changes.',
    ],
    on_error: [
      'Use extract_widget_blueprint to inspect current state.',
      'Consider using operation-specific tools for clearer errors.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['modify_widget', modificationHints('extract_widget_blueprint', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_widget_blueprint to verify.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  ['compile_widget_blueprint', {
    on_success: [
      'Inspect compile.messages and diagnostics for warnings.',
      'Re-extract the widget blueprint before applying the next patch.',
      'Check BindWidget names/types if there are abstract class references.',
    ],
    on_error: [
      'Use extract_widget_blueprint to inspect the current state.',
      'Fix reported issues and recompile.',
    ],
    scope_suggestion: 'widget_authoring',
  }],

  // =========================================================================
  // Widget verification tools
  // =========================================================================

  ['capture_widget_preview', verificationHints({
    on_success: [
      'Use compare_capture_to_reference to diff against a baseline.',
      'Use list_captures to review stored captures.',
    ],
  })],

  ['capture_widget_motion_checkpoints', verificationHints({
    on_success: [
      'Use compare_motion_capture_bundle to diff against a baseline.',
      'Use list_captures to review stored captures.',
    ],
  })],

  ['compare_capture_to_reference', verificationHints({
    on_success: [
      'Review the diff results to identify visual regressions.',
      'Use capture_widget_preview to take a fresh capture if needed.',
    ],
    on_error: [
      'Ensure both capture and reference exist with list_captures.',
      'Recapture with capture_widget_preview.',
    ],
  })],

  ['list_captures', verificationHints({
    on_success: [
      'Use compare_capture_to_reference to diff specific captures.',
      'Use cleanup_captures to remove stale entries.',
    ],
    on_error: [
      'Check editor connection with wait_for_editor.',
    ],
  })],

  ['cleanup_captures', verificationHints({
    on_success: [
      'Stale captures removed. Use capture_widget_preview for fresh captures.',
    ],
    on_error: [
      'Check editor connection with wait_for_editor.',
    ],
  })],

  ['compare_motion_capture_bundle', verificationHints({
    on_success: [
      'Review per-checkpoint diffs to identify animation regressions.',
      'Recapture with capture_widget_motion_checkpoints if needed.',
    ],
    on_error: [
      'Ensure both bundles exist with list_captures.',
      'Recapture with capture_widget_motion_checkpoints.',
    ],
  })],

  // =========================================================================
  // CommonUI tools
  // =========================================================================

  ['create_commonui_button_style', creationHints(
    'extract_commonui_button_style', 'modify_commonui_button_style', {
      scope_suggestion: 'widget_authoring',
    },
  )],

  ['modify_commonui_button_style', modificationHints('extract_commonui_button_style', {
    scope_suggestion: 'widget_authoring',
  })],

  ['apply_commonui_button_style', {
    on_success: [
      'Use extract_widget_blueprint to verify the style was applied.',
      'Use compile_widget_blueprint to verify compilation.',
      'Use save_assets to persist.',
    ],
    on_error: [
      'Use extract_commonui_button_style to verify the style asset.',
      'Ensure the target widget exists with extract_widget_blueprint.',
    ],
    scope_suggestion: 'widget_authoring',
  }],

  // =========================================================================
  // Widget animation tools
  // =========================================================================

  ['create_widget_animation', creationHints(
    'extract_widget_animation', 'modify_widget_animation', {
      scope_suggestion: 'widget_authoring',
    },
  )],

  ['modify_widget_animation', modificationHints('extract_widget_animation', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_widget_animation to verify.',
      'Use capture_widget_motion_checkpoints to preview.',
    ],
    scope_suggestion: 'widget_authoring',
  })],

  // =========================================================================
  // Window UI tools
  // =========================================================================

  ['apply_window_ui_changes', {
    on_success: [
      'Use extract_widget_blueprint to verify the window state.',
      'Use save_assets to persist changes.',
    ],
    on_error: [
      'Use extract_widget_blueprint to inspect the current window layout.',
      'Check editor connection with wait_for_editor.',
    ],
    scope_suggestion: 'widget_authoring',
  }],

  // =========================================================================
  // Material authoring tools
  // =========================================================================

  ['create_material', {
    on_success: [
      'Use material_graph_operation to add nodes.',
      'Use extract_material to verify.',
      'Use save_assets to persist.',
    ],
    on_error: [
      'Check if material already exists with search_assets.',
      'Verify the parent path with list_assets.',
    ],
    scope_suggestion: 'material_authoring',
  }],

  ['material_graph_operation', {
    on_success: [
      'Use extract_material to verify the graph state.',
      'Use compile_material_asset to check shader compilation.',
      'Use save_assets to persist.',
    ],
    on_error: [
      'Use extract_material to inspect the current graph.',
      'Use get_tool_help material_graph_operation for operation-specific guidance.',
    ],
    scope_suggestion: 'material_authoring',
  }],

  ['modify_material', {
    on_success: [
      'Use extract_material to verify.',
      'Use compile_material_asset to check shader compilation.',
      'Use save_assets to persist.',
    ],
    on_error: [
      'Use extract_material to inspect the current state.',
      'Use validate_only=true first to preview failures.',
    ],
    scope_suggestion: 'material_authoring',
  }],

  ['compile_material_asset', {
    on_success: [
      'Material compiled successfully. Use save_assets to persist.',
      'Use extract_material to inspect the final state.',
    ],
    on_error: [
      'Use extract_material to inspect expression wiring.',
      'Fix reported shader errors and recompile.',
    ],
    scope_suggestion: 'material_authoring',
  }],

  // =========================================================================
  // Material instance tools
  // =========================================================================

  ['create_material_instance', creationHints(
    'extract_asset', 'modify_material_instance', {
      on_success: [
        'Use modify_material_instance to set parameter overrides.',
        'Use extract_asset with asset_type=material_instance to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'material_authoring',
    },
  )],

  ['modify_material_instance', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=material_instance to verify.',
    ],
    on_error: [
      'Use extract_asset with asset_type=material_instance to inspect current state.',
      'Use validate_only=true first to preview failures.',
    ],
    scope_suggestion: 'material_authoring',
  })],

  // =========================================================================
  // Blueprint authoring tools
  // =========================================================================

  ['create_blueprint', creationHints(
    'extract_blueprint', 'modify_blueprint_members', {
      scope_suggestion: 'blueprint_authoring',
    },
  )],

  ['modify_blueprint_members', modificationHints('extract_blueprint', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_blueprint to verify members.',
      'Use modify_blueprint_graphs to edit function logic.',
    ],
    scope_suggestion: 'blueprint_authoring',
  })],

  ['modify_blueprint_graphs', modificationHints('extract_blueprint', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_blueprint with scope=Full and graph_filter to verify graphs.',
    ],
    scope_suggestion: 'blueprint_authoring',
  })],

  // =========================================================================
  // Schema / AI authoring tools
  // =========================================================================

  ['create_user_defined_struct', creationHints(
    'extract_asset', 'modify_user_defined_struct', {
      on_success: [
        'Use modify_user_defined_struct to add fields.',
        'Use extract_asset with asset_type=user_defined_struct to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'schema_ai_authoring',
    },
  )],

  ['modify_user_defined_struct', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=user_defined_struct to verify.',
    ],
    scope_suggestion: 'schema_ai_authoring',
  })],

  ['create_user_defined_enum', creationHints(
    'extract_asset', 'modify_user_defined_enum', {
      on_success: [
        'Use modify_user_defined_enum to edit entries.',
        'Use extract_asset with asset_type=user_defined_enum to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'schema_ai_authoring',
    },
  )],

  ['modify_user_defined_enum', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=user_defined_enum to verify.',
    ],
    scope_suggestion: 'schema_ai_authoring',
  })],

  ['create_blackboard', creationHints(
    'extract_asset', 'modify_blackboard', {
      on_success: [
        'Use modify_blackboard to add keys.',
        'Use extract_asset with asset_type=blackboard to verify.',
        'Use create_behavior_tree to use this blackboard.',
      ],
      scope_suggestion: 'schema_ai_authoring',
    },
  )],

  ['modify_blackboard', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=blackboard to verify.',
    ],
    scope_suggestion: 'schema_ai_authoring',
  })],

  ['create_behavior_tree', creationHints(
    'extract_asset', 'modify_behavior_tree', {
      on_success: [
        'Use modify_behavior_tree to add nodes and tasks.',
        'Use extract_asset with asset_type=behavior_tree to verify.',
        'Use create_blackboard to create an associated blackboard.',
      ],
      scope_suggestion: 'schema_ai_authoring',
    },
  )],

  ['modify_behavior_tree', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=behavior_tree to verify.',
    ],
    scope_suggestion: 'schema_ai_authoring',
  })],

  ['create_state_tree', creationHints(
    'extract_asset', 'modify_state_tree', {
      on_success: [
        'Use modify_state_tree to configure states and transitions.',
        'Use extract_asset with asset_type=statetree to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'schema_ai_authoring',
    },
  )],

  ['modify_state_tree', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=statetree to verify.',
    ],
    scope_suggestion: 'schema_ai_authoring',
  })],

  // =========================================================================
  // Animation authoring tools
  // =========================================================================

  ['create_anim_sequence', creationHints(
    'extract_asset', 'modify_anim_sequence', {
      on_success: [
        'Use modify_anim_sequence to edit curves and notifies.',
        'Use extract_asset with asset_type=anim_sequence to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'animation_authoring',
    },
  )],

  ['modify_anim_sequence', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=anim_sequence to verify.',
    ],
    scope_suggestion: 'animation_authoring',
  })],

  ['create_anim_montage', creationHints(
    'extract_asset', 'modify_anim_montage', {
      on_success: [
        'Use modify_anim_montage to add sections and notifies.',
        'Use extract_asset with asset_type=anim_montage to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'animation_authoring',
    },
  )],

  ['modify_anim_montage', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=anim_montage to verify.',
    ],
    scope_suggestion: 'animation_authoring',
  })],

  ['create_blend_space', creationHints(
    'extract_asset', 'modify_blend_space', {
      on_success: [
        'Use modify_blend_space to add sample points.',
        'Use extract_asset with asset_type=blend_space to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'animation_authoring',
    },
  )],

  ['modify_blend_space', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=blend_space to verify.',
    ],
    scope_suggestion: 'animation_authoring',
  })],

  // =========================================================================
  // Data / Input tools
  // =========================================================================

  ['create_data_asset', creationHints(
    'extract_asset', 'modify_data_asset', {
      on_success: [
        'Use modify_data_asset to set properties.',
        'Use extract_asset with asset_type=data_asset to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'data_tables',
    },
  )],

  ['modify_data_asset', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=data_asset to verify.',
    ],
    scope_suggestion: 'data_tables',
  })],

  ['create_input_action', creationHints(
    'extract_asset', 'modify_input_action', {
      on_success: [
        'Use modify_input_action to configure triggers and modifiers.',
        'Use create_input_mapping_context to bind the action.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'data_tables',
    },
  )],

  ['modify_input_action', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Update the input mapping context with modify_input_mapping_context.',
    ],
    scope_suggestion: 'data_tables',
  })],

  ['create_input_mapping_context', creationHints(
    'extract_asset', 'modify_input_mapping_context', {
      on_success: [
        'Use modify_input_mapping_context to add action mappings.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'data_tables',
    },
  )],

  ['modify_input_mapping_context', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Verify input actions are correctly bound.',
    ],
    scope_suggestion: 'data_tables',
  })],

  // =========================================================================
  // Tables / Curves tools
  // =========================================================================

  ['create_data_table', creationHints(
    'extract_asset', 'modify_data_table', {
      on_success: [
        'Use modify_data_table to add rows.',
        'Use extract_asset with asset_type=data_table to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'data_tables',
    },
  )],

  ['modify_data_table', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=data_table to verify rows.',
    ],
    scope_suggestion: 'data_tables',
  })],

  ['create_curve', creationHints(
    'extract_asset', 'modify_curve', {
      on_success: [
        'Use modify_curve to edit curve keys.',
        'Use extract_asset with asset_type=curve to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'data_tables',
    },
  )],

  ['modify_curve', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=curve to verify.',
    ],
    scope_suggestion: 'data_tables',
  })],

  ['create_curve_table', creationHints(
    'extract_asset', 'modify_curve_table', {
      on_success: [
        'Use modify_curve_table to add rows.',
        'Use extract_asset with asset_type=curve_table to verify.',
        'Use save_assets to persist.',
      ],
      scope_suggestion: 'data_tables',
    },
  )],

  ['modify_curve_table', modificationHints('extract_asset', {
    on_success: [
      'Use save_assets to persist changes.',
      'Use extract_asset with asset_type=curve_table to verify.',
    ],
    scope_suggestion: 'data_tables',
  })],

  // =========================================================================
  // Import tools
  // =========================================================================

  ['import_assets', {
    on_success: [
      'Use get_import_job to poll the import status.',
      'Use extract_asset to verify the imported asset.',
    ],
    on_error: [
      'Verify source file paths exist.',
      'Check editor connection with wait_for_editor.',
    ],
    scope_suggestion: 'import',
  }],

  ['get_import_job', listingHints('extract_asset', {
    on_success: [
      'If completed, use extract_asset to inspect the imported asset.',
      'If still running, poll again after a short delay.',
    ],
    on_error: [
      'Verify the job ID with list_import_jobs.',
      'Check editor connection with wait_for_editor.',
    ],
    scope_suggestion: 'import',
  })],

  ['list_import_jobs', listingHints('get_import_job', {
    on_success: [
      'Use get_import_job on a specific job for details.',
      'Use import_assets to start a new import.',
    ],
    scope_suggestion: 'import',
  })],

  // =========================================================================
  // Automation testing tools
  // =========================================================================

  ['run_automation_tests', {
    on_success: [
      'Use get_automation_test_run to poll for results.',
      'Use list_automation_test_runs to review past runs.',
    ],
    on_error: [
      'Check editor connection with wait_for_editor.',
      'Use get_project_automation_context to verify project setup.',
    ],
    scope_suggestion: 'automation_testing',
  }],

  ['get_automation_test_run', listingHints('run_automation_tests', {
    on_success: [
      'Review test results and failures.',
      'If still running, poll again after a short delay.',
    ],
    on_error: [
      'Verify the run ID with list_automation_test_runs.',
      'Check editor connection with wait_for_editor.',
    ],
    scope_suggestion: 'automation_testing',
  })],

  ['list_automation_test_runs', listingHints('get_automation_test_run', {
    on_success: [
      'Use get_automation_test_run for detailed results.',
      'Use run_automation_tests to start a new test run.',
    ],
    scope_suggestion: 'automation_testing',
  })],
]);
