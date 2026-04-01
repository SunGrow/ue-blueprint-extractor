/**
 * Compacts Blueprint extraction JSON by stripping low-value fields and minifying.
 * Reduces size by ~50-70% for LLM consumption.
 */

type AnyObject = Record<string, unknown>;
const GUID_AND_POSITION_PATTERNS = [/guid$/i, /^pos[xy]$/i] as const;

function isPlainObject(value: unknown): value is AnyObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deleteEmptyObjectField(object: AnyObject, key: string): void {
  const value = object[key];
  if (isPlainObject(value) && Object.keys(value).length === 0) {
    delete object[key];
  }
}

function deleteEmptyArrayField(object: AnyObject, key: string): void {
  const value = object[key];
  if (Array.isArray(value) && value.length === 0) {
    delete object[key];
  }
}

function shouldStripField(key: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(key));
}

function stripNullsInPlace(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) stripNullsInPlace(entry);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (value[key] === null) {
      delete value[key];
      continue;
    }
    stripNullsInPlace(value[key]);
  }
}

const WIDGET_DEFAULT_STRIP_PATTERNS: [string, unknown][] = [
  ['bIsVariable', false],
  ['Visibility', 'Visible'],
  ['Visibility', 'SelfHitTestInvisible'],
  ['RenderOpacity', 1.0],
  ['RenderOpacity', 1],
  ['IsEnabled', true],
];

function stripWidgetDefaultsInPlace(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) stripWidgetDefaultsInPlace(entry);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [field, defaultValue] of WIDGET_DEFAULT_STRIP_PATTERNS) {
    if (field in value && value[field] === defaultValue) {
      delete value[field];
    }
  }
  for (const key of Object.keys(value)) {
    stripWidgetDefaultsInPlace(value[key]);
  }
}

function stripFieldsInPlace(value: unknown, fieldPatterns: readonly RegExp[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      stripFieldsInPlace(entry, fieldPatterns);
    }
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  for (const key of Object.keys(value)) {
    if (shouldStripField(key, fieldPatterns)) {
      delete value[key];
      continue;
    }

    stripFieldsInPlace(value[key], fieldPatterns);
    deleteEmptyArrayField(value, key);
    deleteEmptyObjectField(value, key);
  }
}

export function stripFields<T>(data: T, fieldPatterns: readonly RegExp[]): T {
  stripFieldsInPlace(data, fieldPatterns);
  return data;
}

export function compactGenericExtraction(data: unknown): unknown {
  stripNullsInPlace(data);
  return stripFields(data, GUID_AND_POSITION_PATTERNS);
}

/**
 * Compacts a parsed Blueprint extraction result.
 * - Removes positional data (posX, posY), GUIDs, empty fields
 * - Replaces nodeGuid with sequential short IDs (n0, n1, ...)
 * - Rewrites connection references to use short IDs
 * - Replaces exec pin type objects with the string "exec"
 */
export function compactBlueprint(data: unknown): unknown {
  if (!isPlainObject(data)) return data;
  stripNullsInPlace(data);
  const root = data;

  const bp = root.blueprint as AnyObject | undefined;
  if (!bp) return data;

  // Branch 1: Compact graphs (if present)
  const functions = bp.functions as AnyObject[] | undefined;
  if (Array.isArray(functions)) {
    for (const graph of functions) {
      compactGraph(graph);
    }
  }

  // Branch 2: Compact widget tree (if present)
  const wt = bp.widgetTree as AnyObject | undefined;
  if (wt && typeof wt === 'object' && wt.rootWidget) {
    compactWidgetNode(wt.rootWidget as AnyObject);
  }

  return data;
}

export function compactWidgetBlueprint(data: unknown): unknown {
  if (!isPlainObject(data)) return data;

  // Strip nulls and widget defaults inside sub-trees, not at data root
  // (top-level nulls like rootWidget: null carry semantic meaning)
  for (const key of Object.keys(data)) {
    if (data[key] !== null) {
      stripNullsInPlace(data[key]);
    }
  }
  stripWidgetDefaultsInPlace(data);

  const rootWidget = data.rootWidget;
  if (isPlainObject(rootWidget)) {
    compactWidgetNode(rootWidget);
  }

  const functions = data.functions;
  if (Array.isArray(functions)) {
    for (const graph of functions) {
      if (isPlainObject(graph)) {
        compactGraph(graph);
      }
    }
  }

  const compile = data.compile;
  if (isPlainObject(compile)) {
    deleteEmptyArrayField(compile, 'errors');
    deleteEmptyArrayField(compile, 'warnings');
    deleteEmptyArrayField(compile, 'messages');
  }

  deleteEmptyObjectField(data, 'bindings');
  deleteEmptyArrayField(data, 'animations');
  return data;
}

