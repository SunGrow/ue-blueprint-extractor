import { describe, expect, it } from 'vitest';
import { extractCommonUIButtonStyle, normalizeCommonUIButtonStyleInput } from '../src/helpers/commonui-button-style.js';
import {
  canFallbackFromLiveCoding,
  deriveLiveCodingFallbackReason,
  enrichLiveCodingResult,
} from '../src/helpers/live-coding.js';
import {
  buildProjectResolutionDiagnostics,
  explainProjectResolutionFailure,
  supportsConnectionProbe,
} from '../src/helpers/project-utils.js';
import { buildGeneratedBlueprintClassPath, getWidgetIdentifier } from '../src/helpers/widget-utils.js';
import type { ResolvedProjectInputs } from '../src/tool-context.js';

describe('utility helpers', () => {
  it('normalizes and extracts CommonUI button style payloads', () => {
    const normalized = normalizeCommonUIButtonStyleInput({
      normal: { tint: 'white' },
      text_styles: {
        normal: '/Game/UI/TS_Normal',
      },
      padding: {
        button: { left: 8, right: 8 },
        min_width: 120,
      },
      single_material: {
        enabled: true,
        brush: { image: '/Game/UI/T_Brush' },
      },
    });

    expect(normalized).toEqual({
      NormalBase: { tint: 'white' },
      NormalTextStyle: '/Game/UI/TS_Normal',
      ButtonPadding: { left: 8, right: 8 },
      MinWidth: 120,
      bSingleMaterial: true,
      SingleMaterialBrush: { image: '/Game/UI/T_Brush' },
    });
    expect(extractCommonUIButtonStyle(normalized)).toEqual({
      normal: { tint: 'white' },
      text_styles: {
        normal: '/Game/UI/TS_Normal',
      },
      padding: {
        button: { left: 8, right: 8 },
        min_width: 120,
      },
      single_material: {
        enabled: true,
        brush: { image: '/Game/UI/T_Brush' },
      },
    });
  });

  it('derives live coding fallback metadata and warnings', () => {
    const baseResult = {
      status: 'success',
      compileResult: 'NoChanges',
      warnings: ['Existing warning'],
    };

    expect(canFallbackFromLiveCoding(baseResult)).toBe(true);
    expect(deriveLiveCodingFallbackReason(baseResult)).toBe('live_coding_reported_nochanges');
    expect(enrichLiveCodingResult(
      baseResult,
      ['Source/MyGame/Public/MyActor.h', 'Source/MyGame/Private/MyActor.cpp'],
      { strategy: 'external_build' },
    )).toMatchObject({
      fallbackRecommended: true,
      reason: 'live_coding_reported_nochanges',
      changedPathsAccepted: ['Source/MyGame/Public/MyActor.h', 'Source/MyGame/Private/MyActor.cpp'],
      changedPathsAppliedByEditor: false,
      headerChangesDetected: ['Source/MyGame/Public/MyActor.h'],
      lastExternalBuild: { strategy: 'external_build' },
    });
  });

  it('builds widget identifiers and generated class paths', () => {
    expect(buildGeneratedBlueprintClassPath('/Game/UI/WBP_Window')).toBe('/Game/UI/WBP_Window.WBP_Window_C');
    expect(buildGeneratedBlueprintClassPath('/Game/UI/WBP_Window.WBP_Window')).toBe('/Game/UI/WBP_Window.WBP_Window_C');
    expect(buildGeneratedBlueprintClassPath('/Game/UI/WBP_Window.WBP_Window_C')).toBe('/Game/UI/WBP_Window.WBP_Window_C');
    expect(getWidgetIdentifier('TitleText', 'WindowRoot/TitleText')).toBe('WindowRoot/TitleText');
    expect(getWidgetIdentifier('TitleText')).toBe('TitleText');
    expect(getWidgetIdentifier()).toBeNull();
  });

  it('formats project resolution diagnostics, failures, and connection probes', async () => {
    const resolved: ResolvedProjectInputs = {
      engineRoot: 'C:/Epic/UE_5.7',
      projectPath: 'C:/Projects/MyGame/MyGame.uproject',
      target: 'MyGameEditor',
      context: null,
      contextError: 'editor offline',
      sources: {
        engineRoot: 'explicit',
        projectPath: 'editor_context',
        target: 'environment',
      },
    };
    const client = {
      async checkConnection() {
        return true;
      },
    };

    expect(buildProjectResolutionDiagnostics(resolved)).toEqual([
      'engine_root=explicit',
      'project_path=editor_context',
      'target=environment',
      'editor_context_error=editor offline',
    ]);
    expect(explainProjectResolutionFailure('missing inputs', resolved).message).toContain(
      'missing inputs; attempted explicit args -> project association -> editor context -> environment',
    );

    const probe = supportsConnectionProbe(client);
    expect(probe).not.toBeNull();
    await expect(probe?.()).resolves.toBe(true);
    expect(supportsConnectionProbe({})).toBeNull();
  });
});
