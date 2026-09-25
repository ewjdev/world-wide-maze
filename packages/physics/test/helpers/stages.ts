/** Synthetic StageData builders for physics tests (not validated stages; just enough for the sim). */
import { readFileSync } from 'node:fs';
import type { Bridge, Elevator, Island, Item, StageData, Vec2 } from '@wwm/schema';

export const HANDMADE: StageData = JSON.parse(
  readFileSync(new URL('../../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
);

export const HANDMADE_REPLAY_URL = new URL(
  '../../../../fixtures/replays/handmade-simple.keyboard.json',
  import.meta.url,
);

export const AID_DCC_URL = new URL('../../../../reference/aid-dcc.stage.json', import.meta.url);

export function rect(x: number, y: number, w: number, h: number): Vec2[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

export function island(id: number, contour: Vec2[], level: number, opts: Partial<Island> = {}): Island {
  return {
    id,
    contour,
    holes: [],
    level,
    guardrails: [[...contour, contour[0] as Vec2]],
    restartPoints: [],
    sourceElementIds: [],
    ...opts,
  };
}

export function makeStage(parts: {
  islands: Island[];
  bridges?: Bridge[];
  elevators?: Elevator[];
  items?: Item[];
  start: Vec2;
  startIsland?: number;
  goal?: Vec2;
  goalIsland?: number;
  width?: number;
  height?: number;
}): StageData {
  const width = parts.width ?? 1280;
  const height = parts.height ?? 1700;
  return {
    schema: 'wwm.stage/2',
    stageId: 'test',
    builderVersion: 'test',
    seed: 1,
    difficulty: 'easy',
    source: {
      url: 'test:',
      title: 'test',
      captureId: 'test',
      pageWidth: width,
      pageHeight: height,
      slice: { index: 0, count: 1, y: 0, height },
    },
    size: { width, height },
    texture: { path: '', width, height, scale: 1 },
    timeLimitSec: 300,
    islands: parts.islands,
    bridges: parts.bridges ?? [],
    elevators: parts.elevators ?? [],
    items: parts.items ?? [],
    start: { pos: parts.start, islandId: parts.startIsland ?? 0 },
    goal: { pos: parts.goal ?? [-1000, -1000], islandId: parts.goalIsland ?? 0, radius: 12.5 },
    provenance: { keptElementIds: [], dropped: [], notes: [] },
  };
}

/** A regular n-gon ring (positive shoelace area in page coords). */
export function circle(cx: number, cy: number, r: number, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}
