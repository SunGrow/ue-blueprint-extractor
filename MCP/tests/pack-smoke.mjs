import { access, rm } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const windowsShell = 'cmd.exe';

async function main() {
  const tarballPath = await createTarball();

  try {
    await smokeStartFromTarball(tarballPath);
  } finally {
    await rm(tarballPath, { force: true });
  }
}

async function createTarball() {
  const { stdout } = process.platform === 'win32'
    ? await execFileAsync(windowsShell, ['/d', '/s', '/c', 'npm.cmd pack --json'], { cwd })
    : await execFileAsync(npmCmd, ['pack', '--json'], { cwd });
  const parsed = JSON.parse(stdout);
  const filename = parsed?.[0]?.filename;

  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error(`npm pack did not return a tarball filename: ${stdout}`);
  }

  const tarballPath = resolve(cwd, filename);
  await access(tarballPath);
  return tarballPath;
}

async function smokeStartFromTarball(tarballPath) {
  const isWindows = process.platform === 'win32';
  const tarballSpec = isWindows ? `.\\${basename(tarballPath)}` : `./${basename(tarballPath)}`;
  const command = isWindows ? windowsShell : npmCmd;
  const args = isWindows
    ? ['/d', '/s', '/c', `npm.cmd exec --yes --package ${tarballSpec} blueprint-extractor-mcp`]
    : ['exec', '--yes', '--package', tarballSpec, 'blueprint-extractor-mcp'];

  const child = spawn(command, args, {
    cwd,
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
