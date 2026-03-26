import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  formatPromptBlock,
  formatPromptList,
} from '../helpers/formatting.js';

export type PromptCatalogEntry = {
  title: string;
  description: string;
  args: Record<string, z.ZodTypeAny>;
  buildPrompt: (args: Record<string, unknown>) => string;
};

const stringOrStringArrayPromptArg = z.union([z.string(), z.array(z.string())]);
const designSpecPromptArg = z.union([z.string(), z.record(z.string(), z.unknown())]);

export const designSpecSchemaExample = {
  layout: {
    pattern: 'common_menu_shell',
    hierarchy_intent: 'Header, primary actions, and a supporting detail panel.',
    shell_type: 'CommonActivatableWidget',
    density: 'comfortable',
    safe_area_assumptions: {
      platform: 'desktop',
      policy: 'centered',
    },
  },
  visual_tokens: {
    palette: {
      surface: '#10141c',
      accent: '#f3a347',
      text_primary: '#f5f7fb',
      text_muted: '#b8c1cc',
    },
    typography_scale: {
      title: 28,
      button: 16,
      body: 14,
      caption: 11,
    },
    spacing: {
      xs: 4,
      sm: 8,
      md: 12,
      lg: 20,
      xl: 32,
    },
    radius: {
      button: 12,
      panel: 20,
    },
    stroke: {
      panel: 1,
      focus: 2,
    },
    shadow_glow: {
      panel_glow: 'soft amber outer glow',
      focus_glow: 'tight white rim light',
    },
    texture_refs: [
      '/Game/UI/Refs/T_MenuNoise.T_MenuNoise',
    ],
  },
  components: {
    button: {
      base: 'material_button_base',
      states: ['default', 'hovered', 'pressed', 'focused', 'disabled'],
    },
    panel: {
      base: 'bordered_panel',
      emphasis: 'soft glow',
    },
    card: {
      base: 'list_detail_card',
    },
    list_item: {
      base: 'menu_list_item',
    },
    title_bar: {
      base: 'window_title_bar',
    },
    modal_shell: {
      base: 'activatable_window',
    },
  },
  motion: {
    state_motion: {
      hover: 'Scale up slightly and lift glow intensity.',
      pressed: 'Brief downward nudge with faster fade.',
      focused: 'Outline pulse and accent rim.',
      open_close: 'Fade and slide the main panel.',
    },
    cinematic_motion: {
      intro: 'Backdrop bloom, title drift, and staggered button reveal.',
      outro: 'Panel fade, logo settle, and backdrop release.',
    },
    transitions: [
      {
        from: 'closed',
        to: 'open',
        duration_ms: 240,
        easing: 'ease_out_cubic',
      },
    ],
    checkpoints: ['closed', 'opening_peak', 'open', 'focused', 'pressed'],
    triggers: {
      open: 'asset_animation',
      focused: 'asset_animation',
      pressed: 'scenario_trigger',
    },
    fallback_policy: 'Use create_widget_animation/modify_widget_animation for the supported property-track subset. Defer only unsupported track families or arbitrary timeline synthesis.',
  },
  verification: {
    compare_reference_paths: [
      'C:/Refs/menu-open.png',
      'C:/Refs/menu-focused.png',
    ],
    acceptable_deviation_notes: 'Minor glow intensity drift is acceptable if layout and silhouette still match.',
    required_checkpoints: ['open', 'focused'],
  },
};

