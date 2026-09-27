/**
 * Where gems sit on an island, and how two islands' gems pair up. Pure and deterministic, so the lesson page,
 * the game, and tests all draw exactly the same picture from the same document.
 *
 * Coordinates are in "island units": the usable island top is `aspect` wide and 1 tall, origin top-left.
 */
import type { GemGroup } from './schema.ts';

export interface GemLayout {
  /** Gem centres, in reading order (top to bottom, then left to right). */
  points: [number, number][];
  /** Gem radius, in the same units. */
  r: number;
}

export const GEM_RADIUS: Record<GemGroup['size'], number> = { small: 0.1, medium: 0.135, large: 0.18 };

/** mulberry32: tiny, seeded, and identical everywhere. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Die faces (in a unit square) for 1–6. */
const DICE: [number, number][][] = [
  [[0.5, 0.5]],
  [
    [0.25, 0.25],
    [0.75, 0.75],
  ],
  [
    [0.22, 0.22],
    [0.5, 0.5],
    [0.78, 0.78],
  ],
  [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ],
  [
    [0.22, 0.22],
    [0.78, 0.22],
    [0.5, 0.5],
    [0.22, 0.78],
    [0.78, 0.78],
  ],
  [
    [0.25, 0.15],
    [0.75, 0.15],
    [0.25, 0.5],
    [0.75, 0.5],
    [0.25, 0.85],
    [0.75, 0.85],
  ],
];

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function readingOrder(points: [number, number][]): [number, number][] {
  return points
    .map(([x, y]) => [round3(x), round3(y)] as [number, number])
    .sort((p, q) => (Math.abs(p[1] - q[1]) > 0.05 ? p[1] - q[1] : p[0] - q[0]));
}

/** Rows of at most `perRow`, centred, `gap` apart (centre to centre). */
function rows(
  count: number,
  perRow: number,
  gap: number,
  aspect: number,
  stagger: boolean,
): [number, number][] {
  const lines = Math.ceil(count / perRow);
  const points: [number, number][] = [];
  const rowGap = stagger ? gap * 0.87 : gap;
  for (let row = 0; row < lines; row++) {
    const inRow = Math.min(perRow, count - row * perRow);
    const y = 0.5 + (row - (lines - 1) / 2) * rowGap;
    for (let col = 0; col < inRow; col++) points.push([aspect / 2 + (col - (inRow - 1) / 2) * gap, y]);
  }
  return points;
}

export function layoutGroup(group: GemGroup, aspect = 1.9): GemLayout {
  const r = GEM_RADIUS[group.size];
  const n = group.count;
  let points: [number, number][];
  switch (group.arrangement) {
    case 'dice': {
      const face = DICE[n - 1];
      if (face) {
        const side = 0.84;
        points = face.map(([x, y]) => [aspect / 2 + (x - 0.5) * side, 0.5 + (y - 0.5) * side]);
      } else
        points = rows(
          n,
          Math.ceil(n / 2),
          Math.min(0.34, (aspect - 2 * r - 0.1) / Math.ceil(n / 2)),
          aspect,
          false,
        );
      break;
    }
    case 'row':
      points = rows(n, n, r * 2.7, aspect, false);
      break;
    case 'spread': {
      // as wide as the island allows, gently zig-zagging: long rows "look like more"
      const left = r + 0.08;
      const right = aspect - r - 0.08;
      points = Array.from({ length: n }, (_, i) => [
        n === 1 ? aspect / 2 : left + ((right - left) * i) / (n - 1),
        n === 1 ? 0.5 : i % 2 === 0 ? 0.38 : 0.62,
      ]);
      break;
    }
    case 'tight': {
      // bunched up in the middle: a compact hexagonal cluster
      const perRow = n <= 2 ? n : n <= 4 ? 2 : 3;
      const gap = r * 2.2;
      const raw = Array.from({ length: n }, (_, i) => {
        const row = Math.floor(i / perRow);
        return [(i % perRow) * gap + (row % 2) * (gap / 2), row * gap * 0.87] as [number, number];
      });
      const xs = raw.map(([x]) => x);
      const ys = raw.map(([, y]) => y);
      const dx = aspect / 2 - (Math.min(...xs) + Math.max(...xs)) / 2;
      const dy = 0.5 - (Math.min(...ys) + Math.max(...ys)) / 2;
      points = raw.map(([x, y]) => [x + dx, y + dy]);
      break;
    }
    case 'scatter': {
      const random = rng(group.seed ?? 1);
      const minDistance = r * 2.6;
      points = [];
      for (let attempt = 0; points.length < n && attempt < 4000; attempt++) {
        const x = r + 0.06 + random() * (aspect - 2 * r - 0.12);
        const y = r + 0.06 + random() * (1 - 2 * r - 0.12);
        if (points.every(([px, py]) => Math.hypot(px - x, py - y) >= minDistance)) points.push([x, y]);
      }
      // a crowded island falls back to a staggered grid rather than overlapping gems
      if (points.length < n) points = rows(n, Math.ceil(n / 2), r * 2.6, aspect, true);
      break;
    }
  }
  return { points: readingOrder(points), r };
}

export interface Pairing {
  /** Index pairs [gem on island A, gem on island B], one per spoken "match". */
  pairs: [number, number][];
  /** Which island has gems left over (none when equal). */
  extra: 'a' | 'b' | null;
  /** Indexes of the leftover gems on that island. */
  leftovers: number[];
}

/** One-to-one correspondence in reading order: the strategy the match tool teaches. */
export function pairUp(a: GemLayout, b: GemLayout): Pairing {
  const n = Math.min(a.points.length, b.points.length);
  const pairs = Array.from({ length: n }, (_, i) => [i, i] as [number, number]);
  const extra = a.points.length > b.points.length ? 'a' : a.points.length < b.points.length ? 'b' : null;
  const longer = extra === 'a' ? a : b;
  const leftovers = extra ? Array.from({ length: longer.points.length - n }, (_, i) => n + i) : [];
  return { pairs, extra, leftovers };
}
