/**
 * Content-derived ids (contracts §2 `captureId`, §3 `stageId`). Uses WebCrypto (`crypto.subtle`), which
 * exists in browsers, Workers and Node ≥ 19, so every phase computes identical ids.
 *
 * Joining rule (contracts §9): fields are joined with "|" so different splits can't collide
 * (e.g. seed 12 + "1.0.0" vs seed 1 + "21.0.0").
 */
import type { Difficulty } from './types.ts';

/** Lower-case hex sha256 of a UTF-8 string. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** captureId = sha256(normalizedUrl | capturedAt). */
export function computeCaptureId(normalizedUrl: string, capturedAt: string): Promise<string> {
  return sha256Hex(`${normalizedUrl}|${capturedAt}`);
}

/** stageId = sha256(captureId | slice.index | seed | builderVersion | difficulty). */
export function computeStageId(
  captureId: string,
  sliceIndex: number,
  seed: number,
  builderVersion: string,
  difficulty: Difficulty,
): Promise<string> {
  if (!Number.isInteger(sliceIndex) || sliceIndex < 0)
    return Promise.reject(
      new RangeError(`computeStageId: sliceIndex must be a non-negative integer (got ${sliceIndex})`),
    );
  return sha256Hex(`${captureId}|${sliceIndex}|${seed >>> 0}|${builderVersion}|${difficulty}`);
}

/**
 * contracts §7 (v0.2.4): runId = sha256("run" | captureId | seed | builderVersion | difficulty) — one run is
 * every slice of one capture built with one seed/builder/difficulty.
 */
export function computeRunId(
  captureId: string,
  seed: number,
  builderVersion: string,
  difficulty: 'easy' | 'normal' | 'hard',
): Promise<string> {
  return sha256Hex(`run|${captureId}|${seed >>> 0}|${builderVersion}|${difficulty}`);
}
