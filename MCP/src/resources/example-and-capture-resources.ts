import { readFile } from 'node:fs/promises';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationControllerLike } from '../automation-controller.js';
import { exampleCatalog } from '../catalogs/example-catalog.js';
import { isRecord } from '../helpers/formatting.js';
import { normalizeVerificationArtifact } from '../helpers/verification.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterExampleAndCaptureResourcesOptions = {
  server: Pick<McpServer, 'resource' | 'registerResource'>;
  automationController: AutomationControllerLike;
  callSubsystemJson: JsonSubsystemCaller;
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
  material_button_base: [
    'Pattern: material_button_base',
    '',
    'Parent class:',
    '- Project-owned CommonButtonBase subclass or project-owned UserWidget wrapper',
    '',
    'Recommended hierarchy:',
    '- Overlay Root',
    '- Image or Border MaterialPlate',
    '- NamedSlot or Overlay Content',
    '- Optional SizeBox HitTarget',
    '',
    'Use this when the project wants button visuals driven by a material-backed plate instead of raw UButton style fields.',
    'Keep hover, pressed, and disabled visuals centralized in the material instance or style asset, then expose only the project-owned tuning knobs through class defaults.',
  ],
};

export function registerExampleAndCaptureResources({
  server,
  automationController,
  callSubsystemJson,
}: RegisterExampleAndCaptureResourcesOptions): void {
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
      description: 'Schema-backed example payloads and recommended flows for common authoring families.',
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
          ...(typeof example.expectedSuccess === 'boolean'
            ? [`expected success: ${example.expectedSuccess}`]
            : []),
          JSON.stringify(example.arguments, null, 2),
          ...(example.context ? [
            'context:',
            JSON.stringify(example.context, null, 2),
          ] : []),
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

  server.resource(
    'captures',
    new ResourceTemplate('blueprint://captures/{capture_id}', {
      list: undefined,
    }),
    {
      description: 'Read a visual verification capture PNG by capture id.',
      mimeType: 'image/png',
    },
    async (uri, variables) => {
      const captureId = String(variables.capture_id ?? '');
      const listed = await callSubsystemJson('ListCaptures', { AssetPathFilter: '' });
      const captures = Array.isArray(listed.captures)
        ? listed.captures.map((capture) => normalizeVerificationArtifact(capture))
        : [];
      const capture = captures.find((candidate) => (
        isRecord(candidate)
        && typeof candidate.captureId === 'string'
        && candidate.captureId === captureId
        && typeof candidate.artifactPath === 'string'
      ));

      if (!capture || typeof capture.artifactPath !== 'string') {
        throw new Error(`Capture '${captureId}' not found.`);
      }

      const data = await readFile(capture.artifactPath);
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'image/png',
          blob: data.toString('base64'),
        }],
      };
    },
  );

  server.resource(
    'automation-test-runs',
    new ResourceTemplate('blueprint://test-runs/{run_id}/{artifact}', {
      list: undefined,
    }),
    {
      description: 'Read stdout, stderr, summary, or exported report artifacts from a host-side automation test run.',
    },
    async (uri, variables) => {
      const runId = String(variables.run_id ?? '');
      const artifact = String(variables.artifact ?? '');
      const resolved = await automationController.readAutomationArtifact(runId, artifact);
      if (!resolved) {
        throw new Error(`Automation artifact '${artifact}' for run '${runId}' was not found.`);
      }

      const mimeType = resolved.artifact.mimeType;
      const textLike = mimeType.startsWith('text/') || mimeType === 'application/json';
      return {
        contents: [{
          uri: uri.href,
          mimeType,
          ...(textLike ? { text: resolved.data.toString('utf8') } : { blob: resolved.data.toString('base64') }),
        }],
      };
    },
  );

  server.registerResource(
    'unsupported-surfaces',
    'blueprint://unsupported-surfaces',
    {
      description: 'Explicit unsupported or intentionally bounded surfaces.',
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: [
          'Blueprint Extractor Unsupported Surfaces',
          '',
          '- Generic create_data_asset and modify_data_asset reject Enhanced Input asset classes. Use the dedicated InputAction/InputMappingContext tools instead.',
          '- modify_material and modify_material_function remain available but are advanced escape hatches, not the primary authoring workflow.',
          '- There is still no first-class Substrate graph DSL.',
          '- CommonUI wrapper widgets are not a backdoor into internal Slate/UButton background or style fields. For CommonButtonBase-family widgets, treat raw UButton background/style properties as unsupported and use extract_commonui_button_style, create_commonui_button_style, modify_commonui_button_style, or apply_commonui_button_style.',
          '- Dedicated widget animation authoring is supported only for the constrained supported track subset. Unsupported track families and broader arbitrary MovieScene synthesis remain outside the public contract.',
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
          '1. Normalize raw text, image, PNG/Figma, or HTML/CSS inputs into design_spec_json when the redesign is fidelity-sensitive.',
          '2. search_assets and extract the current HUD, transition widgets, and target screen widgets.',
          '3. Inspect class defaults, BindWidget names, and current activatable-window flow before replacing any widget tree.',
          '4. Choose a preset layout pattern such as centered_overlay, common_menu_shell, activatable_window, or list_detail.',
          '5. Apply the smallest modify_widget_blueprint patch possible. Only use build_widget_tree or replace_tree when broad structure must change.',
          '6. If the redesign includes authored motion on the supported track subset, use create_widget_animation or modify_widget_animation instead of trying to encode that work through generic widget patches.',
          '7. Compile immediately after structural or animation changes. If compile fails, inspect compile diagnostics and rerun the smallest recovery patch first.',
          '8. Run capture_widget_preview or capture_widget_motion_checkpoints after the compile result is clean so the rendered result is visually confirmed for each required checkpoint.',
          '9. If reference images or checkpoint frames exist, run compare_capture_to_reference or compare_motion_capture_bundle for key states before save_assets.',
          '10. Save after capture or compare succeeds, or report lower-confidence / partial verification explicitly when the visual checkpoint is blocked.',
        ].join('\n'),
      }],
    }),
  );
}
