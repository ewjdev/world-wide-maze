import { type Difficulty, hashString } from '@wwm/schema';

export { computeRunId } from '@wwm/schema';

/** Default seed when the client sends none: stable per normalized URL, so popular pages share stages. */
export function defaultSeed(normalizedUrl: string): number {
  return hashString(normalizedUrl) >>> 0;
}

/**
 * KV cache key (G0 update): `run:<normUrl>:<difficulty>:<builderVersion>`, plus `:seed=<n>` only when the
 * client chose a seed (the default seed is a function of the URL, so it adds nothing).
 */
export function runCacheKey(
  normUrl: string,
  difficulty: Difficulty,
  builderVersion: string,
  seed?: number,
): string {
  const base = `run:${normUrl}:${difficulty}:${builderVersion}`;
  return seed === undefined ? base : `${base}:seed=${seed >>> 0}`;
}
