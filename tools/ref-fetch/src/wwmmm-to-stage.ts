// WWMMM installation stage JSON -> our StageData (contracts.md §3, v0.2), for use as a real-world test level.
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
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BALL_RADIUS_PX,
  type Bridge,
  computeStageId,
  type Elevator,
  type Island,
  type Item,
  LEVEL_HEIGHT_M,
  PX_PER_METER,
  type StageData,
  type StageValidationError,
  sha256Hex,
  signedArea,
  type Vec2,
  validateStage,
} from '@wwm/schema';
import { cropRows, decodePng, encodePng, padRows } from './png.ts';

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
  ELEVATOR_BASE_MS: 1000, // travel = 1000 + |dh| * WORLD_SCALE * 150 ms (cubicInOut)
  ELEVATOR_MS_PER_WU: 150,
  ELEVATOR_COOLDOWN_S: 2,
  TIME_LIMIT_S: 300,
} as const;

export interface ConvertOptions {
  /**
   * Page-px multiplier. 'ball' (default) scales so the 2013 ball (r = 5.4 px) matches our BALL_RADIUS_PX
   * (6.75 px at contract v0.2) → ×1.25, which also maps the 1024 px stage onto a 1280 px capture width.
   */
  scale: 'ball' | 'raw' | number;
  texturePath: string;
  texture: { width: number; height: number };
}

export interface ConvertResult {
  stage: StageData;
  /** Exact data that StageData cannot hold (raw bridge params, raw heights). */
  extra: Record<string, unknown>;
  /** `validateStage` errors for the converted stage. */
  issues: StageValidationError[];
  unmapped: string[];
}

const pairs = (a: number[]): Vec2[] => {
  const o: Vec2[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) o.push([a[i] as number, a[i + 1] as number]);
  return o;
};
const triples = (a: number[]): [number, number, number][] => {
  const o: [number, number, number][] = [];
  for (let i = 0; i + 2 < a.length; i += 3) o.push([a[i] as number, a[i + 1] as number, a[i + 2] as number]);
  return o;
};
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

function pointInRing(pt: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Vec2;
    const [xj, yj] = poly[j] as Vec2;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distToRing(p: Vec2, ring: Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % ring.length] as Vec2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]));
  }
  return best;
}
/** Orient a ring: positive shoelace area for outers (contract `isCCW`), negative for holes. */
function orient(ring: Vec2[], positive: boolean): Vec2[] {
  return signedArea(ring) > 0 === positive ? ring : [...ring].reverse();
}

export function resolveScale(scale: ConvertOptions['scale']): number {
  if (scale === 'raw') return 1;
  if (scale === 'ball') return BALL_RADIUS_PX / ORIGINAL.BALL_RADIUS_PX;
  return scale;
}

