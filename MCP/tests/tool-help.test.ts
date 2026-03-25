import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  collectRelatedResources,
  collectToolExampleFamilies,
  summarizeOutputSchema,
  summarizeSchemaFields,
} from '../src/helpers/tool-help.js';

describe('summarizeSchemaFields', () => {
  it('summarizes basic string, number, and boolean fields', () => {
    const shape = {
      name: z.string().describe('Asset name'),
      count: z.number().describe('Item count'),
      active: z.boolean().describe('Is active'),
    };

    const fields = summarizeSchemaFields(shape);

    expect(fields).toEqual([
      { name: 'name', description: 'Asset name', type: 'string' },
      { name: 'count', description: 'Item count', type: 'number' },
      { name: 'active', description: 'Is active', type: 'boolean' },
    ]);
  });

  it('marks optional and default fields correctly', () => {
    const shape = {
      required_field: z.string(),
      optional_field: z.string().optional(),
      default_field: z.boolean().default(false).describe('Has default'),
    };

    const fields = summarizeSchemaFields(shape);

    const requiredField = fields.find((f) => f.name === 'required_field');
    const optionalField = fields.find((f) => f.name === 'optional_field');
    const defaultField = fields.find((f) => f.name === 'default_field');

    expect(requiredField).toBeDefined();
    expect(requiredField!.required).toBeUndefined(); // required is default, so not explicitly set
    expect(optionalField!.required).toBe(false);
    expect(defaultField!.required).toBe(false);
    expect(defaultField!.default).toBe(false);
  });

  it('summarizes enum types with values', () => {
    const shape = {
      scope: z.enum(['ClassLevel', 'Variables', 'Full']),
    };

    const fields = summarizeSchemaFields(shape);

    expect(fields[0]).toMatchObject({
      name: 'scope',
      type: 'enum',
      values: ['ClassLevel', 'Variables', 'Full'],
    });
  });

  it('summarizes array types with item info', () => {
    const shape = {
      paths: z.array(z.string()).describe('Asset paths'),
    };

    const fields = summarizeSchemaFields(shape);

    expect(fields[0]).toMatchObject({
      name: 'paths',
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('summarizes object types with property names', () => {
    const shape = {
      config: z.object({
        width: z.number(),
        height: z.number(),
      }),
    };

    const fields = summarizeSchemaFields(shape);

    expect(fields[0]).toMatchObject({
      name: 'config',
      type: 'object',
      properties: ['width', 'height'],
    });
  });

  it('summarizes nullable fields', () => {
    const shape = {
      maybe_name: z.string().nullable().describe('Optional name'),
    };

    const fields = summarizeSchemaFields(shape);

    expect(fields[0]).toMatchObject({
      name: 'maybe_name',
      type: 'string',
      nullable: true,
    });
  });

  it('summarizes union types with options', () => {
    const shape = {
      selector: z.union([z.string(), z.number()]),
    };

    const fields = summarizeSchemaFields(shape);

    expect(fields[0]).toMatchObject({
      name: 'selector',
      type: 'union',
      options: [{ type: 'string' }, { type: 'number' }],
    });
  });

  it('summarizes literal types', () => {
    const shape = {
      mode: z.literal('read_only'),
    };

    const fields = summarizeSchemaFields(shape);

    expect(fields[0]).toMatchObject({
      name: 'mode',
      type: 'literal',
      value: 'read_only',
    });
  });

  it('unwraps ZodEffects (transforms) to reveal the inner type', () => {
    const shape = {
      processed: z.string().transform((val) => val.toUpperCase()),
    };

    const fields = summarizeSchemaFields(shape);

    expect(fields[0]).toMatchObject({
      name: 'processed',
      type: 'string',
    });
  });
});

describe('summarizeOutputSchema', () => {
  it('includes fields array for object schemas', () => {
    const schema = z.object({
      success: z.boolean(),
      assetPath: z.string(),
    });

    const summary = summarizeOutputSchema(schema);

    expect(summary.type).toBe('object');
    expect(summary.fields).toEqual([
      { name: 'success', type: 'boolean' },
      { name: 'assetPath', type: 'string' },
    ]);
  });

  it('handles non-object schemas without fields', () => {
    const schema = z.string();

    const summary = summarizeOutputSchema(schema);

    expect(summary.type).toBe('string');
    expect(summary.fields).toBeUndefined();
  });
});

describe('collectToolExampleFamilies', () => {
  const exampleCatalog = {
    blueprint_creation: {
      summary: 'Create a blueprint',
      recommended_flow: ['create_blueprint', 'save_assets'],
      examples: [
        { title: 'Create Actor BP', tool: 'create_blueprint' },
        { title: 'Create Pawn BP', tool: 'create_blueprint' },
      ],
    },
    material_setup: {
      summary: 'Material workflow',
      recommended_flow: ['create_material', 'material_graph_operation', 'compile_material_asset'],
      examples: [
        { title: 'Create basic material', tool: 'create_material' },
      ],
    },
    widget_design: {
      summary: 'Widget design workflow',
      recommended_flow: ['create_widget_blueprint'],
      examples: [],
    },
  };

  it('finds tool examples and recommended flow membership', () => {
    const families = collectToolExampleFamilies(exampleCatalog, 'create_blueprint');

    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({
      family: 'blueprint_creation',
      summary: 'Create a blueprint',
      usedInRecommendedFlow: true,
      exampleTitles: ['Create Actor BP', 'Create Pawn BP'],
    });
  });

  it('returns empty array for tools with no examples or flow references', () => {
    const families = collectToolExampleFamilies(exampleCatalog, 'extract_cascade');

    expect(families).toEqual([]);
  });

  it('includes family when tool is in recommended_flow but has no examples', () => {
    const families = collectToolExampleFamilies(exampleCatalog, 'create_widget_blueprint');

    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({
      family: 'widget_design',
      usedInRecommendedFlow: true,
      exampleTitles: [],
    });
  });
});

describe('collectRelatedResources', () => {
  it('returns scopes resource for extraction and listing tools', () => {
    expect(collectRelatedResources('extract_blueprint')).toContain('blueprint://scopes');
    expect(collectRelatedResources('search_assets')).toContain('blueprint://scopes');
    expect(collectRelatedResources('list_assets')).toContain('blueprint://scopes');
  });

  it('returns write-capabilities and authoring-conventions for mutation tools', () => {
    const resources = collectRelatedResources('create_blueprint');
    expect(resources).toContain('blueprint://write-capabilities');
    expect(resources).toContain('blueprint://authoring-conventions');
  });

  it('returns widget-specific resources for widget tools', () => {
    const resources = collectRelatedResources('modify_widget');
    expect(resources).toContain('blueprint://selector-conventions');
    expect(resources).toContain('blueprint://widget-best-practices');
    expect(resources).toContain('blueprint://verification-workflows');
  });

  it('returns material guidance for material tools', () => {
    const resources = collectRelatedResources('material_graph_operation');
    expect(resources).toContain('blueprint://material-graph-guidance');
  });

  it('returns import capabilities for import tools', () => {
    const resources = collectRelatedResources('import_assets');
    expect(resources).toContain('blueprint://import-capabilities');
  });

  it('returns project-automation for automation and compile tools', () => {
    expect(collectRelatedResources('compile_project_code')).toContain('blueprint://project-automation');
    expect(collectRelatedResources('run_automation_tests')).toContain('blueprint://project-automation');
    expect(collectRelatedResources('restart_editor')).toContain('blueprint://project-automation');
    expect(collectRelatedResources('wait_for_editor')).toContain('blueprint://project-automation');
    expect(collectRelatedResources('sync_project_code')).toContain('blueprint://project-automation');
    expect(collectRelatedResources('trigger_live_coding')).toContain('blueprint://project-automation');
  });

  it('returns motion resources for animation and motion tools', () => {
    const resources = collectRelatedResources('capture_widget_motion_checkpoints');
    expect(resources).toContain('blueprint://widget-motion-authoring');
    expect(resources).toContain('blueprint://motion-verification-workflow');
  });

  it('returns empty array for tools with no matching resources', () => {
    const resources = collectRelatedResources('get_tool_help');
    expect(resources).toEqual([]);
  });
});
