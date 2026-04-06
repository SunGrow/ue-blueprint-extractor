import { z } from 'zod';

export type ToolInputSchema = Record<string, z.ZodTypeAny>;

export type ToolHelpEntry = {
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  outputSchema: z.ZodTypeAny;
  annotations?: Record<string, unknown>;
};

type ExampleSummaryEntry = {
  summary: string;
  recommended_flow: string[];
  examples: Array<{
    title: string;
    tool: string;
  }>;
};

function unwrapZodType(schema: z.ZodTypeAny): {
  schema: z.ZodTypeAny;
  required: boolean;
  nullable: boolean;
  defaultValue?: unknown;
  description?: string;
} {
  let current = schema;
  let required = true;
  let nullable = false;
  let defaultValue: unknown;
  let description = schema.description;

  while (true) {
    description ??= current.description;

    if (current instanceof z.ZodDefault) {
      required = false;
      defaultValue = current._def.defaultValue();
      current = current._def.innerType;
      continue;
    }

    if (current instanceof z.ZodOptional) {
      required = false;
      current = current.unwrap();
      continue;
    }

    if (current instanceof z.ZodNullable) {
      nullable = true;
      current = current.unwrap();
      continue;
    }

    if (current instanceof z.ZodEffects) {
      current = current.innerType();
      continue;
    }

    break;
  }

  description ??= current.description;
  return { schema: current, required, nullable, defaultValue, description };
}

function summarizeZodType(schema: z.ZodTypeAny): Record<string, unknown> {
  const {
    schema: unwrapped,
    required,
    nullable,
    defaultValue,
    description,
  } = unwrapZodType(schema);

  const summary: Record<string, unknown> = {};
  if (description) {
    summary.description = description;
  }
  if (!required) {
    summary.required = false;
  }
  if (nullable) {
    summary.nullable = true;
  }
  if (defaultValue !== undefined) {
    summary.default = defaultValue;
  }

  if (unwrapped instanceof z.ZodString) {
    summary.type = 'string';
    return summary;
  }

  if (unwrapped instanceof z.ZodNumber) {
    summary.type = 'number';
    return summary;
  }

  if (unwrapped instanceof z.ZodBoolean) {
    summary.type = 'boolean';
    return summary;
  }

  if (unwrapped instanceof z.ZodEnum) {
    summary.type = 'enum';
    summary.values = [...unwrapped.options];
    return summary;
  }

  if (unwrapped instanceof z.ZodLiteral) {
    summary.type = 'literal';
    summary.value = unwrapped.value;
    return summary;
  }

  if (unwrapped instanceof z.ZodArray) {
    summary.type = 'array';
    summary.items = summarizeZodType(unwrapped.element);
    return summary;
  }

  if (unwrapped instanceof z.ZodObject) {
    summary.type = 'object';
    summary.properties = Object.keys(unwrapped.shape);
    return summary;
  }

  if (unwrapped instanceof z.ZodUnion) {
    summary.type = 'union';
    summary.options = unwrapped.options.map((option: z.ZodTypeAny) => summarizeZodType(option));
    return summary;
  }

  summary.type = unwrapped._def.typeName.replace(/^Zod/, '');
  return summary;
}

export function summarizeSchemaFields(shape: ToolInputSchema): Array<Record<string, unknown>> {
  return Object.entries(shape).map(([name, schema]) => ({
    name,
    ...summarizeZodType(schema),
  }));
}

export function summarizeOutputSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const summary = summarizeZodType(schema);
  if (schema instanceof z.ZodObject) {
    summary.fields = summarizeSchemaFields(schema.shape);
  }
  return summary;
}

export function collectToolExampleFamilies(
  exampleCatalog: Record<string, ExampleSummaryEntry>,
  toolName: string,
): Array<Record<string, unknown>> {
  const equivalentToolNames = new Set<string>([toolName]);

  return Object.entries(exampleCatalog)
    .flatMap(([family, entry]) => {
      const exampleTitles = entry.examples
        .filter((example) => equivalentToolNames.has(example.tool))
        .map((example) => example.title);
      const usedInRecommendedFlow = entry.recommended_flow.some((name) => equivalentToolNames.has(name));

      if (!usedInRecommendedFlow && exampleTitles.length === 0) {
        return [];
      }

      return [{
        family,
        summary: entry.summary,
        usedInRecommendedFlow,
        exampleTitles,
      }];
    });
}

export function collectRelatedResources(toolName: string): string[] {
  const resources = new Set<string>();

  if (toolName === 'search_assets' || toolName === 'list_assets' || toolName.startsWith('extract_')) {
    resources.add('blueprint://scopes');
  }
  if (
    toolName.startsWith('create_')
    || toolName.startsWith('modify_')
    || toolName.startsWith('apply_')
    || toolName === 'save_assets'
  ) {
    resources.add('blueprint://write-capabilities');
    resources.add('blueprint://authoring-conventions');
  }
  if (toolName.includes('widget')) {
    resources.add('blueprint://selector-conventions');
    resources.add('blueprint://widget-best-practices');
    resources.add('blueprint://verification-workflows');
  }
  if (
    toolName === 'capture_editor_screenshot'
    || toolName === 'capture_runtime_screenshot'
    || toolName === 'start_pie'
    || toolName === 'stop_pie'
    || toolName === 'relaunch_pie'
  ) {
    resources.add('blueprint://verification-workflows');
    resources.add('blueprint://project-automation');
  }
  if (toolName.includes('material')) {
    resources.add('blueprint://material-graph-guidance');
  }
  if (toolName.includes('import')) {
    resources.add('blueprint://import-capabilities');
  }
  if (
    toolName.includes('automation')
    || toolName === 'compile_project_code'
    || toolName === 'trigger_live_coding'
    || toolName === 'restart_editor'
    || toolName === 'wait_for_editor'
    || toolName === 'sync_project_code'
    || toolName === 'start_pie'
    || toolName === 'stop_pie'
    || toolName === 'relaunch_pie'
    || toolName === 'read_output_log'
    || toolName === 'list_message_log_listings'
    || toolName === 'read_message_log'
  ) {
    resources.add('blueprint://project-automation');
  }
  if (toolName === 'review_blueprint' || toolName === 'audit_project_assets') {
    resources.add('blueprint://analysis-workflows');
  }
  if (
    toolName === 'refresh_project_index'
    || toolName === 'get_project_index_status'
    || toolName === 'search_project_context'
    || toolName === 'get_editor_context'
  ) {
    resources.add('blueprint://project-intelligence-workflows');
  }
  if (toolName === 'get_editor_context') {
    resources.add('blueprint://project-automation');
  }
  if (
    toolName.includes('animation')
    || toolName.includes('motion')
    || toolName === 'compare_motion_capture_bundle'
  ) {
    resources.add('blueprint://widget-motion-authoring');
    resources.add('blueprint://motion-verification-workflow');
  }

  return [...resources];
}
