import { existsSync } from 'node:fs';
/** Real Rapier course traversal and independent exact input replay. */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  validateGates,
} from '../packages/race/src/index.ts';
import { createMazePolicy, type MazeRoute, type MazeRoutePoints } from './race-maze-policy.ts';

const root = resolve(import.meta.dirname, '..');
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const requestedSlug = arg('--slug');
const requestedRoute = arg('--route');
const proofId = arg('--proof-id');
const speed = arg('--speed') ? Number(arg('--speed')) : undefined;
const maxTicks = Number(arg('--max-ticks') ?? 18000);
const fixtures = resolve(root, 'fixtures/race');
const slugs = requestedSlug
  ? [requestedSlug]
  : (await readdir(fixtures, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(resolve(fixtures, entry.name, 'course.json')) &&
          !['flow-sprint', 'switchback', 'longline', 'island-leap'].includes(entry.name),
      )
      .map((entry) => entry.name);

async function verify(course: RaceCourse, route: MazeRoute, dir: string) {
  const errors = validateGates(course.gates);
  if (errors.length) throw new Error(errors.join('; '));
  const simulation = await createRaceSimulation(course);
  const policy = createMazePolicy(route, { targetSpeed: speed, elevation: !!course.physicsProfile });
  let progress = createProgress();
  const recorder = new RaceRecorder(undefined, true);
  const inputs: RaceInputSample[] = [];
  const ticks: number[][] = [];
  const events: unknown[] = [];
  let maxChargeTicks = 0;
  const chargingTicks: Record<string, number> = {};
  await simulation.load(course.stage);
  try {
    for (let tick = 1; tick <= maxTicks; tick++) {
      const before = simulation.getBallState();
      const input = policy({ tick, ball: before, mechanics: simulation.getMechanics() });
      inputs.push(input);
      if (!recorder.record(input)) throw new Error('Recording truncated');
      const step = simulation.step(input);
      const mechanics = simulation.getMechanics();
      maxChargeTicks = Math.max(maxChargeTicks, mechanics.chargeTicks);
      const reason = mechanics.chargingReason ?? 'legacy';
      chargingTicks[reason] = (chargingTicks[reason] ?? 0) + 1;
      progress = advanceProgress(progress, course.gates, {
        tick,
        previous: before.pos,
        current: step.ball.pos,
        fell: step.events.some((event) => event.type === 'fell' || event.type === 'lost'),
      });
      ticks.push([...step.ball.pos, ...step.ball.vel, Number(step.ball.grounded), ...step.ball.quat]);
      if (step.events.length || mechanics.lastEvent)
        events.push({ tick, events: step.events, mechanic: mechanics.lastEvent, pos: step.ball.pos });
      if (progress.reasons.length) {
        throw new Error(
          `Invalid run at tick ${tick}: ${JSON.stringify({ progress, ball: step.ball, mechanics })}`,
        );
      }
      if (progress.finishTick !== null) break;
    }
    if (progress.finishTick === null)
      throw new Error(`No finish: ${JSON.stringify({ progress, ball: simulation.getBallState() })}`);
    const mechanics = simulation.getMechanics();
    if (
      route.expectedLaunches !== undefined &&
      (mechanics.launches !== route.expectedLaunches || mechanics.landings !== route.expectedLaunches)
    )
      throw new Error(
        `Launch/landing mismatch: expected ${route.expectedLaunches}, got ${mechanics.launches}/${mechanics.landings}`,
      );
    const attempt: RaceAttempt = {
      schema: 'wwm.race-attempt/1',
      id: `${course.courseId}-${route.id}`,
      createdAt: 0,
      compatibility: makeCompatibility(course.courseId, !!course.stunts, course.physicsProfile),
      inputSource: 'keyboard',
      outcome: 'finished',
      progress,
      recording: recorder.finish(),
    };
    const replay = await replayRace(course, attempt);
    for (let i = 0; i < ticks.length; i++)
      for (let axis = 0; axis < 3; axis++) {
        if (replay.pos[(i + 1) * 3 + axis] !== Math.fround(ticks[i][axis]))
          throw new Error(`Replay pose drift: tick ${i + 1}, axis ${axis}`);
      }
    for (let i = 0; i < ticks.length; i++)
      for (let axis = 0; axis < 4; axis++) {
        if (replay.quat[(i + 1) * 4 + axis] !== Math.fround(ticks[i][7 + axis]))
          throw new Error(`Replay rotation drift: tick ${i + 1}, axis ${axis}`);
      }
    if (JSON.stringify(replay.progress) !== JSON.stringify(progress))
      throw new Error('Replay progress mismatch');
    const seconds = progress.finishTick / 120;
    const report = {
      courseId: course.courseId,
      compatibility: attempt.compatibility,
      route: route.id,
      seconds,
      targetWindowSeconds: [55, 65],
      withinTargetWindow: seconds >= 55 && seconds <= 65,
      progress,
      mechanics,
      maxChargeTicks,
      chargingTicks,
      replayVerified: true,
      verifiedTicks: ticks.length,
      controller: { targetSpeed: speed ?? route.targetSpeed ?? 10 },
      events,
      method:
        'Ordinary bounded tilt, power and optional turbo inputs through real fixed-step Rapier; ordered gates, no falls or recovery, exact float32 pose and progress replay in a second simulation. Scripted feasibility, not human difficulty or optimal-route evidence.',
    };
    await mkdir(dir, { recursive: true });
    await writeFile(
      resolve(dir, `${route.id}-inputs.json`),
      JSON.stringify({ courseId: course.courseId, inputs }),
    );
    await writeFile(
      resolve(dir, `${route.id}-trace.json`),
      JSON.stringify({
        courseId: course.courseId,
        columns: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'grounded', 'qx', 'qy', 'qz', 'qw'],
        ticks,
      }),
    );
    await writeFile(resolve(dir, `${route.id}-validation.json`), JSON.stringify(report, null, 2));
    console.log(
      `${course.title} / ${route.id}: ${seconds.toFixed(3)}s; ${mechanics.launches} launches, exact replay verified`,
    );
    return report;
  } finally {
    simulation.dispose();
  }
}
for (const slug of slugs) {
  const dir = resolve(fixtures, slug);
  const course: RaceCourse = JSON.parse(await readFile(resolve(dir, 'course.json'), 'utf8'));
  const data: MazeRoutePoints = JSON.parse(await readFile(resolve(dir, 'route-points.json'), 'utf8'));
  const routes = requestedRoute ? data.routes.filter((route) => route.id === requestedRoute) : data.routes;
  if (!routes.length) throw new Error(`No matching routes in ${slug}`);
  const reports = [];
  for (const route of routes)
    reports.push(
      await verify(
        course,
        proofId
          ? {
              ...route,
              id: proofId,
              points: route.points.map((p) => (p.launch ? p : { ...p, speed: speed ?? p.speed })),
            }
          : route,
        dir,
      ),
    );
  if (proofId) continue;
  await writeFile(
    resolve(dir, 'race-validation.json'),
    JSON.stringify(
      {
        courseId: course.courseId,
        compatibility: makeCompatibility(course.courseId, !!course.stunts, course.physicsProfile),
        routes: reports,
      },
      null,
      2,
    ),
  );
}
