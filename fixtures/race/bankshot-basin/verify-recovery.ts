/** Isolated continuation test: start on the catch; does not claim a complete competitive run. */
import { readFile, writeFile } from 'node:fs/promises';
import { createRaceSimulation, type RaceCourse } from '../../../packages/race/src/index.ts';
import { createMazePolicy, type MazeWaypoint } from '../../../scripts/race-maze-policy.ts';

const dir = import.meta.dirname;
const course: RaceCourse = JSON.parse(await readFile(`${dir}/course.json`, 'utf8'));
const spec = JSON.parse(await readFile(`${dir}/maze.json`, 'utf8'));
const ids = Object.keys(spec.nodes);
const id = (label: string) => ids.indexOf(label);
const center = (label: string) => course.stage.islands[id(label)].restartPoints[0];
const points: MazeWaypoint[] = [];
const put = (label: string, p: readonly number[]) =>
  points.push({ id: label, x: p[0], z: p[1], radius: 0.7 });
put('R', center('R'));
for (const [a, b] of [
  ['R', 'Q'],
  ['Q', 'D'],
]) {
  const bridge = course.stage.bridges.find((edge) => edge.from === id(a) && edge.to === id(b));
  if (!bridge) throw new Error(`Missing recovery edge ${a} ${b}`);
  put(`${a}-exit`, bridge.a);
  if (bridge.control)
    for (let t = 0.1; t < 1; t += 0.1)
      put(`${a}-curve-${t}`, [
        (1 - t) ** 2 * bridge.a[0] + 2 * (1 - t) * t * bridge.control[0] + t * t * bridge.b[0],
        (1 - t) ** 2 * bridge.a[1] + 2 * (1 - t) * t * bridge.control[1] + t * t * bridge.b[1],
      ]);
  put(`${b}-entry`, bridge.b);
  put(b, center(b));
}
const routes = JSON.parse(await readFile(`${dir}/route-points.json`, 'utf8'));
const ground = routes.routes[0].points as MazeWaypoint[];
points.push(...ground.slice(ground.findIndex((p) => p.id === 'D') + 1));
const simulation = await createRaceSimulation(course);
await simulation.load(course.stage);
simulation.reset(center('R'));
const policy = createMazePolicy({ id: 'catch-continuation', points, targetSpeed: 8 });
const initial = simulation.getBallState();
if (Math.abs(initial.pos[1] - 8.5) > 0.03)
  throw new Error(`Catch reset selected wrong level: ${initial.pos[1]}`);
let ticks = 0;
try {
  for (ticks = 1; ticks <= 15000; ticks++) {
    const ball = simulation.getBallState();
    const input = policy({ tick: ticks, ball, mechanics: simulation.getMechanics() });
    const step = simulation.step(input);
    if (step.events.some((event) => event.type === 'fell' || event.type === 'lost'))
      throw new Error(`Recovery fell at ${ticks}`);
    if (Math.hypot(step.ball.pos[0] - center('F')[0] / 13.5, step.ball.pos[2] - center('F')[1] / 13.5) < 0.8)
      break;
  }
  if (ticks > 15000) throw new Error('Recovery did not reach finish');
  await writeFile(
    `${dir}/recovery-validation.json`,
    JSON.stringify(
      {
        courseId: course.courseId,
        initial,
        seconds: ticks / 120,
        noFalls: true,
        method:
          'Explicit reset onto lower catch R, then ordinary bounded inputs through R-Q-D-G3-E-F. This verifies catch respawn elevation and continuation, not the missed-jump interception or full competitive gate history.',
      },
      null,
      2,
    ),
  );
  console.log(`Recovery continuation ${(ticks / 120).toFixed(3)}s; reset y=${initial.pos[1]}; no falls`);
} finally {
  simulation.dispose();
}
