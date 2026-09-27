import {
  type BallState,
  LARGE_SCORE,
  SIM_HZ,
  SMALL_SCORE,
  type StageData,
  TIME_SCORE,
  type Vec2,
  worldToPage,
} from '@wwm/schema';
import { buildNavGrid, planRoute, type Route } from '@wwm/solver';
import type { Candidate, Observation } from './contracts.ts';
import { Exploration } from './exploration.ts';
import type { MazeFixture } from './fixtures.ts';

export function mazeFromStage(stage: StageData, textureDataUrl?: string): MazeFixture {
  const centers = Object.fromEntries(stage.islands.map((i) => [i.id, i.restartPoints[0] ?? i.contour[0]]));
  return {
    id: `website-${stage.stageId}`,
    title: stage.source.title,
    description: `${stage.islands.length} islands · ${stage.items.length} gems`,
    stage,
    centers,
    textureDataUrl,
  };
}
export function scoreAt(stage: StageData, collected: ReadonlySet<number>, tick: number, cleared = false) {
  const items = stage.items.filter((i) => collected.has(i.id));
  const small = items.filter((i) => i.kind === 'small').length,
    large = items.length - small;
  const remaining = Math.max(0, Math.round(stage.timeLimitSec - tick / SIM_HZ));
  const gemScore = small * SMALL_SCORE + large * LARGE_SCORE;
  return {
    small,
    large,
    gems: items.length,
    gemScore,
    timeRemaining: remaining,
    bonus: cleared ? remaining * TIME_SCORE : 0,
    score: gemScore + (cleared ? remaining * TIME_SCORE : 0),
  };
}
/** Full visible board mode: Jev chooses score targets; local navigation estimates/executes routes. */
export class ScoreExploration extends Exploration {
  collected = new Set<number>();
  position: Vec2;
  tick = 0;
  grid: ReturnType<typeof buildNavGrid>;
  plans = new Map<string, { route: Route; point: Vec2; islandId: number }>();
  options: Candidate[] = [];
  dirty = true;
  constructor(maze: MazeFixture, seed = 0) {
    super(maze, seed);
    this.position = maze.stage.start.pos;
    this.current = maze.stage.start.islandId;
    this.grid = buildNavGrid(maze.stage, { jumps: false });
  }
  update(ball: BallState, tick: number) {
    this.position = worldToPage(ball.pos);
    this.tick = tick;
    this.dirty = true;
  }
  override candidates(): Candidate[] {
    if (!this.dirty) return this.options;
    this.plans.clear();
    const stage = this.maze.stage;
    const byIsland = new Map<number, typeof stage.items>();
    for (const item of stage.items)
      if (!this.collected.has(item.id)) {
        const list = byIsland.get(item.islandId) ?? [];
        list.push(item);
        byIsland.set(item.islandId, list);
      }
    const options: Candidate[] = [];
    const add = (
      id: string,
      point: Vec2,
      islandId: number,
      kind: 'gem' | 'goal',
      value: number,
      count: number,
    ) => {
      const route = planRoute(this.grid, { from: this.position, to: point });
      if (!route) return;
      const seconds =
        Math.round((route.lengthM / 3 + route.legs.filter((l) => l.elevator).length * 4 + 1) * 10) / 10;
      this.plans.set(id, { route, point, islandId });
      options.push({
        id,
        direction: kind === 'goal' ? 'Finish at goal' : `${value >= 100 ? 'Large gem' : 'Gem trail'}`,
        kind,
        destination: `island-${islandId}`,
        traversals: 0,
        points: value,
        gems: count,
        travelSeconds: seconds,
      });
    };
    for (const [islandId, items] of byIsland) {
      items.sort(
        (a, b) =>
          (b.kind === 'large' ? 100 : 1) - (a.kind === 'large' ? 100 : 1) ||
          Math.hypot(a.pos[0] - this.position[0], a.pos[1] - this.position[1]) -
            Math.hypot(b.pos[0] - this.position[0], b.pos[1] - this.position[1]),
      );
      const item = items[0];
      add(
        `gem-${item.id}`,
        item.pos,
        islandId,
        'gem',
        item.kind === 'large' ? LARGE_SCORE : SMALL_SCORE,
        items.length,
      );
    }
    options.sort(
      (a, b) => (b.points ?? 0) - 5 * (b.travelSeconds ?? 0) - ((a.points ?? 0) - 5 * (a.travelSeconds ?? 0)),
    );
    const top = options.slice(0, 7);
    add('finish', stage.goal.pos, stage.goal.islandId, 'goal', 0, 0);
    const goal = options.find((c) => c.id === 'finish');
    if (goal) top.push(goal);
    this.options = top;
    this.dirty = false;
    return top;
  }
  override observation(): Observation {
    const s = scoreAt(this.maze.stage, this.collected, this.tick);
    return {
      current: `island-${this.current}`,
      goalVisible: true,
      nodes: [],
      edges: [],
      history: [],
      score: {
        ...s,
        totalGems: this.maze.stage.items.length,
        objective:
          'Maximize gem points plus 5 points per second remaining at the goal. Large gems are 100 points, small gems 1. Routes and travel times are local-controller estimates, not guaranteed. The whole maze is visible. Finish before time expires.',
        mode: 'high-score',
      },
    };
  }
  override resolve(choice: string) {
    this.candidates();
    const p = this.plans.get(choice);
    if (!p || !this.options.some((c) => c.id === choice)) throw new Error('Target is no longer reachable');
    return { target: p.islandId, edge: null, point: p.point };
  }
}
