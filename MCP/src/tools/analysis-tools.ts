import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  jsonToolError,
  jsonToolSuccess,
} from '../helpers/subsystem.js';
import { isPlainObject } from '../helpers/formatting.js';
import {
  AuditProjectAssetsResultSchema,
  ReviewBlueprintResultSchema,
  analysisFindingCategorySchema,
} from '../schemas/tool-results.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterAnalysisToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  callSubsystemJson: JsonSubsystemCaller;
};

type AnalysisSeverity = 'low' | 'medium' | 'high';
type AnalysisCategory = z.infer<typeof analysisFindingCategorySchema>;

type AnalysisFinding = {
  severity: AnalysisSeverity;
  category: AnalysisCategory;
  title: string;
  asset_path: string;
  subject: string;
  graph_name?: string;
  evidence: string[];
  next_steps: string[];
};

type AuditFinding = {
  severity: AnalysisSeverity;
  category: 'naming' | 'package_hygiene' | 'asset_family_coverage' | 'content_budget' | 'orphan_detection';
  title: string;
  asset_path: string;
  asset_name: string;
  asset_class: string;
  evidence: string[];
  next_steps: string[];
};

type ListedAsset = {
  assetPath: string;
  assetName: string;
  assetClass: string;
};

function readOnlyAnnotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is Record<string, unknown> => isPlainObject(entry));
}

function normalizeListedAsset(entry: Record<string, unknown>): ListedAsset {
  const assetPath = String(
    entry.assetPath
    ?? entry.asset_path
    ?? entry.PackagePath
    ?? entry.package_path
    ?? entry.path
    ?? '',
  );
  const assetName = String(
    entry.assetName
    ?? entry.asset_name
    ?? entry.Name
    ?? entry.name
    ?? '',
  );
  const assetClass = String(
    entry.assetClass
    ?? entry.className
    ?? entry.class_name
    ?? entry.class
    ?? '',
  );

  return {
    assetPath,
    assetName,
    assetClass,
  };
}

