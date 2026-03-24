import { readFile } from 'node:fs/promises';
import type { ImageContent, ResourceLink } from '@modelcontextprotocol/sdk/types.js';

export const MAX_INLINE_CAPTURE_BYTES = 200_000;

export function buildCaptureResourceUri(captureId: string) {
  return `blueprint://captures/${encodeURIComponent(captureId)}`;
}

export function buildResourceLinkContent(
  uri: string,
  name: string,
  mimeType: string,
  description?: string,
): ResourceLink {
  return {
    type: 'resource_link',
    uri,
    name,
    mimeType,
    ...(description ? { description } : {}),
  };
}

export async function maybeBuildInlineImageContent(filePath: unknown): Promise<ImageContent | null> {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return null;
  }

  try {
    const image = await readFile(filePath);
    if (image.byteLength > MAX_INLINE_CAPTURE_BYTES) {
      return null;
    }

    return {
      type: 'image',
      data: image.toString('base64'),
      mimeType: 'image/png',
    };
  } catch {
    return null;
  }
}
