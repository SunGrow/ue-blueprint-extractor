import { designSpecSchemaExample } from '../prompts/prompt-catalog.js';

export type ToolExample = {
  title: string;
  tool: string;
  arguments: Record<string, unknown>;
  context?: Record<string, unknown>;
  expectedSuccess?: boolean;
};

export type ExampleFamily = {
  summary: string;
  recommended_flow: string[];
  examples: ToolExample[];
};

export const exampleCatalog: Record<string, ExampleFamily> = {
  widget_blueprint: {
    summary: 'Inspect the current widget, apply the smallest structural change that solves the layout problem, compile, visually confirm the rendered result, then save.',
    recommended_flow: [
      'extract_widget_blueprint',
      'modify_widget_blueprint',
      'compile_widget_blueprint',
      'capture_widget_preview',
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
  reference_menu_screen: {
    summary: 'Normalize multimodal design inputs into a shared design_spec_json, author reusable foundation assets first, then assemble and verify the menu through capture plus compare when references exist.',
    recommended_flow: [
      'normalize_ui_design_input',
      'design_menu_from_design_spec',
      'extract_widget_blueprint',
      'import_textures',
      'create_material_instance',
      'modify_widget_blueprint',
      'compile_widget_blueprint',
      'capture_widget_preview',
      'compare_capture_to_reference',
      'save_assets',
    ],
    examples: [
      {
        title: 'text_image_menu_screen',
        tool: 'modify_widget_blueprint',
        arguments: {
          asset_path: '/Game/UI/Screens/WBP_MainMenu',
          operation: 'patch_widget',
          widget_path: 'WindowRoot/TitleBar/TitleText',
          properties: { Text: 'Campaign' },
          compile_after: true,
        },
        context: {
          input_modality: 'text+image',
          design_spec_json: {
            layout: designSpecSchemaExample.layout,
            visual_tokens: designSpecSchemaExample.visual_tokens,
            components: designSpecSchemaExample.components,
          },
        },
      },
      {
        title: 'png_figma_menu_screen',
        tool: 'create_material_instance',
        arguments: {
          asset_path: '/Game/UI/Foundation/MaterialInstances/MI_MenuPrimaryButton',
          parent_material_path: '/Game/UI/Foundation/Materials/M_MenuPrimaryButton',
        },
        context: {
          input_modality: 'png/figma',
          design_spec_json: {
            visual_tokens: designSpecSchemaExample.visual_tokens,
            verification: designSpecSchemaExample.verification,
          },
        },
      },
      {
        title: 'html_css_menu_screen',
        tool: 'apply_commonui_button_style',
        arguments: {
          asset_path: '/Game/UI/Screens/WBP_MainMenu',
          style_asset_path: '/Game/UI/Foundation/Styles/BP_MenuPrimaryButtonStyle.BP_MenuPrimaryButtonStyle_C',
        },
        context: {
          input_modality: 'html/css',
          rendered_reference_frames: [
            'C:/Refs/main-menu-open.png',
            'C:/Refs/main-menu-focused.png',
          ],
          design_spec_json: {
            layout: {
              pattern: 'common_menu_shell',
            },
            components: {
              button: designSpecSchemaExample.components.button,
            },
            verification: designSpecSchemaExample.verification,
          },
        },
      },
      {
        title: 'state_motion_menu_screen',
        tool: 'modify_widget_animation',
        arguments: {
          asset_path: '/Game/UI/Screens/WBP_MainMenu',
          animation_name: 'PrimaryActionStates',
          operation: 'replace_timeline',
          payload: {
            timeline: {
              duration_ms: 180,
              fps: 20,
              tracks: [
                {
                  widget_path: 'WindowRoot/PrimaryActionButton',
                  property: 'render_opacity',
                  keys: [
                    { time_ms: 0, value: 0.82 },
                    { time_ms: 90, value: 1.0 },
                    { time_ms: 180, value: 0.94 },
                  ],
                },
              ],
            },
          },
        },
        context: {
          motion_mode: 'state_motion',
          verification_step: 'After compile, run capture_widget_motion_checkpoints in editor_preview mode and compare the open and focused checkpoints.',
          design_spec_json: {
            motion: {
              state_motion: designSpecSchemaExample.motion.state_motion,
              checkpoints: ['open', 'focused', 'pressed'],
            },
            verification: {
              required_checkpoints: ['open', 'focused'],
              compare_reference_paths: ['C:/Refs/menu-open.png', 'C:/Refs/menu-focused.png'],
            },
          },
        },
      },
      {
        title: 'cinematic_menu_motion',
        tool: 'modify_widget_animation',
        arguments: {
          asset_path: '/Game/UI/Screens/WBP_MainMenu',
          animation_name: 'MenuIntro',
          operation: 'replace_timeline',
          payload: {
            timeline: {
              duration_ms: 420,
              fps: 20,
              tracks: [
                {
                  widget_path: 'WindowRoot/Backdrop',
                  property: 'render_opacity',
                  keys: [
                    { time_ms: 0, value: 0.2 },
                    { time_ms: 210, value: 0.55 },
                    { time_ms: 420, value: 0.85 },
                  ],
                },
                {
                  widget_path: 'WindowRoot/Backdrop',
                  property: 'render_transform_scale',
                  keys: [
                    { time_ms: 0, value: { x: 1.04, y: 1.04 } },
                    { time_ms: 420, value: { x: 1.0, y: 1.0 } },
                  ],
                },
              ],
            },
          },
        },
        context: {
          motion_mode: 'cinematic_motion',
          expected_outcome: 'Fully planned when the motion stays inside the supported track subset; otherwise return a structured partial implementation boundary.',
          verification_step: 'Capture the opening_peak and open checkpoints; only compare them if rendered reference frames exist.',
          design_spec_json: {
            motion: {
              cinematic_motion: designSpecSchemaExample.motion.cinematic_motion,
              checkpoints: ['opening_peak', 'open'],
            },
          },
        },
      },
    ],
  },
  widget_motion: {
    summary: 'Author widget motion through the dedicated animation tools, then verify the result as a keyframe bundle instead of stopping at compile or relying on video capture.',
    recommended_flow: [
      'extract_widget_animation',
      'create_widget_animation',
      'modify_widget_animation',
      'capture_widget_motion_checkpoints',
      'compare_motion_capture_bundle',
      'save_assets',
    ],
    examples: [
      {
        title: 'menu_shell_state_motion',
        tool: 'create_widget_animation',
        arguments: {
          asset_path: '/Game/UI/Screens/WBP_MainMenu',
          animation_name: 'OpenSequence',
          payload: {
            display_label: 'OpenSequence',
            duration_ms: 260,
            fps: 20,
            checkpoints: [
              { name: 'closed', timeMs: 0 },
              { name: 'opening_peak', timeMs: 120 },
              { name: 'open', timeMs: 260 },
            ],
            timeline: {
              tracks: [
                {
                  widget_path: 'WindowRoot/MainPanel',
                  property: 'render_opacity',
                  keys: [
                    { time_ms: 0, value: 0, interpolation: 'linear' },
                    { time_ms: 260, value: 1, interpolation: 'cubic' },
                  ],
                },
                {
                  widget_path: 'WindowRoot/MainPanel',
                  property: 'render_transform_translation',
                  keys: [
                    { time_ms: 0, value: { x: 0, y: 18 } },
                    { time_ms: 260, value: { x: 0, y: 0 } },
                  ],
                },
              ],
            },
          },
        },
        context: {
          scope: 'menu_shell',
          verification: 'Follow with capture_widget_motion_checkpoints in editor_preview mode.',
        },
      },
      {
        title: 'hud_runtime_motion',
        tool: 'capture_widget_motion_checkpoints',
        arguments: {
          mode: 'automation_scenario',
          automation_filter: 'Project.UI.HUD.Motion',
          engine_root: 'C:/Program Files/Epic Games/UE_5.7',
          project_path: 'C:/Projects/MyGame/MyGame.uproject',
          target: 'MyGameEditor',
          compare_reference_paths: ['C:/Refs/hud-open.png', 'C:/Refs/hud-focused.png'],
          checkpoints: [
            { name: 'open' },
            { name: 'focused' },
          ],
          null_rhi: false,
        },
        context: {
          scope: 'hud_runtime',
          expectation: 'Use automation-backed playback and return a keyframe bundle when the test exports checkpoint artifacts.',
        },
      },
      {
        title: 'cinematic_supported_motion',
        tool: 'modify_widget_animation',
        arguments: {
          asset_path: '/Game/UI/Screens/WBP_MainMenu',
          animation_name: 'OpenSequence',
          operation: 'replace_timeline',
          payload: {
            timeline: {
              duration_ms: 420,
              fps: 20,
              tracks: [
                {
                  widget_path: 'WindowRoot/Backdrop',
                  property: 'render_opacity',
                  keys: [
                    { time_ms: 0, value: 0.35 },
                    { time_ms: 420, value: 0.85 },
                  ],
                },
                {
                  widget_path: 'WindowRoot/TitleBar',
                  property: 'render_transform_scale',
                  keys: [
                    { time_ms: 0, value: { x: 0.94, y: 0.94 } },
                    { time_ms: 420, value: { x: 1.0, y: 1.0 } },
                  ],
                },
              ],
            },
          },
        },
        context: {
          scope: 'cinematic_motion_supported_subset',
        },
      },
      {
        title: 'unsupported_track_request',
        tool: 'modify_widget_animation',
        arguments: {
          asset_path: '/Game/UI/Screens/WBP_MainMenu',
          animation_name: 'OpenSequence',
          operation: 'replace_timeline',
          validate_only: true,
          payload: {
            timeline: {
              tracks: [
                {
                  widget_path: 'WindowRoot/MainPanel',
                  property: 'render_transform_shear',
                  keys: [
                    { time_ms: 0, value: { x: 0, y: 0 } },
                    { time_ms: 180, value: { x: 8, y: 0 } },
                  ],
                },
              ],
            },
          },
        },
        expectedSuccess: false,
        context: {
          expectation: 'This should return a structured unsupported / deferred boundary rather than silently synthesizing the track.',
        },
      },
    ],
  },
  material: {
    summary: 'Use material_graph_operation first for single-step material graph edits. It routes into the same graph operations without exposing the full batch DSL.',
    recommended_flow: [
      'create_material',
      'material_graph_operation',
      'extract_material',
      'save_assets',
    ],
    examples: [
      {
        title: 'set_opaque_defaults',
        tool: 'material_graph_operation',
        arguments: {
          asset_path: '/Game/Materials/M_ButtonBase',
          operation: 'set_material_settings',
          settings: {
            blend_mode: 'BLEND_Opaque',
            two_sided: false,
          },
        },
      },
      {
        title: 'add_albedo_sampler',
        tool: 'material_graph_operation',
        arguments: {
          asset_path: '/Game/Materials/M_ButtonBase',
          operation: 'add_expression',
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
        tool: 'material_graph_operation',
        arguments: {
          asset_path: '/Game/Materials/M_ButtonBase',
          operation: 'connect_material_property',
          from_temp_id: 'AlbedoSample',
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
    summary: 'Use the thin sequencing helper when a screen change touches variable flags, class defaults, compile, and optional code sync in one flow, then gate persistence on visual confirmation.',
    recommended_flow: [
      'extract_widget_blueprint',
      'apply_window_ui_changes',
      'capture_widget_preview',
      'save_assets',
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
          save_after: false,
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
  state_tree_bindings: {
    summary: 'Wire task outputs to task inputs using property path bindings. Extract an existing StateTree to discover structIds and property names, then use binding operations to set up data flow.',
    recommended_flow: [
      'extract_asset (discover structIds and property names)',
      'modify_state_tree (add_binding / set_bindings)',
      'extract_asset (verify bindings)',
      'save_assets',
    ],
    examples: [
      {
        title: 'add_single_binding',
        tool: 'modify_state_tree',
        arguments: {
          asset_path: '/Game/AI/ST_Character',
          operation: 'add_binding',
          payload: {
            sourcePath: {
              structId: 'EAB9611F4B07D7E2C25A948AFC790A50',
              segments: [{ name: 'SelectedGestureTag' }],
            },
            targetPath: {
              structId: 'F2A3B44C4D08E6A1C25A948AFC790A50',
              segments: [{ name: 'MontageTag' }],
            },
          },
        },
        context: { description: 'Wire SelectRandomGesture output → PlayMontage input. structIds from extract_asset output.' },
      },
      {
        title: 'set_all_bindings',
        tool: 'modify_state_tree',
        arguments: {
          asset_path: '/Game/AI/ST_Character',
          operation: 'set_bindings',
          payload: {
            propertyBindings: [
              {
                sourcePath: { segments: [{ name: 'SelectedTag' }] },
                targetPath: { segments: [{ name: 'MontageTag' }] },
              },
              {
                sourcePath: { segments: [{ name: 'Duration' }] },
                targetPath: { segments: [{ name: 'WaitTime' }] },
              },
            ],
          },
        },
        context: { description: 'Replace all bindings on the StateTree with a new set.' },
      },
      {
        title: 'remove_binding_by_target',
        tool: 'modify_state_tree',
        arguments: {
          asset_path: '/Game/AI/ST_Character',
          operation: 'remove_binding',
          payload: {
            targetPath: { segments: [{ name: 'MontageTag' }] },
          },
        },
        context: { description: 'Remove all bindings targeting the MontageTag property.' },
      },
      {
        title: 'create_with_bindings',
        tool: 'create_state_tree',
        arguments: {
          asset_path: '/Game/AI/ST_NewWithBindings',
          payload: {
            schema: '/Script/GameplayStateTreeModule.StateTreeComponentSchema',
            states: [{
              name: 'Root',
              type: 'State',
              tasks: [
                { nodeStructType: '/Script/MyMod.STCSelectGesture', name: 'SelectGesture' },
                { nodeStructType: '/Script/MyMod.STCPlayMontage', name: 'PlayMontage' },
              ],
            }],
            bindings: {
              propertyBindings: [{
                sourcePath: 'SelectedGestureTag',
                targetPath: 'MontageTag',
              }],
            },
          },
        },
        context: { description: 'Create a StateTree with tasks and bindings in a single call.' },
      },
    ],
  },
};
