// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MaterialDslSettings {
  MaterialDomain?: string;
  BlendMode?: string;
  ShadingModel?: string;
  [key: string]: unknown;
}

export interface MaterialDslParam {
  type: 'Scalar' | 'Vector' | 'Color' | 'Texture2D' | 'StaticBool';
  name: string;
  defaultValue?: unknown;
}

export interface MaterialDslConnection {
  /** Material property name (BaseColor, Opacity, Normal, etc.) */
  materialProperty: string;
  /** Expression chain that feeds into this property */
  expression: MaterialDslExpression;
}

export interface MaterialDslExpression {
  /** Expression function name (Lerp, Multiply, Add, etc.) */
  func: string;
  /** Input arguments — can be param references, literals, or nested expressions */
  args: MaterialDslArg[];
}

export type MaterialDslArg =
  | { type: 'ref'; name: string }
  | { type: 'literal'; value: number | string | number[] }
  | { type: 'expression'; expr: MaterialDslExpression };

export interface MaterialDslResult {
  name?: string;
  settings: MaterialDslSettings;
  params: MaterialDslParam[];
  connections: MaterialDslConnection[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Expression class mappings
// ---------------------------------------------------------------------------

const EXPRESSION_CLASS_MAP: Record<string, string> = {
  Lerp: 'MaterialExpressionLinearInterpolate',
  Multiply: 'MaterialExpressionMultiply',
  Add: 'MaterialExpressionAdd',
  Subtract: 'MaterialExpressionSubtract',
  Divide: 'MaterialExpressionDivide',
  Power: 'MaterialExpressionPower',
  Clamp: 'MaterialExpressionClamp',
  OneMinus: 'MaterialExpressionOneMinus',
  Abs: 'MaterialExpressionAbs',
  Dot: 'MaterialExpressionDotProduct',
  Cross: 'MaterialExpressionCrossProduct',
  Normalize: 'MaterialExpressionNormalize',
  TextureSample: 'MaterialExpressionTextureSample',
  Time: 'MaterialExpressionTime',
  Constant: 'MaterialExpressionConstant',
  Constant3: 'MaterialExpressionConstant3Vector',
  Constant4: 'MaterialExpressionConstant4Vector',
};

const PARAM_CLASS_MAP: Record<string, string> = {
  Scalar: 'MaterialExpressionScalarParameter',
  Vector: 'MaterialExpressionVectorParameter',
  Color: 'MaterialExpressionVectorParameter',
  Texture2D: 'MaterialExpressionTextureSampleParameter2D',
  StaticBool: 'MaterialExpressionStaticBoolParameter',
};

// Standard input names for well-known expression functions.
const EXPRESSION_INPUT_NAMES: Record<string, string[]> = {
  Lerp: ['A', 'B', 'Alpha'],
  Multiply: ['A', 'B'],
  Add: ['A', 'B'],
  Subtract: ['A', 'B'],
  Divide: ['A', 'B'],
  Power: ['Base', 'Exponent'],
  Clamp: ['Input', 'Min', 'Max'],
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseMaterialDsl(dsl: string): MaterialDslResult {
  const warnings: string[] = [];
  const lines = dsl.split(/\r?\n/);

  let name: string | undefined;
  const settings: MaterialDslSettings = {};
  const params: MaterialDslParam[] = [];
  const connections: MaterialDslConnection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip blank lines
    if (trimmed.length === 0) continue;

    // Skip comments (// style)
    if (trimmed.startsWith('//')) continue;

    // Comment or header line: lines starting with #
    // Only the first # line can be a header (sets the name); subsequent # lines are comments.
    if (trimmed.startsWith('#')) {
      if (name === undefined) {
        const headerMatch = trimmed.match(/^#\s+(?:Material:\s*)?(.+)$/);
        if (headerMatch) {
          name = headerMatch[1].trim();
        }
      }
      continue;
    }

    // Settings line: Settings: Key=Value, Key2=Value2
    if (trimmed.startsWith('Settings:')) {
      parseSettingsLine(trimmed.slice('Settings:'.length).trim(), settings, lineNum, warnings);
      continue;
    }

    // Param line: Param Type "Name" = DefaultValue
    const paramMatch = trimmed.match(/^Param\s+(\S+)\s+"([^"]+)"(?:\s*=\s*(.+))?$/);
    if (paramMatch) {
      const paramType = paramMatch[1] as MaterialDslParam['type'];
      const validTypes = ['Scalar', 'Vector', 'Color', 'Texture2D', 'StaticBool'];
      if (!validTypes.includes(paramType)) {
        warnings.push(`Line ${lineNum}: unrecognized param type '${paramType}'`);
      }
      const param: MaterialDslParam = {
        type: paramType,
        name: paramMatch[2],
      };
      if (paramMatch[3] !== undefined) {
        param.defaultValue = parseDefaultValue(paramMatch[3].trim(), paramType);
      }
      params.push(param);
      continue;
    }

    // Connection line: MaterialProperty <- Expression(args...)
    const arrowIdx = trimmed.indexOf('<-');
    if (arrowIdx > 0) {
      const materialProperty = trimmed.slice(0, arrowIdx).trim();
      const exprStr = trimmed.slice(arrowIdx + 2).trim();
      const expr = parseExpression(exprStr, lineNum, warnings);
      if (expr) {
        connections.push({ materialProperty, expression: expr });
      }
      continue;
    }

    // Unrecognized line
    warnings.push(`Line ${lineNum}: unrecognized line '${trimmed}'`);
  }

  return { name, settings, params, connections, warnings };
}

// ---------------------------------------------------------------------------
// Settings parser
// ---------------------------------------------------------------------------

function parseSettingsLine(
  text: string,
  settings: MaterialDslSettings,
  lineNum: number,
  warnings: string[],
): void {
  // Split by commas at top level
  const pairs = splitTopLevel(text, ',');
  for (const pair of pairs) {
    const trimmedPair = pair.trim();
    if (trimmedPair.length === 0) continue;
    const eqIdx = trimmedPair.indexOf('=');
    if (eqIdx < 0) {
      warnings.push(`Line ${lineNum}: malformed setting '${trimmedPair}'`);
      continue;
    }
    const key = trimmedPair.slice(0, eqIdx).trim();
    const value = trimmedPair.slice(eqIdx + 1).trim();
    settings[key] = parseSettingValue(value);
  }
}

function parseSettingValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw.length > 0) return num;
  return raw;
}

