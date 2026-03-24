import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerWindowUiTools } from '../src/tools/window-ui.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';
import { getTextContent } from './test-helpers.js';

const applyWindowUiChangesResultSchema = z.object({}).passthrough();
const widgetSelectorFieldsSchema = z.object({
  widget_name: z.string().optional(),
  widget_path: z.string().optional(),
});
const fontImportItemSchema = z.object({
  file_path: z.string(),
}).passthrough();
const windowFontApplicationSchema = z.object({
  widget_name: z.string().optional(),
  widget_path: z.string().optional(),
  font_asset: z.string(),
  size: z.number(),
}).passthrough();
const buildPlatformSchema = z.enum(['Win64', 'Mac', 'Linux']);
const buildConfigurationSchema = z.enum(['Debug', 'DebugGame', 'Development', 'Shipping', 'Test']);

function createProjectController(overrides: Record<string, unknown> = {}) {
  return {
    liveCodingSupported: true,
    classifyChangedPaths: vi.fn(() => ({
      strategy: 'live_coding',
      restartRequired: false,
      reasons: [],
    })),
    compileProjectCode: vi.fn(async () => ({
      success: true,
      operation: 'compile_project_code',
      strategy: 'external_build',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      projectDir: 'C:/Proj',
      target: 'ProjEditor',
      platform: 'Win64',
      configuration: 'Development',
      command: {
        executable: 'Build.bat',
        args: [],
      },
      durationMs: 100,
      exitCode: 0,
      restartRequired: true,
      restartReasons: ['external_build_completed'],
      outputIncluded: false,
    })),
    launchEditor: vi.fn(async () => ({
      success: true,
      operation: 'launch_editor',
      engineRoot: 'C:/UE',
      projectPath: 'C:/Proj/Proj.uproject',
      projectDir: 'C:/Proj',
      command: {
        executable: 'UnrealEditor.exe',
        args: [],
      },
      detached: true,
      diagnostics: [],
    })),
    waitForEditorRestart: vi.fn(async () => ({
      success: true,
      operation: 'restart_editor',
      disconnected: true,
      reconnected: true,
      disconnectTimeoutMs: 60_000,
      reconnectTimeoutMs: 180_000,
      diagnostics: [],
    })),
    ...overrides,
  };
}

