import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { extractExtraContent, extractToolPayload, isPlainObject } from './formatting.js';
import { rawHandlerRegistry } from './alias-registration.js';
import type { ToolHelpEntry, ToolInputSchema } from './tool-help.js';
import type { AdaptiveExecutor } from '../execution/adaptive-executor.js';

const normalizedToolResultEnvelopeSchema = z.object({
  success: z.boolean(),
  operation: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
  recoverable: z.boolean().optional(),
  next_steps: z.array(z.string()).optional(),
  _hints: z.array(z.string()).optional(),
  diagnostics: z.array(z.object({
    severity: z.string().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
    path: z.string().optional(),
  })).optional(),
  execution: z.object({
    mode: z.enum(['immediate', 'task_aware']),
    task_support: z.enum(['optional', 'required', 'forbidden']),
    status: z.string().optional(),
    progress_message: z.string().optional(),
  }).optional(),
}).passthrough();

function wrapOutputSchemaWithNormalizedErrors(outputSchema: z.ZodTypeAny): z.ZodTypeAny {
  if (outputSchema instanceof z.ZodObject) {
    return normalizedToolResultEnvelopeSchema.extend(outputSchema.partial().shape).passthrough();
  }

  return normalizedToolResultEnvelopeSchema;
}

type ToolNormalizer = (...args: any[]) => unknown;

type InstallNormalizedToolRegistrationOptions = {
  server: McpServer;
  toolHelpRegistry: Map<string, ToolHelpEntry>;
  registeredToolMap: Map<string, RegisteredTool>;
  defaultOutputSchema: z.ZodTypeAny;
  normalizeToolError: ToolNormalizer;
  normalizeToolSuccess: ToolNormalizer;
  executor?: AdaptiveExecutor | null;
};

export function installNormalizedToolRegistration({
  server,
  toolHelpRegistry,
  registeredToolMap,
  defaultOutputSchema,
  normalizeToolError,
  normalizeToolSuccess,
  executor,
}: InstallNormalizedToolRegistrationOptions): void {
  const rawRegisterTool = server.registerTool.bind(server) as typeof server.registerTool;
  (server as typeof server & { registerTool: typeof server.registerTool }).registerTool = ((name, config, cb) => {
    const declaredOutputSchema = (config.outputSchema ?? defaultOutputSchema) as z.ZodTypeAny;
    const outputSchema = wrapOutputSchemaWithNormalizedErrors(declaredOutputSchema);
    rawHandlerRegistry.set(name, cb as (args: Record<string, unknown>, extra: unknown) => Promise<unknown> | unknown);
    toolHelpRegistry.set(name, {
      title: config.title ?? name,
      description: config.description ?? '',
      inputSchema: (config.inputSchema ?? {}) as ToolInputSchema,
      outputSchema: declaredOutputSchema,
      annotations: config.annotations as Record<string, unknown> | undefined,
    });

    const registered = (rawRegisterTool as any)(name, {
      ...config,
      outputSchema,
    }, async (args: unknown, extra: unknown) => {
      // Set active tool name on executor so callSubsystemJson routing knows
      // which tool is executing (for mode annotations / commandlet fallback).
      if (executor) executor.setActiveToolName(name);
      try {
        const result = await (cb as (args: unknown, extra: unknown) => Promise<unknown> | unknown)(args, extra);
        if (isPlainObject(result) && result.isError === true) {
          return normalizeToolError(name, extractToolPayload(result), result);
        }

        return normalizeToolSuccess(name, extractToolPayload(result), extractExtraContent(result));
      } catch (error) {
        return normalizeToolError(name, error);
      } finally {
        if (executor) executor.setActiveToolName(null);
      }
    }) as RegisteredTool;
    registeredToolMap.set(name, registered);
    return registered;
  }) as typeof server.registerTool;
}
