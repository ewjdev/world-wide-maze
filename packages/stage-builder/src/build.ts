/**
 * Step 13: `buildStage` — orchestrates every step, validates the result with `validateStage`, and rerolls with
 * seed+1..seed+4 if validation fails (then throws `BuildError` with code BUILD_FAILED).
 * Pure and deterministic: no I/O, no DOM, no Math.random, no clock in the output.
 */
import {
  BALL_RADIUS_PX,
  type Bridge,
  type BuildInput,
  type BuildResult,
  createRng,
  type DebugLayers,
  ELEVATOR_COOLDOWN_SEC,
  ELEVATOR_MIN_PLATFORM_PX,
  ELEVATOR_TRAVEL_BASE_SEC,
  ELEVATOR_TRAVEL_SEC_PER_M,
  type Elevator,
  GOAL_RADIUS_M,
  type Island,
  type Item,
  LEVEL_HEIGHT_M,
  PX_PER_METER,
  pointInRing,
  type Rng,
  ringsOverlap,
  type StageData,
  sliceRange,
  TIME_LIMIT_SEC_DEFAULT,
  type Vec2,
  validateStage,
} from '@wwm/schema';
import { classifyBackground } from './background.ts';
import { type Candidate, deckBox, findCandidates, type IslandShape } from './bridges.ts';
import { outlineIsland, removeDiagonalPinches } from './contours.ts';
import { distanceTransform } from './distance.ts';
import { createGrid } from './grid.ts';
import {
  componentInfo,
  extractIslands,
  fillInlets,
  labelComponents,
  splitOversized,
  thickenThin,
} from './islands.ts';
import { assignLevels } from './levels.ts';
import { candidateComponents, carveMaze } from './maze.ts';
import { close, fillHoles, open, or } from './morphology.ts';
import { type BuildParams, D, resolveParams } from './params.ts';
import {
  findSafeSpot,
  ITEM_MIN_CLEARANCE,
  type Raster,
  type RasterIsland,
  RESTART_MIN_CLEARANCE,
  ringPoints,
  type SafeSpot,
} from './placement.ts';
import { attributeElements } from './provenance.ts';
import { buildRails, cutRailGaps } from './rails.ts';
import { semanticFill } from './semantic.ts';
import { sha256HexSync } from './sha256.ts';
import { sliceElements } from './slice-elements.ts';
import { analyzeWalkable, cellAt, flood, onMain, splitAtNecks } from './walkable.ts';

/** Semver of this package; part of every stageId. */
export const BUILDER_VERSION = '0.4.0';
/** Validation rerolls: seed+1 … seed+MAX_REROLLS. */
export const MAX_REROLLS = 4;

export interface BuildOptions {
  /** Override tunables (the debugger's sliders). */
  params?: Partial<BuildParams>;
}

/** `DebugLayers` plus extra raster/vector layers for the stage debugger. Assignable to `DebugLayers`. */
export interface DebugLayersEx extends DebugLayers {
  cols: number;
  rows: number;
  /** Semantic (DOM) fill, per cell. */
  semanticMask: Uint8Array;
  /** Land after morphology + splitting, before the size filter. */
  landMask: Uint8Array;
  /** 1 = dropped as too small/thin, 2 = dropped as unreachable. */
  lostMask: Uint8Array;
  /** Average color per cell (RGB). */
  cellRgb: Uint8Array;
  dominantColor: string;
  /** Per final island: safe spot (distance-transform max) and the heuristic target level. */
  safeSpots: Vec2[];
  targetLevels: number[];
  /** Carved links (tree + loops) as candidate indices, for drawing the maze over the candidates. */
  treeEdges: { a: Vec2; b: Vec2 }[];
  attempt: number;
  effectiveSeed: number;
  validationErrors: string[];
  /** 03b reachability audit: islands whose links can't all be reached by rolling (empty = none). */
  reachIssues: string[];
}

export interface BuildResultEx extends BuildResult {
  debug: DebugLayersEx;
}

export class BuildError extends Error {
  readonly code = 'BUILD_FAILED' as const;
  readonly reasons: string[];
  constructor(message: string, reasons: string[]) {
    super(message);
    this.name = 'BuildError';
    this.reasons = reasons;
  }
}

const now = (): number => globalThis.performance?.now() ?? Date.now();
const round2 = (v: number) => Math.round(v * 100) / 100;

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Build the stage for one slice. Rerolls (seed+1 …) while `validateStage` fails or the reachability audit
 * finds an island the ball can't cross; returns the first clean attempt, else the first valid one. Throws
 * `BuildError` if no attempt is valid.
 */
export function buildStage(input: BuildInput, options: BuildOptions = {}): BuildResultEx {
  const params = resolveParams(options.params, input.difficulty);
  const reasons: string[] = [];
  let firstValid: BuildResultEx | null = null;
  for (let attempt = 0; attempt <= MAX_REROLLS; attempt++) {
    const result = buildOnce(input, params, attempt);
    const v = validateStage(result.stage);
    if (v.ok && result.debug.reachIssues.length === 0) return result;
    if (v.ok) {
      firstValid ??= result;
      reasons.push(`attempt ${attempt}: ${result.debug.reachIssues.slice(0, 3).join('; ')}`);
      continue;
    }
    const msgs = v.errors.map((e) => `${e.code}: ${e.message}`);
    result.debug.validationErrors = msgs;
    reasons.push(`attempt ${attempt} (seed ${(input.seed + attempt) >>> 0}): ${msgs.slice(0, 5).join('; ')}`);
  }
  if (firstValid) return firstValid;
  throw new BuildError(`BUILD_FAILED: no valid stage after ${MAX_REROLLS + 1} attempts`, reasons);
}