describe('registerWindowUiTools', () => {
  it('applies window UI mutations in order and saves only after a successful compile', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async (method) => {
      switch (method) {
        case 'ModifyWidget':
        case 'ModifyWidgetBlueprintStructure':
        case 'ApplyWidgetFonts':
        case 'CompileWidgetBlueprint':
        case 'SaveAssets':
          return {
            success: true,
            operation: method,
          };
        default:
          throw new Error(`Unexpected method ${method}`);
      }
    });

    registerWindowUiTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      applyWindowUiChangesResultSchema,
      widgetSelectorFieldsSchema,
      fontImportItemSchema,
      windowFontApplicationSchema,
      buildPlatformSchema,
      buildConfigurationSchema,
    });

    const result = await registry.getTool('apply_window_ui_changes').handler({
      asset_path: '/Game/UI/WBP_Window',
      variable_widgets: [{
        widget_path: 'Root/Title',
        is_variable: true,
      }],
      class_defaults: {
        bIsModal: true,
      },
      font_applications: [{
        widget_path: 'Root/Title',
        font_asset: '/Game/Fonts/F_Main',
        size: 18,
      }],
      compile_after: true,
      save_after: true,
      checkpoint_after_mutation_steps: false,
      save_asset_paths: ['/Game/UI/Styles/WBP_WindowStyle'],
    });

    expect(callSubsystemJson).toHaveBeenNthCalledWith(1, 'ModifyWidget', {
      AssetPath: '/Game/UI/WBP_Window',
      WidgetName: 'Root/Title',
      PropertiesJson: JSON.stringify({}),
      SlotJson: JSON.stringify({}),
      WidgetOptionsJson: JSON.stringify({ is_variable: true }),
      bValidateOnly: false,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(2, 'ModifyWidgetBlueprintStructure', {
      AssetPath: '/Game/UI/WBP_Window',
      Operation: 'patch_class_defaults',
      PayloadJson: JSON.stringify({
        classDefaults: {
          bIsModal: true,
        },
      }),
      bValidateOnly: false,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(3, 'ApplyWidgetFonts', {
      AssetPath: '/Game/UI/WBP_Window',
      PayloadJson: JSON.stringify({
        applications: [{
          widget_path: 'Root/Title',
          font_asset: '/Game/Fonts/F_Main',
          size: 18,
        }],
      }),
      bValidateOnly: false,
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(4, 'CompileWidgetBlueprint', {
      AssetPath: '/Game/UI/WBP_Window',
    });
    expect(callSubsystemJson).toHaveBeenNthCalledWith(5, 'SaveAssets', {
      AssetPathsJson: JSON.stringify(['/Game/UI/WBP_Window', '/Game/UI/Styles/WBP_WindowStyle']),
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'apply_window_ui_changes',
      steps: [
        { step: 'mark_widget_variable' },
        { step: 'patch_class_defaults' },
        { step: 'apply_widget_fonts' },
        { step: 'compile_widget_blueprint' },
        { step: 'save_assets' },
      ],
      verification: {
        status: 'unverified',
        recommendedTool: 'capture_widget_preview',
      },
    });
  });

  it('returns an error when variable_widgets entries do not provide a selector', async () => {
    const registry = createToolRegistry();

    registerWindowUiTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      applyWindowUiChangesResultSchema,
      widgetSelectorFieldsSchema,
      fontImportItemSchema,
      windowFontApplicationSchema,
      buildPlatformSchema,
      buildConfigurationSchema,
    });

    const result = await registry.getTool('apply_window_ui_changes').handler({
      asset_path: '/Game/UI/WBP_Window',
      variable_widgets: [{
        is_variable: true,
      }],
      compile_after: true,
      save_after: false,
      checkpoint_after_mutation_steps: false,
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getTextContent(result as { content?: Array<{ text?: string; type: string }> })).toContain(
      'variable_widgets entries require widget_name or widget_path',
    );
  });

  it('stops early when compile_widget_blueprint fails and does not continue into save steps', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async (method) => {
      if (method === 'ModifyWidgetBlueprintStructure') {
        return { success: true, operation: method };
      }
      if (method === 'CompileWidgetBlueprint') {
        return { success: false, operation: method, messages: ['compile failed'] };
      }
      if (method === 'SaveAssets') {
        return { success: true, operation: method };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    registerWindowUiTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson,
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      applyWindowUiChangesResultSchema,
      widgetSelectorFieldsSchema,
      fontImportItemSchema,
      windowFontApplicationSchema,
      buildPlatformSchema,
      buildConfigurationSchema,
    });

    const result = await registry.getTool('apply_window_ui_changes').handler({
      asset_path: '/Game/UI/WBP_Window',
      variable_widgets: [],
      class_defaults: {
        bIsModal: true,
      },
      compile_after: true,
      save_after: true,
      checkpoint_after_mutation_steps: false,
    });

    expect(callSubsystemJson).toHaveBeenCalledTimes(2);
    expect(parseDirectToolResult(result)).toMatchObject({
      success: false,
      operation: 'apply_window_ui_changes',
      stoppedAt: 'compile_widget_blueprint',
      steps: [
        { step: 'patch_class_defaults' },
        { step: 'compile_widget_blueprint' },
      ],
    });
  });

  it('marks verification as compile_pending when compile_after is disabled', async () => {
    const registry = createToolRegistry();

    registerWindowUiTools({
      server: registry.server,
      client: {},
      projectController: createProjectController(),
      callSubsystemJson: vi.fn(),
      resolveProjectInputs: vi.fn(),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      applyWindowUiChangesResultSchema,
      widgetSelectorFieldsSchema,
      fontImportItemSchema,
      windowFontApplicationSchema,
      buildPlatformSchema,
      buildConfigurationSchema,
    });

    const result = await registry.getTool('apply_window_ui_changes').handler({
      asset_path: '/Game/UI/WBP_Window',
      variable_widgets: [],
      compile_after: false,
      save_after: false,
      checkpoint_after_mutation_steps: false,
    });

    expect(parseDirectToolResult(result)).toEqual({
      success: true,
      operation: 'apply_window_ui_changes',
      steps: [],
      verification: {
        required: true,
        status: 'compile_pending',
        surface: 'editor_offscreen',
        recommendedTool: 'capture_widget_preview',
        partialAllowed: true,
        reason: 'apply_window_ui_changes completed the mutation flow without compiling the widget, so compile and visual verification are still pending.',
      },
      next_steps: [
        'Compile the widget blueprint or rerun apply_window_ui_changes with compile_after=true before visual verification.',
        'Run capture_widget_preview for /Game/UI/WBP_Window after the compile result is clean.',
        'If preview capture is blocked, report partial verification explicitly with the blocking reason.',
      ],
    });
  });

  it('runs the sync_project_code live-coding branch inside the window UI flow', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async (method) => {
      if (method === 'TriggerLiveCoding') {
        return {
          success: true,
          status: 'success',
          warnings: [],
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });
    const projectController = createProjectController({
      classifyChangedPaths: vi.fn(() => ({
        strategy: 'live_coding',
        restartRequired: false,
        reasons: [],
      })),
    });

    registerWindowUiTools({
      server: registry.server,
      client: {},
      projectController,
      callSubsystemJson,
      resolveProjectInputs: vi.fn(async () => ({
        engineRoot: 'C:/UE',
        projectPath: 'C:/Proj/Proj.uproject',
        target: 'ProjEditor',
        context: null,
        contextError: undefined,
        sources: {
          engineRoot: 'explicit',
          projectPath: 'environment',
          target: 'editor_context',
        },
      })),
      rememberExternalBuild: vi.fn(),
      getLastExternalBuildContext: vi.fn(() => null),
      clearProjectAutomationContext: vi.fn(),
      applyWindowUiChangesResultSchema,
      widgetSelectorFieldsSchema,
      fontImportItemSchema,
      windowFontApplicationSchema,
      buildPlatformSchema,
      buildConfigurationSchema,
    });

    const result = await registry.getTool('apply_window_ui_changes').handler({
      asset_path: '/Game/UI/WBP_Window',
      variable_widgets: [],
      compile_after: false,
      save_after: false,
      checkpoint_after_mutation_steps: false,
      sync_project_code: {
        changed_paths: ['Source/UI/Window.cpp'],
      },
    });

    expect(projectController.classifyChangedPaths).toHaveBeenCalledWith(['Source/UI/Window.cpp'], false);
    expect(callSubsystemJson).toHaveBeenCalledWith('TriggerLiveCoding', {
      bEnableForSession: true,
      bWaitForCompletion: true,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'apply_window_ui_changes',
      steps: [
        {
          step: 'sync_project_code',
          success: true,
          summary: expect.any(String),
        },
      ],
      verification: {
        status: 'compile_pending',
      },
    });
  });
});
