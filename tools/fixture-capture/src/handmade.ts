/**
 * The `handmade-simple` fixture stage (contracts §8), authored as code so every coordinate is explicit and
 * reproducible. Contract v0.2 scale: 1 m = 1 ball diameter = 13.5 px, so this 640×800 px stage is about
 * 47 × 59 m (≈ 47 × 59 ball diameters): a small test course. Layout (stage px, y down):
 *
 *   ┌── A (L0, start) ──┐ ═ b0 ═ ┌──── B (L0) ────┐
 *   │ x 40..280          │ ═ b1 ═ │ x 360..600      │
 *   │ y 40..300          │ ═ b2 ═ │ y 40..300       │
 *   └────────────────────┘        └───║ b3 ramp ────┘
 *   ┌── D (L4, goal) ────┐            ║ (Δ1.5 over 160 px, slope 0.127)
 *   │ x 40..344          │e0┌──── C (L1.5) ───┐
 *   │ y 400..760         │▕▏│ x 360..600       │
 *   │                    │  │ y 460..620       │
 *   │                    │  └──────────────────┘
 *   └────────────────────┘
 *
 * Route: A → (3 flat bridges) → B → (ramp, +1.5) → C → (elevator e0 across a 16 px gap, 1.5 ↔ 4) → D (goal).
 * The texture is rendered at 2× (texture.scale = 2): a 1280×1600 PNG covering the 640×800 stage.
 */
import {
  BALL_RADIUS_PX,
  computeStageId,
  ELEVATOR_COOLDOWN_SEC,
  ELEVATOR_TRAVEL_BASE_SEC,
  ELEVATOR_TRAVEL_SEC_PER_M,
  GOAL_RADIUS_M,
  type Island,
  type Item,
  LEVEL_HEIGHT_M,
  PX_PER_METER,
  type Rect,
  rectToRing,
  type StageData,
  TIME_LIMIT_SEC_DEFAULT,
  type Vec2,
} from '@wwm/schema';

/** Stage extent in stage px. */
export const HANDMADE_STAGE_SIZE = { width: 640, height: 800 } as const;
/** Texture image px per stage px. */
export const HANDMADE_TEXTURE_SCALE = 2;
/** Texture PNG size (image px). */
export const HANDMADE_TEXTURE_SIZE = {
  width: HANDMADE_STAGE_SIZE.width * HANDMADE_TEXTURE_SCALE,
  height: HANDMADE_STAGE_SIZE.height * HANDMADE_TEXTURE_SCALE,
} as const;

export interface HandmadeIslandSpec {
  id: number;
  label: string;
  rect: Rect;
  level: number;
  color: string;
}

export const HANDMADE_ISLANDS: readonly HandmadeIslandSpec[] = [
  { id: 0, label: 'A', rect: { x: 40, y: 40, w: 240, h: 260 }, level: 0, color: '#e4572e' },
  { id: 1, label: 'B', rect: { x: 360, y: 40, w: 240, h: 260 }, level: 0, color: '#3d7be0' },
  { id: 2, label: 'C', rect: { x: 360, y: 460, w: 240, h: 160 }, level: 1.5, color: '#2e9e4f' },
  { id: 3, label: 'D', rect: { x: 40, y: 400, w: 304, h: 360 }, level: 4, color: '#e0a800' },
];

const BRIDGES = [
  { id: 0, from: 0, to: 1, a: [280, 90], b: [360, 90], width: 40 },
  { id: 1, from: 0, to: 1, a: [280, 170], b: [360, 170], width: 48 },
  { id: 2, from: 0, to: 1, a: [280, 250], b: [360, 250], width: 40 },
  // Ramp: Δ1.5 m needs a run ≥ 1.5 / MAX_RAMP_SLOPE = 8.5 m ≈ 115 px; this one is 160 px (slope 0.127).
  { id: 3, from: 1, to: 2, a: [480, 300], b: [480, 460], width: 48 },
] as const;

