import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_INLINE_CAPTURE_BYTES,
  buildCaptureResourceUri,
  buildResourceLinkContent,
  maybeBuildInlineImageContent,
} from '../src/helpers/capture.js';

describe('capture helpers', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('builds stable capture resource links', () => {
    expect(buildCaptureResourceUri('capture 123')).toBe('blueprint://captures/capture%20123');
    expect(buildResourceLinkContent(
      'blueprint://captures/capture-123',
      'Capture',
      'image/png',
      'Preview image',
    )).toEqual({
      type: 'resource_link',
      uri: 'blueprint://captures/capture-123',
      name: 'Capture',
      mimeType: 'image/png',
      description: 'Preview image',
    });
  });

  it('inlines small PNG payloads and skips missing or oversized files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bpx-capture-test-'));
    cleanupPaths.push(root);
    const smallPath = join(root, 'small.png');
    const largePath = join(root, 'large.png');
    await writeFile(smallPath, Buffer.from('png-data'));
    await writeFile(largePath, Buffer.alloc(MAX_INLINE_CAPTURE_BYTES + 1, 1));

    await expect(maybeBuildInlineImageContent(undefined)).resolves.toBeNull();
    await expect(maybeBuildInlineImageContent(join(root, 'missing.png'))).resolves.toBeNull();
    await expect(maybeBuildInlineImageContent(largePath)).resolves.toBeNull();
    await expect(maybeBuildInlineImageContent(smallPath)).resolves.toEqual({
      type: 'image',
      data: Buffer.from('png-data').toString('base64'),
      mimeType: 'image/png',
    });
  });
});
