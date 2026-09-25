/**
 * `solveStage`: plays a stage headlessly with the real physics (`createSimulation`, deterministic) through the
 * InputSample channel, up to K attempts with different controller settings. Handles the contract restart
 * flow exactly like `runInputs` (on 'lost' → reset(restartAt) after the step), so the recorded inputs replay
 * to the same result (ghost runs).
 */
import {
  type InputSample,
  NUM_BALLS,
  SIM_HZ,
  type SimEvent,
  type Simulation,
  type StageData,
  type Vec2,
} from '@wwm/schema';
import { pxToMeters, worldToPage } from '@wwm/schema/space';
import { diagnoseNoRoute, type SolveFailure } from './diagnose.ts';
import { buildNavGrid, cellOf, type NavGrid, surfaceAt } from './nav.ts';
import { DEFAULT_GAINS, NEUTRAL, newTracking, type PilotGains, steer, type Tracking } from './pilot.ts';
import {
  DEFAULT_TUNING,
  JUMP_TAKEOFF_SPEED,
  type Leg,
  type PlanTuning,
  planRoute,
  type Route,
} from './plan.ts';

export type { FailureKind, SolveFailure } from './diagnose.ts';

export interface SolveAttempt {
  variant: string;
  success: boolean;
  timeSec: number;
  falls: number;
  ticks: number;
  replans: number;
  /** Jump presses used for recovery. */
  jumps: number;
  failure?: SolveFailure;
  cpuMs: number;
}

export interface SolveResult {
  success: boolean;
  /** Sim time from the first tick to the goal (s), including time lost to falls. */
  timeSec: number;
  falls: number;
  /** JUMP presses the winning run needed (planned jumps over necks + recovery jumps). */
  jumps: number;
  /** The winning attempt's inputs (or the last attempt's, if none succeeded). Replayable with `runInputs`. */
  inputs: InputSample[];
  failure?: SolveFailure;
  attempts: SolveAttempt[];
  /** Winning attempt's variant name. */
  variant: string;
  /** Route length of the initial plan (m); items collected; the ball's trace (stage px, every 0.25 s). */
  routeM: number;
  items: number;
  trace: Vec2[];
  fallsAt: Vec2[];
  cpuMs: number;
}

export interface SolveVariant {
  name: string;
  tuning?: Partial<PlanTuning>;
  gains?: Partial<PilotGains>;
}

/** Attempt settings, tried in order (N: chosen by tuning on the eval set). */
export const DEFAULT_VARIANTS: readonly SolveVariant[] = [
  { name: 'normal' },
  { name: 'careful', tuning: { cruise: 4.5, bridge: 4, corner90: 1.8, brake: 5, narrow: 2.2 } },
  { name: 'crawl', tuning: { cruise: 3, bridge: 2.6, corner90: 1.3, brake: 4, narrow: 1.6, clearWeight: 5 } },
];

/** Clearance relaxation (px) for the squeeze attempt, and its (slow) settings. */
export const SQUEEZE_PX = 1.5;
export const SQUEEZE_VARIANT: SolveVariant = {
  name: 'squeeze',
  tuning: { cruise: 3.5, bridge: 3, corner90: 1.4, brake: 4, narrow: 1.4 },
};

export interface SolveOptions {
  /** Reuse a simulation (it is re-`load`ed). Default: a new headless `createSimulation()`. */
  sim?: Simulation;
  variants?: readonly SolveVariant[];
  /** Give up after this much sim time per attempt (s). */
  maxSimSec?: number;
  /** Stop at the first attempt that reaches the goal without falls (default true). */
  firstClean?: boolean;
  /** Pre-built nav grid (the planner's), e.g. shared with validation. */
  grid?: NavGrid;
  /** When there's no route, retry on a grid relaxed by SQUEEZE_PX (default true). */
  squeeze?: boolean;
}

const STUCK_SEC = 2.5;
const STUCK_PROGRESS_M = 0.3;
const MAX_STUCK_SAME_SPOT = 4;
const OFF_TRACK_M = 2.2;
const MAX_REPLANS = 40;
/** Press JUMP this far (m) before the planned take-off point. */
const JUMP_TRIGGER_M = 0.25;

