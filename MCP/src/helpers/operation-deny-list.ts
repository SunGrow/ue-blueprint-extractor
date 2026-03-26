export interface DenyListEntry {
  tool: string;
  paramPattern: (args: Record<string, unknown>) => boolean;
  reason: string;
  suggestedAlternative: string;
}

const DENY_LIST: DenyListEntry[] = [
  {
    tool: 'modify_blueprint_members',
    paramPattern: (args) => {
      const operations = args.operations;
      if (!Array.isArray(operations)) return false;
      return operations.some((op: unknown) => {
        if (typeof op !== 'object' || op === null) return false;
        const o = op as Record<string, unknown>;
        return o.operation === 'delete_component' && typeof o.component === 'string';
      });
    },
    reason: 'Deleting components via modify_blueprint_members can crash the editor when the component is inherited or has active references. Use the parent blueprint to manage inherited components.',
    suggestedAlternative: 'Remove the component from the parent blueprint that defines it, or detach references first.',
  },
  {
    tool: 'modify_blueprint_graphs',
    paramPattern: (args) => {
      const operations = args.operations;
      if (!Array.isArray(operations)) return false;
      return operations.some((op: unknown) => {
        if (typeof op !== 'object' || op === null) return false;
        const o = op as Record<string, unknown>;
        return o.operation === 'delete_graph' && o.graph === 'ConstructionScript';
      });
    },
    reason: 'Deleting the ConstructionScript graph crashes the editor. The ConstructionScript is a built-in graph that cannot be removed.',
    suggestedAlternative: 'Clear nodes within the ConstructionScript instead of deleting the graph.',
  },
];

export interface DenyResult {
  [key: string]: unknown;
  code: 'OPERATION_DENIED';
  message: string;
  recoverable: boolean;
  next_steps: string[];
}

export function checkDenyList(
  toolName: string,
  args: Record<string, unknown>,
): DenyResult | null {
  for (const entry of DENY_LIST) {
    if (entry.tool === toolName && entry.paramPattern(args)) {
      return formatDenyListError(entry);
    }
  }
  return null;
}

export function formatDenyListError(entry: DenyListEntry): DenyResult {
  return {
    code: 'OPERATION_DENIED',
    message: entry.reason,
    recoverable: true,
    next_steps: [
      entry.suggestedAlternative,
      'Call get_tool_help for guidance on safe operations.',
    ],
  };
}
