/**
 * Progressive summarization strategies per asset type.
 * Each strategy has 3 levels: full, summary, minimal.
 * Strategy selection is automatic based on token budget headroom.
 */

import { estimateTokens, HARD_CAP } from './token-budget.js';

type SummarizationLevel = 'full' | 'summary' | 'minimal';

function selectLevel(tokens: number): SummarizationLevel {
  if (tokens <= HARD_CAP) return 'full';
  if (tokens <= HARD_CAP * 2) return 'summary';
  return 'minimal';
}

function summarizeBlueprint(data: Record<string, unknown>, level: SummarizationLevel): Record<string, unknown> {
  if (level === 'full') return data;

  const result: Record<string, unknown> = {};

  // Always preserve class hierarchy and identification
  for (const key of ['className', 'class_name', 'parentClass', 'parent_class', 'assetPath', 'asset_path', 'name', 'Name']) {
    if (key in data) result[key] = data[key];
  }

  // Preserve variables (lightweight)
  if (data.variables) result.variables = data.variables;

  if (level === 'summary') {
    // Preserve components as names only
    if (Array.isArray(data.components)) {
      result.components = (data.components as Record<string, unknown>[]).map((c) => ({
        name: c.name ?? c.Name,
        class: c.class ?? c.className ?? c.Class,
      }));
    }
    // Summarize functions to signatures only
    if (Array.isArray(data.functions)) {
      result.functions = (data.functions as Record<string, unknown>[]).map((f) => ({
        name: f.name ?? f.Name,
        inputs: f.inputs,
        outputs: f.outputs,
      }));
    }
  }

  return result;
}

function summarizeWidgetTree(data: Record<string, unknown>, level: SummarizationLevel): Record<string, unknown> {
  if (level === 'full') return data;

  const result: Record<string, unknown> = {};

  for (const key of ['className', 'class_name', 'widgetTree', 'widget_tree', 'name', 'Name', 'assetPath', 'asset_path']) {
    if (key in data) result[key] = data[key];
  }

  if (level === 'summary') {
    // Preserve tree structure but strip style properties
    if (data.widgetTree || data.widget_tree) {
      result.widgetTree = data.widgetTree ?? data.widget_tree;
    }
    if (data.bindings) result.bindings = data.bindings;
  }

  return result;
}

function summarizeMaterial(data: Record<string, unknown>, level: SummarizationLevel): Record<string, unknown> {
  if (level === 'full') return data;

  const result: Record<string, unknown> = {};

  for (const key of ['name', 'Name', 'assetPath', 'asset_path', 'materialDomain', 'shadingModel']) {
    if (key in data) result[key] = data[key];
  }

  if (level === 'summary') {
    // Preserve node connections, summarize parameter values
    if (data.expressions) {
      result.expressions = (data.expressions as Record<string, unknown>[]).map((e) => ({
        name: e.name ?? e.Name,
        class: e.class ?? e.expressionClass,
      }));
    }
    if (data.connections) result.connections = data.connections;
  }

  return result;
}

function summarizeDataTable(data: Record<string, unknown>, level: SummarizationLevel): Record<string, unknown> {
  if (level === 'full') return data;

  const result: Record<string, unknown> = {};

  // Preserve schema
  for (const key of ['structType', 'struct_type', 'rowStruct', 'name', 'Name', 'assetPath', 'asset_path']) {
    if (key in data) result[key] = data[key];
  }

  // Paginate rows
  if (Array.isArray(data.rows)) {
    const rows = data.rows as unknown[];
    const pageSize = level === 'summary' ? 50 : 10;
    result.rows = rows.slice(0, pageSize);
    result._total_rows = rows.length;
    if (rows.length > pageSize) {
      result._rows_truncated = true;
    }
  }

  return result;
}

function summarizeGeneric(data: Record<string, unknown>, level: SummarizationLevel): Record<string, unknown> {
  if (level === 'full') return data;

  // For unknown asset types, keep top-level keys and truncate large nested values
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.length > 1000 && level === 'minimal') {
      result[key] = value.slice(0, 500) + '... [truncated]';
    } else if (Array.isArray(value) && value.length > 20 && level === 'minimal') {
      result[key] = value.slice(0, 10);
      result[`_${key}_total`] = value.length;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export type AssetType = 'blueprint' | 'widget' | 'material' | 'data_table' | 'generic';

export function detectAssetType(data: Record<string, unknown>): AssetType {
  if (data.widgetTree || data.widget_tree) return 'widget';
  if (data.expressions || data.materialDomain) return 'material';
  if (data.rows || data.rowStruct) return 'data_table';
  if (data.functions || data.variables || data.components || data.parentClass || data.parent_class) return 'blueprint';
  return 'generic';
}

export interface SummarizationResult {
  data: Record<string, unknown>;
  level: SummarizationLevel;
  originalTokens: number;
  summarizedTokens: number;
  omittedSections: string[];
}

export function summarizeResponse(
  data: Record<string, unknown>,
  assetType?: AssetType,
): SummarizationResult {
  const originalTokens = estimateTokens(data);
  const level = selectLevel(originalTokens);
  const type = assetType ?? detectAssetType(data);

  let summarized: Record<string, unknown>;
  const omittedSections: string[] = [];

  switch (type) {
    case 'blueprint':
      summarized = summarizeBlueprint(data, level);
      if (level !== 'full') omittedSections.push('node_graphs', 'bytecode');
      if (level === 'minimal') omittedSections.push('components_detail', 'function_bodies');
      break;
    case 'widget':
      summarized = summarizeWidgetTree(data, level);
      if (level !== 'full') omittedSections.push('style_properties');
      if (level === 'minimal') omittedSections.push('widget_tree_detail', 'bindings');
      break;
    case 'material':
      summarized = summarizeMaterial(data, level);
      if (level !== 'full') omittedSections.push('expression_properties');
      if (level === 'minimal') omittedSections.push('expression_detail', 'connections');
      break;
    case 'data_table':
      summarized = summarizeDataTable(data, level);
      if (level !== 'full') omittedSections.push('rows_paginated');
      break;
    default:
      summarized = summarizeGeneric(data, level);
      if (level !== 'full') omittedSections.push('large_nested_values');
      break;
  }

  return {
    data: summarized,
    level,
    originalTokens,
    summarizedTokens: estimateTokens(summarized),
    omittedSections,
  };
}
