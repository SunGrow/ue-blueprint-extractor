import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { EditorInstanceSnapshot, EditorRegistryListResult } from './editor-instance-types.js';

const REGISTRY_ENV = 'BLUEPRINT_EXTRACTOR_EDITOR_REGISTRY_DIR';
const DEFAULT_STALE_TTL_MS = 15_000;

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

export async function listRegisteredEditors(staleTtlMs = DEFAULT_STALE_TTL_MS): Promise<EditorRegistryListResult> {
  const registryDir = getEditorRegistryDir();
  let fileNames: string[] = [];
  try {
    fileNames = await readdir(registryDir);
  } catch {
    return {
      editors: [],
      registryDir,
      staleEntryCount: 0,
    };
  }

  const editors: EditorInstanceSnapshot[] = [];
  let staleEntryCount = 0;

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

      editors.push(parsed);
    } catch {
      staleEntryCount += 1;
      await rm(fullPath, { force: true }).catch(() => undefined);
    }
  }

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
    registryDir,
    staleEntryCount,
  };
}
