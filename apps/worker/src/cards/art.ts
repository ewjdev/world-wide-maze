/**
 * Share cards (Phase 18): StageData → the simplified geometry the card drawing needs. Pure.
 * Contours are thinned to at most MAX_RING points so a huge stage can't make a huge SVG.
 */
import type { StageData, Vec2 } from '@wwm/schema';
import type { StageArt } from './data.ts';

const MAX_ISLANDS = 400;
const MAX_RING = 160;
const MAX_ITEMS = 600;

function thin(ring: Vec2[], max = MAX_RING): [number, number][] {
  if (ring.length <= max) return ring.map(([x, y]) => [x, y]);
  const step = ring.length / max;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) {
    const p = ring[Math.floor(i * step)] as Vec2;
    out.push([p[0], p[1]]);
  }
  return out;
}

export function stageArt(stage: StageData): StageArt {
  const level = new Map(stage.islands.map((i) => [i.id, i.level]));
  const lv = (id: number) => level.get(id) ?? 0;
  return {
    size: { width: stage.size.width, height: stage.size.height },
    islands: stage.islands.slice(0, MAX_ISLANDS).map((i) => ({
      level: i.level,
      contour: thin(i.contour),
      holes: i.holes.slice(0, 8).map((h) => thin(h, 60)),
      guardrails: i.guardrails.slice(0, 16).map((g) => thin(g, 80)),
    })),
    bridges: stage.bridges.slice(0, MAX_ISLANDS).map((b) => ({
      a: [b.a[0], b.a[1]],
      b: [b.b[0], b.b[1]],
      width: b.width,
      levelA: b.levelA,
      levelB: b.levelB,
    })),
    elevators: stage.elevators.slice(0, 100).map((e) => ({
      a: [e.a[0], e.a[1]],
      b: [e.b[0], e.b[1]],
      width: e.width,
      levelLow: e.levelLow,
    })),
    items: stage.items
      .slice(0, MAX_ITEMS)
      .map((it) => ({ kind: it.kind, pos: [it.pos[0], it.pos[1]], level: lv(it.islandId) })),
    start: { pos: [stage.start.pos[0], stage.start.pos[1]], level: lv(stage.start.islandId) },
    goal: { pos: [stage.goal.pos[0], stage.goal.pos[1]], level: lv(stage.goal.islandId) },
  };
}
