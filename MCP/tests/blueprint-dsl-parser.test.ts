import { describe, expect, it } from 'vitest';
import {
  parseBlueprintDsl,
  blueprintDslToPayload,
} from '../src/helpers/blueprint-dsl-parser.js';
import type {
  BlueprintDslNode,
  BlueprintDslGraph,
  PayloadGraph,
} from '../src/helpers/blueprint-dsl-parser.js';

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('parseBlueprintDsl', () => {
  // -------------------------------------------------------------------------
  // Basic parsing
  // -------------------------------------------------------------------------

  it('parses an event node', () => {
    const result = parseBlueprintDsl('EventGraph:\n  Event BeginPlay');
    expect(result.graphs).toHaveLength(1);
    expect(result.graphs[0].graphName).toBe('EventGraph');
    expect(result.graphs[0].nodes).toHaveLength(1);
    expect(result.graphs[0].nodes[0]).toMatchObject({
      type: 'event',
      name: 'BeginPlay',
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('creates default EventGraph when no header present', () => {
    const result = parseBlueprintDsl('Event BeginPlay');
    expect(result.graphs).toHaveLength(1);
    expect(result.graphs[0].graphName).toBe('EventGraph');
    expect(result.graphs[0].nodes).toHaveLength(1);
  });

  it('parses multiple graph headers', () => {
    const dsl = [
      'EventGraph:',
      '  Event BeginPlay',
      'MyFunction:',
      '  Event CustomEvent',
    ].join('\n');
    const result = parseBlueprintDsl(dsl);
    expect(result.graphs).toHaveLength(2);
    expect(result.graphs[0].graphName).toBe('EventGraph');
    expect(result.graphs[1].graphName).toBe('MyFunction');
  });

  // -------------------------------------------------------------------------
  // Chaining with ->
  // -------------------------------------------------------------------------

  it('parses a chain of nodes connected by ->', () => {
    const dsl = [
      'EventGraph:',
      '  Event BeginPlay -> GetPlayerController() -> PrintString(Hello)',
    ].join('\n');
    const result = parseBlueprintDsl(dsl);
    const nodes = result.graphs[0].nodes;
    expect(nodes).toHaveLength(1);

    const root = nodes[0];
    expect(root.type).toBe('event');
    expect(root.name).toBe('BeginPlay');
    expect(root.then).toHaveLength(1);
    expect(root.then![0].type).toBe('call');
    expect(root.then![0].name).toBe('GetPlayerController');
    expect(root.then![0].then).toHaveLength(1);
    expect(root.then![0].then![0].name).toBe('PrintString');
  });

  // -------------------------------------------------------------------------
  // Target object access
  // -------------------------------------------------------------------------

  it('parses target.function syntax', () => {
    const result = parseBlueprintDsl('PC.GetPawn');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('call');
    expect(node.name).toBe('GetPawn');
    expect(node.target).toBe('PC');
  });

  it('parses target.function with args', () => {
    const result = parseBlueprintDsl('self.SetActorHidden(true)');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('call');
    expect(node.name).toBe('SetActorHidden');
    expect(node.target).toBe('self');
    expect(node.args).toEqual({ arg0: true });
  });

  // -------------------------------------------------------------------------
  // Cast with alias
  // -------------------------------------------------------------------------

  it('parses CastTo with alias', () => {
    const result = parseBlueprintDsl('CastTo(APlayerController) as PC');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('cast');
    expect(node.castTo).toBe('APlayerController');
    expect(node.alias).toBe('PC');
  });

  it('parses CastTo without alias', () => {
    const result = parseBlueprintDsl('CastTo(ABP_Character)');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('cast');
    expect(node.castTo).toBe('ABP_Character');
    expect(node.alias).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Branch with True/False paths
  // -------------------------------------------------------------------------

  it('parses condition ? Branch with True/False paths', () => {
    const dsl = [
      'EventGraph:',
      '  Character.Health > 0 ? Branch',
      '    True -> SetActorHidden(false)',
      '    False -> DestroyActor(self)',
    ].join('\n');
    const result = parseBlueprintDsl(dsl);
    const branchNode = result.graphs[0].nodes[0];
    expect(branchNode.type).toBe('branch');
    expect(branchNode.condition).toEqual({
      left: 'Character.Health',
      operator: '>',
      right: '0',
    });
    expect(branchNode.branches).toBeDefined();
    expect(branchNode.branches!['True']).toHaveLength(1);
    expect(branchNode.branches!['True'][0].name).toBe('SetActorHidden');
    expect(branchNode.branches!['False']).toHaveLength(1);
    expect(branchNode.branches!['False'][0].name).toBe('DestroyActor');
  });

  it('parses branch with standalone True/False label lines', () => {
    const dsl = [
      'EventGraph:',
      '  Health > 0 ? Branch',
      '    True ->',
      '      PrintString(Alive)',
      '    False ->',
      '      PrintString(Dead)',
    ].join('\n');
    const result = parseBlueprintDsl(dsl);
    const branchNode = result.graphs[0].nodes[0];
    expect(branchNode.type).toBe('branch');
    expect(branchNode.branches!['True']).toHaveLength(1);
    expect(branchNode.branches!['True'][0].name).toBe('PrintString');
    expect(branchNode.branches!['False']).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Variable get/set
  // -------------------------------------------------------------------------

  it('parses standalone identifier as variable_get', () => {
    const result = parseBlueprintDsl('Health');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('variable_get');
    expect(node.name).toBe('Health');
  });

  it('parses Set VarName = value as variable_set', () => {
    const result = parseBlueprintDsl('Set Health = 100');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('variable_set');
    expect(node.name).toBe('Health');
    expect(node.args).toEqual({ value: 100 });
  });

  it('parses Set with string value', () => {
    const result = parseBlueprintDsl('Set DisplayName = "Test"');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('variable_set');
    expect(node.name).toBe('DisplayName');
    expect(node.args).toEqual({ value: 'Test' });
  });

  // -------------------------------------------------------------------------
  // Function arguments
  // -------------------------------------------------------------------------

  it('parses function with named arguments', () => {
    const result = parseBlueprintDsl('SetActorLocation(X=100, Y=200, Z=0)');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('call');
    expect(node.args).toEqual({ X: 100, Y: 200, Z: 0 });
  });

  it('parses function with positional arguments', () => {
    const result = parseBlueprintDsl('PrintString(Hello World)');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('call');
    expect(node.args).toEqual({ arg0: 'Hello World' });
  });

  it('parses function with no arguments', () => {
    const result = parseBlueprintDsl('GetPlayerController()');
    const node = result.graphs[0].nodes[0];
    expect(node.type).toBe('call');
    expect(node.name).toBe('GetPlayerController');
    expect(node.args).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Comments and blank lines
  // -------------------------------------------------------------------------

  it('skips blank lines and comments', () => {
    const dsl = [
      '# This is a comment',
      '',
      '// Another comment',
      'EventGraph:',
      '  Event BeginPlay',
      '',
      '  # inline comment',
    ].join('\n');
    const result = parseBlueprintDsl(dsl);
    expect(result.graphs).toHaveLength(1);
    expect(result.graphs[0].nodes).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns empty result for empty input', () => {
    const result = parseBlueprintDsl('');
    expect(result.graphs).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns empty result for comment-only input', () => {
    const result = parseBlueprintDsl('# just a comment\n// another');
    expect(result.graphs).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Warnings on unrecognized patterns
  // -------------------------------------------------------------------------

  it('emits warning for unrecognized node expression', () => {
    const result = parseBlueprintDsl('EventGraph:\n  123-bad-line!');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('unrecognized');
  });

  it('emits warning for empty graph name', () => {
    const result = parseBlueprintDsl(':');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('empty graph name');
  });

  // -------------------------------------------------------------------------
  // Full plan example: BeginPlay flow
  // -------------------------------------------------------------------------

  it('parses the full plan example', () => {
    const dsl = [
      'EventGraph:',
      '  Event BeginPlay ->',
      '    GetPlayerController() -> CastTo(APlayerController) as PC',
      '    PC.GetPawn -> CastTo(ABP_Character) as Character',
      '    Character.Health > 0 ? Branch',
      '      True -> SetActorHidden(false)',
      '      False -> DestroyActor(self)',
    ].join('\n');
    const result = parseBlueprintDsl(dsl);
    expect(result.graphs).toHaveLength(1);
    expect(result.graphs[0].graphName).toBe('EventGraph');
    // Event BeginPlay with trailing -> stripped, then separate chains
    expect(result.graphs[0].nodes.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('strips trailing -> from lines', () => {
    const dsl = [
      'EventGraph:',
      '  Event BeginPlay ->',
      '  PrintString(Hello)',
    ].join('\n');
    const result = parseBlueprintDsl(dsl);
    // Trailing -> stripped; Event BeginPlay is a standalone node
    expect(result.graphs[0].nodes).toHaveLength(2);
    expect(result.graphs[0].nodes[0].type).toBe('event');
    expect(result.graphs[0].nodes[0].name).toBe('BeginPlay');
    expect(result.warnings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Alias on chain end
  // -------------------------------------------------------------------------

  it('applies alias to the last node in a chain', () => {
    const dsl = 'GetPlayerController() -> CastTo(APlayerController) as PC';
    const result = parseBlueprintDsl(dsl);
    const root = result.graphs[0].nodes[0];
    expect(root.alias).toBeUndefined();
    expect(root.then![0].alias).toBe('PC');
  });
});

// ---------------------------------------------------------------------------
// Converter tests
// ---------------------------------------------------------------------------

describe('blueprintDslToPayload', () => {
  it('produces correct nodeClass for each node type', () => {
    const graphs: BlueprintDslGraph[] = [{
      graphName: 'TestGraph',
      nodes: [
        { type: 'event', name: 'BeginPlay' },
        { type: 'call', name: 'PrintString' },
        { type: 'cast', name: 'CastTo', castTo: 'APlayerController' },
        { type: 'branch', name: 'Branch' },
        { type: 'variable_get', name: 'Health' },
        { type: 'variable_set', name: 'Health', args: { value: 100 } },
      ],
    }];

    const result = blueprintDslToPayload(graphs);
    const nodes = result.functionGraphs[0].nodes;

    expect(nodes[0].nodeClass).toBe('K2Node_Event');
    expect(nodes[0].eventName).toBe('BeginPlay');

    expect(nodes[1].nodeClass).toBe('K2Node_CallFunction');
    expect(nodes[1].functionName).toBe('PrintString');

    expect(nodes[2].nodeClass).toBe('K2Node_DynamicCast');
    expect(nodes[2].targetClass).toBe('APlayerController');

    expect(nodes[3].nodeClass).toBe('K2Node_IfThenElse');

    expect(nodes[4].nodeClass).toBe('K2Node_VariableGet');
    expect(nodes[4].variableName).toBe('Health');

    expect(nodes[5].nodeClass).toBe('K2Node_VariableSet');
    expect(nodes[5].variableName).toBe('Health');
    expect(nodes[5].value).toBe(100);
  });

  it('generates sequential tempIds', () => {
    const graphs: BlueprintDslGraph[] = [{
      graphName: 'TestGraph',
      nodes: [
        { type: 'event', name: 'A' },
        { type: 'call', name: 'B' },
        { type: 'call', name: 'C' },
      ],
    }];

    const result = blueprintDslToPayload(graphs);
    const nodes = result.functionGraphs[0].nodes;
    expect(nodes[0].tempId).toBe('n0');
    expect(nodes[1].tempId).toBe('n1');
    expect(nodes[2].tempId).toBe('n2');
  });

  it('creates correct connections from chains', () => {
    const graphs: BlueprintDslGraph[] = [{
      graphName: 'TestGraph',
      nodes: [
        {
          type: 'event',
          name: 'BeginPlay',
          then: [
            {
              type: 'call',
              name: 'GetPlayerController',
              then: [
                { type: 'call', name: 'PrintString' },
              ],
            },
          ],
        },
      ],
    }];

    const result = blueprintDslToPayload(graphs);
    const connections = result.functionGraphs[0].connections;

    expect(connections).toHaveLength(2);
    expect(connections[0]).toEqual({
      fromNode: 'n0',
      fromPin: 'then',
      toNode: 'n1',
      toPin: 'execute',
    });
    expect(connections[1]).toEqual({
      fromNode: 'n1',
      fromPin: 'then',
      toNode: 'n2',
      toPin: 'execute',
    });
  });

  it('resolves aliases in target references', () => {
    const graphs: BlueprintDslGraph[] = [{
      graphName: 'TestGraph',
      nodes: [
        {
          type: 'cast',
          name: 'CastTo',
          castTo: 'APlayerController',
          alias: 'PC',
          then: [
            { type: 'call', name: 'GetPawn', target: 'PC' },
          ],
        },
      ],
    }];

    const result = blueprintDslToPayload(graphs);
    const nodes = result.functionGraphs[0].nodes;

    // The call node should have its target resolved to the cast node's tempId
    const callNode = nodes.find((n) => n.functionName === 'GetPawn');
    expect(callNode).toBeDefined();
    expect(callNode!.target).toBe('n0'); // resolved alias for the cast node
  });

  it('creates branch connections with correct pin names', () => {
    const graphs: BlueprintDslGraph[] = [{
      graphName: 'TestGraph',
      nodes: [
        {
          type: 'branch',
          name: 'Branch',
          branches: {
            True: [{ type: 'call', name: 'DoTrue' }],
            False: [{ type: 'call', name: 'DoFalse' }],
          },
        },
      ],
    }];

    const result = blueprintDslToPayload(graphs);
    const connections = result.functionGraphs[0].connections;

    const trueConn = connections.find((c) => c.fromPin === 'True');
    const falseConn = connections.find((c) => c.fromPin === 'False');
    expect(trueConn).toBeDefined();
    expect(falseConn).toBeDefined();
    expect(trueConn!.toPin).toBe('execute');
    expect(falseConn!.toPin).toBe('execute');
  });

  it('adds comparison node for branch condition', () => {
    const graphs: BlueprintDslGraph[] = [{
      graphName: 'TestGraph',
      nodes: [
        {
          type: 'branch',
          name: 'Branch',
          condition: { left: 'Health', operator: '>', right: '0' },
        },
      ],
    }];

    const result = blueprintDslToPayload(graphs);
    const nodes = result.functionGraphs[0].nodes;

    // Should have branch node + comparison node
    expect(nodes).toHaveLength(2);
    const branchNode = nodes.find((n) => n.nodeClass === 'K2Node_IfThenElse');
    const compNode = nodes.find((n) => n.functionName === 'Greater');
    expect(branchNode).toBeDefined();
    expect(compNode).toBeDefined();
    expect(compNode!.args).toEqual({ A: 'Health', B: 0 });

    // Connection: comparison ReturnValue -> branch Condition
    const condConn = result.functionGraphs[0].connections.find(
      (c) => c.fromPin === 'ReturnValue' && c.toPin === 'Condition',
    );
    expect(condConn).toBeDefined();
  });

  it('handles multiple graphs', () => {
    const graphs: BlueprintDslGraph[] = [
      { graphName: 'EventGraph', nodes: [{ type: 'event', name: 'BeginPlay' }] },
      { graphName: 'MyFunc', nodes: [{ type: 'call', name: 'DoStuff' }] },
    ];

    const result = blueprintDslToPayload(graphs);
    expect(result.functionGraphs).toHaveLength(2);
    expect(result.functionGraphs[0].graphName).toBe('EventGraph');
    expect(result.functionGraphs[1].graphName).toBe('MyFunc');
  });

  it('passes through target as-is when alias is not registered', () => {
    const graphs: BlueprintDslGraph[] = [{
      graphName: 'TestGraph',
      nodes: [
        { type: 'call', name: 'GetPawn', target: 'UnknownRef' },
      ],
    }];

    const result = blueprintDslToPayload(graphs);
    const node = result.functionGraphs[0].nodes[0];
    expect(node.target).toBe('UnknownRef');
  });

  it('includes args on call nodes', () => {
    const graphs: BlueprintDslGraph[] = [{
      graphName: 'TestGraph',
      nodes: [
        { type: 'call', name: 'SetActorHidden', args: { bNewHidden: true } },
      ],
    }];

    const result = blueprintDslToPayload(graphs);
    const node = result.functionGraphs[0].nodes[0];
    expect(node.args).toEqual({ bNewHidden: true });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: parse then convert
// ---------------------------------------------------------------------------

describe('parseBlueprintDsl + blueprintDslToPayload integration', () => {
  it('converts a simple event + function chain to payload', () => {
    const dsl = [
      'EventGraph:',
      '  Event BeginPlay -> PrintString(Hello)',
    ].join('\n');
    const parsed = parseBlueprintDsl(dsl);
    const payload = blueprintDslToPayload(parsed.graphs);

    expect(payload.functionGraphs).toHaveLength(1);
    const graph = payload.functionGraphs[0];
    expect(graph.graphName).toBe('EventGraph');
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0].nodeClass).toBe('K2Node_Event');
    expect(graph.nodes[1].nodeClass).toBe('K2Node_CallFunction');
    expect(graph.connections).toHaveLength(1);
    expect(graph.connections[0]).toEqual({
      fromNode: 'n0',
      fromPin: 'then',
      toNode: 'n1',
      toPin: 'execute',
    });
  });

  it('produces valid payload for the plan example DSL', () => {
    const dsl = [
      'EventGraph:',
      '  Event BeginPlay -> GetPlayerController() -> CastTo(APlayerController) as PC',
      '  PC.GetPawn -> CastTo(ABP_Character) as Character',
      '  Character.Health > 0 ? Branch',
      '    True -> SetActorHidden(false)',
      '    False -> DestroyActor(self)',
    ].join('\n');
    const parsed = parseBlueprintDsl(dsl);
    expect(parsed.warnings).toHaveLength(0);

    const payload = blueprintDslToPayload(parsed.graphs);
    expect(payload.functionGraphs).toHaveLength(1);
    const graph = payload.functionGraphs[0];

    // Verify node classes
    const eventNode = graph.nodes.find((n) => n.nodeClass === 'K2Node_Event');
    expect(eventNode).toBeDefined();
    expect(eventNode!.eventName).toBe('BeginPlay');

    const castNodes = graph.nodes.filter((n) => n.nodeClass === 'K2Node_DynamicCast');
    expect(castNodes).toHaveLength(2);

    const branchNode = graph.nodes.find((n) => n.nodeClass === 'K2Node_IfThenElse');
    expect(branchNode).toBeDefined();

    // Verify connections exist
    expect(graph.connections.length).toBeGreaterThan(0);

    // Verify the branch has True/False connections
    const trueConn = graph.connections.find((c) => c.fromPin === 'True');
    const falseConn = graph.connections.find((c) => c.fromPin === 'False');
    expect(trueConn).toBeDefined();
    expect(falseConn).toBeDefined();
  });

  it('handles empty graphs array', () => {
    const payload = blueprintDslToPayload([]);
    expect(payload.functionGraphs).toHaveLength(0);
  });
});