interface AttemptOut extends SolveAttempt {
  inputs: InputSample[];
  trace: Vec2[];
  fallsAt: Vec2[];
  items: number;
  routeM: number;
}

function toPx(pos: readonly [number, number, number]): Vec2 {
  return worldToPage(pos as [number, number, number]);
}

function nearElevator(g: NavGrid, p: Vec2, px: number): number | undefined {
  for (const portal of g.portals) {
    const c = portal.center;
    if (Math.hypot(c[0] - p[0], c[1] - p[1]) < px + portal.lenPx / 2) return portal.elevator.id;
  }
  return undefined;
}

function islandNear(g: NavGrid, p: Vec2, level?: number): { islandId: number; bridgeId?: number } {
  const s = surfaceAt(g, p, level);
  if (s.kind === 'island') return { islandId: s.islandId };
  if (s.kind === 'bridge') {
    const b = g.stage.bridges.find((x) => x.id === s.bridgeId);
    return { islandId: b ? b.from : -1, bridgeId: s.bridgeId };
  }
  return { islandId: -1 };
}

/** Classify a stuck spot. */
function classifyStuck(g: NavGrid, p: Vec2, level: number, onFinalLeg: boolean): SolveFailure {
  const where = islandNear(g, p, level);
  const elevatorId = nearElevator(g, p, 40);
  if (elevatorId !== undefined) return { kind: 'elevator-timing', at: p, ...where, elevatorId };
  if (where.bridgeId !== undefined) {
    const b = g.stage.bridges.find((x) => x.id === where.bridgeId);
    if (b?.type === 'ramp') return { kind: 'ramp-climb', at: p, ...where };
  }
  const goal = g.stage.goal;
  if (
    onFinalLeg &&
    where.islandId === goal.islandId &&
    Math.hypot(goal.pos[0] - p[0], goal.pos[1] - p[1]) < 120
  )
    return { kind: 'goal-pocket', at: p, ...where };
  const clear = g.clear[cellOf(g, p)] as number;
  if (clear < g.minClear + 5)
    return { kind: 'rail-corner', at: p, ...where, detail: `clearance ${clear.toFixed(1)} px` };
  return { kind: 'stuck', at: p, ...where };
}

