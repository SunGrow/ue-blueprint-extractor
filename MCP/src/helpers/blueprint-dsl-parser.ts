// ---------------------------------------------------------------------------
// Blueprint Graph DSL Parser
//
// Converts a pseudocode-style DSL into an intermediate representation that
// maps to the `upsert_function_graphs` payload for `modify_blueprint_graphs`.
//
// The DSL is a high-level intent description — the UE subsystem handles
// actual node creation, UUID assignment, and pin resolution.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public types — Intermediate Representation
// ---------------------------------------------------------------------------

export interface BlueprintDslNode {
  /** Node type: function call, event, variable get/set, branch, cast, macro, literal. */
  type: 'event' | 'call' | 'variable_get' | 'variable_set' | 'branch' | 'cast' | 'macro' | 'literal';
  /** The function/event/variable name. */
  name: string;
  /** Target object (e.g., "PC" in "PC.GetPawn"). */
  target?: string;
  /** Cast target class. */
  castTo?: string;
  /** Alias for the output (e.g., "as PC"). */
  alias?: string;
  /** Arguments (for function calls). */
  args?: Record<string, unknown>;
  /** Connections to next nodes (exec pins). */
  then?: BlueprintDslNode[];
  /** Named output branches (for Branch, Switch, etc.). */
  branches?: Record<string, BlueprintDslNode[]>;
  /** Comparison condition (for `condition ? Branch`). */
  condition?: { left: string; operator: string; right: string };
}

export interface BlueprintDslGraph {
  graphName: string;
  nodes: BlueprintDslNode[];
}

export interface BlueprintDslResult {
  graphs: BlueprintDslGraph[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Payload types (output of converter)
// ---------------------------------------------------------------------------

export interface PayloadNode {
  nodeClass: string;
  tempId: string;
  [key: string]: unknown;
}

export interface PayloadConnection {
  fromNode: string;
  fromPin: string;
  toNode: string;
  toPin: string;
}

export interface PayloadGraph {
  graphName: string;
  nodes: PayloadNode[];
  connections: PayloadConnection[];
}

// ---------------------------------------------------------------------------
// Main entry point — Parser
// ---------------------------------------------------------------------------

export function parseBlueprintDsl(dsl: string): BlueprintDslResult {
  const warnings: string[] = [];
  const rawLines = dsl.split(/\r?\n/);
  const graphs: BlueprintDslGraph[] = [];

  let currentGraph: BlueprintDslGraph | null = null;
  let branchContext: BranchContext | null = null;

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    const raw = rawLines[lineIdx];
    const trimmed = raw.trimEnd();

    // Skip blank lines and comments
    if (trimmed.length === 0) continue;
    const stripped = trimmed.trimStart();
    if (stripped.startsWith('#') || stripped.startsWith('//')) continue;

    // Measure indentation
    const normalized = trimmed.replace(/\t/g, '  ');
    const strippedNorm = normalized.trimStart();
    const leadingSpaces = normalized.length - strippedNorm.length;

    // Graph header: line ending with `:` at indent level 0
    if (leadingSpaces === 0 && stripped.endsWith(':') && !stripped.includes('->')) {
      const graphName = stripped.slice(0, -1).trim();
      if (graphName.length === 0) {
        warnings.push(`Line ${lineNum}: empty graph name`);
        continue;
      }
      currentGraph = { graphName, nodes: [] };
      graphs.push(currentGraph);
      branchContext = null;
      continue;
    }

    // If no graph header yet, create a default EventGraph
    if (!currentGraph) {
      currentGraph = { graphName: 'EventGraph', nodes: [] };
      graphs.push(currentGraph);
    }

    // Check for branch label lines: `True ->`, `False ->`, `Default ->`
    const branchLabelMatch = stripped.match(/^(\w+)\s*->\s*$/);
    if (branchLabelMatch && branchContext) {
      branchContext.currentLabel = branchLabelMatch[1];
      continue;
    }

    // Check for inline branch labels: `True -> NodeChain`
    const inlineBranchMatch = stripped.match(/^(\w+)\s*->\s+(.+)$/);
    if (inlineBranchMatch && branchContext && leadingSpaces > branchContext.indent) {
      const label = inlineBranchMatch[1];
      const chainStr = inlineBranchMatch[2];
      const chain = parseChain(chainStr, lineNum, warnings);
      if (chain.length > 0) {
        const branchNode = branchContext.node;
        if (!branchNode.branches) branchNode.branches = {};
        if (!branchNode.branches[label]) branchNode.branches[label] = [];
        branchNode.branches[label].push(...chain);
      }
      continue;
    }

    // Check for branch continuation (indented lines after a branch label)
    if (branchContext && branchContext.currentLabel && leadingSpaces > branchContext.indent) {
      const chain = parseChain(stripped, lineNum, warnings);
      if (chain.length > 0) {
        const branchNode = branchContext.node;
        if (!branchNode.branches) branchNode.branches = {};
        const label = branchContext.currentLabel;
        if (!branchNode.branches[label]) branchNode.branches[label] = [];
        branchNode.branches[label].push(...chain);
      }
      continue;
    }

    // Reset branch context if we're back at or above the branch indent level
    if (branchContext && leadingSpaces <= branchContext.indent) {
      branchContext = null;
    }

    // Parse the line as a chain of nodes
    const chain = parseChain(stripped, lineNum, warnings);
    if (chain.length === 0) continue;

    // Check if the last node in the chain is a branch
    const lastNode = chain[chain.length - 1];
    if (lastNode.type === 'branch') {
      branchContext = {
        node: lastNode,
        indent: leadingSpaces,
        currentLabel: null,
      };
    }

    // Wire chain: each node's `then` points to the next
    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].then = [chain[i + 1]];
    }

