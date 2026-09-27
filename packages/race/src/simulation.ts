import { createSimulation, type LockableSimulation, type RapierSimulation } from '@wwm/physics';
import {
  type BallState,
  pointInPolygon,
  SIM_HZ,
  type SimLoadOptions,
  type SimStepResult,
  type StageData,
  type Vec2,
} from '@wwm/schema';
import { pageToWorld, worldToPage } from '@wwm/schema/space';
import { advanceProgress, createProgress, validateGates } from './progress.ts';
import type {
  RaceCourse,
  RaceGate,
  RaceInputSample,
  RaceMechanics,
  RaceProgress,
  RaceStunts,
} from './types.ts';

/** Reject untrusted authored parameters before allocating Rapier or a replay track. */
export function validateStunts(course: RaceCourse): string[] {
  const s = course.stunts;
  if (s === undefined) return [];
  const errors: string[] = [];
  if (!s || typeof s !== 'object') return ['Invalid stunts'];
  const range = (x: number, low: number, high: number) => Number.isFinite(x) && x >= low && x <= high;
  if (
    s.version !== 1 ||
    !range(s.cruiseSpeed, 1, 40) ||
    !Number.isInteger(s.chargeTicks) ||
    !range(s.chargeTicks, 1, 1200) ||
    !range(s.turboDeltaV, 0.1, 30) ||
    !range(s.turboMaxSpeed, s.cruiseSpeed, 60) ||
    !range(s.landingDeltaV, 0, 10)
  )
    errors.push('Invalid stunt tuning');
  if (!Array.isArray(s.launchPads) || s.launchPads.length > 64) return [...errors, 'Invalid launch pads'];
  const ids = new Set<string>();
  const islands = new Set(course.stage.islands.map((i) => i.id));
  for (const pad of s.launchPads) {
    if (!pad || typeof pad !== 'object') {
      errors.push('Invalid launch pad');
      continue;
    }
    if (typeof pad.id !== 'string' || !pad.id.length || ids.has(pad.id)) errors.push('Invalid launch pad id');
    ids.add(pad.id);
    if (!range(pad.upSpeed, 1, 40) || !range(pad.minSpeed, 0, 40)) errors.push('Invalid launch speed');
    const g = pad.gate;
    if (
      !g ||
      !Array.isArray(g.center) ||
      g.center.length !== 3 ||
      !Array.isArray(g.normal) ||
      g.normal.length !== 2
    )
      errors.push('Invalid launch gate');
    else if (validateGates([{ ...g, kind: 'finish' }]).length || !range(g.halfHeight, 0.1, 3))
      errors.push('Invalid launch gate geometry');
    if (
      !Array.isArray(pad.landingIslandIds) ||
      !pad.landingIslandIds.length ||
      pad.landingIslandIds.length > 64 ||
      new Set(pad.landingIslandIds).size !== pad.landingIslandIds.length ||
      !pad.landingIslandIds.every((id) => Number.isInteger(id) && islands.has(id))
    )
      errors.push('Invalid landing islands');
  }
  return errors;
}
export interface RaceSimulation extends LockableSimulation {
  step(input: RaceInputSample): SimStepResult;
  getBallState(): BallState;
  getMechanics(): RaceMechanics;
  /** Charge the same penalty as falling; reset itself never charges twice. */
  penalizeRecovery(): void;
}
const empty = (s?: RaceStunts): RaceMechanics => ({
  enabled: !!s,
  chargeTicks: 0,
  chargeRequired: s?.chargeTicks ?? 0,
  ready: false,
  turboCharges: 0,
  lives: 3,
  maxLives: 3,
  exhausted: false,
  turboTicks: 0,
  launches: 0,
  landings: 0,
  lastEvent: null,
});

