/**
 * Filters internal fields from mutation results.
 * Strips implementation details that waste context tokens.
 */

const INTERNAL_FIELDS = new Set([
  'transaction_id',
  'transactionId',
  'duration',
  'duration_ms',
  'durationMs',
  'hash',
  'contentHash',
  'content_hash',
  'debug',
  'debugInfo',
  'debug_info',
  'internalId',
  'internal_id',
  '_internalState',
  '_internal_state',
  'engineTimestamp',
  'engine_timestamp',
  'frameNumber',
  'frame_number',
  'gcIndex',
  'gc_index',
]);

export function filterMutationResult(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (INTERNAL_FIELDS.has(key)) continue;

    // Recursively filter nested objects (one level deep)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const filteredNested: Record<string, unknown> = {};
      for (const [nk, nv] of Object.entries(nested)) {
        if (!INTERNAL_FIELDS.has(nk)) {
          filteredNested[nk] = nv;
        }
      }
      filtered[key] = filteredNested;
    } else {
      filtered[key] = value;
    }
  }
  return filtered;
}