/** Elevator e0: lower platform on C's west edge (x 360), upper on D's east edge (x 344), 16 px gap. */
const ELEVATOR = {
  id: 0,
  islandFrom: 2,
  islandTo: 3,
  a: [360, 540] as Vec2,
  b: [344, 540] as Vec2,
  width: 48,
};

const SMALL_ITEMS: [number, Vec2][] = [
  // A
  [0, [140, 80]],
  [0, [180, 80]],
  [0, [140, 260]],
  [0, [180, 260]],
  // B
  [1, [400, 110]],
  [1, [440, 110]],
  [1, [520, 110]],
  [1, [560, 110]],
  [1, [440, 230]],
  [1, [520, 230]],
  // C
  [2, [400, 540]],
  [2, [450, 540]],
  [2, [520, 540]],
  [2, [570, 540]],
  // D
  [3, [100, 460]],
  [3, [160, 460]],
  [3, [220, 460]],
  [3, [100, 580]],
  [3, [160, 580]],
  [3, [220, 580]],
];
const LARGE_ITEMS: [number, Vec2][] = [
  [1, [480, 170]],
  [3, [290, 720]],
];

const RESTART_POINTS: Record<number, Vec2[]> = {
  0: [
    [60, 60],
    [60, 280],
  ],
  1: [
    [580, 60],
    [580, 280],
  ],
  2: [
    [380, 600],
    [580, 600],
  ],
  3: [
    [60, 420],
    [320, 740],
  ],
};

/**
 * Guardrails for a closed ring: the ring boundary as open polylines, with gaps of `width` centered on each
 * mouth point (bridge endpoint / elevator side). Mouth centers are projected onto the nearest edge.
 */
