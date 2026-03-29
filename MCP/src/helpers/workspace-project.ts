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

export function normalizeFilesystemPath(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  const normalized = path.normalize(input);
  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
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

export function buildEngineAssociationCandidates(engineAssociation: string | undefined): string[] {
  if (!engineAssociation) {
    return [];
  }

  const trimmed = engineAssociation.trim();
  if (!trimmed) {
    return [];
  }

  const candidates = new Set<string>();
  if (/^\d+\.\d+$/.test(trimmed)) {
    candidates.add(`C:/Program Files/Epic Games/UE_${trimmed}`);
  }

  if (/^UE_\d+\.\d+$/.test(trimmed)) {
    candidates.add(`C:/Program Files/Epic Games/${trimmed}`);
  }

  candidates.add(trimmed);
  return Array.from(candidates);
}