// ---------------------------------------------------------------------------
// Default value parser
// ---------------------------------------------------------------------------

function parseDefaultValue(raw: string, paramType: string): unknown {
  // Tuple: (r, g, b, a) or (x, y, z) or (x, y, z, w)
  const tupleMatch = raw.match(/^\((.+)\)$/);
  if (tupleMatch) {
    const parts = tupleMatch[1].split(',').map((s) => Number(s.trim()));
    return parts;
  }

  // Quoted string (for texture paths)
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }

  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw.length > 0) {
    // For Color type with scalar default, wrap in array for consistency
    if (paramType === 'Color' || paramType === 'Vector') {
      return num;
    }
    return num;
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Expression parser
// ---------------------------------------------------------------------------

function parseExpression(
  text: string,
  lineNum: number,
  warnings: string[],
): MaterialDslExpression | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    warnings.push(`Line ${lineNum}: empty expression`);
    return null;
  }

  // Look for FuncName(...)
  const parenIdx = trimmed.indexOf('(');
  if (parenIdx < 0) {
    // Not a function call — this is just a bare reference, treat as single-arg identity.
    // This shouldn't happen at the top level of a connection, but handle gracefully.
    warnings.push(`Line ${lineNum}: expected function call but got '${trimmed}'`);
    return null;
  }

  const funcName = trimmed.slice(0, parenIdx).trim();
  if (funcName.length === 0) {
    warnings.push(`Line ${lineNum}: missing function name before '('`);
    return null;
  }

  // Find matching closing paren
  const lastParen = findMatchingParen(trimmed, parenIdx);
  if (lastParen < 0) {
    warnings.push(`Line ${lineNum}: unmatched parenthesis in '${trimmed}'`);
    return null;
  }

  const argsStr = trimmed.slice(parenIdx + 1, lastParen);
  const argTokens = splitTopLevel(argsStr, ',');

  const args: MaterialDslArg[] = [];
  for (const token of argTokens) {
    const argTrimmed = token.trim();
    if (argTrimmed.length === 0) continue;
    args.push(parseArg(argTrimmed, lineNum, warnings));
  }

  return { func: funcName, args };
}

function parseArg(
  text: string,
  lineNum: number,
  warnings: string[],
): MaterialDslArg {
  const trimmed = text.trim();

  // Nested expression: has parentheses
  const parenIdx = trimmed.indexOf('(');
  if (parenIdx > 0) {
    const expr = parseExpression(trimmed, lineNum, warnings);
    if (expr) {
      return { type: 'expression', expr };
    }
  }

  // Tuple literal: (r, g, b) or (r, g, b, a)
  const tupleMatch = trimmed.match(/^\((.+)\)$/);
  if (tupleMatch) {
    const parts = tupleMatch[1].split(',').map((s) => Number(s.trim()));
    if (parts.every((n) => !isNaN(n))) {
      return { type: 'literal', value: parts };
    }
  }

  // Number literal
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed.length > 0 && !trimmed.startsWith('"')) {
    return { type: 'literal', value: num };
  }

  // Quoted string literal
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return { type: 'literal', value: trimmed.slice(1, -1) };
  }

  // Reference (parameter name or expression name)
  return { type: 'ref', name: trimmed };
}

// ---------------------------------------------------------------------------
// DSL-to-Operations converter
// ---------------------------------------------------------------------------

