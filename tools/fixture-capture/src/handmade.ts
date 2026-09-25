/**
 * The `handmade-simple` fixture stage (contracts §8), authored as code so every coordinate is explicit and
 * reproducible. Page/texture is 1280×1600. Layout (page px, y down):
 *
 *   ┌─────── A (L0, start) ───────┐ ═ b0 ═ ┌──────── B (L0) ────────┐
 *   │ x 80..560, y 80..600         │ ═ b1 ═ │ x 720..1200, y 80..600  │
 *   │                              │ ═ b2 ═ │                          │
 *   └──────────────────────────────┘        └──────────║ b3 (ramp) ──┘
 *   ┌─────── D (L3, goal) ─────────┐        ┌──────── C (L1) ────────┐
 *   │ x 80..560, y 760..1520       │ [e0]   │ x 720..1200, y 760..1200│
 *   │                              │ elev.  └──────────────────────────┘
 *   └──────────────────────────────┘
 *
 * Route: A → (3 flat bridges) → B → (ramp, +1 level) → C → (elevator, L1↔L3) → D (goal).
 */
import {
  computeStageId,
  type Island,
  type Item,
  type Rect,
  rectToRing,
  type StageData,
  type Vec2,
} from '@wwm/schema';

export const HANDMADE_TEXTURE_SIZE = { width: 1280, height: 1600 } as const;

export interface HandmadeIslandSpec {
  id: number;
  label: string;
  rect: Rect;
  level: number;
  color: string;
}

export const HANDMADE_ISLANDS: readonly HandmadeIslandSpec[] = [
  { id: 0, label: 'A', rect: { x: 80, y: 80, w: 480, h: 520 }, level: 0, color: '#e4572e' },
  { id: 1, label: 'B', rect: { x: 720, y: 80, w: 480, h: 520 }, level: 0, color: '#3d7be0' },
  { id: 2, label: 'C', rect: { x: 720, y: 760, w: 480, h: 440 }, level: 1, color: '#2e9e4f' },
  { id: 3, label: 'D', rect: { x: 80, y: 760, w: 480, h: 760 }, level: 3, color: '#e0a800' },
];

const BRIDGES = [
  { id: 0, from: 0, to: 1, a: [560, 170], b: [720, 170], width: 100 },
  { id: 1, from: 0, to: 1, a: [560, 340], b: [720, 340], width: 120 },
  { id: 2, from: 0, to: 1, a: [560, 510], b: [720, 510], width: 100 },
  { id: 3, from: 1, to: 2, a: [960, 600], b: [960, 760], width: 120 },
] as const;

const ELEVATOR = { id: 0, islandFrom: 2, islandTo: 3, pos: [640, 980] as Vec2, size: 160, periodSec: 6 };

const SMALL_ITEMS: [number, Vec2][] = [
  // A
  [0, [320, 180]],
  [0, [420, 180]],
  [0, [320, 500]],
  [0, [420, 500]],
  // B
  [1, [820, 170]],
  [1, [960, 170]],
  [1, [1100, 170]],
  [1, [820, 510]],
  [1, [960, 510]],
  [1, [1100, 510]],
  // C
  [2, [800, 980]],
  [2, [900, 980]],
  [2, [1000, 980]],
  [2, [1100, 980]],
  // D
  [3, [200, 860]],
  [3, [320, 860]],
  [3, [440, 860]],
  [3, [200, 1100]],
  [3, [320, 1100]],
  [3, [440, 1100]],
];
const LARGE_ITEMS: [number, Vec2][] = [
  [1, [1120, 340]],
  [3, [160, 1300]],
];

