import { describe, expect, it, vi } from 'vitest';
import { registerAnalysisTools } from '../src/tools/analysis-tools.js';
import { createToolRegistry, parseDirectToolResult } from './tool-module-test-helpers.js';

function seededReviewBlueprint() {
  return {
    blueprint: {
      assetPath: '/Game/Blueprints/BP_Problematic',
      assetName: 'BP_Problematic',
      variables: [
        {
          name: 'bad name',
          type: { category: 'Object' },
          defaultValue: '/Game/Data/DA_Config.DA_Config',
          propertyFlags: ['CPF_RepNotify'],
        },
      ],
      functions: [
        {
          graphName: 'bad function',
          graphType: 'FunctionGraph',
          functionFlags: ['FUNC_NetServer'],
          isPure: true,
          nodes: [
            {
              nodeClass: 'K2Node_CallFunction',
              nodeTitle: 'Unreachable Call',
              pins: [
                {
                  direction: 'Output',
                  type: { category: 'exec' },
                  connections: [{ nodeGuid: 'n1', pinName: 'Exec' }],
                },
              ],
              typeSpecificData: {
                functionName: 'GetGameMode',
              },
            },
            {
              nodeClass: 'K2Node_CallFunction',
              nodeTitle: 'Is Valid',
              pins: [
                {
                  direction: 'Output',
                  pinName: 'Is Valid',
                  type: { category: 'exec' },
                  connections: [],
                },
                {
                  direction: 'Output',
                  pinName: 'Is Not Valid',
                  type: { category: 'exec' },
                  connections: [],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function cleanReviewBlueprint() {
  return {
    blueprint: {
      assetPath: '/Game/Blueprints/BP_Clean',
      assetName: 'BP_Clean',
      variables: [
        {
          name: 'Health',
          type: { category: 'int' },
          defaultValue: '100',
          propertyFlags: ['CPF_Edit'],
        },
      ],
      functions: [
        {
          graphName: 'ApplyDamage',
          graphType: 'FunctionGraph',
          functionFlags: ['FUNC_BlueprintCallable'],
          nodes: [
            {
              nodeClass: 'K2Node_FunctionEntry',
              nodeTitle: 'Apply Damage',
              pins: [
                {
                  direction: 'Output',
                  type: { category: 'exec' },
                  connections: [{ nodeGuid: 'n1', pinName: 'Exec' }],
                },
              ],
            },
            {
              nodeClass: 'K2Node_CallFunction',
              nodeTitle: 'Do Damage',
              pins: [
                {
                  direction: 'Input',
                  type: { category: 'exec' },
                  connections: [{ nodeGuid: 'n0', pinName: 'Exec' }],
                },
                {
                  direction: 'Output',
                  type: { category: 'exec' },
                  connections: [],
                },
              ],
              typeSpecificData: {
                functionName: 'ApplyDamage',
              },
            },
          ],
        },
      ],
    },
  };
}

describe('registerAnalysisTools', () => {
  it('registers review_blueprint and returns no findings for a clean Blueprint', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => cleanReviewBlueprint());

    registerAnalysisTools({
      server: registry.server,
      callSubsystemJson,
    });

    const result = await registry.getTool('review_blueprint').handler({
      asset_path: '/Game/Blueprints/BP_Clean',
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ExtractBlueprint', {
      AssetPath: '/Game/Blueprints/BP_Clean',
      Scope: 'Full',
      GraphFilter: '',
      bIncludeClassDefaults: false,
    });
    expect(parseDirectToolResult(result)).toMatchObject({
      success: true,
      operation: 'review_blueprint',
      asset_path: '/Game/Blueprints/BP_Clean',
      review: {
        finding_count: 0,
      },
      findings: [],
    });
  });

  it('reports deterministic Blueprint review findings with evidence and next steps', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => seededReviewBlueprint());

    registerAnalysisTools({
      server: registry.server,
      callSubsystemJson,
    });

    const result = await registry.getTool('review_blueprint').handler({
      asset_path: '/Game/Blueprints/BP_Problematic',
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const findings = parsed.findings as Array<Record<string, unknown>>;

    expect(parsed.success).toBe(true);
    expect(findings.length).toBeGreaterThanOrEqual(5);
    expect(findings.some((finding) => finding.category === 'naming_convention')).toBe(true);
    expect(findings.some((finding) => finding.category === 'reference_hygiene')).toBe(true);
    expect(findings.some((finding) => finding.category === 'null_validity_ordering')).toBe(true);
    expect(findings.some((finding) => finding.category === 'logic_flow')).toBe(true);
    expect(findings.some((finding) => finding.category === 'replication_authority')).toBe(true);
    expect(findings.every((finding) => Array.isArray(finding.evidence) && finding.evidence.length > 0)).toBe(true);
    expect(findings.every((finding) => Array.isArray(finding.next_steps) && finding.next_steps.length > 0)).toBe(true);
  });

  it('audits listed assets for naming and package hygiene issues', async () => {
    const registry = createToolRegistry();
    const callSubsystemJson = vi.fn(async () => ({
      assets: [
        { assetPath: '/Game/UI/Main Menu/WrongButton', assetName: 'WrongButton', assetClass: 'WidgetBlueprint' },
        { assetPath: '/Game/Data/DA_Items', assetName: 'DA_Items', assetClass: '' },
      ],
    }));

    registerAnalysisTools({
      server: registry.server,
      callSubsystemJson,
    });

    const result = await registry.getTool('audit_project_assets').handler({
      package_path: '/Game',
      class_filter: '',
    });

    expect(callSubsystemJson).toHaveBeenCalledWith('ListAssets', {
      PackagePath: '/Game',
      bRecursive: true,
      ClassFilter: '',
    });

    const parsed = parseDirectToolResult(result) as Record<string, unknown>;
    const findings = parsed.findings as Array<Record<string, unknown>>;
    expect(parsed.success).toBe(true);
    expect(parsed.package_path).toBe('/Game');
    expect((parsed.audit as Record<string, unknown>).asset_count).toBe(2);
    expect(findings.some((finding) => finding.category === 'package_hygiene')).toBe(true);
    expect(findings.some((finding) => finding.category === 'naming')).toBe(true);
    expect(findings.some((finding) => finding.category === 'asset_family_coverage')).toBe(true);
  });
});
