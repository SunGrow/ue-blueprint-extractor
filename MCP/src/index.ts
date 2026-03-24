#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBlueprintExtractorServer } from './server-factory.js';

export type { UEClientLike } from './server-factory.js';
export { createBlueprintExtractorServer } from './server-factory.js';
export { exampleCatalog } from './catalogs/example-catalog.js';
export { promptCatalog } from './prompts/prompt-catalog.js';

async function main() {
  const server = createBlueprintExtractorServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Fatal:', error);
    process.exit(1);
  });
}