const RESTART_POINTS: Record<number, Vec2[]> = {
  0: [
    [160, 160],
    [160, 520],
  ],
  1: [
    [800, 340],
    [1120, 520],
  ],
  2: [
    [800, 840],
    [1120, 1120],
  ],
  3: [
    [160, 840],
    [460, 1440],
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

  const mouthsByIsland = new Map<number, { center: Vec2; width: number }[]>();
  const addMouth = (id: number, center: Vec2, width: number) =>
    mouthsByIsland.set(id, [...(mouthsByIsland.get(id) ?? []), { center, width }]);
  for (const b of BRIDGES) {
    addMouth(b.from, [b.a[0], b.a[1]], b.width);
    addMouth(b.to, [b.b[0], b.b[1]], b.width);
  }
  // Elevator platform spans the 160px gap between C (x=720) and D (x=560): open both facing edges.
  addMouth(ELEVATOR.islandFrom, [720, ELEVATOR.pos[1]], ELEVATOR.size);
  addMouth(ELEVATOR.islandTo, [560, ELEVATOR.pos[1]], ELEVATOR.size);

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

  const levelLow = Math.min(levelOf(ELEVATOR.islandFrom), levelOf(ELEVATOR.islandTo));
  const levelHigh = Math.max(levelOf(ELEVATOR.islandFrom), levelOf(ELEVATOR.islandTo));

  return {
    schema: 'wwm.stage/1',
    stageId: await computeStageId(captureId, seed, builderVersion, difficulty),
    builderVersion,
    seed,
    difficulty,
    source: {
      url: 'wwm:fixture/handmade-simple',
      title: 'Handmade simple (4 islands, ramp, elevator)',
      captureId,
      pageWidth: HANDMADE_TEXTURE_SIZE.width,
      pageHeight: HANDMADE_TEXTURE_SIZE.height,
    },
    texture: { path: 'handmade-simple.png', ...HANDMADE_TEXTURE_SIZE },
    timeLimitSec: 120,
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
    elevators: [{ ...ELEVATOR, levelLow, levelHigh }],
    items,
    start: { pos: [180, 340], islandId: 0 },
    goal: { pos: [320, 1420], islandId: 3, radius: 48 },
    provenance: {
      keptElementIds: [],
      dropped: [],
      notes: [
        'Hand-authored fixture (Phase 02), generated by tools/fixture-capture/src/handmade.ts; not built from a capture.',
        'Paths are relative to this JSON file. Texture: handmade-simple.png (1280x1600).',
        'Elevator e0 is a 160x160 platform filling the gap between C (L1) and D (L3); rails are open on both facing edges.',
      ],
    },
  };
}

/** HTML for the 1280×1600 texture: page background, one colored block per island, a 40px (1 m) grid, labels. */
export function handmadeTextureHtml(stage: StageData): string {
  const { width, height } = HANDMADE_TEXTURE_SIZE;
  const blocks = HANDMADE_ISLANDS.map((s) => {
    const role = s.id === stage.start.islandId ? ' · START' : s.id === stage.goal.islandId ? ' · GOAL' : '';
    return `<div class="isl" style="left:${s.rect.x}px;top:${s.rect.y}px;width:${s.rect.w}px;height:${s.rect.h}px;background:${s.color}">
      <div class="lbl">${s.label}</div><div class="sub">level ${s.level}${role}</div>
      <div class="corner">(${s.rect.x}, ${s.rect.y})</div></div>`;
  }).join('\n');
  const bridges = stage.bridges
    .map((b) => {
      const x = Math.min(b.a[0], b.b[0]);
      const y = Math.min(b.a[1], b.b[1]);
      const horiz = b.a[1] === b.b[1];
      const w = horiz ? Math.abs(b.b[0] - b.a[0]) : b.width;
      const h = horiz ? b.width : Math.abs(b.b[1] - b.a[1]);
      return `<div class="br" style="left:${horiz ? x : x - b.width / 2}px;top:${horiz ? y - b.width / 2 : y}px;width:${w}px;height:${h}px">${b.type}</div>`;
    })
    .join('\n');
  const e = stage.elevators[0];
  const elev = e
    ? `<div class="br elev" style="left:${e.pos[0] - e.size / 2}px;top:${e.pos[1] - e.size / 2}px;width:${e.size}px;height:${e.size}px">elevator<br>L${e.levelLow}↔L${e.levelHigh}</div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  body{width:${width}px;height:${height}px;position:relative;overflow:hidden;background:#f3f0e8;
    font-family:ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif}
  .isl{position:absolute;box-sizing:border-box;border-radius:0;color:#fff;
    background-image:linear-gradient(rgba(255,255,255,.22) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.22) 1px,transparent 1px);
    background-size:40px 40px;background-position:-1px -1px}
  .lbl{position:absolute;left:24px;top:12px;font-size:120px;font-weight:800;line-height:1}
  .sub{position:absolute;left:28px;top:140px;font-size:28px;font-weight:600;letter-spacing:.04em}
  .corner{position:absolute;right:12px;bottom:8px;font-size:16px;opacity:.8}
  .br{position:absolute;box-sizing:border-box;background:#b9b2a3;color:#3a352c;font-size:14px;font-weight:600;
    display:flex;align-items:center;justify-content:center;text-align:center;text-transform:uppercase;letter-spacing:.08em}
  .elev{background:#8f877a;color:#fff}
  .note{position:absolute;right:40px;bottom:30px;font-size:18px;color:#8a8375;text-align:right}
</style></head><body>
${bridges}
${elev}
${blocks}
<div class="note">WWM fixture: handmade-simple · 1280×1600 · grid = 40px = 1 m<br>x → right, y ↓ down (page space)</div>
</body></html>`;
}
