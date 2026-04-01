import { describe, expect, it } from 'vitest';
import {
  parseMaterialDsl,
  materialDslToOperations,
} from '../src/helpers/material-dsl-parser.js';
import type {
  MaterialDslResult,
  MaterialDslExpression,
} from '../src/helpers/material-dsl-parser.js';

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('parseMaterialDsl', () => {
  it('parses settings line', () => {
    const result = parseMaterialDsl('Settings: MaterialDomain=Surface, BlendMode=Translucent');
    expect(result.settings).toEqual({
      MaterialDomain: 'Surface',
      BlendMode: 'Translucent',
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('parses scalar parameters with defaults', () => {
    const result = parseMaterialDsl('Param Scalar "Opacity" = 0.95');
    expect(result.params).toHaveLength(1);
    expect(result.params[0]).toEqual({
      type: 'Scalar',
      name: 'Opacity',
      defaultValue: 0.95,
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('parses color parameters with tuple defaults (r,g,b,a)', () => {
    const result = parseMaterialDsl('Param Color "BaseColor" = (0.1, 0.14, 0.22, 1.0)');
    expect(result.params).toHaveLength(1);
    expect(result.params[0]).toEqual({
      type: 'Color',
      name: 'BaseColor',
      defaultValue: [0.1, 0.14, 0.22, 1.0],
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('parses vector parameters with tuple defaults (x,y,z)', () => {
    const result = parseMaterialDsl('Param Vector "Normal" = (0.0, 0.0, 1.0)');
    expect(result.params).toHaveLength(1);
    expect(result.params[0].defaultValue).toEqual([0.0, 0.0, 1.0]);
  });

  it('parses connection with simple expression', () => {
    const result = parseMaterialDsl('BaseColor <- Multiply(Color, 1.3)');
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].materialProperty).toBe('BaseColor');
    expect(result.connections[0].expression.func).toBe('Multiply');
    expect(result.connections[0].expression.args).toHaveLength(2);
    expect(result.connections[0].expression.args[0]).toEqual({ type: 'ref', name: 'Color' });
    expect(result.connections[0].expression.args[1]).toEqual({ type: 'literal', value: 1.3 });
  });

  it('parses connection with nested expressions', () => {
    const result = parseMaterialDsl('BaseColor <- Lerp(Color, Multiply(Color, 1.3), HoverAlpha)');
    expect(result.connections).toHaveLength(1);
    const expr = result.connections[0].expression;
    expect(expr.func).toBe('Lerp');
    expect(expr.args).toHaveLength(3);
    expect(expr.args[0]).toEqual({ type: 'ref', name: 'Color' });
    expect(expr.args[1]).toEqual({
      type: 'expression',
      expr: {
        func: 'Multiply',
        args: [
          { type: 'ref', name: 'Color' },
          { type: 'literal', value: 1.3 },
        ],
      },
    });
    expect(expr.args[2]).toEqual({ type: 'ref', name: 'HoverAlpha' });
  });

  it('parses multiple connections', () => {
    const dsl = [
      'BaseColor <- Multiply(Color, 1.3)',
      'Opacity <- Multiply(Opacity, FadeAlpha)',
    ].join('\n');
    const result = parseMaterialDsl(dsl);
    expect(result.connections).toHaveLength(2);
    expect(result.connections[0].materialProperty).toBe('BaseColor');
    expect(result.connections[1].materialProperty).toBe('Opacity');
  });

  it('handles comments and blank lines', () => {
    const dsl = [
      '# Material: M_Test',
      '',
      '// This is a comment',
      'Settings: MaterialDomain=Surface',
      '',
      '# params section',
      'Param Scalar "Opacity" = 1.0',
      '',
      '// wire up',
      'BaseColor <- Multiply(Color, 1.0)',
    ].join('\n');
    const result = parseMaterialDsl(dsl);
    expect(result.name).toBe('M_Test');
    expect(Object.keys(result.settings)).toHaveLength(1);
    expect(result.params).toHaveLength(1);
    expect(result.connections).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('parses the plan example (M_ButtonBase)', () => {
    const dsl = [
      '# Material: M_ButtonBase',
      'Settings: MaterialDomain=Surface, BlendMode=Translucent, ShadingModel=Unlit',
      '',
      'Param Color "BaseColor" = (0.1, 0.14, 0.22, 1.0)',
      'Param Scalar "Opacity" = 0.95',
      'Param Scalar "CornerRadius" = 12.0',
      '',
      'BaseColor <- Lerp(Color, Multiply(Color, 1.3), HoverAlpha)',
      'Opacity <- Multiply(Opacity, FadeAlpha)',
    ].join('\n');

    const result = parseMaterialDsl(dsl);
    expect(result.name).toBe('M_ButtonBase');
    expect(result.settings).toEqual({
      MaterialDomain: 'Surface',
      BlendMode: 'Translucent',
      ShadingModel: 'Unlit',
    });
    expect(result.params).toHaveLength(3);
    expect(result.params[0]).toEqual({
      type: 'Color',
      name: 'BaseColor',
      defaultValue: [0.1, 0.14, 0.22, 1.0],
    });
    expect(result.params[1]).toEqual({
      type: 'Scalar',
      name: 'Opacity',
      defaultValue: 0.95,
    });
    expect(result.params[2]).toEqual({
      type: 'Scalar',
      name: 'CornerRadius',
      defaultValue: 12.0,
    });
    expect(result.connections).toHaveLength(2);
    expect(result.connections[0].materialProperty).toBe('BaseColor');
    expect(result.connections[0].expression.func).toBe('Lerp');
    expect(result.connections[1].materialProperty).toBe('Opacity');
    expect(result.connections[1].expression.func).toBe('Multiply');
    expect(result.warnings).toHaveLength(0);
  });

  it('warns on unrecognized lines', () => {
    const dsl = [
      'Settings: MaterialDomain=Surface',
      'this is not a valid line',
      'Param Scalar "X" = 1.0',
    ].join('\n');
    const result = parseMaterialDsl(dsl);
    expect(result.params).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('unrecognized line');
  });

  it('parses header without Material: prefix', () => {
    const result = parseMaterialDsl('# M_Simple');
    expect(result.name).toBe('M_Simple');
  });

  it('parses parameters without default values', () => {
    const result = parseMaterialDsl('Param Scalar "Weight"');
    expect(result.params).toHaveLength(1);
    expect(result.params[0]).toEqual({
      type: 'Scalar',
      name: 'Weight',
    });
    expect(result.params[0].defaultValue).toBeUndefined();
  });

  it('parses Texture2D parameter with string default', () => {
    const result = parseMaterialDsl('Param Texture2D "Albedo" = "/Game/Textures/T_Default"');
    expect(result.params).toHaveLength(1);
    expect(result.params[0].type).toBe('Texture2D');
    expect(result.params[0].defaultValue).toBe('/Game/Textures/T_Default');
  });

  it('parses StaticBool parameter with boolean default', () => {
    const result = parseMaterialDsl('Param StaticBool "UseDetail" = true');
    expect(result.params).toHaveLength(1);
    expect(result.params[0].type).toBe('StaticBool');
    expect(result.params[0].defaultValue).toBe(true);
  });

  it('handles empty input', () => {
    const result = parseMaterialDsl('');
    expect(result.params).toHaveLength(0);
    expect(result.connections).toHaveLength(0);
    expect(Object.keys(result.settings)).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns on unrecognized param type', () => {
    const result = parseMaterialDsl('Param Float "Bad" = 1.0');
    expect(result.params).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain('unrecognized param type');
  });

  it('handles settings with numeric and boolean values', () => {
    const result = parseMaterialDsl('Settings: TwoSided=true, OpacityMaskClipValue=0.333');
    expect(result.settings.TwoSided).toBe(true);
    expect(result.settings.OpacityMaskClipValue).toBe(0.333);
  });
});

// ---------------------------------------------------------------------------
// Converter tests
// ---------------------------------------------------------------------------

describe('materialDslToOperations', () => {
  it('produces set_material_settings operation', () => {
    const parsed: MaterialDslResult = {
      settings: { MaterialDomain: 'Surface', BlendMode: 'Translucent' },
      params: [],
      connections: [],
      warnings: [],
    };
    const ops = materialDslToOperations(parsed);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      operation: 'set_material_settings',
      settings: { MaterialDomain: 'Surface', BlendMode: 'Translucent' },
    });
  });

  it('creates add_expression for each parameter', () => {
    const parsed: MaterialDslResult = {
      settings: {},
      params: [
        { type: 'Scalar', name: 'Opacity', defaultValue: 0.95 },
        { type: 'Color', name: 'BaseColor', defaultValue: [0.1, 0.14, 0.22, 1.0] },
      ],
      connections: [],
      warnings: [],
    };
    const ops = materialDslToOperations(parsed);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({
      operation: 'add_expression',
      expression_class: 'MaterialExpressionScalarParameter',
      temp_id: 'param_Opacity',
      properties: { ParameterName: 'Opacity', DefaultValue: 0.95 },
    });
    expect(ops[1]).toEqual({
      operation: 'add_expression',
      expression_class: 'MaterialExpressionVectorParameter',
      temp_id: 'param_BaseColor',
      properties: { ParameterName: 'BaseColor', DefaultValue: [0.1, 0.14, 0.22, 1.0] },
    });
  });

  it('creates nested expressions with correct temp_ids', () => {
    const innerExpr: MaterialDslExpression = {
      func: 'Multiply',
      args: [
        { type: 'ref', name: 'Color' },
        { type: 'literal', value: 1.3 },
      ],
    };
    const parsed: MaterialDslResult = {
      settings: {},
      params: [{ type: 'Color', name: 'Color' }],
      connections: [{
        materialProperty: 'BaseColor',
        expression: {
          func: 'Lerp',
          args: [
            { type: 'ref', name: 'Color' },
            { type: 'expression', expr: innerExpr },
            { type: 'ref', name: 'HoverAlpha' },
          ],
        },
      }],
      warnings: [],
    };
    const ops = materialDslToOperations(parsed);

    // Should have: 1 param add, 1 constant add (1.3), 1 Multiply add, connections for Multiply,
    // 1 Lerp add, connections for Lerp, 1 connect_material_property
    const addOps = ops.filter((op) => op.operation === 'add_expression');
    const connectOps = ops.filter((op) => op.operation === 'connect_expressions');
    const materialConnectOps = ops.filter((op) => op.operation === 'connect_material_property');

    // param_Color, const for 1.3, Multiply, Lerp = 4 add_expression
    expect(addOps).toHaveLength(4);
    expect(addOps[0].temp_id).toBe('param_Color');
    expect(addOps[0].expression_class).toBe('MaterialExpressionVectorParameter');

    // Find the constant expression
    const constOp = addOps.find((op) => op.expression_class === 'MaterialExpressionConstant');
    expect(constOp).toBeDefined();
    expect(constOp!.properties).toEqual({ R: 1.3 });

    // Find the Multiply expression
    const mulOp = addOps.find((op) => op.expression_class === 'MaterialExpressionMultiply');
    expect(mulOp).toBeDefined();

    // Find the Lerp expression
    const lerpOp = addOps.find((op) => op.expression_class === 'MaterialExpressionLinearInterpolate');
    expect(lerpOp).toBeDefined();

    // Multiply should have 2 connect_expressions inputs (A, B)
    const mulConnects = connectOps.filter((op) => op.to_temp_id === mulOp!.temp_id);
    expect(mulConnects).toHaveLength(2);
    expect(mulConnects[0].to_input_name).toBe('A');
    expect(mulConnects[1].to_input_name).toBe('B');

    // Lerp should have 3 connect_expressions inputs (A, B, Alpha)
    const lerpConnects = connectOps.filter((op) => op.to_temp_id === lerpOp!.temp_id);
    expect(lerpConnects).toHaveLength(3);
    expect(lerpConnects[0].to_input_name).toBe('A');
    expect(lerpConnects[1].to_input_name).toBe('B');
    expect(lerpConnects[2].to_input_name).toBe('Alpha');

    // Should have exactly 1 connect_material_property
    expect(materialConnectOps).toHaveLength(1);
    expect(materialConnectOps[0].material_property).toBe('BaseColor');
    expect(materialConnectOps[0].from_temp_id).toBe(lerpOp!.temp_id);
  });

  it('creates connect_material_property operations', () => {
    const parsed: MaterialDslResult = {
      settings: {},
      params: [{ type: 'Scalar', name: 'Opacity' }],
      connections: [{
        materialProperty: 'Opacity',
        expression: {
          func: 'Multiply',
          args: [
            { type: 'ref', name: 'Opacity' },
            { type: 'ref', name: 'FadeAlpha' },
          ],
        },
      }],
      warnings: [],
    };
    const ops = materialDslToOperations(parsed);
    const materialConnectOps = ops.filter((op) => op.operation === 'connect_material_property');
    expect(materialConnectOps).toHaveLength(1);
    expect(materialConnectOps[0].material_property).toBe('Opacity');
  });

  it('skips set_material_settings when no settings present', () => {
    const parsed: MaterialDslResult = {
      settings: {},
      params: [{ type: 'Scalar', name: 'X' }],
      connections: [],
      warnings: [],
    };
    const ops = materialDslToOperations(parsed);
    expect(ops.every((op) => op.operation !== 'set_material_settings')).toBe(true);
  });

  it('maps Texture2D param to the correct expression class', () => {
    const parsed: MaterialDslResult = {
      settings: {},
      params: [{ type: 'Texture2D', name: 'Albedo' }],
      connections: [],
      warnings: [],
    };
    const ops = materialDslToOperations(parsed);
    expect(ops[0].expression_class).toBe('MaterialExpressionTextureSampleParameter2D');
  });

  it('maps StaticBool param to the correct expression class', () => {
    const parsed: MaterialDslResult = {
      settings: {},
      params: [{ type: 'StaticBool', name: 'UseDetail', defaultValue: true }],
      connections: [],
      warnings: [],
    };
    const ops = materialDslToOperations(parsed);
    expect(ops[0].expression_class).toBe('MaterialExpressionStaticBoolParameter');
    expect(ops[0].properties).toEqual({
      ParameterName: 'UseDetail',
      DefaultValue: true,
    });
  });

  it('full pipeline for the plan example', () => {
    const dsl = [
      '# Material: M_ButtonBase',
      'Settings: MaterialDomain=Surface, BlendMode=Translucent, ShadingModel=Unlit',
      '',
      'Param Color "BaseColor" = (0.1, 0.14, 0.22, 1.0)',
      'Param Scalar "Opacity" = 0.95',
      'Param Scalar "CornerRadius" = 12.0',
      '',
      'BaseColor <- Lerp(Color, Multiply(Color, 1.3), HoverAlpha)',
      'Opacity <- Multiply(Opacity, FadeAlpha)',
    ].join('\n');

    const parsed = parseMaterialDsl(dsl);
    expect(parsed.warnings).toHaveLength(0);

    const ops = materialDslToOperations(parsed);

    // First operation: settings
    expect(ops[0]).toEqual({
      operation: 'set_material_settings',
      settings: {
        MaterialDomain: 'Surface',
        BlendMode: 'Translucent',
        ShadingModel: 'Unlit',
      },
    });

    // Parameters: 3 add_expression operations for params
    const paramOps = ops.filter(
      (op) => op.operation === 'add_expression'
        && typeof op.temp_id === 'string'
        && (op.temp_id as string).startsWith('param_'),
    );
    expect(paramOps).toHaveLength(3);
    expect(paramOps[0].temp_id).toBe('param_BaseColor');
    expect(paramOps[1].temp_id).toBe('param_Opacity');
    expect(paramOps[2].temp_id).toBe('param_CornerRadius');

    // Should have connect_material_property for BaseColor and Opacity
    const materialConnects = ops.filter((op) => op.operation === 'connect_material_property');
    expect(materialConnects).toHaveLength(2);
    expect(materialConnects[0].material_property).toBe('BaseColor');
    expect(materialConnects[1].material_property).toBe('Opacity');

    // Verify Lerp and Multiply expressions were created
    const exprOps = ops.filter(
      (op) => op.operation === 'add_expression'
        && typeof op.temp_id === 'string'
        && (op.temp_id as string).startsWith('expr_'),
    );
    const lerpOps = exprOps.filter((op) => op.expression_class === 'MaterialExpressionLinearInterpolate');
    const mulOps = exprOps.filter((op) => op.expression_class === 'MaterialExpressionMultiply');
    expect(lerpOps.length).toBeGreaterThanOrEqual(1);
    expect(mulOps.length).toBeGreaterThanOrEqual(1);
  });
});
