import { type Difficulty, hashString, sha256Hex } from '@wwm/schema';

/**
 * runId = sha256(captureId | seed | builderVersion | difficulty): one run = every slice of one capture built
 * with one seed/builder/difficulty. LOCAL until the orchestrator adds `computeRunId` to @wwm/schema (CCR-07-1).
 */
export function computeRunId(
  captureId: string,
  seed: number,
  builderVersion: string,
  difficulty: Difficulty,
): Promise<string> {
  return sha256Hex(`run|${captureId}|${seed >>> 0}|${builderVersion}|${difficulty}`);
}

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
