/**
 * Diff-friendly JSON: pretty at the top level, one compact line per array entry for the big arrays
 * (`elements`, `items`, …). Still plain JSON.
 */
export function formatJson(value: unknown, compactArrays: readonly string[] = ['elements']): string {
  const compact = new Set(compactArrays);
  const walk = (v: unknown, indent: string, key?: string): string => {
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      if (key !== undefined && compact.has(key)) {
        return `[\n${v.map((x) => `${indent}  ${JSON.stringify(x)}`).join(',\n')}\n${indent}]`;
      }
      if (v.every((x) => typeof x !== 'object' || x === null)) return JSON.stringify(v);
      return `[\n${v.map((x) => `${indent}  ${walk(x, `${indent}  `)}`).join(',\n')}\n${indent}]`;
    }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
      if (entries.length === 0) return '{}';
      return `{\n${entries
        .map(([k, x]) => `${indent}  ${JSON.stringify(k)}: ${walk(x, `${indent}  `, k)}`)
        .join(',\n')}\n${indent}}`;
    }
    return JSON.stringify(v);
  };
  return `${walk(value, '')}\n`;
}