/** Same as `buildStage` but never throws: returns the last attempt with its validation errors in `debug`. */
export function buildStageUnchecked(input: BuildInput, options: BuildOptions = {}): BuildResultEx {
  const params = resolveParams(options.params, input.difficulty);
  let last: BuildResultEx | null = null;
  let firstValid: BuildResultEx | null = null;
  for (let attempt = 0; attempt <= MAX_REROLLS; attempt++) {
    last = buildOnce(input, params, attempt);
    const v = validateStage(last.stage);
    last.debug.validationErrors = v.errors.map((e) => `${e.code}: ${e.message}`);
    if (v.ok && last.debug.reachIssues.length === 0) return last;
    if (v.ok) firstValid ??= last;
  }
  return firstValid ?? (last as BuildResultEx);
}

function roleBumpFor(kinds: Set<string>): number {
  if (kinds.has('footer')) return -2;
  if (kinds.has('header') || kinds.has('nav')) return 2;
  if (kinds.has('image') || kinds.has('video')) return 1;
  return 0;
}

function buildOnce(input: BuildInput, params: BuildParams, attempt: number): BuildResultEx {
  const t = { start: now() } as Record<string, number>;
  const timings: Record<string, number> = {};
  let last = now();
  const lap = (name: string) => {
    const n = now();
    timings[name] = round2(n - last);
    last = n;
  };

  const { capture, image, sliceIndex, difficulty } = input;
  const effectiveSeed = (input.seed + attempt) >>> 0;
  const rng: Rng = createRng(effectiveSeed);
  const slice = sliceRange(capture, sliceIndex);
  const W = capture.page.width;
  const H = slice.height;
  const scale = capture.screenshot.scale > 0 ? capture.screenshot.scale : image.width / W;
  const cell = params.cellPx;
  const notes: string[] = [];

  // 1. grid
  const { elements, dropped: sliceDropped } = sliceElements(capture, slice, W);
  const grid = createGrid(image, scale, W, H, slice.y, cell);
  const { cols, rows } = grid;
  const N = cols * rows;
  lap('grid');

  // 2. background
  const viewportArea = capture.viewport.width * capture.viewport.height;
  const bg = classifyBackground(grid, elements, capture.backgroundColor, viewportArea, params);
  lap('background');

  // 3. semantic
  const sem = semanticFill(grid, elements, bg.backgroundMask, params);
  lap('semantic');

  // 4. morphology
  const pixelFg = new Uint8Array(N);
  for (let i = 0; i < N; i++) pixelFg[i] = bg.backgroundMask[i] ? 0 : 1;
  let land = or(open(pixelFg, cols, rows, params.pixelOpenCells), sem.mask);
  land = close(land, cols, rows, params.closeCellsX, params.closeCellsY);
  land = fillHoles(land, cols, rows, Math.floor(params.holeFillMaxPx2 / (cell * cell)));
  land = open(land, cols, rows, params.neckOpenCells);
  lap('morphology');

  // 5. islands
  const splits = splitOversized(land, cols, rows, cell, params);
  if (splits > 0) notes.push(`split ${splits} oversized component(s) into tiles along natural gaps`);
  const thickened = thickenThin(
    land,
    cols,
    rows,
    cell,
    params.minIslandThicknessPx + 1,
    params.thickenMaxCells,
  );
  if (thickened > 0) notes.push(`thickened ${thickened} thin component(s) to the minimum island size`);
  if (params.inletFillCells > 0) {
    const filled = fillInlets(land, cols, rows, params.inletFillCells);
    if (filled > 0) notes.push(`filled ${filled} cell(s) of narrow gaps inside islands`);
  }
  if (params.splitNecks) {
    const necks = splitAtNecks(land, cols, rows, cell, {
      clearancePx: params.neckClearancePx,
      minThicknessPx: params.minIslandThicknessPx,
      minAreaPx2: params.minIslandAreaPx2,
    });
    if (necks > 0) notes.push(`cut ${necks} component(s) at necks narrower than the ball`);
  }
  const landMask = land.slice();
  const extracted = extractIslands(land, cols, rows, cell, params);
  const kept = new Uint8Array(N);
  for (let i = 0; i < N; i++) kept[i] = (extracted.labels[i] as number) > 0 ? 1 : 0;
  let fallback = false;
  if (extracted.count === 0) {
    // Blank slice: a single plain island in the middle so the run can continue (N).
    fallback = true;
    const w = Math.min(cols - 2, Math.round((24 * D) / cell));
    const h = Math.min(rows - 2, Math.round((12 * D) / cell));
    const c0 = Math.floor((cols - w) / 2);
    const r0 = Math.floor((rows - h) / 2);
    for (let r = r0; r < r0 + h; r++) kept.fill(1, r * cols + c0, r * cols + c0 + w);
    notes.push('no content islands found; generated a single fallback island');
  }
  removeDiagonalPinches(kept, cols, rows);
  const { labels, count } = labelComponents(kept, cols, rows);
  const dist = distanceTransform(kept, cols, rows);
  const infos = componentInfo(labels, count, cols);
  lap('islands');

  // 6. contours
  const shapes: IslandShape[] = [];
  const rawShapes: { contour: Vec2[]; holes: Vec2[][] }[] = [];
  for (const info of infos) {
    const o = outlineIsland(
      labels,
      cols,
      rows,
      info.label,
      info,
      cell,
      W,
      H,
      params.simplifyEpsPx,
      params.cornerBevelPx,
    );
    const contour = o?.contour ?? [];
    shapes.push({
      contour,
      holes: o?.holes ?? [],
      bbox: {
        x0: info.c0 * cell,
        y0: info.r0 * cell,
        x1: Math.min(W, info.c1 * cell),
        y1: Math.min(H, info.r1 * cell),
      },
    });
    rawShapes.push({ contour: o?.rawContour ?? [], holes: o?.rawHoles ?? [] });
  }
  // smoothing must never make two islands touch: fall back to the exact outline for any overlapping pair
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i] as IslandShape;
      const b = shapes[j] as IslandShape;
      if (
        a.bbox.x1 + 2 < b.bbox.x0 ||
        b.bbox.x1 + 2 < a.bbox.x0 ||
        a.bbox.y1 + 2 < b.bbox.y0 ||
        b.bbox.y1 + 2 < a.bbox.y0
      )
        continue;
      if (a.contour.length >= 3 && b.contour.length >= 3 && ringsOverlap(a.contour, b.contour)) {
        for (const k of [i, j]) {
          const s = shapes[k] as IslandShape;
          const raw = rawShapes[k] as { contour: Vec2[]; holes: Vec2[][] };
          s.contour = raw.contour;
          s.holes = raw.holes;
        }
      }
    }
  }
  // 03b: the ball-walkable parts of each island (on the final polygons); mouths, start, goal, items and
  // restart points only use the main (largest) one
  const walk = analyzeWalkable(shapes, W, H, params.walkCellPx, params.walkClearancePx);
  const onMainOf = (island: number, p: Vec2, slack = 0) => onMain(walk, island + 1, p, slack);
  const multiPart = walk.parts.filter((n) => n > 1).length;
  if (multiPart > 0)
    notes.push(`${multiPart} island(s) have parts the ball can't roll to; nothing is placed there`);
  const wCols = walk.cols;
  const wRows = walk.rows;
  const wCell = walk.cell;
  /** Walkable-raster cells whose centres lie strictly inside the box. */
  const boxCells = (x0: number, y0: number, x1: number, y1: number): number[] => {
    const out: number[] = [];
    const c0 = Math.max(0, Math.floor(x0 / wCell));
    const c1 = Math.min(wCols - 1, Math.floor(x1 / wCell));
    const r0 = Math.max(0, Math.floor(y0 / wCell));
    const r1 = Math.min(wRows - 1, Math.floor(y1 / wCell));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * wCell;
        const y = (r + 0.5) * wCell;
        if (x > x0 && x < x1 && y > y0 && y < y1) out.push(r * wCols + c);
      }
    return out;
  };
  lap('contours');

  // 8a. candidate bridges (each mouth must open onto its island's main walkable part: BI-1)
  const laneHalf = (w: number) => Math.max(0, w / 2 - BALL_RADIUS_PX);
  /**
   * First main-walkable cell behind a mouth, reached by rolling straight in along the deck axis (−1 if none).
   * Each lane (a line parallel to the axis within the deck) is followed into the island while it stays on land
   * that is at least a ball wide across the axis (the ball crosses a thin strip, e.g. a text line's meta line,
   * sideways-on, but can't squeeze along one); the first main cell on any lane wins, lanes nearest the centre
   * first.
   */
  const mouthCell = (island: number, from: Vec2, ux: number, uy: number, w: number): number => {
    const half = laneHalf(w);
    const label = island + 1;
    const landAt = (p: Vec2) => {
      const k = cellAt(walk, p);
      return k >= 0 && walk.labels[k] === label;
    };
    const wideEnough = (p: Vec2) => {
      // land across the axis over a ball width (+1 px) centred anywhere within ±r of p
      let run = 0;
      for (let q = -2 * BALL_RADIUS_PX - 1; q <= 2 * BALL_RADIUS_PX + 1 + 1e-9; q += 1.5) {
        if (landAt([p[0] - uy * q, p[1] + ux * q])) {
          run += 1.5;
          if (run >= 2 * BALL_RADIUS_PX + 1) return true;
        } else run = 0;
      }
      return false;
    };
    const lanes: number[] = [0];
    for (let t = cell; t <= half + 1e-9; t += cell) lanes.push(-t, t);
    let best = -1;
    let bestS = Number.POSITIVE_INFINITY;
    for (const t of lanes) {
      for (let s = cell; s <= params.mouthDepthPx + 1e-9 && s < bestS; s += cell) {
        const p: Vec2 = [from[0] + ux * s - uy * t, from[1] + uy * s + ux * t];
        if (onMainOf(island, p)) {
          best = cellAt(walk, p);
          bestS = s;
          break;
        }
        if (!landAt(p) || !wideEnough(p)) break;
      }
    }
    return best;
  };
  const unit = (a: Vec2, b: Vec2): [number, number, number] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return len > 0 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len, len] : [1, 0, 0];
  };
  const mouthOk = (c: Candidate): boolean => {
    const [ux, uy] = unit(c.a, c.b);
    const ok = mouthCell(c.from, c.a, -ux, -uy, c.width) >= 0 && mouthCell(c.to, c.b, ux, uy, c.width) >= 0;
    return ok;
  };
  const candidates = findCandidates(
    labels,
    shapes,
    { cols, rows, cell, width: W, height: H },
    params,
    mouthOk,
  );
  /** Ground behind a link's mouth on `island` (first main cell), cached. */
  const mouthCache = new Map<string, number>();
  const mouthAnchor = (e: number, island: number): number => {
    const key = `${e}:${island}`;
    let k = mouthCache.get(key);
    if (k === undefined) {
      const c = candidates[e] as Candidate;
      const [ux, uy] = unit(c.a, c.b);
      k =
        island === c.from ? mouthCell(c.from, c.a, -ux, -uy, c.width) : mouthCell(c.to, c.b, ux, uy, c.width);
      mouthCache.set(key, k);
    }
    return k;
  };
  // Deck side rails run the full a→b length (@wwm/physics), so each deck leaves two short rail stubs (≤
  // bridgeCornerMaxDepthPx) on each island it touches: p0 at the deck end, p1 where the rail leaves the island.
  interface Stub {
    island: number;
    p0: Vec2;
    p1: Vec2;
    /** Unit direction from p0 back into the island. */
    back: Vec2;
  }
  const stubCache = new Map<number, Stub[]>();
  const stubsOf = (e: number): Stub[] => {
    let out = stubCache.get(e);
    if (out) return out;
    out = [];
    const c = candidates[e] as Candidate;
    const [ux, uy] = unit(c.a, c.b);
    const off = c.width / 2 + 0.7;
    for (const [end, dir, island] of [
      [c.a, 1, c.from],
      [c.b, -1, c.to],
    ] as const) {
      const ring = (shapes[island] as IslandShape).contour;
      for (const side of [-1, 1]) {
        const p0: Vec2 = [end[0] - uy * side * off, end[1] + ux * side * off];
        let depth = -1;
        for (let t = 0; t <= 30; t += 0.5) {
          if (!pointInRing([p0[0] + dir * ux * t, p0[1] + dir * uy * t], ring)) break;
          depth = t;
        }
        if (depth < 0) continue;
        out.push({
          island,
          p0,
          p1: [p0[0] + dir * ux * depth, p0[1] + dir * uy * depth],
          back: [-dir * ux, -dir * uy],
        });
      }
    }
    stubCache.set(e, out);
    return out;
  };
  const stubCells = (st: Stub): number[] => {
    const g = BALL_RADIUS_PX;
    return boxCells(
      Math.min(st.p0[0], st.p1[0]) - g,
      Math.min(st.p0[1], st.p1[1]) - g,
      Math.max(st.p0[0], st.p1[0]) + g,
      Math.max(st.p0[1], st.p1[1]) + g,
    ).filter((k) => walk.labels[k] === st.island + 1);
  };
  const segPoint = (p: Vec2, a: Vec2, b: Vec2): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };
  const stubGap = (s1: Stub, s2: Stub): number =>
    Math.min(
      segPoint(s1.p0, s2.p0, s2.p1),
      segPoint(s1.p1, s2.p0, s2.p1),
      segPoint(s2.p0, s1.p0, s1.p1),
      segPoint(s2.p1, s1.p0, s1.p1),
    );
  /** Land behind a stub (from p0 into the island) before the far edge, px (capped). */
  const roomBehind = (st: Stub): number => {
    const ring = (shapes[st.island] as IslandShape).contour;
    let d = 0;
    for (let t = 0.5; t <= 3 * D; t += 0.5) {
      if (!pointInRing([st.p0[0] + st.back[0] * t, st.p0[1] + st.back[1] * t], ring)) break;
      d = t;
    }
    return d;
  };
  const connectedAround = (island: number, anchors: number[], walls: Set<number>): boolean => {
    if (anchors.some((k) => k < 0 || walls.has(k))) return false;
    const label = island + 1;
    const seen = flood(wCols, wRows, [anchors[0] as number], (k) => {
      return walk.labels[k] === label && walk.main[k] === 1 && !walls.has(k);
    });
    return anchors.every((k) => seen[k] === 1);
  };
  const pinchRoom = 2 * BALL_RADIUS_PX + 1;
  /**
   * Maze carving hook: would carving `e` (with the rail stubs of the links already carved) pinch one of its
   * islands shut? A cheap test flags stubs with too little land behind them or too close to another stub;
   * only then is the island flood-filled with the stubs as walls and its anchors checked.
   */
  const pinchFree = (e: number, carved: readonly number[]): boolean => {
    const c = candidates[e] as Candidate;
    for (const island of [c.from, c.to]) {
      const mine = stubsOf(e).filter((st) => st.island === island);
      if (mine.length === 0) continue;
      const others = carved.filter((l) => {
        const d = candidates[l] as Candidate;
        return d.from === island || d.to === island;
      });
      const otherStubs = others.flatMap((l) => stubsOf(l).filter((st) => st.island === island));
      const risky = mine.some(
        (st) => roomBehind(st) < pinchRoom || otherStubs.some((o) => stubGap(st, o) < pinchRoom),
      );
      if (!risky) continue;
      const walls = new Set<number>();
      for (const st of [...mine, ...otherStubs]) for (const k of stubCells(st)) walls.add(k);
      const anchors = [
        cellAt(walk, (spots[island] as SafeSpot).pos),
        ...[e, ...others].map((l) => mouthAnchor(l, island)),
      ];
      if (!connectedAround(island, anchors, walls)) return false;
    }
    return true;
  };
  lap('bridges');

  // 10a. safe spots (needed to choose the start)
  const raster: Raster = { labels, dist, cols, rows, cell };
  const rIslands: RasterIsland[] = infos.map((f) => ({
    label: f.label,
    c0: f.c0,
    r0: f.r0,
    c1: f.c1,
    r1: f.r1,
    areaCells: f.area,
  }));
  const spots: SafeSpot[] = rIslands.map((ri, i) =>
    findSafeSpot(raster, ri, shapes[i] as IslandShape, (k) =>
      onMainOf(i, [((k % cols) + 0.5) * cell, (Math.floor(k / cols) + 0.5) * cell]),
    ),
  );

  // 9. maze: main component (largest total area) → start at its top-left safe spot → randomized DFS
  const comp = candidateComponents(count, candidates);
  const compArea = new Map<number, number>();
  infos.forEach((f, i) => {
    compArea.set(comp[i] as number, (compArea.get(comp[i] as number) ?? 0) + f.area);
  });
  let mainComp = -1;
  let bestArea = -1;
  for (const [cid, a] of [...compArea.entries()].sort((x, y) => x[0] - y[0]))
    if (a > bestArea) {
      bestArea = a;
      mainComp = cid;
    }
  let root = -1;
  for (let i = 0; i < count; i++) {
    if (comp[i] !== mainComp || (spots[i] as SafeSpot).clearance < RESTART_MIN_CLEARANCE) continue;
    const s = (spots[i] as SafeSpot).pos;
    const r = root < 0 ? null : (spots[root] as SafeSpot).pos;
    if (!r || s[0] + s[1] < r[0] + r[1]) root = i;
  }
  if (root < 0) root = 0;
  const maze = carveMaze(count, candidates, root, rng.fork('maze'), params.loopShare[difficulty], pinchFree);
  lap('maze');

  // prune islands the maze didn't reach
  const newId = new Array<number>(count).fill(-1);
  let nextId = 0;
  for (let i = 0; i < count; i++) if (maze.reached[i]) newId[i] = nextId++;
  const lostMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const l = labels[i] as number;
    if (extracted.droppedMask[i]) lostMask[i] = 1;
    else if (l > 0 && newId[l - 1] === -1) lostMask[i] = 2;
  }
  const unreached = count - nextId;
  if (unreached > 0) notes.push(`${unreached} island(s) dropped: no cardinal bridge could reach them`);

  // goal: bottom-right safe spot (E)
  let goal = -1;
  for (let i = 0; i < count; i++) {
    if (!maze.reached[i] || i === root) continue;
    const s = (spots[i] as SafeSpot).pos;
    const g = goal < 0 ? null : (spots[goal] as SafeSpot).pos;
    if (!g || s[0] + s[1] > g[0] + g[1]) goal = i;
  }

  // 7a. elevator feasibility (BI-2). A platform is max(|b−a|, 18.75 px) long and ends at b (upper side); the
  // ball boards and leaves through its ends only (side rails), so both islands need main-walkable ground 1 D
  // beyond them. The lower platform also lies on its island, and rolling over it starts the lift, so for the
  // ball it is a wall: it must not cut any island in two. Every island keeps its anchors (the ground behind
  // each of its links' mouths, its safe spot = start/goal/large item) connected in main − footprints.
  const links0 = [...maze.tree, ...maze.loops];
  const anchor = new Map<string, number>(); // `${link}:${island}` → cell
  for (const e of links0) {
    const c = candidates[e] as Candidate;
    anchor.set(`${e}:${c.from}`, mouthAnchor(e, c.from));
    anchor.set(`${e}:${c.to}`, mouthAnchor(e, c.to));
  }
  const linksOf: number[][] = Array.from({ length: count }, () => []);
  for (const e of links0) {
    const c = candidates[e] as Candidate;
    linksOf[c.from]?.push(e);
    linksOf[c.to]?.push(e);
  }
  const blocked = new Uint8Array(wCols * wRows);
  const connected = (island: number, anchors: number[], extra: Set<number>): boolean => {
    if (anchors.some((k) => k < 0 || blocked[k] || extra.has(k))) return false;
    const label = island + 1;
    const seen = flood(wCols, wRows, [anchors[0] as number], (k) => {
      return walk.labels[k] === label && walk.main[k] === 1 && !blocked[k] && !extra.has(k);
    });
    return anchors.every((k) => seen[k] === 1);
  };
  const elevatorFits = (e: number, low: number): boolean => {
    const c = candidates[e] as Candidate;
    const a = low === c.from ? c.a : c.b;
    const b = low === c.from ? c.b : c.a;
    const high = low === c.from ? c.to : c.from;
    const [ux, uy, len] = unit(a, b);
    const plat = Math.max(len, ELEVATOR_MIN_PLATFORM_PX);
    const end: Vec2 = [b[0] - ux * plat, b[1] - uy * plat];
    const land = params.elevatorLandingD * D;
    const half = laneHalf(c.width) / 2;
    const landing = (island: number, from: Vec2, dx: number, dy: number): number => {
      for (const t of [0, -half, half]) {
        const p: Vec2 = [from[0] + dx * land - dy * t, from[1] + dy * land + dx * t];
        if (onMainOf(island, p)) return cellAt(walk, p);
      }
      return -1;
    };
    const lowLand = landing(low, end, -ux, -uy);
    const highLand = landing(high, b, ux, uy);
    if (lowLand < 0 || highLand < 0) return false;
    // footprint (cardinal → axis-aligned), grown by the ball radius + 1 px: where the ball centre would
    // touch it (and start the lift)
    const grow = BALL_RADIUS_PX + 1;
    const hw = c.width / 2 + grow;
    const xs = [end[0], b[0]];
    const ys = [end[1], b[1]];
    const box =
      Math.abs(ux) > Math.abs(uy)
        ? boxCells(Math.min(...xs) - grow, end[1] - hw, Math.max(...xs) + grow, end[1] + hw)
        : boxCells(end[0] - hw, Math.min(...ys) - grow, end[0] + hw, Math.max(...ys) + grow);
    const extra = new Set(box);
    for (const [island, own] of [
      [low, lowLand],
      [high, highLand],
    ] as const) {
      const anchors = [(spots[island] as SafeSpot).pos, own].map((p) =>
        typeof p === 'number' ? p : cellAt(walk, p),
      );
      // the other links' deck rail stubs are walls too (a link that later becomes a lift only has its
      // footprint, so this is conservative)
      const walls = new Set(extra);
      for (const l of linksOf[island] as number[]) {
        if (l === e) continue;
        anchors.push(anchor.get(`${l}:${island}`) ?? -1);
        for (const st of stubsOf(l)) if (st.island === island) for (const k of stubCells(st)) walls.add(k);
      }
      if (!connected(island, anchors, walls)) return false;
    }
    for (const k of box) blocked[k] = 1;
    anchor.set(`${e}:${low}`, lowLand);
    anchor.set(`${e}:${high}`, highLand);
    return true;
  };

  /** How far each island reaches past its deck end, anywhere across the deck width (px, max of both ends). */
  const rampFits = (e: number): boolean => {
    const c = candidates[e] as Candidate;
    const [ux, uy, len] = unit(c.a, c.b);
    for (const [end, dir, island] of [
      [c.a, 1, c.from],
      [c.b, -1, c.to],
    ] as const) {
      const ring = (shapes[island] as IslandShape).contour;
      for (let t = -c.width / 2; t <= c.width / 2 + 1e-9; t += 1.5) {
        const p0: Vec2 = [end[0] - uy * t, end[1] + ux * t];
        for (let d = params.rampMouthMaxDepthPx + 0.5; d <= Math.min(len, 24); d += 0.5) {
          if (!pointInRing([p0[0] + dir * ux * d, p0[1] + dir * uy * d], ring)) break;
          if (d > params.rampMouthMaxDepthPx) return false;
        }
      }
    }
    return true;
  };

  // 7. levels
  const attributionAll = attributeElements(
    grid,
    elements,
    labels,
    [-1, ...infos.map((_, i) => i)],
    count,
    lostMask,
  );
  const kindById = new Map(elements.map((e) => [e.id, e.kind]));
  const roleBump = attributionAll.sources.map((ids) =>
    roleBumpFor(new Set(ids.map((id) => kindById.get(id) ?? ''))),
  );
  const lv = assignLevels(
    {
      n: count,
      root,
      candidates,
      tree: maze.tree,
      loops: maze.loops,
      parentEdge: maze.parentEdge,
      anchor: spots.map((s) => s.pos),
      roleBump,
      stageHeight: H,
      elevatorFits,
      rampFits,
    },
    rng.fork('levels'),
    params,
  );
  lap('levels');

  // 8b. links
  const links = [...maze.tree, ...maze.loops.filter((e) => !lv.droppedLoops.includes(e))];
  const bridges: Bridge[] = [];
  const elevators: Elevator[] = [];
  const mouths: { x0: number; y0: number; x1: number; y1: number }[][] = Array.from(
    { length: count },
    () => [],
  );
  for (const e of links) {
    const c = candidates[e] as Candidate;
    const la = lv.levels[c.from] as number;
    const lb = lv.levels[c.to] as number;
    const box = deckBox(c, 1);
    mouths[c.from]?.push(box);
    mouths[c.to]?.push(box);
    if (lv.kinds.get(e) === 'elevator') {
      const lowIsFrom = la < lb;
      const dh = Math.abs(lb - la) * LEVEL_HEIGHT_M;
      elevators.push({
        id: elevators.length,
        islandFrom: newId[lowIsFrom ? c.from : c.to] as number,
        islandTo: newId[lowIsFrom ? c.to : c.from] as number,
        a: lowIsFrom ? c.a : c.b,
        b: lowIsFrom ? c.b : c.a,
        width: c.width,
        levelLow: Math.min(la, lb),
        levelHigh: Math.max(la, lb),
        travelSec: round2(ELEVATOR_TRAVEL_BASE_SEC + ELEVATOR_TRAVEL_SEC_PER_M * dh),
        cooldownSec: ELEVATOR_COOLDOWN_SEC,
      });
    } else {
      bridges.push({
        id: bridges.length,
        from: newId[c.from] as number,
        to: newId[c.to] as number,
        a: c.a,
        b: c.b,
        width: c.width,
        type: la === lb ? 'flat' : 'ramp',
        levelA: la,
        levelB: lb,
      });
    }
  }

  // 03b reachability audit. Deck side rails run the full a→b length, so every deck leaves two short rail stubs
  // (≤ bridgeCornerMaxDepthPx) on each island it touches; on a thin strip, stubs from opposite sides can pinch
  // it shut. With the stubs and the lower elevator platforms as walls, each island's anchors (its safe spot and
  // the ground behind each of its links) must stay connected; otherwise `buildStage` tries the next seed.
  const walls = blocked.slice();
  for (const e of links) {
    if (lv.kinds.get(e) === 'elevator') continue;
    for (const st of stubsOf(e)) for (const k of stubCells(st)) walls[k] = 1;
  }
  const reach = flood(
    wCols,
    wRows,
    spots.map((sp) => cellAt(walk, sp.pos)),
    (k) => walk.main[k] === 1 && !walls[k],
  );
  const reachIssues: string[] = [];
  for (let i = 0; i < count; i++) {
    if (!maze.reached[i]) continue;
    for (const e of links) {
      const c = candidates[e] as Candidate;
      if (c.from !== i && c.to !== i) continue;
      const k = anchor.get(`${e}:${i}`) ?? -1;
      if (k < 0 || reach[k] !== 1) {
        reachIssues.push(`island ${newId[i]}: the ground behind link ${e} can't be reached from its centre`);
        break;
      }
    }
  }
  if (reachIssues.length > 0) notes.push(`reachability: ${reachIssues.join('; ')}`);
  const reachInfo = { ...walk, main: reach };
  const placeOk = (island: number, p: Vec2, slackPx: number) => onMain(reachInfo, island + 1, p, slackPx);

  // 10b. placement
  const startSpot = spots[root] as SafeSpot;
  let goalIsland = goal;
  let goalPos: Vec2;
  if (goal < 0) {
    // single-island stage: goal at the bottom-right-most roomy point of the start island
    goalIsland = root;
    const pts = ringPoints(
      raster,
      rIslands[root] as RasterIsland,
      shapes[root] as IslandShape,
      {
        ringsPx: [2 * D, 1.5 * D, D],
        spacingPx: D,
        jitterPx: 0,
        minClearance: RESTART_MIN_CLEARANCE,
        keepOutPx: 3 * D,
        avoid: [startSpot.pos],
        accept: (p) => placeOk(root, p, 3),
      },
      rng.fork('goal'),
    );
    goalPos = pts.reduce((b, p) => (p[0] + p[1] > b[0] + b[1] ? p : b), startSpot.pos);
  } else goalPos = (spots[goal] as SafeSpot).pos;

  const reachedIdx = infos.map((_, i) => i).filter((i) => maze.reached[i]);
  const degree = new Array<number>(count).fill(0);
  for (const e of links) {
    const c = candidates[e] as Candidate;
    degree[c.from]++;
    degree[c.to]++;
  }
  const totalAreaPx2 = reachedIdx.reduce((s, i) => s + (infos[i]?.area ?? 0) * cell * cell, 0);
  const largeWanted = Math.min(
    params.maxLargeItems,
    Math.max(reachedIdx.length > 2 ? 1 : 0, Math.round(totalAreaPx2 * params.largePerPx2)),
  );
  const largeIslands = reachedIdx
    .filter(
      (i) => i !== root && i !== goalIsland && (spots[i] as SafeSpot).clearance >= ITEM_MIN_CLEARANCE + D / 2,
    )
    .sort((p, q) => {
      const sp = (spots[p] as SafeSpot).clearance * (degree[p] === 1 ? 1.5 : 1);
      const sq = (spots[q] as SafeSpot).clearance * (degree[q] === 1 ? 1.5 : 1);
      return sq - sp || p - q;
    })
    .slice(0, largeWanted);
  const items: Item[] = [];
  const avoid: Vec2[] = [startSpot.pos, goalPos];
  for (const i of [...largeIslands].sort((p, q) => p - q)) {
    const pos = (spots[i] as SafeSpot).pos;
    avoid.push(pos);
    items.push({ id: 0, kind: 'large', pos, islandId: newId[i] as number });
  }
  const itemRng = rng.fork('items');
  const restartRng = rng.fork('restart');
  const railGapRng = rng.fork('rail-gaps');
  const railsByIsland: Vec2[][][] = [];
  const restartByIsland: Vec2[][] = [];
  for (const i of reachedIdx) {
    const shape = shapes[i] as IslandShape;
    const ri = rIslands[i] as RasterIsland;
    const pickIsland = itemRng.next() < params.itemIslandShare;
    if (pickIsland) {
      const pts = ringPoints(
        raster,
        ri,
        shape,
        {
          ringsPx: params.itemRingsPx,
          spacingPx: params.itemSpacingPx,
          jitterPx: params.itemJitterPx,
          minClearance: ITEM_MIN_CLEARANCE,
          keepOutPx: params.itemKeepOutPx,
          avoid,
          // within pickup reach of the main part (pickup radius 0.926 D ≈ 12.5 px)
          accept: (p) => placeOk(i, p, 9),
        },
        itemRng.fork(`island:${i}`),
      );
      for (const pos of pts) items.push({ id: 0, kind: 'small', pos, islandId: newId[i] as number });
    }
    let restarts = ringPoints(
      raster,
      ri,
      shape,
      {
        ringsPx: params.restartRingsPx,
        spacingPx: params.restartSpacingPx,
        jitterPx: 0,
        minClearance: RESTART_MIN_CLEARANCE,
        keepOutPx: 0,
        avoid: [],
        accept: (p) => placeOk(i, p, 3),
      },
      restartRng.fork(`island:${i}`),
    );
    if (restarts.length === 0 && (spots[i] as SafeSpot).clearance >= RESTART_MIN_CLEARANCE)
      restarts = [(spots[i] as SafeSpot).pos];
    restartByIsland[i] = restarts;
    const rails = buildRails(shape.contour, shape.holes, mouths[i] ?? []);
    const gapRng = railGapRng.fork(`island:${i}`);
    railsByIsland[i] =
      params.railGapPx > 0
        ? cutRailGaps(rails, {
            gapPx: params.railGapPx,
            everyPx: params.railGapEveryPx,
            keepEndsPx: 2 * D,
            avoid: [startSpot.pos, goalPos],
            avoidPx: 4 * D,
            next: () => gapRng.next(),
          })
        : rails;
  }
  items.sort((p, q) => p.islandId - q.islandId || (p.kind === q.kind ? 0 : p.kind === 'large' ? -1 : 1));
  items.forEach((it, k) => {
    it.id = k;
  });
  lap('placement');

  // provenance (final ids)
  const islandOf = [-1, ...infos.map((_, i) => newId[i] as number)];
  const attribution = attributeElements(grid, elements, labels, islandOf, nextId, lostMask);
  const islands: Island[] = reachedIdx.map((i) => {
    const s = shapes[i] as IslandShape;
    return {
      id: newId[i] as number,
      contour: s.contour,
      holes: s.holes,
      level: lv.levels[i] as number,
      guardrails: railsByIsland[i] ?? [],
      restartPoints: restartByIsland[i] ?? [],
      sourceElementIds: attribution.sources[newId[i] as number] ?? [],
    };
  });
  const dropped = [...sliceDropped, ...attribution.dropped].sort((p, q) => p.elementId - q.elementId);
  notes.push(
    `builder ${BUILDER_VERSION}: grid ${cols}×${rows} @ ${cell}px, dominant background ${hex(bg.dominant)}`,
  );
  if (bg.regionElementIds.length > 0)
    notes.push(`local background regions from elements ${bg.regionElementIds.join(', ')}`);
  if (attempt > 0) notes.push(`reroll: built with seed ${effectiveSeed} (attempt ${attempt})`);
  if (fallback) notes.push('fallback island is not derived from page content');

  const stageId = sha256HexSync(
    `${capture.captureId}|${sliceIndex}|${input.seed >>> 0}|${BUILDER_VERSION}|${difficulty}`,
  );
  const stage: StageData = {
    schema: 'wwm.stage/2',
    stageId,
    builderVersion: BUILDER_VERSION,
    seed: input.seed >>> 0,
    difficulty,
    source: {
      url: capture.url,
      title: capture.title,
      captureId: capture.captureId,
      pageWidth: capture.page.width,
      pageHeight: capture.page.height,
      slice,
    },
    size: { width: W, height: H },
    texture: { path: '', width: Math.round(W * scale), height: Math.round(H * scale), scale },
    timeLimitSec: TIME_LIMIT_SEC_DEFAULT,
    islands,
    bridges,
    elevators,
    items,
    start: { pos: startSpot.pos, islandId: newId[root] as number },
    goal: {
      pos: goalPos,
      islandId: newId[goalIsland] as number,
      radius: round2(GOAL_RADIUS_M * PX_PER_METER),
    },
    provenance: { keptElementIds: attribution.kept, dropped, notes },
  };

  // debug layers (final labels = island id + 1)
  const finalLabels = new Int32Array(N);
  const islandMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const l = labels[i] as number;
    if (l === 0) continue;
    const id = newId[l - 1] as number;
    if (id >= 0) {
      finalLabels[i] = id + 1;
      islandMask[i] = 1;
    }
  }
  timings.total = round2(now() - (t.start as number));
  const debug: DebugLayersEx = {
    gridCellPx: cell,
    backgroundMask: bg.backgroundMask,
    islandMask,
    labels: finalLabels,
    candidateBridges: candidates.map((c) => ({
      a: c.a,
      b: c.b,
      from: newId[c.from] as number,
      to: newId[c.to] as number,
    })),
    timingsMs: timings,
    cols,
    rows,
    semanticMask: sem.mask,
    landMask,
    lostMask,
    cellRgb: grid.cellRgb,
    dominantColor: hex(bg.dominant),
    safeSpots: reachedIdx.map((i) => (spots[i] as SafeSpot).pos),
    targetLevels: reachedIdx.map((i) => round2(lv.targets[i] as number)),
    treeEdges: links.map((e) => ({ a: (candidates[e] as Candidate).a, b: (candidates[e] as Candidate).b })),
    attempt,
    effectiveSeed,
    validationErrors: [],
    reachIssues,
  };
  return { stage, debug };
}