export const promptCatalog: Record<string, PromptCatalogEntry> = {
  normalize_ui_design_input: {
    title: 'Normalize UI Design Input',
    description: 'Convert text, image, PNG/Figma, or HTML/CSS references into a shared design_spec_json for menu authoring.',
    args: {
      design_goal: z.string(),
      design_notes_text: z.string().optional(),
      reference_image_paths: stringOrStringArrayPromptArg.optional(),
      html_reference_paths: stringOrStringArrayPromptArg.optional(),
      design_spec_json: designSpecPromptArg.optional(),
    },
    buildPrompt: ({
      design_goal,
      design_notes_text,
      reference_image_paths,
      html_reference_paths,
      design_spec_json,
    }) => [
      'Normalize menu-design inputs into a single design_spec_json.',
      `Goal: ${design_goal}.`,
      typeof design_notes_text === 'string' && design_notes_text.trim().length > 0
        ? `Design notes:\n${design_notes_text}`
        : 'If the notes are sparse, derive only the minimum safe assumptions and mark them explicitly.',
      formatPromptList('Reference image paths', reference_image_paths, 'No reference image paths were supplied.'),
      formatPromptList('HTML/CSS reference paths', html_reference_paths, 'No HTML/CSS reference paths were supplied.'),
      formatPromptBlock('Existing design_spec_json', design_spec_json, 'If a partial design_spec_json is supplied, normalize and extend it instead of replacing it wholesale.'),
      'Return compact JSON that matches blueprint://design-spec-schema.',
      'Treat text+image and PNG/Figma references as first-class high-fidelity inputs.',
      'HTML/CSS references should reach near parity by extracting tokens, layout intent, and component recipes; when fidelity matters, prefer rendered reference frames over direct DOM-to-UMG translation.',
      'If only text is available, keep the output lower-confidence and record the missing references in verification notes.',
      'Populate layout, visual_tokens, components, motion when relevant, and verification when reference frames or checkpoint frames exist.',
      'Motion can include state_motion, cinematic_motion, checkpoints, triggers, and fallback_policy.',
      'For supported widget-property tracks, plan to use create_widget_animation, modify_widget_animation, capture_widget_motion_checkpoints, and compare_motion_capture_bundle.',
      'Only mark motion work deferred_to_future when it requires unsupported track families or broader arbitrary timeline synthesis beyond the current subset.',
    ].join('\n'),
  },
  design_menu_from_design_spec: {
    title: 'Design Menu From Design Spec',
    description: 'Plan a high-fidelity menu implementation from a normalized design_spec_json using only the existing authoring tools.',
    args: {
      widget_asset_path: z.string(),
      design_spec_json: designSpecPromptArg,
      parent_class_path: z.string().optional(),
      existing_hud_asset_path: z.string().optional(),
      existing_transition_asset_path: z.string().optional(),
      compare_reference_paths: stringOrStringArrayPromptArg.optional(),
    },
    buildPrompt: ({
      widget_asset_path,
      design_spec_json,
      parent_class_path,
      existing_hud_asset_path,
      existing_transition_asset_path,
      compare_reference_paths,
    }) => [
      `Plan a reference-driven WidgetBlueprint menu implementation for ${widget_asset_path}.`,
      formatPromptBlock('design_spec_json', design_spec_json, 'A design_spec_json is required for this prompt.'),
      parent_class_path ? `Expected parent class: ${parent_class_path}.` : 'Choose the narrowest appropriate parent widget class for a menu shell.',
      existing_hud_asset_path ? `Inspect the existing HUD first: ${existing_hud_asset_path}.` : 'Inspect the current HUD wiring before replacing the screen.',
      existing_transition_asset_path ? `Inspect the transition asset first: ${existing_transition_asset_path}.` : 'Inspect transition widgets and activatable-window flow before redesigning layout.',
      formatPromptList('Compare reference paths', compare_reference_paths, 'No compare reference paths were supplied. If the design spec includes checkpoint frames, use those instead.'),
      'Prefer foundation assets under /Game/UI/Foundation/Materials, /Game/UI/Foundation/MaterialInstances, /Game/UI/Foundation/Styles, and /Game/UI/Foundation/Widgets, and place the final screen under /Game/UI/Screens.',
      'Produce a decision-complete sequence that uses the existing tools only: inspect, import textures/fonts if needed, author material instances and styles, patch the widget tree, author or patch widget animations when needed, compile, capture checkpoints, compare when references exist, then save.',
      'Prefer CommonUI for shell, activation, and focus, and prefer material instances plus reusable components for visual fidelity instead of large one-off property blobs.',
      'For motion, use create_widget_animation and modify_widget_animation for render_opacity, render_transform translation/scale/angle, and color_and_opacity tracks. Defer only unsupported track families.',
      'Verification must use capture_widget_preview or capture_widget_motion_checkpoints for each required checkpoint and compare_capture_to_reference or compare_motion_capture_bundle whenever compare_reference_paths or checkpoint frames are available.',
      'If no visual references exist, finish with capture_widget_preview plus an explicit lower-confidence or partial verification note.',
      'Prefer centered_overlay, common_menu_shell, activatable_window, or list_detail patterns over ad-hoc CanvasPanel placement.',
    ].join('\n'),
  },
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
      'For high-fidelity multimodal work, normalize text, image, PNG/Figma, or HTML/CSS inputs through normalize_ui_design_input before authoring the menu plan.',
      'Produce a concrete widget-tree plan, required BindWidget names, class-default changes, and compile/capture/save steps.',
      'The plan is not complete until it includes capture_widget_preview or an explicit partial verification fallback with a blocking reason.',
      'Prefer centered_overlay, common_menu_shell, or activatable_window patterns over ad-hoc CanvasPanel placement.',
    ].join('\n'),
  },
  author_material_button_style: {
    title: 'Author Material Button Style',
    description: 'Plan a composable material authoring pass for a button style using the material authoring tools.',
    args: {
      asset_path: z.string(),
      visual_goal: z.string(),
      texture_asset_path: z.string().optional(),
      design_spec_json: designSpecPromptArg.optional(),
    },
    buildPrompt: ({ asset_path, visual_goal, texture_asset_path, design_spec_json }) => [
      `Author a button-style material at ${asset_path}.`,
      `Visual goal: ${visual_goal}.`,
      texture_asset_path ? `Use texture asset: ${texture_asset_path}.` : 'Only use engine-default texture assets if no project texture is available.',
      formatPromptBlock('design_spec_json', design_spec_json, 'If a design_spec_json exists, use it as the source of palette, typography, state, and motion cues for the button.'),
      'Prefer material_graph_operation for set_material_settings, add_expression, connect_expressions, and connect_material_property.',
      'Prefer material parameters and instances for hover, pressed, focused, and disabled states before escalating to widget animation timelines.',
      'Only fall back to modify_material if the smaller tools cannot express the required graph operation.',
    ].join('\n'),
  },
  author_widget_motion_from_design_spec: {
    title: 'Author Widget Motion From Design Spec',
    description: 'Turn a normalized motion spec into concrete widget animation authoring steps using the widget animation tools.',
    args: {
      widget_asset_path: z.string(),
      animation_name: z.string(),
      design_spec_json: designSpecPromptArg,
      compare_reference_paths: stringOrStringArrayPromptArg.optional(),
    },
    buildPrompt: ({ widget_asset_path, animation_name, design_spec_json, compare_reference_paths }) => [
      `Author widget motion for ${widget_asset_path} using animation '${animation_name}'.`,
      formatPromptBlock('design_spec_json', design_spec_json, 'A design_spec_json with motion data is required.'),
      formatPromptList('Compare reference paths', compare_reference_paths, 'No compare reference paths were supplied. Use checkpoint frames from the design spec if they exist.'),
      'Use create_widget_animation or modify_widget_animation instead of overloading widget tools. Use patch_widget for property changes and replace_widget_tree for full tree replacement.',
      'Supported track subset: render_opacity, render_transform_translation, render_transform_scale, render_transform_angle, color_and_opacity.',
      'Prefer widget_path selectors for bindings and tracks. Accept widget_name only as a compatibility fallback when unique.',
      'Use replace_timeline as the canonical write path. patch_metadata is only for display labels, checkpoints, playback metadata, and other non-track updates.',
      'If the requested motion exceeds the supported track subset, return a partial implementation / deferred_to_future boundary explicitly instead of synthesizing unsupported tracks.',
      'End with compile plus capture_widget_motion_checkpoints, then compare_motion_capture_bundle or compare_capture_to_reference for the required checkpoints.',
    ].join('\n'),
  },
  plan_widget_motion_verification: {
    title: 'Plan Widget Motion Verification',
    description: 'Plan keyframe-bundle verification for widget motion in editor preview or automation scenarios.',
    args: {
      widget_asset_path: z.string().optional(),
      animation_name: z.string().optional(),
      design_spec_json: designSpecPromptArg.optional(),
      automation_filter: z.string().optional(),
      compare_reference_paths: stringOrStringArrayPromptArg.optional(),
    },
    buildPrompt: ({ widget_asset_path, animation_name, design_spec_json, automation_filter, compare_reference_paths }) => [
      widget_asset_path
        ? `Plan motion verification for widget asset ${widget_asset_path}.`
        : 'Plan motion verification for a widget-driven UI flow.',
      animation_name ? `Animation focus: ${animation_name}.` : 'Infer the animation or scenario trigger from the supplied spec.',
      automation_filter ? `Automation scenario filter: ${automation_filter}.` : 'If this is HUD/runtime verification, identify the narrowest automation scenario required to drive it.',
      formatPromptBlock('design_spec_json', design_spec_json, 'If a motion-aware design_spec_json exists, use its checkpoints, triggers, and fallback policy.'),
      formatPromptList('Compare reference paths', compare_reference_paths, 'No explicit compare reference paths were supplied. Use checkpoint frames if available; otherwise report lower-confidence / partial verification.'),
      'Use editor_preview plus capture_widget_motion_checkpoints for menu/shell widgets whenever possible.',
      'Use automation_scenario plus run_automation_tests-backed playback for HUD/runtime verification. Do not imply that editor preview proves runtime behavior.',
      'Verification output must be a keyframe bundle, not video or GIF.',
      'The canonical checkpoints are closed, opening_peak, open, focused, and pressed unless the spec narrows or extends them.',
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
      'Return the smallest set of modify_blueprint_members or patch_widget_class_defaults calls needed to complete the wiring.',
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
      'Check for BindWidget type/name mismatches, abstract widget classes in the tree, stale class-default references, and degraded extraction states such as rootWidget=null with widgetTreeStatus/widgetTreeError.',
      'If the failure is tied to CommonUI button styling, treat raw UButton background/style fields as unsupported wrapper surfaces and redirect to extract_commonui_button_style, create_commonui_button_style, modify_commonui_button_style, or apply_commonui_button_style.',
      'If the patch touched WidthOverride, HeightOverride, MinDesiredHeight, or similar overrides, verify the paired bOverride_* flags are enabled before assuming the write failed.',
      'Return the minimal follow-up extract/modify/compile sequence needed to fix the compile state, then finish with capture_widget_preview or explicit partial verification if rendering is blocked.',
    ].join('\n'),
  },
};

export function registerPromptCatalog(
  server: Pick<McpServer, 'registerPrompt'>,
): void {
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
}
