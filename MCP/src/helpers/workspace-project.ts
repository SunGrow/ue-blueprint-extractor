import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export type WorkspaceProjectResolution = {
  projectPath?: string;
  ambiguous: boolean;
  searchedFrom: string;
};

type ProjectDescriptor = {
  EngineAssociation?: unknown;
};

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;
const WSL_MOUNT_PATH = /^\/mnt\/([a-zA-Z])(\/.*)?$/;

export function isWindowsStylePath(input: string): boolean {
  return WINDOWS_DRIVE_PATH.test(input) || WINDOWS_UNC_PATH.test(input);
}

export function isWslMountedWindowsPath(input: string): boolean {
  return WSL_MOUNT_PATH.test(input);
}

export function toWindowsStylePath(input: string): string {
  if (isWindowsStylePath(input)) {
    return path.win32.normalize(input);
  }

  const match = input.replaceAll('\\', '/').match(WSL_MOUNT_PATH);
  if (!match) {
    return input;
  }

  const drive = match[1]?.toUpperCase();
  const suffix = match[2] ?? '';
  return path.win32.normalize(`${drive}:${suffix}`);
}

export function toHostFilesystemPath(
  input: string,
  targetPlatform: NodeJS.Platform,
  hostPlatform: NodeJS.Platform = process.platform,
): string {
  if (targetPlatform !== 'win32' || hostPlatform === 'win32') {
    return input;
  }

  if (isWslMountedWindowsPath(input)) {
    return path.posix.normalize(input.replaceAll('\\', '/'));
  }

  const normalized = input.replaceAll('\\', '/');
  const match = normalized.match(/^([A-Za-z]):(\/.*)?$/);
  if (!match) {
    return input;
  }

  const drive = match[1]?.toLowerCase();
  const suffix = match[2] ?? '';
  return path.posix.normalize(`/mnt/${drive}${suffix}`);
}

export function normalizeFilesystemPath(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  if (isWindowsStylePath(trimmed)) {
    return path.win32.normalize(trimmed).replaceAll('\\', '/').toLowerCase();
  }

  return path.posix.normalize(trimmed);
}

export function filesystemPathsEqual(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeFilesystemPath(left);
  const normalizedRight = normalizeFilesystemPath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export async function findNearestWorkspaceProject(startDir: string = process.cwd()): Promise<WorkspaceProjectResolution> {
  let currentDir = path.resolve(startDir);
  let lastDir = '';

  while (currentDir !== lastDir) {
    let projectFiles: string[] = [];
    try {
      projectFiles = (await readdir(currentDir))
        .filter((entry) => entry.toLowerCase().endsWith('.uproject'));
    } catch {
      // Ignore unreadable directories and continue climbing.
    }

    if (projectFiles.length === 1) {
      return {
        projectPath: path.join(currentDir, projectFiles[0] as string),
        ambiguous: false,
        searchedFrom: startDir,
      };
    }

    if (projectFiles.length > 1) {
      return {
        ambiguous: true,
        searchedFrom: startDir,
      };
    }

    lastDir = currentDir;
    currentDir = path.dirname(currentDir);
  }

  return {
    ambiguous: false,
    searchedFrom: startDir,
  };
}

export async function readProjectEngineAssociation(projectPath: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(projectPath, 'utf8')) as ProjectDescriptor;
    return typeof parsed.EngineAssociation === 'string' && parsed.EngineAssociation.length > 0
      ? parsed.EngineAssociation
      : undefined;
  } catch {
    return undefined;
  }
}

export function buildEngineAssociationCandidates(
  engineAssociation: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!engineAssociation) {
    return [];
  }

  const trimmed = engineAssociation.trim();
  if (!trimmed) {
    return [];
  }

  const candidates = new Set<string>();
  const installRoots = platform === 'win32'
    ? ['C:/Program Files/Epic Games']
    : platform === 'darwin'
      ? ['/Users/Shared/Epic Games', '/Users/Shared/EpicGames']
      : [];

  if (/^\d+\.\d+$/.test(trimmed)) {
    for (const root of installRoots) {
      candidates.add(`${root}/UE_${trimmed}`);
    }
  }

  if (/^UE_\d+\.\d+$/.test(trimmed)) {
    for (const root of installRoots) {
      candidates.add(`${root}/${trimmed}`);
    }
  }

  candidates.add(trimmed);
  return Array.from(candidates);
}