function runAttempt(sim: Simulation, g: NavGrid, variant: SolveVariant, maxTicks: number): AttemptOut {
  const t0 = performance.now();
  const tuning: PlanTuning = { ...DEFAULT_TUNING, ...variant.tuning };
  const gains: PilotGains = { ...DEFAULT_GAINS, ...variant.gains };
  const stage = g.stage;
  const inputs: InputSample[] = [];
  const trace: Vec2[] = [];
  const fallsAt: Vec2[] = [];
  let falls = 0;
  let jumps = 0;
  let replans = 0;
  let items = 0;
  const done = (o: Partial<AttemptOut> & { success: boolean }, ticks: number): AttemptOut => ({
    variant: variant.name,
    timeSec: ticks / SIM_HZ,
    falls,
    ticks,
    replans,
    jumps,
    inputs,
    trace,
    fallsAt,
    items,
    routeM: firstRouteM,
    cpuMs: performance.now() - t0,
    ...o,
  });

  let route: Route | null = planRoute(g, { from: stage.start.pos }, tuning);
  const firstRouteM = route?.lengthM ?? 0;
  if (!route) return done({ success: false, failure: diagnoseNoRoute(g, stage.start.pos) }, 0);

  let legIdx = 0;
  let tr: Tracking = newTracking();
  let mode: 'walk' | 'ride' | 'fall' | 'backoff' | 'air' = 'walk';
  /** Planned jump in flight: the leg flown in the air and when it started. */
  let air: { leg: Leg; tr: Tracking; start: number } | null = null;
  let backoffUntil = 0;
  /** Jump recovery: press JUMP on this tick (after a run-up) — used from the 2nd stuck event at a spot. */
  let jumpAt = -1;
  let jumpNext = false;
  let restartAt: Vec2 | null = null;
  let bestS = 0;
  let bestTick = 0;
  const stuckSpots: { p: Vec2; n: number }[] = [];
  let lastFall: { p: Vec2; level: number; bridgeId?: number; islandId: number } | null = null;
  let lastGround: { p: Vec2; level: number } = { p: stage.start.pos, level: 0 };
  let pos: [number, number, number] = [0, 0, 0];
  let vel: [number, number, number] = [0, 0, 0];

  const resetLeg = () => {
    tr = newTracking();
    bestS = 0;
    bestTick = inputs.length;
  };
  const replan = (from: Vec2, level?: number): boolean => {
    replans++;
    const r = planRoute(g, level === undefined ? { from } : { from, level }, tuning);
    if (!r) return false;
    route = r;
    legIdx = 0;
    resetLeg();
    return true;
  };

  for (let tick = 1; tick <= maxTicks; tick++) {
    const leg = (route as Route).legs[legIdx] as Leg;
    let input: InputSample;
    if (tick === 1 || mode === 'ride' || mode === 'fall') {
      input = NEUTRAL;
    } else if (mode === 'backoff') {
      // Roll back towards the previous vertex for a moment, then retry.
      const back = leg.verts[Math.max(0, tr.seg)]?.p ?? leg.verts[0]?.p ?? stage.start.pos;
      const tmp: Leg = {
        verts: [
          { p: toPx(pos), v: 2, s: 0, label: 0, clear: 99, cap: 2, turn: 0 },
          { p: back, v: 1.5, s: 1, label: 0, clear: 99, cap: 2, turn: 0 },
        ],
        length: 1,
      };
      input = steer(tmp, newTracking(), pos, vel, gains, tuning.brake);
      if (tick >= backoffUntil) {
        mode = 'walk';
        if (jumpNext) {
          jumpAt = tick + Math.round(0.45 * SIM_HZ);
          jumpNext = false;
        }
        const here = toPx(pos);
        if (!replan(here, pos[1] - 0.5)) {
          return done({ success: false, failure: classifyStuck(g, here, pos[1], false) }, tick);
        }
      }
    } else if (mode === 'air' && air) {
      input = steer(air.leg, air.tr, pos, vel, gains, tuning.brake);
    } else {
      input = steer(leg, tr, pos, vel, gains, tuning.brake);
      const j = leg.jump;
      if (j && tr.toEnd < JUMP_TRIGGER_M) {
        // Planned jump over a neck narrower than the ball: take off and fly to the landing point.
        const d = Math.hypot(j.to[0] - j.from[0], j.to[1] - j.from[1]) || 1;
        const land: Vec2 = [
          j.to[0] + ((j.to[0] - j.from[0]) / d) * 10,
          j.to[1] + ((j.to[1] - j.from[1]) / d) * 10,
        ];
        const len = pxToMeters(d + 10);
        air = {
          leg: {
            verts: [
              {
                p: j.from,
                v: JUMP_TAKEOFF_SPEED,
                s: 0,
                label: 0,
                clear: 99,
                cap: JUMP_TAKEOFF_SPEED,
                turn: 0,
              },
              { p: land, v: 1.5, s: len, label: 0, clear: 99, cap: JUMP_TAKEOFF_SPEED, turn: 0 },
            ],
            length: len,
          },
          tr: newTracking(),
          start: tick,
        };
        mode = 'air';
        input = { ...steer(air.leg, air.tr, pos, vel, gains, tuning.brake), jump: true };
        jumps++;
      } else if (tick === jumpAt) {
        input = { ...input, jump: true };
        jumps++;
      }
    }
    inputs.push(input);
    const r = sim.step(input);
    pos = r.ball.pos;
    vel = r.ball.vel;
    if (tick % 30 === 0) trace.push(toPx(pos));
    if (r.ball.grounded && mode === 'walk') lastGround = { p: toPx(pos), level: pos[1] };

    let goal = false;
    let lost = false;
    for (const e of r.events as SimEvent[]) {
      switch (e.type) {
        case 'goal':
          goal = true;
          break;
        case 'item':
          items++;
          break;
        case 'fell': {
          falls++;
          mode = 'fall';
          restartAt = e.restartAt;
          const where = islandNear(g, lastGround.p, lastGround.level);
          lastFall = { p: lastGround.p, level: lastGround.level, ...where };
          fallsAt.push(lastGround.p);
          break;
        }
        case 'lost':
          lost = true;
          break;
        case 'elevator':
          if (e.phase === 'start') {
            mode = 'ride';
          } else {
            mode = 'walk';
            const planned = leg.elevator?.portal.elevator.id === e.elevatorId;
            if (planned && legIdx + 1 < (route as Route).legs.length) {
              legIdx++;
              resetLeg();
            } else {
              // An unplanned ride: plan again from the platform.
              const here = toPx(pos);
              if (!replan(here, pos[1] - 0.5))
                return done({ success: false, failure: classifyStuck(g, here, pos[1], false) }, tick);
            }
          }
          break;
        default:
          break;
      }
    }
    if (goal) return done({ success: true }, tick);
    if (lost) {
      sim.reset(restartAt ?? stage.start.pos); // the contract restart flow (same as runInputs)
      if (falls > NUM_BALLS) {
        const f = lastFall as NonNullable<typeof lastFall>;
        const elevatorId = nearElevator(g, f.p, 30);
        const kind =
          elevatorId !== undefined
            ? 'elevator-timing'
            : f.bridgeId !== undefined
              ? 'bridge-fall'
              : 'edge-fall';
        return done(
          {
            success: false,
            failure: {
              kind,
              at: f.p,
              islandId: f.islandId,
              ...(f.bridgeId !== undefined ? { bridgeId: f.bridgeId } : {}),
              ...(elevatorId !== undefined ? { elevatorId } : {}),
              detail: `${falls} falls`,
            },
          },
          tick,
        );
      }
      mode = 'walk';
      const from = restartAt ?? stage.start.pos;
      if (!replan(from)) return done({ success: false, failure: diagnoseNoRoute(g, from) }, tick);
      continue;
    }
    if (mode === 'air' && air && r.ball.grounded && tick - air.start > 0.25 * SIM_HZ) {
      mode = 'walk';
      air = null;
      if (legIdx + 1 < (route as Route).legs.length) legIdx++;
      resetLeg();
      continue;
    }
    if (mode !== 'walk') continue;

    // Leg completion without an elevator (item-tour waypoints): advance when close to the end.
    const curLeg = (route as Route).legs[legIdx] as Leg;
    if (!curLeg.elevator && !curLeg.jump && legIdx + 1 < (route as Route).legs.length && tr.toEnd < 0.8) {
      legIdx++;
      resetLeg();
      continue;
    }

    // Progress / stuck detection.
    if (tr.s > bestS + STUCK_PROGRESS_M) {
      bestS = tr.s;
      bestTick = tick;
    }
    const offTrack = tr.cross > OFF_TRACK_M && r.ball.grounded;
    const stuck = tick - bestTick > STUCK_SEC * SIM_HZ;
    if (offTrack || stuck) {
      const here = toPx(pos);
      if (replans >= MAX_REPLANS)
        return done(
          {
            success: false,
            failure: classifyStuck(g, here, pos[1], legIdx === (route as Route).legs.length - 1),
          },
          tick,
        );
      if (stuck) {
        let spot = stuckSpots.find((s) => Math.hypot(s.p[0] - here[0], s.p[1] - here[1]) < 40);
        if (!spot) {
          spot = { p: here, n: 0 };
          stuckSpots.push(spot);
        }
        spot.n++;
        if (spot.n >= MAX_STUCK_SAME_SPOT) {
          const onFinal = legIdx === (route as Route).legs.length - 1;
          return done({ success: false, failure: classifyStuck(g, here, pos[1] - 0.5, onFinal) }, tick);
        }
        mode = 'backoff';
        backoffUntil = tick + Math.round(0.6 * SIM_HZ);
        jumpNext = spot.n >= 2; // the 2nd and later tries at the same spot: run up and jump over the snag
        bestTick = tick;
        continue;
      }
      if (!replan(here, pos[1] - 0.5)) {
        return done({ success: false, failure: classifyStuck(g, here, pos[1] - 0.5, false) }, tick);
      }
    }
  }
  const here = toPx(pos);
  return done(
    {
      success: false,
      failure: { kind: 'timeout', at: here, ...islandNear(g, here), detail: `> ${maxTicks / SIM_HZ} s` },
    },
    maxTicks,
  );
}