export function compactBehaviorTree(data: unknown): unknown {
  if (!isPlainObject(data)) return data;
  stripNullsInPlace(data);

  delete data.schemaVersion;

  const behaviorTree = data.behaviorTree;
  if (!isPlainObject(behaviorTree)) {
    return data;
  }

  const rootNode = behaviorTree.rootNode;
  if (isPlainObject(rootNode)) {
    compactBehaviorTreeNode(rootNode);
  }

  return data;
}

export function compactStateTree(data: unknown): unknown {
  if (!isPlainObject(data)) return data;
  stripNullsInPlace(data);

  delete data.schemaVersion;

  const stateTree = data.stateTree;
  if (!isPlainObject(stateTree)) {
    return data;
  }

  compactStateTreeNodeArray(stateTree, 'evaluators');
  compactStateTreeNodeArray(stateTree, 'globalTasks');

  const states = stateTree.states;
  if (Array.isArray(states)) {
    for (const state of states) {
      if (isPlainObject(state)) {
        compactStateTreeState(state);
      }
    }
    deleteEmptyArrayField(stateTree, 'states');
  }

  return data;
}

export function compactMaterial(data: unknown): unknown {
  if (!isPlainObject(data)) {
    return data;
  }
  stripNullsInPlace(data);

  const graph = findMaterialGraphRoot(data);
  if (!graph) {
    return compactGenericExtraction(data);
  }

  compactMaterialExpressions(graph);
  return compactGenericExtraction(data);
}

function compactGraph(graph: AnyObject): void {
  // Remove graphGuid at graph level
  delete graph.graphGuid;

  const nodes = graph.nodes as AnyObject[] | undefined;
  if (!Array.isArray(nodes)) return;

  // Build guidToShortId map
  const guidToShortId = new Map<string, string>();
  for (let i = 0; i < nodes.length; i++) {
    const guid = nodes[i].nodeGuid as string | undefined;
    if (guid) {
      guidToShortId.set(guid, `n${i}`);
    }
  }

  // Process each node
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Replace nodeGuid with short ID
    delete node.nodeGuid;
    node.id = `n${i}`;

    // Remove positional data
    delete node.posX;
    delete node.posY;

    // Remove empty nodeComment
    if (node.nodeComment === '') {
      delete node.nodeComment;
    }

    // Process pins
    const pins = node.pins as AnyObject[] | undefined;
    if (Array.isArray(pins)) {
      for (const pin of pins) {
        compactPin(pin, guidToShortId);
      }
    }
  }
}

function compactWidgetNode(node: AnyObject): void {
  if (!node) return;

  // Remove displayLabel when it equals name or is empty (redundant)
  if (node.displayLabel === node.name || node.displayLabel === '') {
    delete node.displayLabel;
  }

  // Remove default visibility
  if (node.visibility === 'Visible') {
    delete node.visibility;
  }

  // Remove empty properties objects
  if (node.properties && typeof node.properties === 'object' && Object.keys(node.properties as object).length === 0) {
    delete node.properties;
  }

  // Recurse into children
  const children = node.children as AnyObject[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      compactWidgetNode(child);
    }
  }
}

function findMaterialGraphRoot(data: AnyObject): AnyObject | null {
  const candidateKeys = ['material', 'materialFunction', 'materialLayer', 'materialLayerBlend'] as const;
  for (const key of candidateKeys) {
    const value = data[key];
    if (isPlainObject(value)) {
      return value;
    }
  }

  return Array.isArray(data.expressions) ? data : null;
}

function compactMaterialExpressions(graph: AnyObject): void {
  const expressions = graph.expressions;
  if (!Array.isArray(expressions)) {
    return;
  }

  const guidToShortId = new Map<string, string>();
  for (let i = 0; i < expressions.length; i++) {
    const expression = expressions[i];
    if (!isPlainObject(expression)) {
      continue;
    }

    const guid = firstDefinedString(
      expression.expressionGuid,
      expression.materialExpressionGuid,
    );
    if (guid) {
      guidToShortId.set(guid, `e${i}`);
    }
  }

  for (let i = 0; i < expressions.length; i++) {
    const expression = expressions[i];
    if (!isPlainObject(expression)) {
      continue;
    }

    for (const nestedValue of Object.values(expression)) {
      rewriteMaterialReferenceIds(nestedValue, guidToShortId);
    }
    delete expression.expressionGuid;
    delete expression.materialExpressionGuid;
    expression.id = `e${i}`;
  }

  rewriteMaterialReferenceIds(graph, guidToShortId);
}

