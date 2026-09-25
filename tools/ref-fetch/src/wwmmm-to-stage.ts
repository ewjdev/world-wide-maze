// WWMMM installation stage JSON -> our StageData (contracts.md §3), for use as a real-world test level.
// Output is written to reference/ (gitignored) and is never committed.
//
// Semantics are taken from the 2013 desktop bundle (game/object/stage, game/object/elevator); see
// docs/reference/stage-format.md. Short version:
//   - contours / guardrails / restartPoints / *_items are FLAT number arrays ([x,y,x,y..] or [x,y,h,x,y,h..]).
//   - x,y are page px on a fixed 1024 x 1358 stage; the 3rd component and `level` are HEIGHTS in the same px unit.
//   - bridge = start point + cardinal angle (deg, 0=+x, 90=+y page-down) + distance + width; type 0 = static
//     bridge/ramp, type 1 = elevator. level[0] is the start island height, level[1] the end island height.
//
// Usage: node src/wwmmm-to-stage.ts [--scale ball|raw|<number>] [in.json] [in.png] [outDir]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cropRows, decodePng, encodePng } from './png.ts';
// TEMP: replace with @wwm/schema import at merge
import {
  BALL_RADIUS_M,
  type Bridge,
  type Elevator,
  type Island,
  type Item,
  LEVEL_HEIGHT_M,
  MIN_BRIDGE_WIDTH_PX,
  PX_PER_METER,
  type StageData,
  type Vec2,
} from './stage-types.ts';

export interface WwmmmIsland {
  id: number;
  level: number;
  contours: number[][];
  guardrails: number[][];
  restartPoints: number[];
}
export interface WwmmmBridge {
  angle: number;
  distance: number;
  level: [number, number];
  start: [number, number];
  type: number;
  width: number;
}
export interface WwmmmStage {
  title: string;
  url: string;
  image?: string;
  mobile_image?: string;
  start: [number, number, number];
  goal: [number, number, number];
  islands: WwmmmIsland[];
  bridges: WwmmmBridge[];
  small_items: number[];
  large_items: number[];
}

/** 2013 constants (evidenced in common/config and game/object/*). */
export const ORIGINAL = {
  WORLD_SCALE: 0.1, // world units per page px
  STAGE_WIDTH_PX: 1024,
  STAGE_HEIGHT_PX: 1358,
  TEXTURE_PAGE_ROW0: 692, // page row 0 sits at texture row 692 of the 1024x2048 canvas
  BALL_RADIUS_PX: 5.4, // Ball.RADIUS = 5.4 * WORLD_SCALE
  SENSOR_RADIUS_PX: 10, // item / goal ghost shapes have radius 1 world unit
  ELEVATOR_MIN_LEN_PX: 15, // Math.max(distance, 15)
  ELEVATOR_COOLDOWN_S: 2,
  TIME_LIMIT_S: 300,
} as const;

export interface ConvertOptions {
  /** Page-px multiplier. 'ball' scales so the 2013 ball (r=5.4px) matches our BALL_RADIUS_M*PX_PER_METER. */
  scale: 'ball' | 'raw' | number;
  texturePath: string;
  texture: { width: number; height: number };
}

export interface ConvertResult {
  stage: StageData;
  /** Exact data that StageData cannot hold (continuous heights, raw bridge params). */
  extra: Record<string, unknown>;
  issues: string[];
  unmapped: string[];
}

const pairs = (a: number[]): Vec2[] => {
  const o: Vec2[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) o.push([a[i], a[i + 1]]);
  return o;
};
const triples = (a: number[]): [number, number, number][] => {
  const o: [number, number, number][] = [];
  for (let i = 0; i + 2 < a.length; i += 3) o.push([a[i], a[i + 1], a[i + 2]]);
  return o;
};
const r2 = (v: number): number => Math.round(v * 100) / 100;

export function signedArea(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function distToRing(p: Vec2, ring: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]));
  }
  return best;
}

