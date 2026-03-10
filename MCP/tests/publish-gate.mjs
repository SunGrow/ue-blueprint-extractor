import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const windowsShell = 'cmd.exe';

async function main() {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const packageName = packageJson?.name;
  const packageVersion = packageJson?.version;

  if (typeof packageName !== 'string' || typeof packageVersion !== 'string') {
    throw new Error('Could not resolve package name/version from package.json');
  }

  if (await isAlreadyPublished(packageName, packageVersion)) {
    console.log(`${packageName}@${packageVersion} is already published; skipping npm publish --dry-run.`);
    return;
  }

  await runNpm(['publish', '--dry-run'], { cwd });
}

async function isAlreadyPublished(packageName, packageVersion) {
  try {
    const { stdout } = await runNpm(
      ['view', `${packageName}@${packageVersion}`, 'version', '--json'],
      { cwd },
    );
    const parsed = JSON.parse(stdout.trim());
    return parsed === packageVersion;
  } catch {
    return false;
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