class StuntSimulation implements RaceSimulation {
  private mechanics: RaceMechanics;
  private progress: RaceProgress = createProgress();
  private used = new Set<string>();
  private previousTurbo = false;
  private fallPenalized = false;
  private flight: {
    pad: RaceStunts['launchPads'][number];
    origin: number | undefined;
    start: BallState['pos'];
    airTicks: number;
  } | null = null;
  private course: RaceCourse;
  private sim: RapierSimulation;
  constructor(course: RaceCourse, sim: RapierSimulation) {
    this.course = course;
    this.sim = sim;
    this.mechanics = empty(course.stunts);
  }
  async load(stage: StageData, options?: SimLoadOptions): Promise<void> {
    if (stage !== this.course.stage && JSON.stringify(stage) !== JSON.stringify(this.course.stage))
      throw new Error('Race simulation stage does not match course');
    await this.sim.load(stage, options);
    this.mechanics = empty(this.course.stunts);
    this.progress = createProgress();
    this.used.clear();
    this.previousTurbo = false;
    this.fallPenalized = false;
    this.flight = null;
  }
  reset(to?: Vec2): void {
    if (this.mechanics.exhausted) throw new Error('Race has no lives remaining');
    this.sim.reset(to);
    this.mechanics = { ...this.mechanics, chargeTicks: 0, turboTicks: 0, lastEvent: null };
    this.fallPenalized = false;
    this.flight = null;
    // Retain earned turbos, lives, and launch consumption: recovery is not a new run.
    this.previousTurbo = false;
  }
  penalizeRecovery(): void {
    if (this.fallPenalized || this.mechanics.exhausted) return;
    this.fallPenalized = true;
    const m = this.mechanics;
    m.turboCharges = Math.max(0, m.turboCharges - 1);
    m.lives = Math.max(0, m.lives - 1);
    m.exhausted = m.lives === 0;
    m.chargeTicks = 0;
    m.ready = m.turboCharges > 0;
    m.turboTicks = 0;
    m.lastEvent = m.exhausted ? 'out-of-lives' : 'fall';
    this.flight = null;
  }
  setLock(id: number, open: boolean): void {
    this.sim.setLock(id, open);
  }
  getBallState(): BallState {
    return this.sim.getBallState();
  }
  getMechanics(): RaceMechanics {
    return { ...this.mechanics };
  }
  dispose(): void {
    this.sim.dispose();
  }
  private island(ball: BallState): number | undefined {
    const p = worldToPage(ball.pos);
    return this.course.stage.islands.find(
      (i) =>
        Math.abs(ball.pos[1] - pageToWorld([0, 0], i.level)[1] - this.sim.params.ballRadius) < 0.3 &&
        pointInPolygon(p, i.contour, i.holes),
    )?.id;
  }
  private boost(amount: number, max: number, heading?: number): boolean {
    const b = this.sim.getBallState();
    const speed = Math.hypot(b.vel[0], b.vel[2]);
    if (speed >= max || (speed < 0.1 && heading === undefined)) return false;
    const dv = Math.min(amount, max - speed);
    const direction =
      speed >= 0.1
        ? [b.vel[0] / speed, b.vel[2] / speed]
        : [-Math.sin(heading ?? 0), -Math.cos(heading ?? 0)];
    this.sim.applyVelocityDelta([direction[0] * dv, 0, direction[1] * dv]);
    return true;
  }
  step(input: RaceInputSample): SimStepResult {
    const s = this.course.stunts;
    const m = this.mechanics;
    if (m.exhausted) return { ball: this.sim.getBallState(), events: [], elevators: [] };
    m.lastEvent = null;
    if (m.turboTicks > 0) m.turboTicks--;
    if (
      s &&
      !this.fallPenalized &&
      input.turbo &&
      !this.previousTurbo &&
      m.turboCharges > 0 &&
      this.boost(s.turboDeltaV, s.turboMaxSpeed, input.frameYaw)
    ) {
      m.turboCharges--;
      m.ready = m.turboCharges > 0;
      m.turboTicks = SIM_HZ;
      m.lastEvent = 'turbo';
    }
    this.previousTurbo = !!input.turbo;
    const previous = this.sim.getBallState();
    const result = this.sim.step(input);
    const b = result.ball;
    const speed = Math.hypot(b.vel[0], b.vel[2]);
    const fell = result.events.some((e) => e.type === 'fell' || e.type === 'lost');
    const bump = result.events.some((e) => e.type === 'bump' && e.impact >= 3);
    if (fell) {
      this.penalizeRecovery();
      m.chargeTicks = 0;
      m.ready = m.turboCharges > 0;
      m.turboTicks = 0;
      m.lastEvent = m.exhausted ? 'out-of-lives' : 'fall';
      this.flight = null;
    }
    // Full-speed flow can continue through corners. Each uninterrupted three-second
    // segment earns another stored turbo, including fast airborne travel.
    if (s && !this.fallPenalized) {
      if (speed + 0.00001 < s.cruiseSpeed) m.chargeTicks = 0;
      else {
        m.chargeTicks++;
        if (m.chargeTicks >= s.chargeTicks) {
          m.chargeTicks -= s.chargeTicks;
          m.turboCharges++;
          m.ready = true;
          m.lastEvent = 'charged';
        }
      }
    }
    this.progress = advanceProgress(this.progress, this.course.gates, {
      tick: this.progress.tick + 1,
      previous: previous.pos,
      current: b.pos,
      fell,
    });
    if (!s) return result;
    if (this.flight && !this.fallPenalized) {
      const flight = this.flight;
      if (!b.grounded) flight.airTicks++;
      else if (flight.airTicks > 0) {
        const id = this.island(b);
        const travel =
          (b.pos[0] - flight.start[0]) * flight.pad.gate.normal[0] +
          (b.pos[2] - flight.start[2]) * flight.pad.gate.normal[1];
        const heading =
          speed > 0.1
            ? (b.vel[0] * flight.pad.gate.normal[0] + b.vel[2] * flight.pad.gate.normal[1]) / speed
            : 0;
        if (
          !bump &&
          heading > 0.5 &&
          flight.airTicks >= Math.round(SIM_HZ * 0.15) &&
          travel >= 2 &&
          id !== undefined &&
          id !== flight.origin &&
          flight.pad.landingIslandIds.includes(id)
        ) {
          this.boost(s.landingDeltaV, s.turboMaxSpeed);
          m.landings++;
          m.lastEvent = 'landing';
        }
        // First physical landing ends provenance, including invalid landings / bridge contacts.
        this.flight = null;
      }
    }
    if (!this.fallPenalized && !this.flight && (previous.grounded || b.grounded)) {
      for (const pad of s.launchPads) {
        if (this.used.has(pad.id) || speed < pad.minSpeed || !crosses(pad.gate, previous.pos, b.pos))
          continue;
        this.used.add(pad.id);
        this.flight = { pad, origin: this.island(previous), start: [...b.pos], airTicks: 0 };
        this.sim.applyVelocityDelta([0, Math.max(0, pad.upSpeed - b.vel[1]), 0]);
        m.launches++;
        m.lastEvent = 'launch';
        break;
      }
    }
    return { ...result, ball: this.sim.getBallState() };
  }
}
function crosses(gate: RaceGate, previous: BallState['pos'], current: BallState['pos']): boolean {
  return (
    advanceProgress(createProgress(), [{ ...gate, kind: 'finish' }], { tick: 1, previous, current })
      .finishTick !== null
  );
}
export async function createRaceSimulation(course: RaceCourse): Promise<RaceSimulation> {
  const errors = validateStunts(course);
  if (errors.length) throw new Error(errors.join('; '));
  return new StuntSimulation(course, await createSimulation());
}