export function resolveScale(scale: ConvertOptions['scale']): number {
  if (scale === 'raw') return 1;
  if (scale === 'ball') return (BALL_RADIUS_M * PX_PER_METER) / ORIGINAL.BALL_RADIUS_PX;
  return scale;
}

export function convertWwmmm(src: WwmmmStage, opts: ConvertOptions): ConvertResult {
  const k = resolveScale(opts.scale);
  const levelStepPx = LEVEL_HEIGHT_M * PX_PER_METER; // px of (scaled) height per integer level
  const S = (p: Vec2): Vec2 => [r2(p[0] * k), r2(p[1] * k)];
  const heights = src.islands.map((i) => i.level);
  const hMin = Math.min(...heights);
  const quantize = (h: number): number => Math.round(((h - hMin) * k) / levelStepPx);
  const unmapped: string[] = [];

  const islands: Island[] = src.islands.map((isl) => {
    const rings = isl.contours.map(pairs);
    return {
      id: isl.id,
      contour: rings[0].map(S),
      holes: rings.slice(1).map((r) => r.map(S)),
      level: quantize(isl.level),
      guardrails: isl.guardrails.map((g) => pairs(g).map(S)),
      restartPoints: pairs(isl.restartPoints).map(S),
      sourceElementIds: [],
    };
  });
  const rawOuter = new Map(src.islands.map((i) => [i.id, pairs(i.contours[0])]));

  /** Island containing p (raw px), else the nearest one. */
  const islandAt = (p: Vec2, exclude?: number): number => {
    let best = -1,
      bestD = Infinity;
    for (const [id, ring] of rawOuter) {
      if (id === exclude) continue;
      const d = pointInPolygon(p, ring) ? -1 : distToRing(p, ring);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  };

  const bridges: Bridge[] = [];
  const elevators: Elevator[] = [];
  src.bridges.forEach((b, idx) => {
    const rad = (b.angle * Math.PI) / 180;
    const dir: Vec2 = [Math.cos(rad), Math.sin(rad)];
    const a: Vec2 = [b.start[0], b.start[1]];
    const e: Vec2 = [a[0] + dir[0] * b.distance, a[1] + dir[1] * b.distance];
    const from = islandAt(a);
    const to = islandAt(e, from);
    const levelA = quantize(b.level[0]),
      levelB = quantize(b.level[1]);
    if (b.type === 0) {
      bridges.push({
        id: bridges.length,
        from,
        to,
        a: S(a),
        b: S(e),
        width: r2(b.width * k),
        type: levelA === levelB ? 'flat' : 'ramp',
        levelA,
        levelB,
      });
    } else if (b.type === 1) {
      // Platform extent along the bridge axis, as in game/object/elevator.
      const len = Math.max(b.distance, ORIGINAL.ELEVATOR_MIN_LEN_PX);
      const [v, u] = b.level[1] > b.level[0] ? [b.distance - len, b.distance] : [0, len];
      const mid = (v + u) / 2;
      const travelS = (1000 + Math.abs(b.level[1] - b.level[0]) * ORIGINAL.WORLD_SCALE * 150) / 1000;
      elevators.push({
        id: elevators.length,
        islandFrom: from,
        islandTo: to,
        pos: S([a[0] + dir[0] * mid, a[1] + dir[1] * mid]),
        size: r2(Math.max(len, b.width) * k),
        levelLow: Math.min(levelA, levelB),
        levelHigh: Math.max(levelA, levelB),
        // The original is switch-triggered, not periodic. Approximate: round trip + cooldown at each end.
        periodSec: r2(2 * (travelS + ORIGINAL.ELEVATOR_COOLDOWN_S)),
      });
    } else {
      unmapped.push(`bridge[${idx}] has unknown type ${b.type}; dropped`);
    }
  });

  const items: Item[] = [];
  for (const [kind, arr] of [
    ['small', src.small_items],
    ['large', src.large_items],
  ] as const) {
    for (const t of triples(arr))
      items.push({ id: items.length, kind, pos: S([t[0], t[1]]), islandId: islandAt([t[0], t[1]]) });
  }

  const pageWidth = r2(ORIGINAL.STAGE_WIDTH_PX * k),
    pageHeight = r2(ORIGINAL.STAGE_HEIGHT_PX * k);
  const captureId = createHash('sha256').update(`${src.url}|wwmmm@be2bea8`).digest('hex');
  const builderVersion = 'wwmmm-import/0.1.0';
  const seed = 0;
  const difficulty = 'normal' as const;
  const stageId = createHash('sha256')
    .update(captureId + seed + builderVersion + difficulty)
    .digest('hex');

  unmapped.push(
    'island.level: source is a continuous height in page px (100..250); quantized to integer steps of LEVEL_HEIGHT_M*PX_PER_METER after scaling. Exact heights are in *.extra.json.',
    'item 3rd component (height, = floor(island level)) dropped; implied by islandId.',
    'start/goal 3rd component (height) dropped; implied by islandId.',
    'bridge.angle/distance/start replaced by endpoints a/b; from/to inferred geometrically (not stored in source).',
    'bridge type 1 (elevator) is switch-triggered in 2013 (travel 1000 + dh_world*150 ms, 2 s cooldown), not periodic; periodSec is an approximation.',
    'elevator platform is a width x length rectangle; contract has a single `size`, so max(len, width) was used.',
    'image / mobile_image paths: replaced by the cropped texture; the mobile image is not in the repo.',
    'goal radius: 2013 goal is a ghost cylinder r=1 world unit (10 px), h=2; mapped to radius 10 px * scale.',
    'timeLimitSec: not in source; 2013 desktop used a fixed 300 s (game/world Timer).',
  );

  const stage: StageData = {
    schema: 'wwm.stage/1',
    stageId,
    builderVersion,
    seed,
    difficulty,
    source: { url: src.url, title: src.title, captureId, pageWidth, pageHeight },
    texture: { path: opts.texturePath, width: opts.texture.width, height: opts.texture.height },
    timeLimitSec: ORIGINAL.TIME_LIMIT_S,
    islands,
    bridges,
    elevators,
    items,
    start: { pos: S([src.start[0], src.start[1]]), islandId: islandAt([src.start[0], src.start[1]]) },
    goal: {
      pos: S([src.goal[0], src.goal[1]]),
      islandId: islandAt([src.goal[0], src.goal[1]]),
      radius: r2(ORIGINAL.SENSOR_RADIUS_PX * k),
    },
    provenance: {
      keptElementIds: [],
      dropped: [],
      notes: [
        'Imported from Katamari-Inc/WWMMM@be2bea8 _StageRenderer/bin/data/http-aid-dcc.json (installation data, no license; reference use only, never commit).',
        `scale=${r2(k)} page px per source px (ball-matched: 2013 ball r=5.4 px -> ${BALL_RADIUS_M * PX_PER_METER} px).`,
        `levels quantized: level = round((h - ${hMin}) * scale / ${levelStepPx}).`,
        'Texture is the source PNG cropped to rows 692..2047 (1024 x 1356); it maps onto the whole page (uv = page / pageSize).',
      ],
    },
  };

  const extra = {
    scale: k,
    heightPxByIsland: Object.fromEntries(src.islands.map((i) => [i.id, i.level])),
    heightWorldUnits2013: 'y = heightPx * 0.1 (world units; ball radius 0.54)',
    rawBridges: src.bridges,
    counts: {
      islands: src.islands.length,
      bridges: src.bridges.filter((b) => b.type === 0).length,
      elevators: src.bridges.filter((b) => b.type === 1).length,
      smallItems: src.small_items.length / 3,
      largeItems: src.large_items.length / 3,
    },
  };

  return { stage, extra, issues: checkStructure(stage), unmapped };
}

/**
 * Manual structural check that mirrors the contract §3 invariants. It stands in for validateStage()
 * until @wwm/schema exists. It is not a replacement for it.
 */
export function checkStructure(s: StageData): string[] {
  const issues: string[] = [];
  const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
  const isVec = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]);
  if (s.schema !== 'wwm.stage/1') issues.push('schema literal wrong');
  if (!/^[0-9a-f]{64}$/.test(s.stageId)) issues.push('stageId not sha256 hex');
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 0xffffffff) issues.push('seed not uint32');
  const byId = new Map(s.islands.map((i) => [i.id, i]));
  const edgeMin = BALL_RADIUS_M * PX_PER_METER;
  for (const i of s.islands) {
    if (i.contour.length < 3 || !i.contour.every(isVec)) issues.push(`island ${i.id}: bad contour`);
    if (!Number.isInteger(i.level)) issues.push(`island ${i.id}: non-integer level`);
    // Contract says "outer ring CCW" without fixing the axis convention; report the sign so the delta can be decided.
    if (signedArea(i.contour) > 0)
      issues.push(`island ${i.id}: outer ring has positive signed area in page coords (y-down)`);
    if (selfIntersects(i.contour)) issues.push(`island ${i.id}: contour self-intersects`);
    for (const p of i.restartPoints) {
      if (!pointInPolygon(p, i.contour)) issues.push(`island ${i.id}: restart point outside contour`);
      else if (distToRing(p, i.contour) < edgeMin)
        issues.push(
          `island ${i.id}: restart point ${distToRing(p, i.contour).toFixed(1)}px from edge (< ${edgeMin})`,
        );
    }
  }
  for (const b of s.bridges) {
    if (!byId.has(b.from) || !byId.has(b.to)) issues.push(`bridge ${b.id}: unknown island`);
    if (b.from === b.to) issues.push(`bridge ${b.id}: from === to`);
    if (b.width < MIN_BRIDGE_WIDTH_PX)
      issues.push(`bridge ${b.id}: width ${b.width} < ${MIN_BRIDGE_WIDTH_PX}`);
    const d = Math.abs(b.levelA - b.levelB);
    if (b.type === 'ramp' && d !== 1)
      issues.push(`bridge ${b.id}: ramp level difference ${d} (contract requires exactly 1)`);
    if (b.type === 'flat' && d !== 0) issues.push(`bridge ${b.id}: flat bridge with level difference ${d}`);
    const fa = byId.get(b.from),
      fb = byId.get(b.to);
    if (fa && b.levelA !== fa.level)
      issues.push(`bridge ${b.id}: levelA ${b.levelA} != island ${b.from} level ${fa.level}`);
    if (fb && b.levelB !== fb.level)
      issues.push(`bridge ${b.id}: levelB ${b.levelB} != island ${b.to} level ${fb.level}`);
    for (let t = 0.1; t < 0.9; t += 0.1) {
      const p: Vec2 = [b.a[0] + (b.b[0] - b.a[0]) * t, b.a[1] + (b.b[1] - b.a[1]) * t];
      for (const i of s.islands) {
        if (i.id !== b.from && i.id !== b.to && pointInPolygon(p, i.contour)) {
          issues.push(`bridge ${b.id}: crosses island ${i.id}`);
          t = 1;
          break;
        }
      }
    }
  }
  for (const e of s.elevators)
    if (!byId.has(e.islandFrom) || !byId.has(e.islandTo)) issues.push(`elevator ${e.id}: unknown island`);
  for (const it of s.items) {
    const isl = byId.get(it.islandId);
    if (!isl) {
      issues.push(`item ${it.id}: unknown island`);
      continue;
    }
    if (!pointInPolygon(it.pos, isl.contour))
      issues.push(`item ${it.id} (${it.kind}): outside island ${it.islandId}`);
    else if (distToRing(it.pos, isl.contour) < edgeMin)
      issues.push(
        `item ${it.id} (${it.kind}): ${distToRing(it.pos, isl.contour).toFixed(1)}px from edge (< ${edgeMin})`,
      );
  }
  // Reachability from the start island through bridges and elevators (undirected).
  const adj = new Map<number, number[]>();
  const link = (x: number, y: number): void => {
    adj.set(x, [...(adj.get(x) ?? []), y]);
    adj.set(y, [...(adj.get(y) ?? []), x]);
  };
  for (const b of s.bridges) link(b.from, b.to);
  for (const e of s.elevators) link(e.islandFrom, e.islandTo);
  const seen = new Set([s.start.islandId]);
  const queue = [s.start.islandId];
  while (queue.length)
    for (const n of adj.get(queue.shift() as number) ?? [])
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
  const unreachable = s.islands.filter((i) => !seen.has(i.id)).map((i) => i.id);
  if (unreachable.length)
    issues.push(`unreachable islands from start island ${s.start.islandId}: ${unreachable.join(',')}`);
  if (s.islands.length > 1 && s.goal.islandId === s.start.islandId) issues.push('goal on start island');
  if (!byId.has(s.goal.islandId) || !byId.has(s.start.islandId)) issues.push('start/goal island unknown');
  return issues;
}

