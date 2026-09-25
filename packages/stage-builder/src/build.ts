/**
 * Step 13: `buildStage` — orchestrates every step, validates the result with `validateStage`, and rerolls with
 * seed+1..seed+4 if validation fails (then throws `BuildError` with code BUILD_FAILED).
 * Pure and deterministic: no I/O, no DOM, no Math.random, no clock in the output.
 */
import {
  type Bridge,
  type BuildInput,
  type BuildResult,
  createRng,
  type DebugLayers,
  ELEVATOR_COOLDOWN_SEC,
  ELEVATOR_TRAVEL_BASE_SEC,
  ELEVATOR_TRAVEL_SEC_PER_M,
  type Elevator,
  GOAL_RADIUS_M,
  type Island,
  type Item,
  LEVEL_HEIGHT_M,
  PX_PER_METER,
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
import { componentInfo, extractIslands, labelComponents, splitOversized, thickenThin } from './islands.ts';
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
import { buildRails } from './rails.ts';
import { semanticFill } from './semantic.ts';
import { sha256HexSync } from './sha256.ts';
import { sliceElements } from './slice-elements.ts';

/** Semver of this package; part of every stageId. */
export const BUILDER_VERSION = '0.3.0';
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

/** Build the stage for one slice. Throws `BuildError` if no valid stage is found after the rerolls. */
export function buildStage(input: BuildInput, options: BuildOptions = {}): BuildResultEx {
  const params = resolveParams(options.params);
  const reasons: string[] = [];
  for (let attempt = 0; attempt <= MAX_REROLLS; attempt++) {
    const result = buildOnce(input, params, attempt);
    const v = validateStage(result.stage);
    if (v.ok) return result;
    const msgs = v.errors.map((e) => `${e.code}: ${e.message}`);
    reasons.push(`attempt ${attempt} (seed ${(input.seed + attempt) >>> 0}): ${msgs.slice(0, 5).join('; ')}`);
    if (attempt === MAX_REROLLS) {
      result.debug.validationErrors = msgs;
      throw new BuildError(`BUILD_FAILED: no valid stage after ${MAX_REROLLS + 1} attempts`, reasons);
    }
  }
  throw new BuildError('BUILD_FAILED', reasons);
}

/** Same as `buildStage` but never throws: returns the last attempt with its validation errors in `debug`. */
export function buildStageUnchecked(input: BuildInput, options: BuildOptions = {}): BuildResultEx {
  const params = resolveParams(options.params);
  let last: BuildResultEx | null = null;
  for (let attempt = 0; attempt <= MAX_REROLLS; attempt++) {
    last = buildOnce(input, params, attempt);
    const v = validateStage(last.stage);
    last.debug.validationErrors = v.errors.map((e) => `${e.code}: ${e.message}`);
    if (v.ok) return last;
  }
  return last as BuildResultEx;
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
  lap('contours');

  // 8a. candidate bridges
  const candidates = findCandidates(labels, shapes, { cols, rows, cell, width: W, height: H }, params);
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
  const spots: SafeSpot[] = rIslands.map((ri, i) => findSafeSpot(raster, ri, shapes[i] as IslandShape));

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
  const maze = carveMaze(count, candidates, root, rng.fork('maze'), params.loopShare[difficulty]);
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
      },
      restartRng.fork(`island:${i}`),
    );
    if (restarts.length === 0 && (spots[i] as SafeSpot).clearance >= RESTART_MIN_CLEARANCE)
      restarts = [(spots[i] as SafeSpot).pos];
    restartByIsland[i] = restarts;
    railsByIsland[i] = buildRails(shape.contour, shape.holes, mouths[i] ?? []);
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
  if (attempt > 0) notes.push(`validation reroll: built with seed ${effectiveSeed} (attempt ${attempt})`);
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
  };
  return { stage, debug };
}
