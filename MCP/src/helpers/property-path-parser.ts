/**
 * Property-path string notation helpers.
 *
 * Converts between the flat string format used by MCP tool inputs and the
 * nested C++ representation expected by the Unreal Engine StateTree subsystem.
 *
 * String format:  "structGuid:PropertyName.SubProperty[ArrayIndex]"
 *
 * Examples:
 *   "abc:Speed.Value"       -> { structId: "abc", segments: [{ name: "Speed" }, { name: "Value" }] }
 *   "abc:Items[2].Name"     -> { structId: "abc", segments: [{ name: "Items", arrayIndex: 2 }, { name: "Name" }] }
 *   ":RootProp"             -> { structId: undefined, segments: [{ name: "RootProp" }] }
 */

export interface PropertyPathSegment {
  name: string;
  arrayIndex?: number;
  instanceStruct?: string;
}

export interface PropertyPath {
  structId?: string;
  segments: PropertyPathSegment[];
}

export interface PropertyPathBinding {
  sourcePath: string;
  targetPath: string;
}

export interface NestedPropertyPathBinding {
  sourcePath: PropertyPath;
  targetPath: PropertyPath;
}

/**
 * Parse a property-path string into the nested C++ representation.
 *
 * Format: "structId:Segment1.Segment2[ArrayIdx].Segment3"
 * - structId is optional (may be empty before the colon, or colon may be absent)
 * - Segments are dot-separated property names
 * - Array indices use bracket notation: PropertyName[0]
 */
export function parsePropertyPath(str: string): PropertyPath {
  if (!str || str.trim().length === 0) {
    return { segments: [] };
  }

  let structId: string | undefined;
  let segmentsPart: string;

  const colonIndex = str.indexOf(':');
  if (colonIndex >= 0) {
    const rawId = str.slice(0, colonIndex);
    structId = rawId.length > 0 ? rawId : undefined;
    segmentsPart = str.slice(colonIndex + 1);
  } else {
    segmentsPart = str;
  }

  if (!segmentsPart || segmentsPart.trim().length === 0) {
    return { structId, segments: [] };
  }

  // Split on dots, but handle bracket notation within each token
  const tokens = segmentsPart.split('.');
  const segments: PropertyPathSegment[] = [];

  for (const token of tokens) {
    if (!token) continue;

    const bracketMatch = token.match(/^([^[]+)\[(\d+)\]$/);
    if (bracketMatch) {
      segments.push({
        name: bracketMatch[1],
        arrayIndex: parseInt(bracketMatch[2], 10),
      });
    } else {
      segments.push({ name: token });
    }
  }

  return { structId, segments };
}

/**
 * Serialize a nested PropertyPath object into the flat string notation.
 *
 * Produces: "structId:Segment1.Segment2[ArrayIdx].Segment3"
 */
export function serializePropertyPath(obj: PropertyPath): string {
  const prefix = obj.structId ? `${obj.structId}:` : ':';

  const segmentStrs = (obj.segments || []).map((seg) => {
    let s = seg.name;
    if (seg.arrayIndex !== undefined && seg.arrayIndex !== null) {
      s += `[${seg.arrayIndex}]`;
    }
    return s;
  });

  return prefix + segmentStrs.join('.');
}

/**
 * Convert a flat PropertyPathBinding (string paths) into the nested C++ form.
 */
export function expandBinding(binding: PropertyPathBinding): NestedPropertyPathBinding {
  return {
    sourcePath: parsePropertyPath(binding.sourcePath),
    targetPath: parsePropertyPath(binding.targetPath),
  };
}

/**
 * Convert a nested PropertyPathBinding into the flat string form.
 */
export function flattenBinding(binding: NestedPropertyPathBinding): PropertyPathBinding {
  return {
    sourcePath: serializePropertyPath(binding.sourcePath),
    targetPath: serializePropertyPath(binding.targetPath),
  };
}