export function materialDslToOperations(parsed: MaterialDslResult): Record<string, unknown>[] {
  const operations: Record<string, unknown>[] = [];
  let nodeCounter = 0;
  const tempIdMap = new Map<string, string>();

  // 1. Settings operation
  if (Object.keys(parsed.settings).length > 0) {
    operations.push({
      operation: 'set_material_settings',
      settings: parsed.settings,
    });
  }

  // 2. Add parameter expressions
  for (const param of parsed.params) {
    const tempId = `param_${param.name}`;
    tempIdMap.set(param.name, tempId);

    const properties: Record<string, unknown> = {
      ParameterName: param.name,
    };
    if (param.defaultValue !== undefined) {
      properties.DefaultValue = param.defaultValue;
    }

    operations.push({
      operation: 'add_expression',
      expression_class: getExpressionClassForParam(param.type),
      temp_id: tempId,
      properties,
    });
  }

  // 3. Process connections
  for (const conn of parsed.connections) {
    const resultTempId = flattenExpression(conn.expression, operations, tempIdMap, nodeCounter);
    nodeCounter = extractCounterFromTempId(resultTempId, nodeCounter);

    operations.push({
      operation: 'connect_material_property',
      from_temp_id: resultTempId,
      material_property: conn.materialProperty,
    });
  }

  return operations;
}

function flattenExpression(
  expr: MaterialDslExpression,
  operations: Record<string, unknown>[],
  tempIdMap: Map<string, string>,
  counter: number,
): string {
  // Recursively flatten all child args first
  const inputTempIds: string[] = [];

  for (const arg of expr.args) {
    if (arg.type === 'ref') {
      // Look up in tempIdMap (parameter or prior expression)
      const mapped = tempIdMap.get(arg.name);
      inputTempIds.push(mapped ?? arg.name);
    } else if (arg.type === 'literal') {
      // Create a constant expression for the literal
      const constTempId = `expr_const_${counter++}`;
      const constOp = createConstantExpression(arg.value, constTempId);
      operations.push(constOp);
      tempIdMap.set(constTempId, constTempId);
      inputTempIds.push(constTempId);
    } else if (arg.type === 'expression') {
      const childTempId = flattenExpression(arg.expr, operations, tempIdMap, counter);
      counter = extractCounterFromTempId(childTempId, counter);
      inputTempIds.push(childTempId);
    }
  }

  // Create the expression node itself
  const expressionClass = getExpressionClassForFunc(expr.func);
  const tempId = `expr_${expr.func}_${counter++}`;

  operations.push({
    operation: 'add_expression',
    expression_class: expressionClass,
    temp_id: tempId,
  });

  // Connect inputs
  const inputNames = EXPRESSION_INPUT_NAMES[expr.func];
  for (let i = 0; i < inputTempIds.length; i++) {
    const connectOp: Record<string, unknown> = {
      operation: 'connect_expressions',
      from_temp_id: inputTempIds[i],
      to_temp_id: tempId,
    };

    if (inputNames && i < inputNames.length) {
      connectOp.to_input_name = inputNames[i];
    } else {
      connectOp.to_input_index = i;
    }

    operations.push(connectOp);
  }

  tempIdMap.set(tempId, tempId);
  return tempId;
}

function extractCounterFromTempId(tempId: string, fallback: number): number {
  const match = tempId.match(/_(\d+)$/);
  if (match) {
    return Math.max(fallback, Number(match[1]) + 1);
  }
  return fallback;
}

function createConstantExpression(
  value: number | string | number[],
  tempId: string,
): Record<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length === 3) {
      return {
        operation: 'add_expression',
        expression_class: EXPRESSION_CLASS_MAP.Constant3,
        temp_id: tempId,
        properties: { Constant: { R: value[0], G: value[1], B: value[2] } },
      };
    }
    if (value.length === 4) {
      return {
        operation: 'add_expression',
        expression_class: EXPRESSION_CLASS_MAP.Constant4,
        temp_id: tempId,
        properties: { Constant: { R: value[0], G: value[1], B: value[2], A: value[3] } },
      };
    }
  }

  if (typeof value === 'number') {
    return {
      operation: 'add_expression',
      expression_class: EXPRESSION_CLASS_MAP.Constant,
      temp_id: tempId,
      properties: { R: value },
    };
  }

  // String value — treat as a texture path reference for TextureSample
  return {
    operation: 'add_expression',
    expression_class: EXPRESSION_CLASS_MAP.TextureSample,
    temp_id: tempId,
    properties: { TexturePath: value },
  };
}

function getExpressionClassForParam(paramType: string): string {
  return PARAM_CLASS_MAP[paramType] ?? PARAM_CLASS_MAP.Scalar;
}

function getExpressionClassForFunc(funcName: string): string {
  return EXPRESSION_CLASS_MAP[funcName] ?? funcName;
}

// ---------------------------------------------------------------------------
// Utility: split at top level (respecting nested parens)
// ---------------------------------------------------------------------------

function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === delimiter && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

function findMatchingParen(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
