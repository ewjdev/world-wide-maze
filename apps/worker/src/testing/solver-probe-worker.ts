/**
 * Test-only Worker entry, never imported by the Worker itself (test/solver.workerd.test.ts): runs the production playability hook in workerd.
 *   POST /build-solve {capture, png (base64), slice, seed, difficulty} → build the slice with the real builder,
 *   then `solverHook` (the same code the BuildJob pipeline calls). Returns what ran and how long each part took.
 *   POST /solve StageData → `solverHook` only.
 */
import type { CaptureBundle, Difficulty, StageData } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { solverHook } from '../builder.ts';
import { decodePng } from '../image/png.ts';

// the production config binds these Durable Object classes, so the entry must export them
export { BuildJob, Limiter, Room } from '../index.ts';

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    if (url.pathname === '/solve') {
      const stage = (await req.json()) as StageData;
      const t0 = performance.now();
      const r = await solverHook(stage);
      return Response.json({ ua, result: r, ms: performance.now() - t0 });
    }
    if (url.pathname === '/build-solve') {
      const body = (await req.json()) as {
        capture: CaptureBundle;
        png: string;
        slice: number;
        seed: number;
        difficulty: Difficulty;
      };
      const t0 = performance.now();
      const image = await decodePng(b64(body.png));
      const t1 = performance.now();
      const { stage } = buildStage({
        capture: body.capture,
        image,
        sliceIndex: body.slice,
        seed: body.seed,
        difficulty: body.difficulty,
      });
      const t2 = performance.now();
      const r = await solverHook(stage);
      const t3 = performance.now();
      return Response.json({
        ua,
        result: r,
        islands: stage.islands.length,
        decodeMs: t1 - t0,
        buildMs: t2 - t1,
        solveMs: t3 - t2,
      });
    }
    return new Response('not found', { status: 404 });
  },
};
