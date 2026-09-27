import { type Difficulty, hashString, sha256Hex } from '@wwm/schema';

export { computeRunId } from '@wwm/schema';

/** Default seed when the client sends none: stable per normalized URL, so popular pages share stages. */
export function defaultSeed(normalizedUrl: string): number {
  return hashString(normalizedUrl) >>> 0;
}

/** Hashed variant identity fits KV limits even for the longest accepted URL. */
export async function runCacheKey(
  normUrl: string,
  difficulty: Difficulty,
  builderVersion: string,
  seed?: number,
): Promise<string> {
  return `run:v2:${await sha256Hex(JSON.stringify([normUrl, difficulty, builderVersion, (seed ?? defaultSeed(normUrl)) >>> 0]))}`;
}