function rewriteMaterialReferenceIds(value: unknown, guidToShortId: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      rewriteMaterialReferenceIds(entry, guidToShortId);
    }
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  const legacyGuid = firstDefinedString(value.expressionGuid, value.materialExpressionGuid);
  if (legacyGuid) {
    value.expressionId = guidToShortId.get(legacyGuid) ?? legacyGuid;
    delete value.expressionGuid;
    delete value.materialExpressionGuid;
  }

  for (const nestedValue of Object.values(value)) {
    rewriteMaterialReferenceIds(nestedValue, guidToShortId);
  }
}

function firstDefinedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function compactBehaviorTreeNode(node: AnyObject): void {
  delete node.nodeIndex;
  delete node.executionIndex;

  deleteEmptyObjectField(node, 'properties');

  const childCollections = ['services', 'decorators', 'children'] as const;
  for (const key of childCollections) {
    const collection = node[key];
    if (!Array.isArray(collection)) {
      continue;
    }

    for (const child of collection) {
      if (isPlainObject(child)) {
        compactBehaviorTreeNode(child);
      }
    }

    deleteEmptyArrayField(node, key);
  }

  deleteEmptyArrayField(node, 'decoratorLogic');
}

function compactStateTreeNodeArray(node: AnyObject, key: string): void {
  const collection = node[key];
  if (!Array.isArray(collection)) {
    return;
  }

  for (const entry of collection) {
    if (isPlainObject(entry)) {
      compactStateTreeEditorNode(entry);
    }
  }

  deleteEmptyArrayField(node, key);
}

function compactStateTreeState(state: AnyObject): void {
  compactStateTreeNodeArray(state, 'tasks');
  compactStateTreeNodeArray(state, 'enterConditions');
  compactStateTreeNodeArray(state, 'considerations');

  const singleTask = state.singleTask;
  if (isPlainObject(singleTask)) {
    compactStateTreeEditorNode(singleTask);
    deleteEmptyObjectField(state, 'singleTask');
  }

  const transitions = state.transitions;
  if (Array.isArray(transitions)) {
    for (const transition of transitions) {
      if (isPlainObject(transition)) {
        compactStateTreeTransition(transition);
      }
    }
    deleteEmptyArrayField(state, 'transitions');
  }

  const children = state.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (isPlainObject(child)) {
        compactStateTreeState(child);
      }
    }
    deleteEmptyArrayField(state, 'children');
  }
}

function compactStateTreeEditorNode(node: AnyObject): void {
  if (node.expressionIndent === 0) {
    delete node.expressionIndent;
  }

  deleteEmptyObjectField(node, 'nodeProperties');
  deleteEmptyObjectField(node, 'instanceProperties');
}

function compactStateTreeTransition(transition: AnyObject): void {
  const conditions = transition.conditions;
  if (Array.isArray(conditions)) {
    for (const condition of conditions) {
      if (isPlainObject(condition)) {
        compactStateTreeEditorNode(condition);
      }
    }
    deleteEmptyArrayField(transition, 'conditions');
  }
}

function compactPin(pin: AnyObject, guidToShortId: Map<string, string>): void {
  // Remove pinId
  delete pin.pinId;

  // Remove autogeneratedDefaultValue
  delete pin.autogeneratedDefaultValue;

  // Remove empty defaultValue
  if (pin.defaultValue === '') {
    delete pin.defaultValue;
  }

  // Process type object
  const type = pin.type as AnyObject | undefined;
  if (type && typeof type === 'object') {
    // Remove empty sub_category
    if (type.sub_category === '') {
      delete type.sub_category;
    }

    // Replace exec pin type with string "exec"
    if (type.category === 'exec') {
      pin.type = 'exec';
    }
  }

  // Rewrite connection nodeGuid references to short IDs
  const connections = pin.connections as AnyObject[] | undefined;
  if (Array.isArray(connections)) {
    if (connections.length === 0) {
      // Remove empty connections arrays
      delete pin.connections;
    } else {
      for (const conn of connections) {
        const connGuid = conn.nodeGuid as string | undefined;
        if (connGuid && guidToShortId.has(connGuid)) {
          conn.nodeGuid = guidToShortId.get(connGuid);
        }
      }
    }
  }
}
