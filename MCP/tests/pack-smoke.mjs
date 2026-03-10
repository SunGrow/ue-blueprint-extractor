import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const windowsShell = 'cmd.exe';

async function main() {
  const tarballPath = await createTarball();
  const installRoot = await mkdtemp(join(tmpdir(), 'blueprint-extractor-pack-smoke-'));

  try {
    await installTarball(installRoot, tarballPath);
    const entryPoint = await resolvePackagedEntryPoint(installRoot);
    await smokeStartFromTarball(entryPoint, installRoot);
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

async function resolvePackagedEntryPoint(installRoot) {
  const packageRoot = join(installRoot, 'node_modules', 'blueprint-extractor-mcp');
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

async function smokeStartFromTarball(entryPoint, installRoot) {
  const child = spawn(process.execPath, [entryPoint], {
    cwd: installRoot,
    env: {
      ...process.env,
      UE_REMOTE_CONTROL_HOST: process.env.UE_REMOTE_CONTROL_HOST ?? '127.0.0.1',
      UE_REMOTE_CONTROL_PORT: process.env.UE_REMOTE_CONTROL_PORT ?? '30010',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitPromise = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => {
      resolveExit({ code, signal });
    });
  });
  const errorPromise = new Promise((_, reject) => {
    child.once('error', reject);
  });

  const startupResult = await Promise.race([
    errorPromise,
    exitPromise,
    wait(10000).then(() => ({ timeout: true })),
  ]);

  if (!('timeout' in startupResult)) {
    throw new Error(
      `blueprint-extractor-mcp exited before the startup smoke timeout (code=${startupResult.code}, signal=${startupResult.signal})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }

  await terminate(child, exitPromise);
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

async function terminate(child, exitPromise) {
  child.kill();

  const result = await Promise.race([
    exitPromise,
    wait(5000).then(() => ({ timeout: true })),
  ]);

  if ('timeout' in result) {
    child.kill('SIGKILL');
    await exitPromise;
  }
}

function wait(ms) {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, ms);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
