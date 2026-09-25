/**
 * One eval job: build (slug, slice, difficulty, seed) with the real builder → validateStage → audit → solve →
 * validatePlayable verdict (+ optional thumbnail). Pure apart from reading the capture and writing the PNG.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { CaptureBundle, Difficulty, RGBAImage, StageData, Vec2 } from '@wwm/schema';
import { sliceCount, validateStage } from '@wwm/schema';
import {
  auditIslands,
  buildNavGrid,
  difficultyStars,
  PAR_REJECT_SEC,
  planRoute,
  type SolveFailure,
  solveStage,
} from '@wwm/solver';
import { buildStage } from '@wwm/stage-builder';
import { encodePng, loadCapture } from '@wwm/stage-builder/node';
import { renderThumb } from './thumb.ts';

export interface EvalJob {
  slug: string;
  slice: number;
  difficulty: Difficulty;
  seed: number;
  /** Write a thumbnail to this path (absolute) when set; `thumbOnFail` writes one only on failure. */
  thumbPath?: string;
  thumbOnFail?: string;
}

export interface EvalRecord {
  slug: string;
  slice: number;
  sliceCount: number;
  difficulty: Difficulty;
  seed: number;
  /** Seed of the built stage (the builder may reroll internally). */
  stageSeed: number;
  stageId: string;
  size: { width: number; height: number };
  buildOk: boolean;
  buildError?: string;
  valid: boolean;
  validationErrors: string[];
  islands: number;
  bridges: number;
  ramps: number;
  elevators: number;
  smallItems: number;
  largeItems: number;
  buildMs: number;
  /** Planner audit (builder feedback): islands with split walkable areas / mouths without ball-sized ground. */
  audit: {
    split: number;
    noGround: number;
    issues: { islandId: number; kind: string; points: string[]; at: Vec2 }[];
  };
  solved: boolean;
  /** Solver verdict for publishing: solved and par ≤ PAR_REJECT_SEC. */
  playable: boolean;
  parSec: number;
  falls: number;
  /** JUMP presses the solved run needed (a jump over a neck is a builder issue worth fixing too). */
  jumps: number;
  stars: number;
  variant: string;
  attempts: {
    variant: string;
    success: boolean;
    timeSec: number;
    falls: number;
    cpuMs: number;
    failure?: string;
  }[];
  failure?: SolveFailure;
  routeM: number;
  items: number;
  solveCpuMs: number;
  /** Sim seconds per CPU second over all attempts. */
  speedup: number;
  thumb?: string;
}

const captures = new Map<string, { capture: CaptureBundle; image: RGBAImage }>();
function capture(slug: string) {
  let c = captures.get(slug);
  if (!c) {
    c = loadCapture(slug);
    captures.clear(); // keep one decoded page in memory per worker
    captures.set(slug, c);
  }
  return c;
}

export function slicesOf(slug: string): number {
  return sliceCount(capture(slug).capture);
}

export async function runJob(job: EvalJob): Promise<EvalRecord> {
  const { capture: cap, image } = capture(job.slug);
  const base = {
    slug: job.slug,
    slice: job.slice,
    sliceCount: sliceCount(cap),
    difficulty: job.difficulty,
    seed: job.seed,
  };
  const tB = performance.now();
  let stage: StageData;
  try {
    stage = buildStage({
      capture: cap,
      image,
      sliceIndex: job.slice,
      seed: job.seed,
      difficulty: job.difficulty,
    }).stage;
  } catch (e) {
    return {
      ...base,
      stageSeed: job.seed,
      stageId: '',
      size: { width: 0, height: 0 },
      buildOk: false,
      buildError: (e as Error).message,
      valid: false,
      validationErrors: [],
      islands: 0,
      bridges: 0,
      ramps: 0,
      elevators: 0,
      smallItems: 0,
      largeItems: 0,
      buildMs: performance.now() - tB,
      audit: { split: 0, noGround: 0, issues: [] },
      solved: false,
      playable: false,
      parSec: 0,
      falls: 0,
      jumps: 0,
      stars: 0,
      variant: '',
      attempts: [],
      routeM: 0,
      items: 0,
      solveCpuMs: 0,
      speedup: 0,
    };
  }
  const buildMs = performance.now() - tB;
  const v = validateStage(stage);
  const grid = buildNavGrid(stage);
  const issues = auditIslands(grid);
  const solve = await solveStage(stage, { grid });
  const simSec = solve.attempts.reduce((a, t) => a + t.timeSec, 0);
  const rec: EvalRecord = {
    ...base,
    stageSeed: stage.seed,
    stageId: stage.stageId,
    size: stage.size,
    buildOk: true,
    valid: v.ok,
    validationErrors: v.errors.map((e) => `${e.code}: ${e.message}`).slice(0, 5),
    islands: stage.islands.length,
    bridges: stage.bridges.length,
    ramps: stage.bridges.filter((b) => b.type === 'ramp').length,
    elevators: stage.elevators.length,
    smallItems: stage.items.filter((i) => i.kind === 'small').length,
    largeItems: stage.items.filter((i) => i.kind === 'large').length,
    buildMs,
    audit: {
      split: issues.filter((i) => i.kind === 'split').length,
      noGround: issues.filter((i) => i.kind === 'no-ground').length,
      issues: issues.map((i) => ({ islandId: i.islandId, kind: i.kind, points: i.points, at: i.at })),
    },
    solved: solve.success,
    playable: solve.success && solve.timeSec <= PAR_REJECT_SEC,
    parSec: solve.success ? solve.timeSec : 0,
    falls: solve.falls,
    jumps: solve.jumps,
    stars: difficultyStars(solve),
    variant: solve.variant,
    attempts: solve.attempts.map((a) => ({
      variant: a.variant,
      success: a.success,
      timeSec: a.timeSec,
      falls: a.falls,
      cpuMs: a.cpuMs,
      ...(a.failure ? { failure: a.failure.kind } : {}),
    })),
    ...(solve.failure ? { failure: solve.failure } : {}),
    routeM: solve.routeM,
    items: solve.items,
    solveCpuMs: solve.cpuMs,
    speedup: solve.cpuMs > 0 ? simSec / (solve.cpuMs / 1000) : 0,
  };
  const thumbPath = job.thumbPath ?? (!rec.playable ? job.thumbOnFail : undefined);
  if (thumbPath) {
    const route = planRoute(grid, { from: stage.start.pos });
    const r = renderThumb(stage, {
      width: 360,
      image,
      imageScale: cap.screenshot.scale,
      route: route ? route.legs.map((l) => l.verts.map((x) => x.p)) : [],
      solve,
    });
    mkdirSync(thumbPath.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(thumbPath, encodePng({ width: r.width, height: r.height, data: r.data }));
    rec.thumb = thumbPath;
  }
  return rec;
}