    // Add root of chain to current graph
    currentGraph.nodes.push(chain[0]);
  }

  // If no graphs were produced at all (empty or comment-only input), return empty
  return { graphs, warnings };
}

// ---------------------------------------------------------------------------
// Branch context tracking
// ---------------------------------------------------------------------------

interface BranchContext {
  node: BlueprintDslNode;
  indent: number;
  currentLabel: string | null;
}

// ---------------------------------------------------------------------------
// Chain parser — handles `A -> B -> C` chains within a single line
// ---------------------------------------------------------------------------

function parseChain(line: string, lineNum: number, warnings: string[]): BlueprintDslNode[] {
  // Strip trailing ` ->` — this signals continuation on the next indented line
  // but has no effect on the current chain (the connection is implicit).
  const cleaned = line.replace(/\s*->\s*$/, '');

  // Split on ` -> ` (with surrounding spaces) but preserve content inside parens
  const segments = splitChainArrow(cleaned);
  const nodes: BlueprintDslNode[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) continue;

    const node = parseNodeExpression(trimmed, lineNum, warnings);
    if (node) {
      nodes.push(node);
    }
  }

  return nodes;
}

/**
 * Split a line on ` -> ` tokens, but NOT inside parentheses.
 * E.g. `A(x, y) -> B -> C(a -> b)` splits into [`A(x, y)`, `B`, `C(a -> b)`].
 */
function splitChainArrow(line: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }

    if (depth === 0 && i + 3 < line.length
      && line[i] === ' ' && line[i + 1] === '-' && line[i + 2] === '>' && line[i + 3] === ' ') {
      segments.push(line.slice(start, i));
      start = i + 4; // skip ` -> `
      i += 3;
    }
  }

  segments.push(line.slice(start));
  return segments;
}

// ---------------------------------------------------------------------------
// Node expression parser — single node token
// ---------------------------------------------------------------------------

function parseNodeExpression(expr: string, lineNum: number, warnings: string[]): BlueprintDslNode | null {
  let remaining = expr;

  // Extract trailing `as Alias`
  let alias: string | undefined;
  const asMatch = remaining.match(/\s+as\s+(\w+)\s*$/);
  if (asMatch) {
    alias = asMatch[1];
    remaining = remaining.slice(0, asMatch.index!).trim();
  }

  // Check for condition pattern: `left operator right ? Branch`
  const conditionMatch = remaining.match(/^(\S+)\s*(>|<|>=|<=|==|!=)\s*(\S+)\s*\?\s*Branch$/);
  if (conditionMatch) {
    return {
      type: 'branch',
      name: 'Branch',
      condition: {
        left: conditionMatch[1],
        operator: conditionMatch[2],
        right: conditionMatch[3],
      },
      alias,
    };
  }

  // Check for Event prefix: `Event BeginPlay`
  const eventMatch = remaining.match(/^Event\s+(\w+)$/);
  if (eventMatch) {
    return {
      type: 'event',
      name: eventMatch[1],
      alias,
    };
  }

  // Check for CastTo pattern: `CastTo(ClassName)`
  const castMatch = remaining.match(/^CastTo\(([^)]+)\)$/);
  if (castMatch) {
    return {
      type: 'cast',
      name: 'CastTo',
      castTo: castMatch[1].trim(),
      alias,
    };
  }

  // Check for Set variable: `Set VarName = value`
  const setMatch = remaining.match(/^Set\s+(\w+)\s*=\s*(.+)$/);
  if (setMatch) {
    return {
      type: 'variable_set',
      name: setMatch[1],
      args: { value: parseArgValue(setMatch[2].trim()) },
      alias,
    };
  }

  // Check for function call with target: `Target.FunctionName(args)` or `Target.FunctionName`
  const targetCallMatch = remaining.match(/^(\w+)\.(\w+)(?:\(([^)]*)\))?$/);
  if (targetCallMatch) {
    const target = targetCallMatch[1];
    const funcName = targetCallMatch[2];
    const argsStr = targetCallMatch[3];
    const node: BlueprintDslNode = {
      type: 'call',
      name: funcName,
      target,
      alias,
    };
    if (argsStr !== undefined && argsStr.trim().length > 0) {
      node.args = parseArgs(argsStr, lineNum, warnings);
    }
    return node;
  }

  // Check for plain function call: `FunctionName(args)`
  const callMatch = remaining.match(/^(\w+)\(([^)]*)\)$/);
  if (callMatch) {
    const funcName = callMatch[1];
    const argsStr = callMatch[2];
    const node: BlueprintDslNode = {
      type: 'call',
      name: funcName,
      alias,
    };
    if (argsStr.trim().length > 0) {
      node.args = parseArgs(argsStr, lineNum, warnings);
    }
    return node;
  }

  // Check for plain function call with no args: `FunctionName()` (already handled above via empty args)
  // or plain identifier (variable get or parameterless function)
  const identMatch = remaining.match(/^(\w+)$/);
  if (identMatch) {
    return {
      type: 'variable_get',
      name: identMatch[1],
      alias,
    };
  }

  // Unrecognized pattern
  warnings.push(`Line ${lineNum}: unrecognized node expression: "${expr}"`);
  return null;
}

