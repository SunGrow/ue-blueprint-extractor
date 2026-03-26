import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { createBlueprintExtractorServer } from '../src/server-factory.js';
import { CORE_TOOLS, WORKFLOW_SCOPE_IDS, ToolSurfaceManager } from '../src/tool-surface-manager.js';
import { connectInMemoryServer } from './test-helpers.js';

// Tools exempted from the 15-field budget (pre-existing tech debt, per TDD §3.6)
const FIELD_EXEMPTED_TOOLS = new Set([
  'apply_window_ui_changes',    // 34+ fields, acknowledged tech debt
  'modify_widget_blueprint',    // dispatch alias, retains old polymorphic schema
  'material_graph_operation',   // pre-existing 17-field polymorphic tool
]);

// Tools exempted from 4-level nesting limit (inherent schema structure)
const NESTING_EXEMPTED_TOOLS = new Set([
  // Widget tools using recursive widgetNodeSchema (children contain children)
  'replace_widget_tree', 'insert_widget_child', 'wrap_widget',
  'build_widget_tree', 'modify_widget_blueprint',
  // Pre-existing deep schemas (passthrough, nested payloads)
  'create_curve', 'modify_curve', 'create_curve_table', 'modify_curve_table',
  'modify_user_defined_struct', 'create_user_defined_enum', 'modify_user_defined_enum',
  'create_blackboard', 'modify_blackboard', 'create_state_tree', 'modify_state_tree',
  'import_assets',
  'create_behavior_tree', 'modify_behavior_tree',
  'apply_window_ui_changes',
  // Material tools with operation-specific typed payloads (array of operation objects with nested fields)
  'modify_material',
]);

function countTopLevelFields(schema: z.ZodTypeAny): number {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape).length;
  }
  // Handle ZodEffects (from .refine())
  if (schema instanceof z.ZodEffects) {
    return countTopLevelFields(schema._def.schema);
  }
  return 0;
}

function measureNestingDepth(schema: z.ZodTypeAny, depth = 0): number {
  if (depth > 10) return depth; // safety cap

  if (schema instanceof z.ZodObject) {
    let maxChild = depth;
    for (const value of Object.values(schema.shape) as z.ZodTypeAny[]) {
      maxChild = Math.max(maxChild, measureNestingDepth(value, depth + 1));
    }
    return maxChild;
  }
  if (schema instanceof z.ZodArray) {
    return measureNestingDepth(schema._def.type, depth + 1);
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault || schema instanceof z.ZodNullable) {
    return measureNestingDepth(schema._def.innerType, depth);
  }
  if (schema instanceof z.ZodEffects) {
    return measureNestingDepth(schema._def.schema, depth);
  }
  if (schema instanceof z.ZodRecord) {
    return measureNestingDepth(schema._def.valueType, depth + 1);
  }
  return depth;
}

describe('schema complexity budget', () => {
  let tools: Map<string, { inputSchema?: z.ZodTypeAny }>;

  beforeAll(async () => {
    const { server } = createBlueprintExtractorServer(
      { callSubsystem: async () => ({}) } as any,
      { runBuild: async () => ({}) } as any,
      { startRun: async () => ({}), getRunDetails: async () => ({}), listRuns: async () => ({}) } as any,
    );
    const { client } = await connectInMemoryServer(server);
    const result = await client.listTools();

    tools = new Map();
    for (const tool of result.tools) {
      tools.set(tool.name, { inputSchema: tool.inputSchema as any });
    }
  });

  it('no new/redesigned tool exceeds 15 top-level fields', () => {
    const violations: string[] = [];
    for (const [name, entry] of tools) {
      if (FIELD_EXEMPTED_TOOLS.has(name)) continue;
      if (!entry.inputSchema) continue;

      // Count properties from the JSON schema representation
      const properties = (entry.inputSchema as any).properties;
      if (!properties) continue;
      const fieldCount = Object.keys(properties).length;

      if (fieldCount > 15) {
        violations.push(`${name}: ${fieldCount} fields (max 15)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no tool schema exceeds 4 nesting levels', () => {
    const violations: string[] = [];
    for (const [name, entry] of tools) {
      if (!entry.inputSchema) continue;
      if (NESTING_EXEMPTED_TOOLS.has(name)) continue;

      // Measure nesting from JSON schema representation
      const maxDepth = measureJsonSchemaNesting(entry.inputSchema as any);
      if (maxDepth > 4) {
        violations.push(`${name}: ${maxDepth} levels deep (max 4)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('registered at least 65 tools total (post alias removal)', () => {
    expect(tools.size).toBeGreaterThanOrEqual(65);
  });

  it('no removed aliases are registered', () => {
    const removedAliases = [
      'extract_material_function',
      'create_material_function',
      'modify_material_function',
      'import_textures',
      'import_meshes',
      'reimport_assets',
    ];
    const found = removedAliases.filter((alias) => tools.has(alias));
    expect(found).toEqual([]);
  });

  it('zero .passthrough() in tool-inputs.ts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/schemas/tool-inputs.ts'),
      'utf-8',
    );
    const count = (content.match(/\.passthrough\(\)/g) || []).length;
    expect(count).toBe(0);
  });

  it('zero .passthrough() in tool-results.ts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/schemas/tool-results.ts'),
      'utf-8',
    );
    const count = (content.match(/\.passthrough\(\)/g) || []).length;
    expect(count).toBe(0);
  });

  it('CORE_TOOLS has at most 14 entries', () => {
    expect(CORE_TOOLS.size).toBeLessThanOrEqual(14);
  });

  it('no leaf scope exceeds 15 tools', () => {
    // Parent scopes (like widget_authoring) expand to all sub-scopes and are excluded
    const parentScopes = new Set(['widget_authoring']);
    const violations: string[] = [];
    for (const scopeId of WORKFLOW_SCOPE_IDS) {
      if (parentScopes.has(scopeId)) continue;
      const registeredToolMap = new Map();
      const manager = new ToolSurfaceManager(registeredToolMap as any);
      const scope = manager.getScopeDefinition(scopeId);
      if (scope && scope.tools && scope.tools.length > 15) {
        violations.push(`${scopeId}: ${scope.tools.length} tools (max 15)`);
      }
    }
    expect(violations).toEqual([]);
  });
});

function measureJsonSchemaNesting(schema: any, depth = 0): number {
  if (depth > 10) return depth;
  if (!schema || typeof schema !== 'object') return depth;

  let maxChild = depth;

  if (schema.properties) {
    for (const value of Object.values(schema.properties)) {
      maxChild = Math.max(maxChild, measureJsonSchemaNesting(value as any, depth + 1));
    }
  }
  if (schema.items) {
    maxChild = Math.max(maxChild, measureJsonSchemaNesting(schema.items, depth + 1));
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    maxChild = Math.max(maxChild, measureJsonSchemaNesting(schema.additionalProperties, depth + 1));
  }

  return maxChild;
}