let simFactory: (() => Promise<Simulation>) | null = null;
/** Inject the simulation factory (tests; defaults to @wwm/physics `createSimulation`). */
export function setSimulationFactory(f: (() => Promise<Simulation>) | null): void {
  simFactory = f;
}
async function newSim(): Promise<Simulation> {
  if (simFactory) return simFactory();
  const { createSimulation } = await import('@wwm/physics');
  return createSimulation();
}

export async function solveStage(stage: StageData, opts: SolveOptions = {}): Promise<SolveResult> {
  const t0 = performance.now();
  const sim = opts.sim ?? (await newSim());
  const g = opts.grid ?? buildNavGrid(stage);
  const maxTicks = Math.round((opts.maxSimSec ?? 240) * SIM_HZ);
  const attempts: AttemptOut[] = [];
  // Grid ladder. When the strict grid finds no route, the physics is the judge: retry with looser elevator
  // boarding ground, then with clearance relaxed by SQUEEZE_PX (rails are thin, the contact solver has slack).
  const ladder: { grid: () => NavGrid; variants: readonly SolveVariant[] }[] = [
    { grid: () => g, variants: opts.variants ?? DEFAULT_VARIANTS },
  ];
  if (opts.squeeze !== false) {
    ladder.push({
      grid: () => buildNavGrid(stage, { minClear: g.minClear, cell: g.cell, loosePortals: true }),
      variants: opts.variants ?? DEFAULT_VARIANTS,
    });
    ladder.push({
      grid: () =>
        buildNavGrid(stage, { minClear: g.minClear - SQUEEZE_PX, cell: g.cell, loosePortals: true }),
      variants: [SQUEEZE_VARIANT],
    });
  }
  let strictNoRoute: SolveFailure | undefined;
  try {
    rungs: for (const [k, rung] of ladder.entries()) {
      const grid = rung.grid();
      for (const v of rung.variants) {
        await sim.load(stage);
        const a = runAttempt(sim, grid, v, maxTicks);
        if (k > 0) a.variant = `${a.variant}/${k === 1 ? 'loose' : 'relaxed'}`;
        attempts.push(a);
        if (a.success && a.falls === 0 && opts.firstClean !== false) break rungs;
        if (!a.success && a.ticks === 0) {
          if (k === 0) strictNoRoute = a.failure;
          continue rungs; // no route on this grid: the variants don't matter
        }
      }
      if (attempts.some((a) => a.success) || strictNoRoute === undefined) break;
    }
  } finally {
    if (!opts.sim) sim.dispose();
  }
  const ok = attempts.filter((a) => a.success);
  ok.sort((a, b) => a.falls - b.falls || a.timeSec - b.timeSec);
  const best = ok[0] ?? (attempts[attempts.length - 1] as AttemptOut);
  // If nothing worked and the strict planner saw no route, its geometric diagnosis is the root cause.
  if (!best.success && strictNoRoute) best.failure = strictNoRoute;
  const summary: SolveAttempt[] = attempts.map((a) => ({
    variant: a.variant,
    success: a.success,
    timeSec: a.timeSec,
    falls: a.falls,
    ticks: a.ticks,
    replans: a.replans,
    jumps: a.jumps,
    cpuMs: a.cpuMs,
    ...(a.failure ? { failure: a.failure } : {}),
  }));
  // The most informative failure: the first attempt's (normal settings) unless a later one got further.
  const failure = best.success ? undefined : (strictNoRoute ?? pickFailure(attempts));
  return {
    success: best.success,
    timeSec: best.timeSec,
    falls: best.falls,
    jumps: best.jumps,
    inputs: best.inputs,
    ...(failure ? { failure } : {}),
    attempts: summary,
    variant: best.variant,
    routeM: best.routeM,
    items: best.items,
    trace: best.trace,
    fallsAt: best.fallsAt,
    cpuMs: performance.now() - t0,
  };
}

function pickFailure(attempts: AttemptOut[]): SolveFailure | undefined {
  const withF = attempts.filter((a) => a.failure);
  if (withF.length === 0) return undefined;
  // Prefer a non-timeout classification.
  return (withF.find((a) => a.failure?.kind !== 'timeout') ?? withF[0])?.failure;
}