// ---------------------------------------------------------------------------
// Argument parsing — `key=value, key=value` or positional `value, value`
// ---------------------------------------------------------------------------

function parseArgs(argsStr: string, lineNum: number, warnings: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const parts = argsStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const eqIdx = part.indexOf('=');
    if (eqIdx >= 0) {
      const key = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      result[key] = parseArgValue(value);
    } else {
      // Positional argument — use index as key
      result[`arg${i}`] = parseArgValue(part);
    }
  }

  return result;
}

function parseArgValue(raw: string): unknown {
  // Quoted string
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Null
  if (raw === 'null') return null;
  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw.length > 0) return num;
  // Unquoted identifier / string
  return raw;
}

// ---------------------------------------------------------------------------
// DSL-to-Payload Converter
// ---------------------------------------------------------------------------

export function blueprintDslToPayload(graphs: BlueprintDslGraph[]): { functionGraphs: PayloadGraph[] } {
  const functionGraphs: PayloadGraph[] = [];

  for (const graph of graphs) {
    const ctx: ConvertContext = {
      nodes: [],
      connections: [],
      aliasMap: new Map(),
      nextId: 0,
    };

    for (const rootNode of graph.nodes) {
      convertNodeTree(rootNode, ctx);
    }

    functionGraphs.push({
      graphName: graph.graphName,
      nodes: ctx.nodes,
      connections: ctx.connections,
    });
  }

  return { functionGraphs };
}

// ---------------------------------------------------------------------------
// Converter internals
// ---------------------------------------------------------------------------

interface ConvertContext {
  nodes: PayloadNode[];
  connections: PayloadConnection[];
  aliasMap: Map<string, string>; // alias -> tempId
  nextId: number;
}

function allocTempId(ctx: ConvertContext): string {
  return `n${ctx.nextId++}`;
}

/**
 * Convert a DSL node (and its `then` / `branches` children) into payload nodes
 * and connections. Returns the tempId of the created node.
 */
function convertNodeTree(node: BlueprintDslNode, ctx: ConvertContext): string {
  const tempId = allocTempId(ctx);
  const payloadNode = buildPayloadNode(node, tempId, ctx);
  ctx.nodes.push(payloadNode);

  // Register alias
  if (node.alias) {
    ctx.aliasMap.set(node.alias, tempId);
  }

  // Process `then` chain (exec output -> next node)
  // Connection is recorded first, then recurse — this keeps connections in
  // declaration order (parent -> child before child -> grandchild).
  if (node.then && node.then.length > 0) {
    for (const nextNode of node.then) {
      const nextId = allocTempId(ctx);
      ctx.connections.push({
        fromNode: tempId,
        fromPin: 'then',
        toNode: nextId,
        toPin: 'execute',
      });
      convertNodeTreeWithId(nextNode, nextId, ctx);
    }
  }

  // Process branches
  if (node.branches) {
    for (const [label, branchNodes] of Object.entries(node.branches)) {
      const pinName = mapBranchLabelToPin(label);
      for (const branchNode of branchNodes) {
        const branchId = allocTempId(ctx);
        ctx.connections.push({
          fromNode: tempId,
          fromPin: pinName,
          toNode: branchId,
          toPin: 'execute',
        });
        convertNodeTreeWithId(branchNode, branchId, ctx);
      }
    }
  }

  // Process condition — add comparison node and wire it to the branch
  if (node.condition) {
    const condNode = buildConditionNode(node.condition, ctx);
    ctx.connections.push({
      fromNode: condNode.tempId,
      fromPin: 'ReturnValue',
      toNode: tempId,
      toPin: 'Condition',
    });
  }

  return tempId;
}