function toListedAssets(parsed: Record<string, unknown>): ListedAsset[] {
  const assets = Array.isArray(parsed.assets)
    ? parsed.assets
    : Array.isArray(parsed)
      ? parsed
      : [];
  return assets
    .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
    .map(normalizeListedAsset);
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function isExecPin(pin: Record<string, unknown>): boolean {
  const type = isPlainObject(pin.type) ? pin.type : null;
  return type?.category === 'exec';
}

function isConnectedExecInput(pin: Record<string, unknown>): boolean {
  return pin.direction === 'Input'
    && isExecPin(pin)
    && getRecordArray(pin.connections).length > 0;
}

function isConnectedExecOutput(pin: Record<string, unknown>): boolean {
  return pin.direction === 'Output'
    && isExecPin(pin)
    && getRecordArray(pin.connections).length > 0;
}

function isEntryNode(node: Record<string, unknown>): boolean {
  const nodeClass = getString(node.nodeClass) ?? '';
  return nodeClass.includes('FunctionEntry')
    || nodeClass.includes('Event')
    || nodeClass.includes('CustomEvent')
    || nodeClass.includes('Tunnel');
}

function hasAuthorityGuard(graph: Record<string, unknown>): boolean {
  return getRecordArray(graph.nodes).some((node) => {
    const title = (getString(node.nodeTitle) ?? '').toLowerCase();
    const nodeClass = (getString(node.nodeClass) ?? '').toLowerCase();
    return title.includes('authority')
      || title.includes('local control')
      || nodeClass.includes('switchauthority')
      || nodeClass.includes('authority');
  });
}

function pushFinding(
  findings: AnalysisFinding[],
  finding: AnalysisFinding,
): void {
  findings.push(finding);
}

function reviewBlueprintExtraction(
  parsed: Record<string, unknown>,
  requestedAssetPath: string,
): {
  assetPath: string;
  blueprintName: string;
  findings: AnalysisFinding[];
} {
  const blueprint = isPlainObject(parsed.blueprint) ? parsed.blueprint : {};
  const assetPath = getString(blueprint.assetPath) ?? requestedAssetPath;
  const blueprintName = getString(blueprint.assetName) ?? assetPath.split('/').pop() ?? requestedAssetPath;
  const findings: AnalysisFinding[] = [];

  const variables = getRecordArray(blueprint.variables);
  for (const variable of variables) {
    const variableName = getString(variable.name);
    if (!variableName) {
      continue;
    }

    if (/\s/.test(variableName) || !isPascalCase(variableName)) {
      pushFinding(findings, {
        severity: 'low',
        category: 'naming_convention',
        title: `Variable '${variableName}' does not follow the project naming convention`,
        asset_path: assetPath,
        subject: variableName,
        evidence: [
          `Variable names should stay whitespace-free and PascalCase for predictable Blueprint search and generated code parity.`,
          `Observed variable name: ${variableName}.`,
        ],
        next_steps: [
          `Rename '${variableName}' to a whitespace-free PascalCase identifier.`,
        ],
      });
    }

    const propertyFlags = new Set(getStringArray(variable.propertyFlags));
    const repNotifyFunc = getString(variable.repNotifyFunc);
    if (propertyFlags.has('CPF_RepNotify') && !repNotifyFunc) {
      pushFinding(findings, {
        severity: 'medium',
        category: 'replication_authority',
        title: `RepNotify variable '${variableName}' does not declare a RepNotify function`,
        asset_path: assetPath,
        subject: variableName,
        evidence: [
          `The variable advertises CPF_RepNotify but no repNotifyFunc was extracted.`,
        ],
        next_steps: [
          `Add a RepNotify handler for '${variableName}' or remove CPF_RepNotify if notification is not required.`,
        ],
      });
    }

    const type = isPlainObject(variable.type) ? variable.type : null;
    const category = getString(type?.category)?.toLowerCase();
    const defaultValue = getString(variable.defaultValue) ?? '';
    if (
      defaultValue.includes('/Game/')
      && (category === 'object' || category === 'class' || category === 'softobject' || category === 'softclass')
    ) {
      pushFinding(findings, {
        severity: 'low',
        category: 'reference_hygiene',
        title: `Variable '${variableName}' carries a hard content reference default`,
        asset_path: assetPath,
        subject: variableName,
        evidence: [
          `Default value contains a direct content path: ${defaultValue}.`,
        ],
        next_steps: [
          `Confirm '${variableName}' should hard-reference that asset; otherwise switch to a softer indirection strategy or initialize it closer to use.`,
        ],
      });
    }
  }

  const functions = getRecordArray(blueprint.functions);
  for (const graph of functions) {
    const graphName = getString(graph.graphName) ?? 'UnknownGraph';
    const graphType = getString(graph.graphType) ?? 'Unknown';

    if (graphType === 'FunctionGraph' && !isPascalCase(graphName)) {
      pushFinding(findings, {
        severity: 'low',
        category: 'naming_convention',
        title: `Function graph '${graphName}' does not follow the project naming convention`,
        asset_path: assetPath,
        subject: graphName,
        graph_name: graphName,
        evidence: [
          `Blueprint function graphs should stay PascalCase for consistency with generated class members.`,
        ],
        next_steps: [
          `Rename '${graphName}' to a PascalCase function name.`,
        ],
      });
    }

    const functionFlags = new Set(getStringArray(graph.functionFlags));
    if (
      (functionFlags.has('FUNC_NetServer') || functionFlags.has('FUNC_NetClient') || functionFlags.has('FUNC_NetMulticast'))
      && (graph.isPure === true || graph.isConst === true)
    ) {
      pushFinding(findings, {
        severity: 'high',
        category: 'replication_authority',
        title: `Networked function '${graphName}' is marked pure/const`,
        asset_path: assetPath,
        subject: graphName,
        graph_name: graphName,
        evidence: [
          `Extracted function flags: ${[...functionFlags].join(', ') || 'none'}.`,
          `isPure=${String(graph.isPure)} isConst=${String(graph.isConst)}.`,
        ],
        next_steps: [
          `Remove pure/const semantics from '${graphName}' or move the network behavior into an impure execution path.`,
        ],
      });
    }

    const nodes = getRecordArray(graph.nodes);
    const guardedByAuthority = hasAuthorityGuard(graph);
    for (const node of nodes) {
      const nodeTitle = getString(node.nodeTitle) ?? getString(node.nodeClass) ?? 'UnnamedNode';
      const pins = getRecordArray(node.pins);

      const hasIncomingExec = pins.some(isConnectedExecInput);
      const hasOutgoingExec = pins.some(isConnectedExecOutput);
      if (hasOutgoingExec && !hasIncomingExec && !isEntryNode(node)) {
        pushFinding(findings, {
          severity: 'medium',
          category: 'logic_flow',
          title: `Node '${nodeTitle}' appears unreachable`,
          asset_path: assetPath,
          subject: nodeTitle,
          graph_name: graphName,
          evidence: [
            `Graph '${graphName}' contains an exec-producing node with no incoming exec connection.`,
            `Node class: ${getString(node.nodeClass) ?? 'unknown'}.`,
          ],
          next_steps: [
            `Wire '${nodeTitle}' into the execution chain or remove the dead node.`,
          ],
        });
      }

      const normalizedTitle = nodeTitle.toLowerCase();
      if (normalizedTitle.includes('is valid')) {
        const execOutputs = pins.filter((pin) => pin.direction === 'Output' && isExecPin(pin));
        const connectedBranches = execOutputs.filter((pin) => getRecordArray(pin.connections).length > 0);
        if (execOutputs.length > 0 && connectedBranches.length === 0) {
          pushFinding(findings, {
            severity: 'medium',
            category: 'null_validity_ordering',
            title: `Validity guard '${nodeTitle}' does not drive either branch`,
            asset_path: assetPath,
            subject: nodeTitle,
            graph_name: graphName,
            evidence: [
              `The validity node exposes exec outputs but neither branch is connected.`,
            ],
            next_steps: [
              `Route the valid and invalid branches explicitly or remove the unused validity node.`,
            ],
          });
        } else if (execOutputs.length > 1 && connectedBranches.length < execOutputs.length) {
          pushFinding(findings, {
            severity: 'low',
            category: 'null_validity_ordering',
            title: `Validity guard '${nodeTitle}' handles only part of the nullability flow`,
            asset_path: assetPath,
            subject: nodeTitle,
            graph_name: graphName,
            evidence: [
              `Only ${connectedBranches.length} of ${execOutputs.length} validity branches are connected.`,
            ],
            next_steps: [
              `Decide whether the missing validity branch should be handled explicitly or collapse the node into a simpler flow.`,
            ],
          });
        }
      }

      const typeSpecificData = isPlainObject(node.typeSpecificData) ? node.typeSpecificData : null;
      if (
        getString(typeSpecificData?.functionName) === 'GetGameMode'
        && !guardedByAuthority
        && !functionFlags.has('FUNC_NetServer')
      ) {
        pushFinding(findings, {
          severity: 'medium',
          category: 'replication_authority',
          title: `Graph '${graphName}' calls GetGameMode without an authority gate`,
          asset_path: assetPath,
          subject: nodeTitle,
          graph_name: graphName,
          evidence: [
            `GetGameMode is only valid on the authority side and no authority-switch node was extracted in this graph.`,
          ],
          next_steps: [
            `Guard the GetGameMode path with an authority check or move it into a server-only execution context.`,
          ],
        });
      }

      for (const pin of pins) {
        const defaultObject = getString(pin.defaultObject) ?? '';
        const defaultValue = getString(pin.defaultValue) ?? '';
        if (defaultObject.startsWith('/Game/') || defaultValue.includes('/Game/')) {
          pushFinding(findings, {
            severity: 'low',
            category: 'reference_hygiene',
            title: `Node '${nodeTitle}' bakes in a direct content reference`,
            asset_path: assetPath,
            subject: nodeTitle,
            graph_name: graphName,
            evidence: [
              defaultObject.startsWith('/Game/')
                ? `Pin defaultObject: ${defaultObject}.`
                : `Pin defaultValue: ${defaultValue}.`,
            ],
            next_steps: [
              `Confirm the direct content dependency is intentional; otherwise move the asset lookup closer to runtime configuration or an injected reference.`,
            ],
          });
        }
      }
    }
  }

  return { assetPath, blueprintName, findings };
}

function summarizeFindings<T extends { severity: AnalysisSeverity }>(findings: T[]) {
  return findings.reduce(
    (summary, finding) => {
      summary[finding.severity] += 1;
      return summary;
    },
    { low: 0, medium: 0, high: 0 },
  );
}

function expectedPrefixForClass(assetClass: string): string | null {
  const normalized = assetClass.toLowerCase();
  if (normalized.includes('widgetblueprint')) return 'WBP_';
  if (normalized === 'blueprint') return 'BP_';
  if (normalized.includes('animblueprint')) return 'ABP_';
  if (normalized.includes('behaviortree')) return 'BT_';
  if (normalized.includes('blackboard')) return 'BB_';
  if (normalized.includes('statetree')) return 'ST_';
  if (normalized.includes('datatable')) return 'DT_';
  if (normalized.includes('dataasset')) return 'DA_';
  if (normalized.includes('materialinstance')) return 'MI_';
  if (normalized === 'material') return 'M_';
  if (normalized.includes('texture')) return 'T_';
  if (normalized.includes('curvetable')) return 'CT_';
  if (normalized.includes('enum')) return 'E_';
  return null;
}

function auditListedAssets(packagePath: string, assets: ListedAsset[]) {
  const findings: AuditFinding[] = [];
  const familyCounts = new Map<string, number>();

  for (const asset of assets) {
    familyCounts.set(asset.assetClass, (familyCounts.get(asset.assetClass) ?? 0) + 1);

    if (!asset.assetClass) {
      findings.push({
        severity: 'low',
        category: 'asset_family_coverage',
        title: `Asset '${asset.assetName}' did not report an asset class`,
        asset_path: asset.assetPath,
        asset_name: asset.assetName,
        asset_class: asset.assetClass,
        evidence: [
          `The asset registry entry for '${asset.assetPath}' did not include a class name.`,
        ],
        next_steps: [
          `Rebuild the asset registry state and confirm '${asset.assetPath}' resolves to a concrete asset class.`,
        ],
      });
    }

    if (/\s/.test(asset.assetPath) || /\s/.test(asset.assetName)) {
      findings.push({
        severity: 'medium',
        category: 'package_hygiene',
        title: `Asset '${asset.assetName}' uses whitespace in its package path`,
        asset_path: asset.assetPath,
        asset_name: asset.assetName,
        asset_class: asset.assetClass,
        evidence: [
          `Whitespace in asset paths increases quoting and scripting friction: ${asset.assetPath}.`,
        ],
        next_steps: [
          `Rename '${asset.assetPath}' to a whitespace-free package path.`,
        ],
      });
    }

    const expectedPrefix = expectedPrefixForClass(asset.assetClass);
    if (expectedPrefix && asset.assetName && !asset.assetName.startsWith(expectedPrefix)) {
      findings.push({
        severity: 'low',
        category: 'naming',
        title: `Asset '${asset.assetName}' does not follow the expected class prefix`,
        asset_path: asset.assetPath,
        asset_name: asset.assetName,
        asset_class: asset.assetClass,
        evidence: [
          `Class '${asset.assetClass}' usually uses the '${expectedPrefix}' prefix.`,
        ],
        next_steps: [
          `Rename '${asset.assetName}' to start with '${expectedPrefix}' if this asset is meant to follow the project naming convention.`,
        ],
      });
    }
  }

  const findingsBySeverity = summarizeFindings(findings);
  const byCategory = (category: AuditFinding['category']) => findings.filter((finding) => finding.category === category).length;

  return {
    findings,
    audit: {
      package_path: packagePath,
      asset_count: assets.length,
      finding_count: findings.length,
      findings_by_severity: findingsBySeverity,
      check_summaries: [
        { category: 'naming' as const, finding_count: byCategory('naming') },
        { category: 'package_hygiene' as const, finding_count: byCategory('package_hygiene') },
        { category: 'asset_family_coverage' as const, finding_count: byCategory('asset_family_coverage') },
        { category: 'content_budget' as const, finding_count: 0 },
        { category: 'orphan_detection' as const, finding_count: 0 },
      ],
      asset_family_counts: [...familyCounts.entries()]
        .map(([asset_class, count]) => ({ asset_class, count }))
        .sort((a, b) => a.asset_class.localeCompare(b.asset_class)),
    },
  };
}

export function registerAnalysisTools({
  server,
  callSubsystemJson,
}: RegisterAnalysisToolsOptions): void {
  server.registerTool(
    'review_blueprint',
    {
      title: 'Review Blueprint',
      description: 'Run deterministic read-only Blueprint review checks over extracted graph and variable data.',
      inputSchema: {
        asset_path: z.string().describe(
          'UE content path to the Blueprint asset.',
        ),
        graph_filter: z.array(z.string()).optional().describe(
          'Optional graph-name filter passed through to extraction.',
        ),
        include_class_defaults: z.boolean().default(false).describe(
          'Include generated-class defaults in the underlying extraction when needed for evidence gathering.',
        ),
      },
      outputSchema: ReviewBlueprintResultSchema,
      annotations: readOnlyAnnotations('Review Blueprint'),
    },
    async ({ asset_path, graph_filter, include_class_defaults }) => {
      try {
        const parsed = await callSubsystemJson('ExtractBlueprint', {
          AssetPath: asset_path,
          Scope: 'Full',
          GraphFilter: Array.isArray(graph_filter) ? graph_filter.join(',') : '',
          bIncludeClassDefaults: include_class_defaults ?? false,
        });

        const review = reviewBlueprintExtraction(parsed, asset_path);
        const findingsBySeverity = summarizeFindings(review.findings);

        return jsonToolSuccess({
          success: true,
          operation: 'review_blueprint',
          asset_path: review.assetPath,
          review: {
            asset_path: review.assetPath,
            blueprint_name: review.blueprintName,
            finding_count: review.findings.length,
            categories_reviewed: [
              'logic_flow',
              'null_validity_ordering',
              'reference_hygiene',
              'naming_convention',
              'replication_authority',
            ],
            findings_by_severity: findingsBySeverity,
          },
          findings: review.findings,
          ...(review.findings.length === 0
            ? { message: 'No deterministic Blueprint review findings were detected.' }
            : {}),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'audit_project_assets',
    {
      title: 'Audit Project Assets',
      description: 'Audit project asset metadata for low-noise naming, package hygiene, and asset-family coverage issues.',
      inputSchema: {
        package_path: z.string().default('/Game').describe(
          'UE package path to audit.',
        ),
        class_filter: z.string().default('').describe(
          'Optional asset class filter. Empty string audits all asset classes.',
        ),
      },
      outputSchema: AuditProjectAssetsResultSchema,
      annotations: readOnlyAnnotations('Audit Project Assets'),
    },
    async ({ package_path, class_filter }) => {
      try {
        const parsed = await callSubsystemJson('ListAssets', {
          PackagePath: package_path,
          bRecursive: true,
          ClassFilter: class_filter ?? '',
        });
        const assets = toListedAssets(parsed);
        const audit = auditListedAssets(package_path, assets);

        return jsonToolSuccess({
          success: true,
          operation: 'audit_project_assets',
          package_path,
          audit: audit.audit,
          findings: audit.findings,
          ...(audit.findings.length === 0
            ? { message: 'No asset-audit findings were detected for the requested package scope.' }
            : {}),
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
