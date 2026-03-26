type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

interface AssetResult {
  assetPath?: string;
  asset_path?: string;
  PackagePath?: string;
  package_path?: string;
  [key: string]: unknown;
}

function getPath(result: AssetResult): string {
  return result.assetPath ?? result.asset_path ?? result.PackagePath ?? result.package_path ?? '';
}

/**
 * Filters phantom assets from search/list results by verifying each asset's
 * parent directory listing. Assets not found in the listing are removed.
 * Returns the filtered array and the count of removed phantom entries.
 */
export async function filterPhantomAssets<T extends AssetResult>(
  results: T[],
  callSubsystemJson: JsonSubsystemCaller,
): Promise<{ filtered: T[]; removedCount: number }> {
  if (results.length === 0) {
    return { filtered: results, removedCount: 0 };
  }

  // Group results by parent directory for batch verification
  const parentDirs = new Map<string, Set<string>>();
  for (const result of results) {
    const assetPath = getPath(result);
    if (!assetPath) continue;
    const lastSlash = assetPath.lastIndexOf('/');
    const parentDir = lastSlash > 0 ? assetPath.slice(0, lastSlash) : '/Game';
    if (!parentDirs.has(parentDir)) {
      parentDirs.set(parentDir, new Set());
    }
    parentDirs.get(parentDir)!.add(assetPath);
  }

  // Verify existence by listing each parent directory
  const validPaths = new Set<string>();
  for (const [parentDir, assetPaths] of parentDirs) {
    try {
      const listing = await callSubsystemJson('ListAssets', {
        PackagePath: parentDir,
        bRecursive: false,
        ClassFilter: '',
      });
      const listedAssets = Array.isArray(listing.assets) ? listing.assets : [];
      for (const asset of listedAssets) {
        if (typeof asset === 'object' && asset !== null) {
          const path = getPath(asset as AssetResult);
          if (path) validPaths.add(path);
        }
      }
    } catch {
      // If listing fails, keep all results from this directory
      for (const path of assetPaths) {
        validPaths.add(path);
      }
    }
  }

  const filtered = results.filter((r) => {
    const path = getPath(r);
    return !path || validPaths.has(path);
  });

  return { filtered, removedCount: results.length - filtered.length };
}
