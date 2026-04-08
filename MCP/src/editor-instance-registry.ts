import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { EditorInstanceSnapshot, EditorRegistryListResult } from './editor-instance-types.js';

const REGISTRY_ENV = 'BLUEPRINT_EXTRACTOR_EDITOR_REGISTRY_DIR';
const DEFAULT_STALE_TTL_MS = 15_000;
const WSL_WINDOWS_USERS_ROOT = '/mnt/c/Users';
const WSL_WINDOWS_REGISTRY_SUFFIX = ['AppData', 'Local', 'Temp', 'BlueprintExtractor', 'EditorRegistry'];

const editorInstanceSchema = z.object({
  instanceId: z.string(),
  projectName: z.string().optional(),
  projectFilePath: z.string(),
  projectDir: z.string().optional(),
  engineRoot: z.string().optional(),
  engineVersion: z.string().optional(),
  editorTarget: z.string().optional(),
  processId: z.number().int().optional(),
  remoteControlHost: z.string().default('127.0.0.1'),
  remoteControlPort: z.number().int().positive(),
  lastSeenAt: z.string().optional(),
});

function parseLastSeenAt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getEditorRegistryDir(): string {
  return process.env[REGISTRY_ENV]
    ? path.resolve(process.env[REGISTRY_ENV] as string)
    : path.join(tmpdir(), 'BlueprintExtractor', 'EditorRegistry');
}

async function getEditorRegistryDirs(): Promise<string[]> {
  const overrideDir = process.env[REGISTRY_ENV];
  if (overrideDir) {
    return [path.resolve(overrideDir)];
  }

  const dirs = new Set<string>([getEditorRegistryDir()]);
  if (process.platform !== 'linux') {
    return Array.from(dirs);
  }

  try {
    const userEntries = await readdir(WSL_WINDOWS_USERS_ROOT, { withFileTypes: true });
    for (const entry of userEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      dirs.add(path.join(WSL_WINDOWS_USERS_ROOT, entry.name, ...WSL_WINDOWS_REGISTRY_SUFFIX));
    }
  } catch {
    // Ignore missing /mnt/c/Users on non-WSL or restricted hosts.
  }

  return Array.from(dirs);
}

export async function listRegisteredEditors(staleTtlMs = DEFAULT_STALE_TTL_MS): Promise<EditorRegistryListResult> {
  const registryDirs = await getEditorRegistryDirs();
  const editorsByInstanceId = new Map<string, { snapshot: EditorInstanceSnapshot; lastSeenAt: number }>();
  let staleEntryCount = 0;

  for (const registryDir of registryDirs) {
    let fileNames: string[] = [];
    try {
      fileNames = await readdir(registryDir);
    } catch {
      continue;
    }

    for (const fileName of fileNames) {
      if (!fileName.toLowerCase().endsWith('.json')) {
        continue;
      }

      const fullPath = path.join(registryDir, fileName);
      try {
        const [raw, fileStat] = await Promise.all([
          readFile(fullPath, 'utf8'),
          stat(fullPath),
        ]);
        const parsed = editorInstanceSchema.parse(JSON.parse(raw)) as EditorInstanceSnapshot;
        const lastSeenAt = parseLastSeenAt(parsed.lastSeenAt) ?? fileStat.mtimeMs;
        if ((Date.now() - lastSeenAt) > staleTtlMs) {
          staleEntryCount += 1;
          await rm(fullPath, { force: true }).catch(() => undefined);
          continue;
        }

        // Verify the process is actually alive — registry files can outlive the editor
        // process (e.g. after a crash, force-kill, or external build restart).
        if (typeof parsed.processId === 'number') {
          try {
            process.kill(parsed.processId, 0);
          } catch {
            staleEntryCount += 1;
            await rm(fullPath, { force: true }).catch(() => undefined);
            continue;
          }
        }

        const existing = editorsByInstanceId.get(parsed.instanceId);
        if (!existing || lastSeenAt >= existing.lastSeenAt) {
          editorsByInstanceId.set(parsed.instanceId, { snapshot: parsed, lastSeenAt });
        }
      } catch {
        staleEntryCount += 1;
        await rm(fullPath, { force: true }).catch(() => undefined);
      }
    }
  }

  const editors = Array.from(editorsByInstanceId.values(), (entry) => entry.snapshot);

  editors.sort((left, right) => {
    const projectCompare = String(left.projectName ?? left.projectFilePath)
      .localeCompare(String(right.projectName ?? right.projectFilePath));
    if (projectCompare !== 0) {
      return projectCompare;
    }

    return left.remoteControlPort - right.remoteControlPort;
  });

  return {
    editors,
    registryDir: registryDirs[0] ?? getEditorRegistryDir(),
    staleEntryCount,
  };
}
