/** Independent continuous-line classic driver: ordinary tilt only, no injected state or inventory. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  advanceProgress,
  createProgress,
  createRaceSimulation,
  makeCompatibility,
  type RaceCourse,
  type RaceInputSample,
} from '../packages/race/src/index.ts';
import { bridgeSections, PX_PER_METER } from '../packages/schema/src/index.ts';

let failures = 0;
for (const slug of ['flow-sprint', 'switchback', 'longline']) {
  const dir = resolve(import.meta.dirname, '../fixtures/race', slug);
  const course = JSON.parse(await readFile(resolve(dir, 'course.json'), 'utf8')) as RaceCourse;
  const points: [number, number][] = [[...course.stage.start.pos]];
  for (const bridge of course.stage.bridges) {
    points.push(
      ...bridgeSections(bridge)
        .filter((_, i) => i % 3 === 0)
        .map((s) => s.pos),
    );
    points.push(bridge.b);
    const island = course.stage.islands.find((i) => i.id === bridge.to);
    if (!island) throw new Error('missing island');
    points.push([
      island.contour.reduce((n, p) => n + p[0], 0) / island.contour.length,
      island.contour.reduce((n, p) => n + p[1], 0) / island.contour.length,
    ]);
  }
  const finish = course.gates.at(-1);
  if (!finish) throw new Error('missing finish');
  points.push([
    (finish.center[0] + finish.normal[0] * 3) * PX_PER_METER,
    (finish.center[2] + finish.normal[1] * 3) * PX_PER_METER,
  ]);
  const world = points.map((p) => p.map((v) => v / PX_PER_METER) as [number, number]);
  const distance = [0];
  for (let i = 1; i < world.length; i++)
    distance.push(distance[i - 1] + Math.hypot(world[i][0] - world[i - 1][0], world[i][1] - world[i - 1][1]));
  let best: unknown = null;
  const results = [];
  outer: for (const speed of [8.1, 9.5, 11.5, 14, 18])
    for (const lookahead of [2, 4, 6, 8]) {
      const sim = await createRaceSimulation(course);
      await sim.load(course.stage);
      let progress = createProgress(),
        along = 0,
        maxChargeTicks = 0,
        charges = 0;
      const inputs: RaceInputSample[] = [];
      const trace: number[][] = [];
      const interruptions: unknown[] = [];
      let previousChargeTicks = 0;
      for (let tick = 1; tick <= 12000; tick++) {
        const before = sim.getBallState();
        let nearest = Infinity,
          candidate = along;
        for (let i = 1; i < world.length; i++) {
          if (distance[i] < along - 1 || distance[i - 1] > along + 15) continue;
          const [ax, az] = world[i - 1],
            [bx, bz] = world[i];
          const dx = bx - ax,
            dz = bz - az,
            len2 = dx * dx + dz * dz;
          if (len2 < 1e-9) continue;
          const t = Math.max(0, Math.min(1, ((before.pos[0] - ax) * dx + (before.pos[2] - az) * dz) / len2));
          const d = Math.hypot(before.pos[0] - ax - t * dx, before.pos[2] - az - t * dz);
          if (d < nearest) {
            nearest = d;
            candidate = distance[i - 1] + t * Math.sqrt(len2);
          }
        }
        along = Math.max(along, candidate);
        const targetDistance = Math.min(distance.at(-1) as number, along + lookahead);
        let index = 1;
        while (index < distance.length - 1 && distance[index] < targetDistance) index++;
        const fraction =
          (targetDistance - distance[index - 1]) / (distance[index] - distance[index - 1] || 1);
        const dx = world[index - 1][0] + fraction * (world[index][0] - world[index - 1][0]) - before.pos[0];
        const dz = world[index - 1][1] + fraction * (world[index][1] - world[index - 1][1]) - before.pos[2];
        const d = Math.hypot(dx, dz) || 1,
          vx = (dx / d) * speed,
          vz = (dz / d) * speed;
        const horizontal = Math.hypot(before.vel[0], before.vel[2]);
        const gradeForce =
          before.grounded && horizontal > 0.5
            ? (((-46.3 * 5) / 7) * before.vel[1]) / (horizontal * horizontal + before.vel[1] * before.vel[1])
            : 0;
        const tilt = (a: number) =>
          Math.asin(Math.max(-Math.sin(0.436), Math.min(Math.sin(0.436), a / ((46.3 * 5) / 7))));
        const damping = sim.getMechanics().chargingReason === 'downhill' ? 0.04 : 1.2;
        const input: RaceInputSample = {
          tiltX: tilt(4 * (vx - before.vel[0]) + damping * vx - gradeForce * before.vel[0]),
          tiltZ: tilt(-4 * (vz - before.vel[2]) - damping * vz + gradeForce * before.vel[2]),
          frameYaw: 0,
          power: true,
          jump: false,
        };
        inputs.push(input);
        const result = sim.step(input),
          m = sim.getMechanics();
        if (m.chargeTicks === 0 && previousChargeTicks > 60 && m.chargingReason !== 'charging')
          interruptions.push({
            tick,
            previousChargeTicks,
            reason: m.chargingReason,
            pos: result.ball.pos,
            speed: Math.hypot(result.ball.vel[0], result.ball.vel[2]),
          });
        previousChargeTicks = m.chargeTicks;
        trace.push([...result.ball.pos, ...result.ball.vel, Number(result.ball.grounded)]);
        maxChargeTicks = Math.max(maxChargeTicks, m.chargeTicks);
        charges = Math.max(charges, m.turboCharges);
        progress = advanceProgress(progress, course.gates, {
          tick,
          previous: before.pos,
          current: result.ball.pos,
          fell: result.events.some((e) => e.type === 'fell' || e.type === 'lost'),
        });
        if (progress.finishTick !== null || progress.reasons.length) break;
      }
      const report = {
        speed,
        lookahead,
        progress,
        maxChargeTicks,
        charges,
        interruptions,
        mechanics: sim.getMechanics(),
      };
      results.push(report);
      sim.dispose();
      if (progress.finishTick && !progress.reasons.length && charges > 0) {
        best = report;
        await writeFile(
          resolve(dir, 'charging-probe-inputs.json'),
          JSON.stringify({ courseId: course.courseId, inputs }),
        );
        await writeFile(
          resolve(dir, 'charging-probe-trace.json'),
          JSON.stringify({ courseId: course.courseId, ticks: trace }),
        );
        break outer;
      }
    }
  await writeFile(
    resolve(dir, 'charging-probe-validation.json'),
    JSON.stringify(
      {
        courseId: course.courseId,
        compatibility: makeCompatibility(course.courseId, !!course.stunts, course.physicsProfile),
        method:
          'Ordinary bounded tilt, no turbo spending or injected state. Continuous-line lookahead driver, clean full-course finish required.',
        best,
        results,
      },
      null,
      2,
    ),
  );
  if (!best) failures++;
  console.log(
    slug,
    JSON.stringify(
      best ??
        results.map((r) => ({
          speed: r.speed,
          lookahead: r.lookahead,
          finish: r.progress.finishTick,
          fall: r.progress.reasons,
          max: r.maxChargeTicks,
          charges: r.charges,
        })),
    ),
  );
}

if (failures) throw new Error(`${failures} classic courses lack a clean timed-turbo charging run`);
