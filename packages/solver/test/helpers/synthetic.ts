/**
 * Synthetic stages for solver tests. All geometry in stage px; contour rings use the contract orientation
 * (positive shoelace area in x-right / y-down coordinates).
 */
import type { Island, StageData, Vec2 } from '@wwm/schema';

export function rect(x: number, y: number, w: number, h: number): Vec2[] {
  // positive area in (x right, y down): clockwise on screen = (x,y) → (x+w,y) → (x+w,y+h) → (x,y+h)
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function island(id: number, contour: Vec2[], level: number, restartPoints: Vec2[]): Island {
  return {
    id,
    contour,
    holes: [],
    level,
    guardrails: [[...contour, contour[0] as Vec2]],
    restartPoints,
    sourceElementIds: [],
  };
}

export function baseStage(
  partial: Partial<StageData> & Pick<StageData, 'islands' | 'start' | 'goal'>,
): StageData {
  return {
    schema: 'wwm.stage/2',
    stageId: 'synthetic',
    builderVersion: 'test',
    seed: 1,
    difficulty: 'normal',
    source: {
      url: 'about:blank',
      title: 'synthetic',
      captureId: 'synthetic',
      pageWidth: 400,
      pageHeight: 400,
      slice: { index: 0, count: 1, y: 0, height: 400 },
    },
    size: { width: 400, height: 400 },
    texture: { path: '', width: 400, height: 400, scale: 1 },
    timeLimitSec: 300,
    bridges: [],
    elevators: [],
    items: [],
    provenance: { keptElementIds: [], dropped: [], notes: [] },
    ...partial,
  };
}

/**
 * One island shaped like a dumbbell: two 80×80 pads joined by a horizontal neck `neckPx` wide and 60 px long.
 * Start on the left pad, goal on the right one.
 */
export function neckStage(neckPx: number, neckLenPx = 60): StageData {
  const y0 = 100;
  const l = 120;
  const r = 120 + neckLenPx;
  const nt = 140 - neckPx / 2;
  const nb = 140 + neckPx / 2;
  const contour: Vec2[] = [
    [40, y0],
    [l, y0],
    [l, nt],
    [r, nt],
    [r, y0],
    [r + 80, y0],
    [r + 80, y0 + 80],
    [r, y0 + 80],
    [r, nb],
    [l, nb],
    [l, y0 + 80],
    [40, y0 + 80],
  ];
  return baseStage({
    islands: [island(0, contour, 15, [[80, 140]])],
    start: { pos: [80, 140], islandId: 0 },
    goal: { pos: [r + 40, 140], islandId: 0, radius: 12.5 },
  });
}

/** Two pads at different levels joined by a trigger elevator (lower pad left), rising `rise` D. */
export function elevatorStage(rise = 6): StageData {
  const low = island(0, rect(40, 100, 100, 80), 12, [[80, 140]]);
  low.guardrails = [
    [
      [140, 160],
      [140, 180],
      [40, 180],
      [40, 100],
      [140, 100],
      [140, 120],
    ],
  ];
  const high = island(1, rect(149, 100, 100, 80), 12 + rise, [[200, 140]]);
  high.guardrails = [
    [
      [149, 120],
      [149, 100],
      [249, 100],
      [249, 180],
      [149, 180],
      [149, 160],
    ],
  ];
  return baseStage({
    islands: [low, high],
    elevators: [
      {
        id: 0,
        islandFrom: 0,
        islandTo: 1,
        a: [140, 140],
        b: [149, 140],
        width: 40,
        levelLow: 12,
        levelHigh: 12 + rise,
        travelSec: 1 + 0.162 * rise,
        cooldownSec: 2,
      },
    ],
    start: { pos: [70, 140], islandId: 0 },
    goal: { pos: [225, 140], islandId: 1, radius: 12.5 },
  });
}
