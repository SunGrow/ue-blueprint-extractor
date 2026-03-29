import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as {
  name?: string;
  version?: string;
};

export const packageName = packageJson.name ?? 'blueprint-extractor-mcp';
export const packageVersion = packageJson.version ?? '0.0.0';
