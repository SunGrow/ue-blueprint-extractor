import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const windowsShell = 'cmd.exe';

async function main() {
  const tarballPath = await createTarball();
  const installRoot = await mkdtemp(join(tmpdir(), 'blueprint-extractor-pack-smoke-'));

  try {
    await installTarball(installRoot, tarballPath);
    const packageRoot = resolveInstalledPackageRoot(installRoot);
    const entryPoint = await resolvePackagedEntryPoint(packageRoot);
    await verifyPackagedReadme(packageRoot);
    await smokeContractFromTarball(entryPoint, installRoot);
  } finally {
    await rm(installRoot, { recursive: true, force: true });
    await rm(tarballPath, { force: true });
  }
}

async function createTarball() {
  const { stdout } = await runNpm(['pack', '--json'], { cwd });
  const parsed = JSON.parse(stdout);
  const filename = parsed?.[0]?.filename;

  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error(`npm pack did not return a tarball filename: ${stdout}`);
  }

  const tarballPath = resolve(cwd, filename);
  await access(tarballPath);
  return tarballPath;
}

async function installTarball(installRoot, tarballPath) {
  await writeFile(join(installRoot, 'package.json'), '{\n  "private": true\n}\n', 'utf8');
  await runNpm(
    ['install', '--no-package-lock', '--no-save', tarballPath],
    { cwd: installRoot },
  );
}

function resolveInstalledPackageRoot(installRoot) {
  return join(installRoot, 'node_modules', 'blueprint-extractor-mcp');
}

async function resolvePackagedEntryPoint(packageRoot) {
  const packageJsonPath = join(packageRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const binField = packageJson?.bin;
  const binRelativePath = typeof binField === 'string'
    ? binField
    : binField?.['blueprint-extractor-mcp'];

  if (typeof binRelativePath !== 'string' || binRelativePath.length === 0) {
    throw new Error(`Could not resolve blueprint-extractor-mcp bin from ${packageJsonPath}`);
  }

  const entryPoint = resolve(packageRoot, binRelativePath);
  await access(entryPoint);
  return entryPoint;
}

async function verifyPackagedReadme(packageRoot) {
  const readmePath = join(packageRoot, 'README.md');
  const readme = await readFile(readmePath, 'utf8');

  const requiredSnippets = [
    '`extract_asset`',
    '`material_graph_operation`',
    '`get_tool_help`',
    '`structuredContent`',
    '`activate_workflow_scope`',
  ];
  for (const snippet of requiredSnippets) {
    if (!readme.includes(snippet)) {
      throw new Error(`Packaged README is missing expected content: ${snippet}`);
    }
  }

  const staleSnippets = [
    'The current v2 MCP contract exposes 97 tools',
    'current v2 MCP contract',
    'composable material authoring (`set_material_settings`, `add_material_expression`, `connect_material_expressions`, `bind_material_property`)',
    '## Migration From Legacy Entrypoints',
    '## Migration from v3 / v4',
  ];
  for (const snippet of staleSnippets) {
    if (readme.includes(snippet)) {
      throw new Error(`Packaged README still contains stale content: ${snippet}`);
    }
  }
}

async function smokeContractFromTarball(entryPoint, installRoot) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPoint],
    cwd: installRoot,
    env: {
      ...process.env,
      UE_REMOTE_CONTROL_HOST: process.env.UE_REMOTE_CONTROL_HOST ?? '127.0.0.1',
      UE_REMOTE_CONTROL_PORT: process.env.UE_REMOTE_CONTROL_PORT ?? '30010',
    },
    stderr: 'pipe',
  });

  const client = new Client({
    name: 'blueprint-extractor-pack-smoke',
    version: '1.0.0',
  });

  try {
    await client.connect(transport);
    const [tools, resources, templates] = await Promise.all([
      client.listTools(),
      client.listResources(),
      client.listResourceTemplates(),
    ]);

    if (!tools.tools.some((tool) => tool.name === 'extract_blueprint')) {
      throw new Error('Packaged MCP server did not expose extract_blueprint');
    }

    if (!tools.tools.some((tool) => tool.name === 'sync_project_code')) {
      throw new Error('Packaged MCP server did not expose sync_project_code');
    }

    if (!resources.resources.some((resource) => resource.uri === 'blueprint://project-automation')) {
      throw new Error('Packaged MCP server did not expose blueprint://project-automation');
    }

    if (!templates.resourceTemplates.some((template) => template.uriTemplate === 'blueprint://widget-patterns/{pattern}')) {
      throw new Error('Packaged MCP server did not expose widget pattern templates');
    }
  } finally {
    await Promise.allSettled([client.close(), transport.close()]);
  }
}

async function runNpm(args, options = {}) {
  if (process.platform === 'win32') {
    const command = ['npm.cmd', ...args].map(quoteWindowsArg).join(' ');
    return execFileAsync(windowsShell, ['/d', '/s', '/c', command], options);
  }

  return execFileAsync(npmCmd, args, options);
}

function quoteWindowsArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
