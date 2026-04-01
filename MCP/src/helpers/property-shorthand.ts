export function expandDottedProperties(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!key.includes('.')) { result[key] = value; continue; }
    const parts = key.split('.');
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part in current && typeof current[part] !== 'object') {
        throw new Error(`expandDottedProperties: key conflict — "${parts.slice(0, i + 1).join('.')}" is both a value and a path prefix`);
      }
      if (!(part in current) || current[part] === null) current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
  return result;
}