function selfIntersects(r: Vec2[]): boolean {
  const n = r.length;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (let i = 0; i < n; i++) {
    const a1 = r[i],
      a2 = r[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = r[j],
        b2 = r[(j + 1) % n];
      const d1 = cross(b1, b2, a1),
        d2 = cross(b1, b2, a2),
        d3 = cross(a1, a2, b1),
        d4 = cross(a1, a2, b2);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
        return true;
    }
  }
  return false;
}

/** Summarise issues by kind (the full list can be long). */
export function summarise(issues: string[]): string[] {
  const groups = new Map<string, number>();
  for (const s of issues) {
    const key = s.replace(/\d+(\.\d+)?/g, '#');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(4)} x ${k}`);
}

export function convertFiles(args: {
  jsonPath: string;
  pngPath: string;
  outDir: string;
  slug: string;
  scale?: ConvertOptions['scale'];
}): ConvertResult {
  const src = JSON.parse(readFileSync(args.jsonPath, 'utf8')) as WwmmmStage;
  const png = decodePng(readFileSync(args.pngPath));
  const tex = cropRows(png, ORIGINAL.TEXTURE_PAGE_ROW0, png.height);
  const texFile = `${args.slug}.texture.png`;
  writeFileSync(join(args.outDir, texFile), encodePng(tex));
  const res = convertWwmmm(src, {
    scale: args.scale ?? 'ball',
    texturePath: texFile,
    texture: { width: tex.width, height: tex.height },
  });
  writeFileSync(join(args.outDir, `${args.slug}.stage.json`), `${JSON.stringify(res.stage, null, 1)}\n`);
  writeFileSync(join(args.outDir, `${args.slug}.extra.json`), `${JSON.stringify(res.extra, null, 1)}\n`);
  const report = [
    `# ${args.slug} structural check (manual stand-in for validateStage)`,
    `islands ${res.stage.islands.length}, bridges ${res.stage.bridges.length}, elevators ${res.stage.elevators.length}, items ${res.stage.items.length}`,
    '',
    '## Issues by kind',
    ...summarise(res.issues),
    '',
    '## Unmapped / lossy fields',
    ...res.unmapped.map((u) => `- ${u}`),
    '',
    '## All issues',
    ...res.issues,
  ].join('\n');
  writeFileSync(join(args.outDir, `${args.slug}.check.txt`), `${report}\n`);
  return res;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const si = argv.indexOf('--scale');
  let scale: ConvertOptions['scale'] = 'ball';
  if (si >= 0) {
    const v = argv[si + 1];
    scale = v === 'raw' || v === 'ball' ? v : Number(v);
    argv.splice(si, 2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const ref = join(root, 'reference');
  const res = convertFiles({
    jsonPath: argv[0] ?? join(ref, 'wwmmm/http-aid-dcc.json'),
    pngPath: argv[1] ?? join(ref, 'wwmmm/http-aid-dcc.png'),
    outDir: argv[2] ?? ref,
    slug: 'aid-dcc',
    scale,
  });
  console.log(summarise(res.issues).join('\n') || 'no structural issues');
}
