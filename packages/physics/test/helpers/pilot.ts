/**
 * Minimal waypoint pilot used ONLY to author fixture replays and drive tests (the real solver is Phase 09).
 * It steers like a keyboard player with a chase camera: `frameYaw` = heading towards the next waypoint,
 * POWER held, tilt limited to ±KEYBOARD_TILT, a P-controller on the velocity error.
 */
import {
  type InputSample,
  KEYBOARD_TILT,
  SIM_HZ,
  type Simulation,
  type StageData,
  type Vec2,
} from '@wwm/schema';
import { pxToMeters } from '@wwm/schema/space';
import type { TickedEvent } from '../../src/replay.ts';

export interface PilotOptions {
  maxTicks?: number;
  /** Target cruise speed (m/s). */
  cruise?: number;
  /** Waypoint capture radius (m). */
  reach?: number;
  /** Skip a waypoint after this long without getting closer (s); covers lead points behind a rail. */
  stallSec?: number;
}

export interface PilotRun {
  inputs: InputSample[];
  events: TickedEvent[];
  goalTick: number;
}

const clamp = (v: number, l: number) => Math.max(-l, Math.min(l, v));

/** Drive `sim` (already loaded with `stage`) through `waypoints` (stage px) until the goal event. */
export function flyWaypoints(
  sim: Simulation,
  stage: StageData,
  waypoints: Vec2[],
  opts: PilotOptions = {},
): PilotRun {
  const maxTicks = opts.maxTicks ?? 120 * SIM_HZ;
  const cruise = opts.cruise ?? 4;
  const reach = opts.reach ?? 0.6;
  const wps = [...waypoints, stage.goal.pos];
  const inputs: InputSample[] = [];
  const events: TickedEvent[] = [];
  let wi = 0;
  let best = Number.POSITIVE_INFINITY;
  let bestTick = 0;
  const stallTicks = (opts.stallSec ?? 1.5) * SIM_HZ;
  let pos: [number, number, number] = [0, 0, 0];
  let vel: [number, number, number] = [0, 0, 0];
  let yaw = 0;
  // Prime the state with a neutral tick.
  for (let tick = 1; tick <= maxTicks; tick++) {
    let input: InputSample;
    if (tick === 1) {
      input = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
    } else {
      const wp = wps[Math.min(wi, wps.length - 1)] as Vec2;
      const tx = pxToMeters(wp[0]);
      const tz = pxToMeters(wp[1]);
      const dx = tx - pos[0];
      const dz = tz - pos[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < best - 0.05) {
        best = dist;
        bestTick = tick;
      }
      if ((dist < reach || tick - bestTick > stallTicks) && wi < wps.length - 1) {
        wi++;
        best = Number.POSITIVE_INFINITY;
        bestTick = tick;
      }
      if (dist > 0.05) yaw = Math.atan2(-dx, -dz); // forward = (−sin ψ, 0, −cos ψ) points at the waypoint
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const isLast = wi === wps.length - 1;
      const vDes = Math.min(cruise, (isLast ? 1.2 : 2.0) * dist + (isLast ? 0 : 1.5));
      const vf = vel[0] * fx + vel[2] * fz;
      const vr = vel[0] * rx + vel[2] * rz;
      input = {
        tiltZ: Number(clamp(0.12 * (vDes - vf), KEYBOARD_TILT).toFixed(4)),
        tiltX: Number(clamp(-0.15 * vr, KEYBOARD_TILT).toFixed(4)),
        frameYaw: Number(yaw.toFixed(4)),
        power: true,
        jump: false,
      };
    }
    inputs.push(input);
    const r = sim.step(input);
    pos = r.ball.pos;
    vel = r.ball.vel;
    let goal = false;
    for (const event of r.events) {
      events.push({ tick, event });
      if (event.type === 'goal') goal = true;
    }
    if (goal) return { inputs, events, goalTick: tick };
  }
  return { inputs, events, goalTick: -1 };
}
