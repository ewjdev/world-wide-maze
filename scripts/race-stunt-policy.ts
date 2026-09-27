/** Shared bounded player-input driver for feasibility comparisons, never teleports or edits physics. */

import type { RaceCourse, RaceInputSample, RaceMechanics } from '../packages/race/src/index.ts';
import type { BallState } from '../packages/schema/src/index.ts';
import { PX_PER_METER } from '../packages/schema/src/index.ts';
export type Route = 'safe' | 'near' | 'far';
export function createRoutePolicy(
  _course: RaceCourse,
  route: Route,
  options: { targetSpeed?: number; turbo?: boolean } = {},
) {
  let waypoint = 0;
  let spent = false;
  const targetSpeed = options.targetSpeed ?? 11;
  const targets =
    route === 'safe'
      ? [
          [870, 290],
          [870, 465],
          [1100, 475],
          [1140, 518],
          [1195, 510],
          [1250, 525],
          [1375, 580],
          [1375, 730],
        ]
      : route === 'near'
        ? [
            [1240, 270],
            [1230, 520],
            [1375, 570],
            [1375, 730],
          ]
        : [
            [1380, 210],
            [1360, 530],
            [1375, 570],
            [1375, 730],
          ];
  return ({
    ball,
    mechanics,
  }: {
    tick: number;
    ball: BallState;
    mechanics: RaceMechanics;
  }): RaceInputSample => {
    const px = ball.pos[0] * PX_PER_METER;
    const pz = ball.pos[2] * PX_PER_METER;
    let input: RaceInputSample = { tiltX: 0, tiltZ: 0.436, frameYaw: -Math.PI / 2, power: true, jump: false };
    const cruise = route === 'safe' ? px < 670 : px < 1030;
    if (!cruise) {
      if (route === 'far' && mechanics.landings > 0 && waypoint === 0) waypoint = 1;
      let target = targets[waypoint];
      let dx = target[0] / PX_PER_METER - ball.pos[0],
        dz = target[1] / PX_PER_METER - ball.pos[2];
      if (Math.hypot(dx, dz) < 2 && waypoint < targets.length - 1) {
        waypoint++;
        target = targets[waypoint];
        dx = target[0] / PX_PER_METER - ball.pos[0];
        dz = target[1] / PX_PER_METER - ball.pos[2];
      }
      const distance = Math.hypot(dx, dz) || 1;
      const speed = Math.min(mechanics.turboTicks > 0 ? 26 : targetSpeed, distance * 2.8);
      const vx = (dx / distance) * speed,
        vz = (dz / distance) * speed;
      const ax = 4 * (vx - ball.vel[0]) + 1.2 * vx,
        az = 4 * (vz - ball.vel[2]) + 1.2 * vz;
      const tilt = (a: number) =>
        Math.asin(Math.max(-Math.sin(0.436), Math.min(Math.sin(0.436), a / ((46.3 * 5) / 7))));
      input = { tiltX: tilt(ax), tiltZ: tilt(-az), frameYaw: 0, power: true, jump: false };
    }
    const turboHere = route === 'far' ? px > 1065 && px < 1080 : pz > 575 && pz < 610;
    if (options.turbo !== false && !spent && mechanics.ready && turboHere) {
      input.turbo = true;
      spent = true;
    }
    return input;
  };
}
