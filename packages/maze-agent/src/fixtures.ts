import type { StageData, Vec2 } from '@wwm/schema';
export interface MazeFixture {
  id: string;
  title: string;
  description: string;
  stage: StageData;
  centers: Record<number, Vec2>;
  textureDataUrl?: string;
}
const DEFINITIONS = [
  {
    id: 'first-fork',
    title: 'The first fork',
    description: 'Seven islands. One fork, two dead ends, and a goal to discover.',
    points: [
      [0, 1],
      [1, 1],
      [1, 0],
      [2, 1],
      [2, 0],
      [2, 2],
      [3, 2],
    ],
    links: [
      [0, 1],
      [1, 2],
      [1, 3],
      [3, 4],
      [3, 5],
      [5, 6],
    ],
    goal: 6,
  },
  {
    id: 'round-trip',
    title: 'Round trip',
    description: 'A loop brings Jev back to a familiar junction.',
    points: [
      [0, 1],
      [1, 1],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
      [3, 1],
      [3, 2],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 1],
      [4, 5],
      [4, 6],
      [6, 7],
    ],
    goal: 7,
  },
  {
    id: 'branch-library',
    title: 'Branch library',
    description: 'Nine islands with short branches and a longer return path.',
    points: [
      [0, 1],
      [1, 1],
      [1, 0],
      [1, 2],
      [2, 1],
      [2, 0],
      [2, 2],
      [3, 2],
      [3, 1],
    ],
    links: [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [4, 5],
      [4, 6],
      [6, 7],
      [7, 8],
    ],
    goal: 8,
  },
  {
    id: 'confirmation',
    title: 'Confirmation',
    description: 'Held-out fixture for a later confirmation run.',
    points: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [2, 1],
      [2, 0],
    ],
    links: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
      [4, 5],
    ],
    goal: 5,
  },
];
export const FIXTURES: MazeFixture[] = DEFINITIONS.map((d) => {
  const centers = Object.fromEntries(
    d.points.map(([x, y], i) => [i, [120 + x * 200, 120 + y * 200] as Vec2]),
  );
  const islands = d.points.map((_, i) => {
    const [x, y] = centers[i];
    return {
      id: i,
      contour: [
        [x - 65, y - 65],
        [x + 65, y - 65],
        [x + 65, y + 65],
        [x - 65, y + 65],
      ] as Vec2[],
      holes: [],
      level: 0,
      guardrails: [],
      restartPoints: [centers[i]],
      sourceElementIds: [],
    };
  });
  const bridges = d.links.map(([from, to], id) => {
    const a = centers[from],
      b = centers[to];
    const dx = Math.sign(b[0] - a[0]),
      dy = Math.sign(b[1] - a[1]);
    return {
      id,
      from,
      to,
      a: [a[0] + dx * 60, a[1] + dy * 60] as Vec2,
      b: [b[0] - dx * 60, b[1] - dy * 60] as Vec2,
      width: 44,
      type: 'flat' as const,
      levelA: 0,
      levelB: 0,
    };
  });
  const goal = centers[d.goal];
  const stage: StageData = {
    schema: 'wwm.stage/2',
    stageId: `jev-${d.id}-v1`,
    builderVersion: '0.1.0-jev',
    seed: 1,
    difficulty: 'easy',
    source: {
      url: `wwm:jev/${d.id}`,
      title: d.title,
      captureId: `jev-${d.id}`,
      pageWidth: 860,
      pageHeight: 660,
      slice: { index: 0, count: 1, y: 0, height: 660 },
    },
    size: { width: 860, height: 660 },
    texture: { path: 'generated', width: 860, height: 660, scale: 1 },
    timeLimitSec: 300,
    islands,
    bridges,
    elevators: [],
    items: [],
    start: { pos: centers[0], islandId: 0 },
    goal: { pos: [goal[0] + 30, goal[1] + 30], islandId: d.goal, radius: 12 },
    provenance: { keptElementIds: [], dropped: [], notes: ['Authored spectator fixture'] },
  };
  return { id: d.id, title: d.title, description: d.description, stage, centers };
});
export function fixture(id: string) {
  const f = FIXTURES.find((f) => f.id === id);
  if (!f) throw new Error('Unknown fixture');
  return f;
}