/**
 * Convert a DSL node using a pre-allocated tempId.
 * Used when the caller has already reserved the id for connection ordering.
 */
function convertNodeTreeWithId(node: BlueprintDslNode, tempId: string, ctx: ConvertContext): void {
  const payloadNode = buildPayloadNode(node, tempId, ctx);
  ctx.nodes.push(payloadNode);

  if (node.alias) {
    ctx.aliasMap.set(node.alias, tempId);
  }

  if (node.then && node.then.length > 0) {
    for (const nextNode of node.then) {
      const nextId = allocTempId(ctx);
      ctx.connections.push({
        fromNode: tempId,
        fromPin: 'then',
        toNode: nextId,
        toPin: 'execute',
      });
      convertNodeTreeWithId(nextNode, nextId, ctx);
    }
  }

  if (node.branches) {
    for (const [label, branchNodes] of Object.entries(node.branches)) {
      const pinName = mapBranchLabelToPin(label);
      for (const branchNode of branchNodes) {
        const branchId = allocTempId(ctx);
        ctx.connections.push({
          fromNode: tempId,
          fromPin: pinName,
          toNode: branchId,
          toPin: 'execute',
        });
        convertNodeTreeWithId(branchNode, branchId, ctx);
      }
    }
  }

  if (node.condition) {
    const condNode = buildConditionNode(node.condition, ctx);
    ctx.connections.push({
      fromNode: condNode.tempId,
      fromPin: 'ReturnValue',
      toNode: tempId,
      toPin: 'Condition',
    });
  }
}

function buildPayloadNode(node: BlueprintDslNode, tempId: string, ctx: ConvertContext): PayloadNode {
  switch (node.type) {
    case 'event':
      return { nodeClass: 'K2Node_Event', tempId, eventName: node.name };

    case 'call': {
      const pn: PayloadNode = {
        nodeClass: 'K2Node_CallFunction',
        tempId,
        functionName: node.name,
      };
      if (node.target) {
        // Resolve alias to tempId if known, otherwise pass through as target name
        const resolvedTarget = ctx.aliasMap.get(node.target);
        pn.target = resolvedTarget ?? node.target;
      }
      if (node.args) {
        pn.args = node.args;
      }
      return pn;
    }

    case 'cast':
      return { nodeClass: 'K2Node_DynamicCast', tempId, targetClass: node.castTo };

    case 'branch':
      return { nodeClass: 'K2Node_IfThenElse', tempId };

    case 'variable_get':
      return { nodeClass: 'K2Node_VariableGet', tempId, variableName: node.name };

    case 'variable_set': {
      const pn: PayloadNode = { nodeClass: 'K2Node_VariableSet', tempId, variableName: node.name };
      if (node.args) {
        pn.value = node.args.value;
      }
      return pn;
    }

    case 'macro':
      return { nodeClass: 'K2Node_MacroInstance', tempId, macroName: node.name };

    case 'literal':
      return { nodeClass: 'K2Node_Literal', tempId, value: node.name };
  }
}

function buildConditionNode(
  condition: { left: string; operator: string; right: string },
  ctx: ConvertContext,
): PayloadNode {
  const tempId = allocTempId(ctx);
  const node: PayloadNode = {
    nodeClass: 'K2Node_CallFunction',
    tempId,
    functionName: operatorToFunctionName(condition.operator),
    args: { A: resolveConditionOperand(condition.left, ctx), B: resolveConditionOperand(condition.right, ctx) },
  };
  ctx.nodes.push(node);
  return node;
}

function resolveConditionOperand(operand: string, ctx: ConvertContext): unknown {
  // Check alias map
  const resolved = ctx.aliasMap.get(operand);
  if (resolved) return resolved;

  // Try as number
  const num = Number(operand);
  if (!isNaN(num) && operand.length > 0) return num;

  // Return as-is (variable or literal reference)
  return operand;
}

function operatorToFunctionName(operator: string): string {
  switch (operator) {
    case '>': return 'Greater';
    case '<': return 'Less';
    case '>=': return 'GreaterEqual';
    case '<=': return 'LessEqual';
    case '==': return 'EqualEqual';
    case '!=': return 'NotEqual';
    default: return operator;
  }
}

function mapBranchLabelToPin(label: string): string {
  // Standard if-then-else branch labels
  const map: Record<string, string> = {
    True: 'True',
    False: 'False',
    Default: 'Default',
  };
  return map[label] ?? label;
}
