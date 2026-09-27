/** Ordinary bounded tilt inputs only. No resets, teleports, velocity injection, or gate bypass. */
import type { RaceInputSample, RaceMechanics } from '../packages/race/src/index.ts';
import { type BallState, PX_PER_METER } from '../packages/schema/src/index.ts';

export interface MazeWaypoint {
  id?: string;
  /** Page pixels, in the same coordinates as course.stage. */
  x: number;
  z: number;
  speed?: number;
  radius?: number;
  launch?: boolean;
  turbo?: boolean;
}
export interface MazeRoute {
  id: string;
  label?: string;
  points: MazeWaypoint[];
  expectedLaunches?: number;
  targetSeconds?: number;
  targetSpeed?: number;
}
export interface MazeRoutePoints {
  schema: 'wwm.race-route-points/1';
  defaultRoute: string;
  routes: MazeRoute[];
}
export function createMazePolicy(route: MazeRoute, options: { targetSpeed?: number } = {}) {
  let waypoint = 0;
  const speedLimit = options.targetSpeed ?? route.targetSpeed ?? 10;
  const tilt = (acceleration: number) =>
    Math.asin(Math.max(-Math.sin(0.436), Math.min(Math.sin(0.436), acceleration / ((46.3 * 5) / 7))));
  return ({
    ball,
    mechanics,
  }: {
    tick: number;
    ball: BallState;
    mechanics: RaceMechanics;
  }): RaceInputSample => {
    let target = route.points[waypoint];
    if (!target) throw new Error(`Empty route ${route.id}`);
    let dx = target.x / PX_PER_METER - ball.pos[0];
    let dz = target.z / PX_PER_METER - ball.pos[2];
    if (Math.hypot(dx, dz) < (target.radius ?? 0.65) && waypoint < route.points.length - 1) {
      target = route.points[++waypoint];
      dx = target.x / PX_PER_METER - ball.pos[0];
      dz = target.z / PX_PER_METER - ball.pos[2];
    }
    const distance = Math.hypot(dx, dz) || 1;
    // Stopping distance enforces deliberate braking on small islands. Launch approach points
    // retain speed so a pad can be crossed; landing waypoints remain ordinary aim targets.
    const next = route.points[waypoint + 1];
    let cornerSpeed = 0;
    if (next) {
      const nx = next.x - target.x;
      const nz = next.z - target.z;
      const cos = (dx * nx + dz * nz) / (distance * (Math.hypot(nx, nz) || 1));
      cornerSpeed = cos > 0.98 ? speedLimit : cos > 0.5 ? 2 : 0;
    }
    const requested = target.speed ?? speedLimit;
    const speed = target.launch ? requested : Math.min(requested, Math.sqrt(cornerSpeed ** 2 + 9 * distance));
    const vx = (dx / distance) * speed;
    const vz = (dz / distance) * speed;
    return {
      tiltX: tilt(4 * (vx - ball.vel[0]) + 1.2 * vx),
      tiltZ: tilt(-4 * (vz - ball.vel[2]) - 1.2 * vz),
      frameYaw: 0,
      power: true,
      jump: false,
      turbo: !!target.turbo && mechanics.ready,
    };
  };
}