export function railsAround(
  ring: readonly Vec2[],
  mouths: readonly { center: Vec2; width: number }[],
): Vec2[][] {
  const n = ring.length;
  const cum: number[] = [0];
  for (let i = 0; i < n; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    cum.push((cum[i] as number) + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const P = cum[n] as number;
  const at = (s: number): Vec2 => {
    const t = ((s % P) + P) % P;
    let i = 0;
    while (i < n - 1 && (cum[i + 1] as number) <= t) i++;
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    const len = (cum[i + 1] as number) - (cum[i] as number);
    const u = len === 0 ? 0 : (t - (cum[i] as number)) / len;
    return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  };
  const project = (c: Vec2): number => {
    let best = Number.POSITIVE_INFINITY;
    let bestS = 0;
    for (let i = 0; i < n; i++) {
      const p = ring[i] as Vec2;
      const q = ring[(i + 1) % n] as Vec2;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const l2 = dx * dx + dy * dy;
      const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((c[0] - p[0]) * dx + (c[1] - p[1]) * dy) / l2));
      const d = Math.hypot(p[0] + u * dx - c[0], p[1] + u * dy - c[1]);
      if (d < best) {
        best = d;
        bestS = (cum[i] as number) + u * Math.sqrt(l2);
      }
    }
    return bestS;
  };
  if (mouths.length === 0)
    return [[...ring.map((p) => [p[0], p[1]] as Vec2), [ring[0]?.[0] ?? 0, ring[0]?.[1] ?? 0]]];

  // Gap intervals [start, end] in perimeter parameter, sorted; assumed non-overlapping.
  const gaps = mouths
    .map((m) => {
      const s = project(m.center);
      return [s - m.width / 2, s + m.width / 2] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  const rails: Vec2[][] = [];
  for (let g = 0; g < gaps.length; g++) {
    const start = (gaps[g] as [number, number])[1];
    let end = (gaps[(g + 1) % gaps.length] as [number, number])[0];
    if (g === gaps.length - 1) end += P;
    if (end - start <= 1e-6) continue;
    const line: Vec2[] = [at(start)];
    for (let k = 0; k <= 2 * n; k++) {
      const s = (cum[k % n] as number) + Math.floor(k / n) * P;
      if (s > start + 1e-6 && s < end - 1e-6) line.push(at(s));
    }
    line.push(at(end));
    rails.push(line);
  }
  return rails;
}

/** Build the handmade-simple StageData. Deterministic; the only async step is the sha256 stageId. */
export async function buildHandmadeStage(): Promise<StageData> {
  const seed = 1;
  const builderVersion = '0.0.0-handmade';
  const difficulty = 'easy' as const;
  const captureId = 'handmade-simple';
  const { width, height } = HANDMADE_STAGE_SIZE;

  const mouthsByIsland = new Map<number, { center: Vec2; width: number }[]>();
  const addMouth = (id: number, center: Vec2, w: number) =>
    mouthsByIsland.set(id, [...(mouthsByIsland.get(id) ?? []), { center, width: w }]);
  for (const b of BRIDGES) {
    addMouth(b.from, [b.a[0], b.a[1]], b.width);
    addMouth(b.to, [b.b[0], b.b[1]], b.width);
  }
  addMouth(ELEVATOR.islandFrom, ELEVATOR.a, ELEVATOR.width);
  addMouth(ELEVATOR.islandTo, ELEVATOR.b, ELEVATOR.width);

  const islands: Island[] = HANDMADE_ISLANDS.map((s) => {
    const contour = rectToRing(s.rect);
    return {
      id: s.id,
      contour,
      holes: [],
      level: s.level,
      guardrails: railsAround(contour, mouthsByIsland.get(s.id) ?? []),
      restartPoints: RESTART_POINTS[s.id] ?? [],
      sourceElementIds: [],
    };
  });
  const levelOf = (id: number) => HANDMADE_ISLANDS.find((s) => s.id === id)?.level ?? 0;

  const items: Item[] = [
    ...SMALL_ITEMS.map(([islandId, pos], i) => ({ id: i, kind: 'small' as const, pos, islandId })),
    ...LARGE_ITEMS.map(([islandId, pos], i) => ({
      id: SMALL_ITEMS.length + i,
      kind: 'large' as const,
      pos,
      islandId,
    })),
  ];

  const levelLow = levelOf(ELEVATOR.islandFrom);
  const levelHigh = levelOf(ELEVATOR.islandTo);
  const travelSec =
    Math.round(
      (ELEVATOR_TRAVEL_BASE_SEC + ELEVATOR_TRAVEL_SEC_PER_M * (levelHigh - levelLow) * LEVEL_HEIGHT_M) * 1000,
    ) / 1000;

  return {
    schema: 'wwm.stage/2',
    stageId: await computeStageId(captureId, 0, seed, builderVersion, difficulty),
    builderVersion,
    seed,
    difficulty,
    source: {
      url: 'wwm:fixture/handmade-simple',
      title: 'Handmade simple (4 islands, ramp, elevator)',
      captureId,
      pageWidth: width,
      pageHeight: height,
      slice: { index: 0, count: 1, y: 0, height },
    },
    size: { width, height },
    texture: { path: 'handmade-simple.png', ...HANDMADE_TEXTURE_SIZE, scale: HANDMADE_TEXTURE_SCALE },
    timeLimitSec: TIME_LIMIT_SEC_DEFAULT,
    islands,
    bridges: BRIDGES.map((b) => {
      const levelA = levelOf(b.from);
      const levelB = levelOf(b.to);
      return {
        id: b.id,
        from: b.from,
        to: b.to,
        a: [b.a[0], b.a[1]] as Vec2,
        b: [b.b[0], b.b[1]] as Vec2,
        width: b.width,
        type: levelA === levelB ? ('flat' as const) : ('ramp' as const),
        levelA,
        levelB,
      };
    }),
    elevators: [{ ...ELEVATOR, levelLow, levelHigh, travelSec, cooldownSec: ELEVATOR_COOLDOWN_SEC }],
    items,
    start: { pos: [100, 170], islandId: 0 },
    goal: { pos: [190, 690], islandId: 3, radius: GOAL_RADIUS_M * PX_PER_METER },
    provenance: {
      keptElementIds: [],
      dropped: [],
      notes: [
        'Hand-authored fixture (Phase 02b, contract v0.2), generated by tools/fixture-capture/src/handmade.ts; not built from a capture.',
        `Stage 640x800 px at ${PX_PER_METER} px/m (1 m = 1 ball diameter). Paths are relative to this JSON file. Texture: handmade-simple.png (1280x1600, scale 2).`,
        'Ramp b3 rises 1.5 m over 160 px (11.85 m): slope 0.127 <= MAX_RAMP_SLOPE.',
        'Elevator e0 spans the 16 px gap between C (level 1.5, lower platform at a) and D (level 4, upper at b); rails are open at both mouths.',
        `Item / restart clearance >= BALL_RADIUS_PX (${BALL_RADIUS_PX} px).`,
      ],
    },
  };
}

/** Axis-aligned rectangle (stage px) covering a span's footprint (a→b centerline with a width). */
function spanRect(a: Vec2, b: Vec2, w: number): Rect {
  const horiz = a[1] === b[1];
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return horiz
    ? { x, y: y - w / 2, w: Math.abs(b[0] - a[0]), h: w }
    : { x: x - w / 2, y, w, h: Math.abs(b[1] - a[1]) };
}

/**
 * HTML for the texture: a 640×800 CSS px page rendered at DPR 2 (→ 1280×1600 PNG). Page background, one
 * colored block per island, a 13.5 px (1 m = 1 ball diameter) grid, labels.
 */
export function handmadeTextureHtml(stage: StageData): string {
  const { width, height } = HANDMADE_STAGE_SIZE;
  const blocks = HANDMADE_ISLANDS.map((s) => {
    const role = s.id === stage.start.islandId ? ' · START' : s.id === stage.goal.islandId ? ' · GOAL' : '';
    return `<div class="isl" style="left:${s.rect.x}px;top:${s.rect.y}px;width:${s.rect.w}px;height:${s.rect.h}px;background-color:${s.color}">
      <div class="lbl">${s.label}</div><div class="sub">level ${s.level}${role}</div>
      <div class="corner">(${s.rect.x}, ${s.rect.y})</div></div>`;
  }).join('\n');
  const box = (r: Rect, cls: string, text: string) =>
    `<div class="${cls}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">${text}</div>`;
  const bridges = stage.bridges.map((b) => box(spanRect(b.a, b.b, b.width), 'br', b.type)).join('\n');
  const elev = stage.elevators.map((e) => box(spanRect(e.a, e.b, e.width), 'br elev', '')).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  body{width:${width}px;height:${height}px;position:relative;overflow:hidden;background:#f3f0e8;
    font-family:ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif}
  .isl{position:absolute;box-sizing:border-box;border-radius:0;color:#fff;
    background-image:linear-gradient(rgba(255,255,255,.25) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.25) 1px,transparent 1px);
    background-size:${PX_PER_METER}px ${PX_PER_METER}px;background-position:0 0}
  .lbl{position:absolute;left:10px;top:4px;font-size:56px;font-weight:800;line-height:1}
  .sub{position:absolute;left:12px;top:62px;font-size:13px;font-weight:600;letter-spacing:.04em}
  .corner{position:absolute;right:6px;bottom:4px;font-size:9px;opacity:.85}
  .br{position:absolute;box-sizing:border-box;background:#b9b2a3;color:#3a352c;font-size:8px;font-weight:600;
    display:flex;align-items:center;justify-content:center;text-align:center;text-transform:uppercase;letter-spacing:.06em}
  .elev{background:#6f675a}
  .note{position:absolute;right:16px;bottom:12px;font-size:9px;line-height:1.4;color:#8a8375;text-align:right}
</style></head><body>
${bridges}
${elev}
${blocks}
<div class="note">WWM fixture: handmade-simple · stage ${width}×${height} px · texture ×${HANDMADE_TEXTURE_SCALE}<br>grid = ${PX_PER_METER} px = 1 m = 1 ball diameter · x → right, y ↓ down</div>
</body></html>`;
}
