#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBlueprintExtractorServer } from './server-factory.js';

export type { UEClientLike } from './server-factory.js';
export { createBlueprintExtractorServer } from './server-factory.js';
export { exampleCatalog } from './catalogs/example-catalog.js';
export { promptCatalog } from './prompts/prompt-catalog.js';

async function main() {
  const { server } = createBlueprintExtractorServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function isCliEntrypoint() {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  try {
    // npm/npx launch the package via a symlink in node_modules/.bin.
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main().catch((error) => {
    console.error('Fatal:', error);
    process.exit(1);
  });
}