export async function convertWwmmm(src: WwmmmStage, opts: ConvertOptions): Promise<ConvertResult> {
  const k = resolveScale(opts.scale);
  const S = (p: Vec2): Vec2 => [r2(p[0] * k), r2(p[1] * k)];
  // Heights: 2013 px → our px (×k) → meters (÷PX_PER_METER) → level units (÷LEVEL_HEIGHT_M). At the ball
  // scale this is h / 10.8, i.e. the height in 2013 ball diameters. No offset: levels stay ≈ 9–23.
  const level = (h: number): number => r4((h * k) / PX_PER_METER / LEVEL_HEIGHT_M);
  const unmapped: string[] = [];

  const islands: Island[] = src.islands.map((isl) => {
    const rings = isl.contours.map(pairs);
    return {
      id: isl.id,
      contour: orient((rings[0] ?? []).map(S), true),
      holes: rings.slice(1).map((r) => orient(r.map(S), false)),
      level: level(isl.level),
      guardrails: isl.guardrails.map((g) => pairs(g).map(S)),
      restartPoints: pairs(isl.restartPoints).map(S),
      sourceElementIds: [],
    };
  });
  const rawOuter = new Map(src.islands.map((i) => [i.id, pairs(i.contours[0] ?? [])]));
  const levelById = new Map(islands.map((i) => [i.id, i.level]));

  /** Island containing p (raw px), else the nearest one. */
  const islandAt = (p: Vec2, exclude?: number): number => {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (const [id, ring] of rawOuter) {
      if (id === exclude) continue;
      const d = pointInRing(p, ring) ? -1 : distToRing(p, ring);
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
    const levelA = level(b.level[0]);
    const levelB = level(b.level[1]);
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
      // Contract: islandFrom = lower island, lower platform at `a`, upper at `b`. 2013 records may descend.
      const rising = b.level[1] > b.level[0];
      const [lo, hi, pa, pb] = rising ? [from, to, a, e] : [to, from, e, a];
      const dh = Math.abs(b.level[1] - b.level[0]);
      elevators.push({
        id: elevators.length,
        islandFrom: lo,
        islandTo: hi,
        a: S(pa),
        b: S(pb),
        width: r2(b.width * k),
        levelLow: levelById.get(lo) ?? Math.min(levelA, levelB),
        levelHigh: levelById.get(hi) ?? Math.max(levelA, levelB),
        travelSec: r4(
          (ORIGINAL.ELEVATOR_BASE_MS + dh * ORIGINAL.WORLD_SCALE * ORIGINAL.ELEVATOR_MS_PER_WU) / 1000,
        ),
        cooldownSec: ORIGINAL.ELEVATOR_COOLDOWN_S,
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

  const pageWidth = r2(ORIGINAL.STAGE_WIDTH_PX * k);
  const pageHeight = r2(ORIGINAL.STAGE_HEIGHT_PX * k);
  const captureId = await sha256Hex(`${src.url}|wwmmm@be2bea8`);
  const builderVersion = '0.2.0-wwmmm-import';
  const seed = 0;
  const difficulty = 'normal' as const;
  const stageId = await computeStageId(captureId, 0, seed, builderVersion, difficulty);

  unmapped.push(
    'island.level: source is a continuous height in 2013 page px (100..250); converted to float level = h * scale / PX_PER_METER (= h / 10.8 at the ball scale, i.e. 2013 ball diameters). Raw heights are in *.extra.json.',
    'contour orientation: 2013 outer rings have negative shoelace area on (x, y-down); flipped to the contract convention (outer positive, holes negative).',
    'item 3rd component (height, = floor(island level)) dropped; implied by islandId.',
    'start/goal 3rd component (height) dropped; implied by islandId.',
    'bridge.angle/distance/start replaced by endpoints a/b; from/to inferred geometrically (not stored in source).',
    'bridge type 1 (elevator) -> Elevator{a,b,width}: from/a = lower island side, to/b = upper (swapped for descending 2013 records). The 2013 platform extent max(distance, 15 px) along the axis is left to the renderer/physics.',
    'elevator travelSec: exact 2013 formula (1000 + |dh| * 0.1 * 150) ms; cooldownSec 2 (E).',
    'image / mobile_image paths: replaced by the cropped texture; the mobile image is not in the repo.',
    'goal radius: 2013 goal is a ghost cylinder r=1 world unit (10 px), h=2; mapped to radius 10 px * scale.',
    'timeLimitSec: not in source; 2013 desktop used a fixed 300 s (game/world Timer).',
  );

  const stage: StageData = {
    schema: 'wwm.stage/2',
    stageId,
    builderVersion,
    seed,
    difficulty,
    source: {
      url: src.url,
      title: src.title,
      captureId,
      pageWidth,
      pageHeight,
      slice: { index: 0, count: 1, y: 0, height: pageHeight },
    },
    size: { width: pageWidth, height: pageHeight },
    texture: {
      path: opts.texturePath,
      width: opts.texture.width,
      height: opts.texture.height,
      scale: r4(opts.texture.width / pageWidth),
    },
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
        `scale=${r4(k)} stage px per 2013 px (ball-matched: 2013 ball r=5.4 px -> ${BALL_RADIUS_PX} px).`,
        `levels: level = h * ${r4(k)} / ${PX_PER_METER} (float, ball diameters).`,
        'Texture is the source PNG rows 692..2047 padded to 1358 rows (last row repeated), covering the whole stage.',
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

  return { stage, extra, issues: validateStage(stage).errors, unmapped };
}

/** Summarise validateStage errors by code (the full list can be long). */
export function summarise(issues: StageValidationError[]): string[] {
  const groups = new Map<string, number>();
  for (const e of issues) groups.set(e.code, (groups.get(e.code) ?? 0) + 1);
  return [...groups].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(4)} x ${k}`);
}

export async function convertFiles(args: {
  jsonPath: string;
  pngPath: string;
  outDir: string;
  slug: string;
  scale?: ConvertOptions['scale'];
}): Promise<ConvertResult> {
  const src = JSON.parse(readFileSync(args.jsonPath, 'utf8')) as WwmmmStage;
  const png = decodePng(readFileSync(args.pngPath));
  // Page rows 0..1358 start at texture row 692; the canvas ends at 2048, so pad the last 2 rows.
  const tex = padRows(cropRows(png, ORIGINAL.TEXTURE_PAGE_ROW0, png.height), ORIGINAL.STAGE_HEIGHT_PX);
  const texFile = `${args.slug}.texture.png`;
  writeFileSync(join(args.outDir, texFile), encodePng(tex));
  const res = await convertWwmmm(src, {
    scale: args.scale ?? 'ball',
    texturePath: texFile,
    texture: { width: tex.width, height: tex.height },
  });
  writeFileSync(join(args.outDir, `${args.slug}.stage.json`), `${JSON.stringify(res.stage, null, 1)}\n`);
  writeFileSync(join(args.outDir, `${args.slug}.extra.json`), `${JSON.stringify(res.extra, null, 1)}\n`);
  const s = res.stage;
  const report = [
    `# ${args.slug}: validateStage (@wwm/schema, contract v0.2) on the converted WWMMM stage`,
    `islands ${s.islands.length}, bridges ${s.bridges.length}, elevators ${s.elevators.length}, items ${s.items.length}`,
    `size ${s.size.width}x${s.size.height} px, texture ${s.texture.width}x${s.texture.height} @${s.texture.scale}, levels ${Math.min(...s.islands.map((i) => i.level))}..${Math.max(...s.islands.map((i) => i.level))}`,
    `ok: ${res.issues.length === 0} (${res.issues.length} issue(s))`,
    '',
    '## Issues by code',
    ...summarise(res.issues),
    '',
    '## Unmapped / lossy fields',
    ...res.unmapped.map((u) => `- ${u}`),
    '',
    '## All issues',
    ...res.issues.map((e) => `${e.code} ${e.path ?? ''}: ${e.message}`),
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
  const res = await convertFiles({
    jsonPath: argv[0] ?? join(ref, 'wwmmm/http-aid-dcc.json'),
    pngPath: argv[1] ?? join(ref, 'wwmmm/http-aid-dcc.png'),
    outDir: argv[2] ?? ref,
    slug: 'aid-dcc',
    scale,
  });
  console.log(summarise(res.issues).join('\n') || 'validateStage: ok');
}
