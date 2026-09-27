/**
 * Phase 22 M0 spike driver: ram a lock's gate. The ball starts `distM` metres from the gate on its island, on a
 * line at `angleDeg` to the connector axis, and is steered every tick at a point 1 m *past* the gate (on the
 * deck), with POWER held, full forward tilt (the phone maximum, 0.785 rad) and JUMP pressed every `jumpEvery`
 * seconds. It reports how far the ball ever got past the gate's island-side face.
 */
import {
  distanceToPolygonEdge,
  type InputSample,
  type LockSpec,
  MAX_TILT_PITCH,
  pointInPolygon,
  SIM_HZ,
  type SimEvent,
  type StageData,
} from '@wwm/schema';
import { worldToPage } from '@wwm/schema/space';
import { barrierPose } from '../../src/locks.ts';
import type { RapierSimulation } from '../../src/simulation.ts';

export interface RamResult {
  /** max signed distance (m) of the ball's leading surface past the gate's island-side face, along the axis */
  maxPastFace: number;
  /** max height of the ball bottom above the floor at the gate (m) */
  maxHeight: number;
  /** islands touched (ids), in order */
  islands: number[];
  locked: number;
  fell: boolean;
  /** ticks at which `locked` fired for the rammed lock */
  lockedTicks: number[];
  events: SimEvent[];
  /** fastest horizontal speed (m/s) before the first `locked` */
  approachSpeed: number;
  /** start distance used (m) */
  distM: number;
}

export interface RamOptions {
  angleDeg: number;
  /** start distance from the gate (m); shortened until the start is ≥ 1 m inside the island (default 12) */
  distM?: number;
  /** steer at a point this far past the gate (m, default 1: onto the deck) */
  targetPastM?: number;
  seconds?: number;
  jumpEvery?: number;
  /** open the lock (setLock) at this tick */
  openAtTick?: number;
}

export async function ramGate(
  sim: RapierSimulation,
  stage: StageData,
  locks: LockSpec[],
  lockId: number,
  o: RamOptions,
): Promise<RamResult> {
  const spec = locks.find((l) => l.id === lockId);
  const pose = spec && barrierPose(stage, spec, sim.params);
  if (!pose) throw new Error(`no pose for lock ${lockId}`);
  await sim.load(stage, { locks });
  const [ux, uz] = pose.dir;
  const [cx, y0, cz] = pose.center;
  const face = { x: cx - (ux * pose.thickness) / 2, z: cz - (uz * pose.thickness) / 2 };
  const a = (o.angleDeg * Math.PI) / 180;
  // approach direction rotated from the axis by `angle`
  const ax = ux * Math.cos(a) - uz * Math.sin(a);
  const az = uz * Math.cos(a) + ux * Math.sin(a);
  const island = stage.islands.find((i) => i.id === spec.islandId);
  if (!island) throw new Error('island');
  let dist = o.distM ?? 12;
  let start = worldToPage([face.x - ax * dist, 0, face.z - az * dist]);
  const inside = (p: [number, number]) =>
    pointInPolygon(p, island.contour, island.holes) &&
    distanceToPolygonEdge(p, island.contour, island.holes) >= 13.5;
  while (dist > 2 && !inside(start)) {
    dist -= 0.5;
    start = worldToPage([face.x - ax * dist, 0, face.z - az * dist]);
  }
  sim.reset(start);
  const R = sim.params.ballRadius;
  const past = o.targetPastM ?? 1;
  const target = { x: cx + ux * past, z: cz + uz * past };
  const ticks = Math.round((o.seconds ?? 6) * SIM_HZ);
  const jumpTicks = Math.max(2, Math.round((o.jumpEvery ?? 0.3) * SIM_HZ));
  const out: RamResult = {
    maxPastFace: Number.NEGATIVE_INFINITY,
    maxHeight: 0,
    islands: [],
    locked: 0,
    fell: false,
    lockedTicks: [],
    events: [],
    approachSpeed: 0,
    distM: dist,
  };
  let st = sim.getBallState();
  for (let t = 1; t <= ticks; t++) {
    if (o.openAtTick === t) sim.setLock(lockId, true);
    const dx = target.x - st.pos[0];
    const dz = target.z - st.pos[2];
    const input: InputSample = {
      tiltX: 0,
      tiltZ: MAX_TILT_PITCH,
      frameYaw: Math.atan2(-dx, -dz), // forward = (−sin ψ, −cos ψ) points at the target
      power: true,
      jump: t > SIM_HZ && t % jumpTicks < jumpTicks / 2,
    };
    const r = sim.step(input);
    st = r.ball;
    if (out.locked === 0) out.approachSpeed = Math.max(out.approachSpeed, Math.hypot(st.vel[0], st.vel[2]));
    const along = (st.pos[0] - face.x) * ux + (st.pos[2] - face.z) * uz + R;
    out.maxPastFace = Math.max(out.maxPastFace, along);
    out.maxHeight = Math.max(out.maxHeight, st.pos[1] - R - y0);
    for (const e of r.events) {
      out.events.push(e);
      if (e.type === 'island') out.islands.push(e.islandId);
      if (e.type === 'fell') out.fell = true;
      if (e.type === 'locked' && e.lockId === lockId) {
        out.locked++;
        out.lockedTicks.push(t);
      }
    }
  }
  return out;
}
