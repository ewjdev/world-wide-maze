/** Prove an accessible charge window with ordinary steering, independently replayed; not a finish proof. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_PARAMS } from '../packages/physics/src/index.ts';
import {
  advanceProgress,
  createProgress,
  createRaceSimulation,
  makeCompatibility,
  type RaceAttempt,
  type RaceCourse,
  type RaceInputSample,
  RaceRecorder,
  replayRace,
} from '../packages/race/src/index.ts';
import { PX_PER_METER } from '../packages/schema/src/index.ts';

const root = resolve(import.meta.dirname, '..');
const slugs = process.argv.slice(2);
if (!slugs.length) slugs.push('hairpin-terraces', 'twin-canyons');
for (const slug of slugs) {
  const dir = resolve(root, 'fixtures/race', slug);
  const course = JSON.parse(await readFile(resolve(dir, 'course.json'), 'utf8')) as RaceCourse;
  const routes = JSON.parse(await readFile(resolve(dir, 'route-points.json'), 'utf8'));
  const points = routes.routes[0].points as { x: number; z: number }[];
  const controller = { desiredSpeed: 9.5, lookaheadMetres: 2, velocityGain: 4, dragFeedforward: 0.7 };
  const sim = await createRaceSimulation(course);
  const replay = await createRaceSimulation(course);
  await sim.load(course.stage);
  await replay.load(course.stage);
  const inputs: RaceInputSample[] = [];
  const recorder = new RaceRecorder(undefined, true);
  const poses = [sim.getBallState()];
  let progress = createProgress();
  let index = 1;
  let chargedAt: number | null = null;
  let firstDownhillTick: number | null = null;
  let maxPartial = 0;
  let minimumChargingSpeed = Infinity;
  try {
    for (let tick = 1; tick <= 4800; tick++) {
      const ball = sim.getBallState();
      while (index < points.length - 1) {
        const a = points[index - 1];
        const target = points[index];
        const ux = (target.x - a.x) / PX_PER_METER;
        const uz = (target.z - a.z) / PX_PER_METER;
        const along = (ball.pos[0] - a.x / PX_PER_METER) * ux + (ball.pos[2] - a.z / PX_PER_METER) * uz;
        if (along > ux * ux + uz * uz) index++;
        else break;
      }
      let tx = points[index].x / PX_PER_METER;
      let tz = points[index].z / PX_PER_METER;
      const previous = points[index - 1];
      const ux = tx - previous.x / PX_PER_METER;
      const uz = tz - previous.z / PX_PER_METER;
      const length = Math.hypot(ux, uz) || 1;
      const along = Math.max(
        0,
        Math.min(
          1,
          ((ball.pos[0] - previous.x / PX_PER_METER) * ux + (ball.pos[2] - previous.z / PX_PER_METER) * uz) /
            (length * length),
        ),
      );
      let x = previous.x / PX_PER_METER + ux * along;
      let z = previous.z / PX_PER_METER + uz * along;
      let remaining = controller.lookaheadMetres;
      // Smooth pursuit follows the guide continuously instead of braking at every curve sample.
      for (let j = index; j < points.length; j++) {
        const nx = points[j].x / PX_PER_METER;
        const nz = points[j].z / PX_PER_METER;
        const distance = Math.hypot(nx - x, nz - z);
        if (distance >= remaining) {
          tx = x + ((nx - x) * remaining) / distance;
          tz = z + ((nz - z) * remaining) / distance;
          break;
        }
        remaining -= distance;
        x = tx = nx;
        z = tz = nz;
      }
      const dx = tx - ball.pos[0];
      const dz = tz - ball.pos[2];
      const distance = Math.hypot(dx, dz) || 1;
      const speed = Math.hypot(ball.vel[0], ball.vel[2]);
      const rollingGravity = (DEFAULT_PARAMS.gravity * 5) / 7;
      const slopeCompensation =
        ball.grounded && speed > 0.5
          ? (-rollingGravity * ball.vel[1]) / (speed * speed + ball.vel[1] * ball.vel[1])
          : 0;
      const tilt = (acceleration: number) =>
        Math.asin(
          Math.max(
            -Math.sin(DEFAULT_PARAMS.maxTiltRoll),
            Math.min(Math.sin(DEFAULT_PARAMS.maxTiltRoll), acceleration / rollingGravity),
          ),
        );
      const vx = (dx / distance) * controller.desiredSpeed;
      const vz = (dz / distance) * controller.desiredSpeed;
      const input: RaceInputSample = {
        tiltX: tilt(
          controller.velocityGain * (vx - ball.vel[0]) +
            controller.dragFeedforward * vx -
            slopeCompensation * ball.vel[0],
        ),
        tiltZ: tilt(
          -controller.velocityGain * (vz - ball.vel[2]) -
            controller.dragFeedforward * vz +
            slopeCompensation * ball.vel[2],
        ),
        frameYaw: 0,
        power: true,
        jump: false,
        turbo: false,
      };
      inputs.push(input);
      recorder.record(input);
      const result = sim.step(input);
      const mechanics = sim.getMechanics();
      const second = replay.step(input);
      if (
        JSON.stringify(result) !== JSON.stringify(second) ||
        JSON.stringify(mechanics) !== JSON.stringify(replay.getMechanics())
      )
        throw new Error(`${slug}: independent simulation differs at tick ${tick}`);
      if (result.events.some((e) => e.type === 'fell' || e.type === 'lost'))
        throw new Error(`${slug}: charge window fell at tick ${tick}`);
      progress = advanceProgress(progress, course.gates, {
        tick,
        previous: ball.pos,
        current: result.ball.pos,
      });
      if (progress.finishTick !== null) throw new Error(`${slug}: charge-window proof unexpectedly finished`);
      poses.push(result.ball);
      if (mechanics.chargingReason === 'downhill' && firstDownhillTick === null) firstDownhillTick = tick;
      if (mechanics.chargingReason === 'charging')
        minimumChargingSpeed = Math.min(
          minimumChargingSpeed,
          Math.hypot(result.ball.vel[0], result.ball.vel[2]),
        );
      maxPartial = Math.max(maxPartial, mechanics.chargeTicks);
      if (mechanics.turboCharges > 0) {
        chargedAt = tick;
        break;
      }
    }
    if (chargedAt === null) throw new Error(`${slug}: no charge within 40 seconds`);
    if (firstDownhillTick !== null) throw new Error(`${slug}: first descent preceded charge`);
    const compatibility = makeCompatibility(course.courseId, !!course.stunts, course.physicsProfile);
    const attempt: RaceAttempt = {
      schema: 'wwm.race-attempt/1',
      id: `${slug}-charge-window`,
      createdAt: 0,
      inputSource: 'keyboard',
      outcome: 'abandoned',
      progress,
      compatibility,
      recording: recorder.finish(),
    };
    const ghost = await replayRace(course, attempt);
    for (let tick = 0; tick < poses.length; tick++) {
      if (
        JSON.stringify(Array.from(ghost.pos.slice(tick * 3, tick * 3 + 3))) !==
          JSON.stringify(poses[tick].pos.map(Math.fround)) ||
        JSON.stringify(Array.from(ghost.quat.slice(tick * 4, tick * 4 + 4))) !==
          JSON.stringify(poses[tick].quat.map(Math.fround))
      )
        throw new Error(`${slug}: ghost differs at tick ${tick}`);
    }
    await writeFile(
      resolve(dir, 'charge-window-inputs.json'),
      JSON.stringify({ courseId: course.courseId, inputs }),
    );
    await writeFile(
      resolve(dir, 'charge-window-validation.json'),
      `${JSON.stringify(
        {
          courseId: course.courseId,
          compatibility,
          controller,
          ticks: inputs.length,
          chargedAt,
          seconds: chargedAt / 120,
          firstDownhillTick,
          minimumChargingSpeed,
          maxPartial,
          mechanics: sim.getMechanics(),
          ball: sim.getBallState(),
          progress,
          independentSimulationVerified: true,
          ghostReplayVerified: true,
          evidence:
            'Ordinary bounded tilt inputs earn one turbo before the first descent. No turbo, jumps, state injection, falls or recoveries. This verifies a charge window, not a completed race or human playtesting.',
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `${slug}: charged at ${chargedAt} (${chargedAt / 120}s), both independent simulation and ghost replay exact`,
    );
  } finally {
    sim.dispose();
    replay.dispose();
  }
}
