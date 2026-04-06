import { McpServer, type RegisteredPrompt } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationControllerLike } from './automation-controller.js';
import { registerPromptCatalog } from './prompts/prompt-catalog.js';
import { registerExampleAndCaptureResources } from './resources/example-and-capture-resources.js';
import { registerStaticDocResources } from './resources/static-doc-resources.js';

type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RegisterServerResourcesOptions = {
  server: McpServer;
  automationController: AutomationControllerLike;
  callSubsystemJson: JsonSubsystemCaller;
};

type RegisterServerResourcesResult = {
  registeredPrompts: Map<string, RegisteredPrompt>;
};

export function registerServerResources({
  server,
  automationController,
  callSubsystemJson,
}: RegisterServerResourcesOptions): RegisterServerResourcesResult {
  registerStaticDocResources(server);

  registerExampleAndCaptureResources({
    server,
    automationController,
    callSubsystemJson,
  });

  const registeredPrompts = registerPromptCatalog(server);

  return { registeredPrompts };
}
