import { createSimulation, type RapierSimulation } from '@wwm/physics';
import { type BallState, type InputSample, SIM_HZ, type SimStepResult, worldToPage } from '@wwm/schema';
import {
  buildNavGrid,
  DEFAULT_GAINS,
  DEFAULT_TUNING,
  newTracking,
  planRoute,
  type Route,
  steer,
  type Tracking,
} from '@wwm/solver';
import { Exploration } from './exploration.ts';
import type { MazeFixture } from './fixtures.ts';
import { ScoreExploration, scoreAt } from './score.ts';
export class MazePilot {
  sim!: RapierSimulation;
  ball!: BallState;
  tick = 0;
  exploration: Exploration;
  route: Route | null = null;
  tracking: Tracking = newTracking();
  leg = 0;
  settled = 0;
  actionTicks = 0;
  best = Infinity;
  progressTick = 0;
  riding = false;
  cleared = false;
  scoreMode: boolean;
  get score() {
    return scoreAt(
      this.maze.stage,
      this.exploration instanceof ScoreExploration ? this.exploration.collected : new Set(),
      this.tick,
      this.cleared,
    );
  }
  targetItem: number | null = null;
  target: ReturnType<Exploration['resolve']> | null = null;
  constructor(
    readonly maze: MazeFixture,
    seed = 0,
    scoreMode = false,
  ) {
    this.scoreMode = scoreMode;
    this.exploration = scoreMode ? new ScoreExploration(maze, seed) : new Exploration(maze, seed);
  }
  async init() {
    this.sim = await createSimulation();
    await this.sim.load(this.maze.stage);
    this.ball = this.sim.getBallState();
    return this;
  }
  choose(choice: string) {
    this.target = this.exploration.resolve(choice);
    this.targetItem = this.scoreMode && choice.startsWith('gem-') ? Number(choice.slice(4)) : null;
    const current = this.exploration.current;
    const target = this.target;
    const allowed = new Set([current, target.target]);
    const stage = this.scoreMode
      ? this.maze.stage
      : {
          ...this.maze.stage,
          islands: this.maze.stage.islands.filter((i) => allowed.has(i.id)),
          bridges: this.maze.stage.bridges.filter((b) => b.id === target.edge),
          elevators: [],
          items: [],
          portals: [],
        };
    const grid =
      this.exploration instanceof ScoreExploration
        ? this.exploration.grid
        : buildNavGrid(stage, { jumps: false });
    this.route = planRoute(
      grid,
      { from: worldToPage(this.ball.pos), to: target.point },
      this.scoreMode
        ? { ...DEFAULT_TUNING, goalSpeed: choice === 'finish' ? 2.5 : 0 }
        : { ...DEFAULT_TUNING, cruise: 3, bridge: 2.5, narrow: 2, goalSpeed: 0 },
    );
    if (!this.route) throw new Error('No path inside selected corridor');
    this.leg = 0;
    this.tracking = newTracking();
    this.settled = 0;
    this.actionTicks = 0;
    this.best = Infinity;
    this.progressTick = 0;
  }
  step(): {
    input: InputSample;
    result: SimStepResult;
    outcome: 'goal' | 'fell' | 'arrived' | 'stuck' | 'timeout' | null;
  } {
    if (!this.route || !this.target) throw new Error('No action');
    const leg = this.route.legs[this.leg];
    const p = worldToPage(this.ball.pos);
    const dist = Math.hypot(p[0] - this.target.point[0], p[1] - this.target.point[1]);
    const input = this.riding
      ? { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false }
      : steer(
          leg,
          this.tracking,
          this.ball.pos,
          this.ball.vel,
          DEFAULT_GAINS,
          7,
          dist < 1.8 ? 0 : Math.min(1, Math.max(0.12, dist / 30)),
        );
    const result = this.sim.step(input);
    this.ball = result.ball;
    this.tick++;
    this.actionTicks++;
    if (this.exploration instanceof ScoreExploration) {
      for (const e of result.events) {
        if (e.type === 'item') this.exploration.collected.add(e.itemId);
        if (e.type === 'island') this.exploration.current = e.islandId;
        if (e.type === 'elevator') {
          this.riding = e.phase === 'start';
          if (e.phase === 'end' && this.leg + 1 < this.route.legs.length) {
            this.leg++;
            this.tracking = newTracking();
            this.best = Infinity;
            this.progressTick = this.actionTicks;
          }
        }
      }
      this.exploration.update(this.ball, this.tick);
    }
    let outcome: 'goal' | 'fell' | 'arrived' | 'stuck' | 'timeout' | null = null;
    if (result.events.some((e) => e.type === 'fell')) outcome = 'fell';
    else if (result.events.some((e) => e.type === 'goal')) {
      outcome = 'goal';
      this.cleared = true;
    } else if (
      this.tick >= Math.min(300, this.maze.stage.timeLimitSec) * SIM_HZ ||
      this.actionTicks >= (this.scoreMode ? 300 : 30) * SIM_HZ
    )
      outcome = 'timeout';
    const q = worldToPage(this.ball.pos);
    const d = Math.hypot(q[0] - this.target.point[0], q[1] - this.target.point[1]);
    const progress = this.scoreMode ? -this.tracking.s * 20 : d;
    if (progress < this.best - 1.25) {
      this.best = progress;
      this.progressTick = this.actionTicks;
    }
    if (
      !outcome &&
      this.targetItem !== null &&
      this.exploration instanceof ScoreExploration &&
      this.exploration.collected.has(this.targetItem)
    )
      outcome = 'arrived';
    if (!outcome && !this.riding && this.actionTicks - this.progressTick >= 10 * SIM_HZ) outcome = 'stuck';
    if (
      (this.target.edge !== null || this.scoreMode) &&
      d < 1.8 &&
      Math.hypot(this.ball.vel[0], this.ball.vel[2]) <= 0.1 &&
      this.ball.grounded
    )
      this.settled++;
    else this.settled = 0;
    if (!outcome && this.settled >= Math.ceil(0.2 * SIM_HZ)) {
      outcome = 'arrived';
      if (!this.scoreMode) this.exploration.arrive(this.target.target, this.target.edge);
    }
    return { input, result, outcome };
  }
  dispose() {
    this.sim?.dispose();
  }
}
