import { readFile, writeFile } from 'node:fs/promises';
import { DEFAULT_PARAMS } from '../../../packages/physics/src/index.ts';
import { createRaceSimulation } from '../../../packages/race/src/index.ts';
import { bridgeSections, PX_PER_METER } from '../../../packages/schema/src/index.ts';

const dir = import.meta.dirname;
const course = JSON.parse(await readFile(`${dir}/course.json`, 'utf8'));
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const intersections = [];
for (const upper of course.stage.bridges.filter((b) => b.levelA === 14 && b.levelB === 14))
  for (const lower of course.stage.bridges.filter((b) => b.levelA === 10 && b.levelB === 10)) {
    const us = bridgeSections(upper),
      ls = bridgeSections(lower);
    for (let i = 1; i < us.length; i++)
      for (let j = 1; j < ls.length; j++) {
        const a = us[i - 1].pos,
          b = us[i].pos,
          c = ls[j - 1].pos,
          d = ls[j].pos,
          u = sub(b, a),
          v = sub(d, c),
          e = sub(c, a),
          den = cross(u, v);
        if (Math.abs(den) < 1e-8) continue;
        const t = cross(e, v) / den,
          q = cross(e, u) / den;
        if (t >= 0 && t <= 1 && q >= 0 && q <= 1)
          intersections.push({ p: a.map((x, k) => x + t * u[k]), upperId: upper.id, lowerId: lower.id });
      }
  }
if (!intersections.length) throw Error('No actual curved bridge crossing');
const { p } = intersections[0];
const levels = { upper: 14, lower: 10 };
if (levels.upper - levels.lower < 4) throw Error('Less than 4m crossing deck separation');
const simulation = await createRaceSimulation(course);
await simulation.load(course.stage);
const resets = [];
for (const island of course.stage.islands) {
  const pos = island.restartPoints[0];
  simulation.reset(pos);
  const ball = simulation.getBallState();
  const error = Math.abs(ball.pos[1] - (island.level + DEFAULT_PARAMS.ballRadius + 0.01));
  resets.push({ id: island.id, pos, level: island.level, actualY: ball.pos[1], error });
  if (error > 0.05)
    throw Error(`Reset selected wrong level for island ${island.id}: ${JSON.stringify(resets.at(-1))}`);
}
simulation.dispose();
const trace = JSON.parse(await readFile(`${dir}/route-0-trace.json`, 'utf8')).ticks;
const near = trace
  .map((x, i) => ({
    tick: i + 1,
    pose: x.slice(0, 3),
    distance: Math.hypot(x[0] - p[0] / PX_PER_METER, x[2] - p[1] / PX_PER_METER),
  }))
  .filter((x) => x.distance < 2);
const lowerTicks = near.filter((x) => Math.abs(x.pose[1] - (levels.lower + 0.5)) < 0.1),
  upperTicks = near.filter((x) => Math.abs(x.pose[1] - (levels.upper + 0.5)) < 0.1);
if (!lowerTicks.length || !upperTicks.length) throw Error('Trace does not exercise both levels');
const lowerNearest = lowerTicks.sort((a, b) => a.distance - b.distance)[0],
  upperNearest = upperTicks.sort((a, b) => a.distance - b.distance)[0];
const result = {
  courseId: course.courseId,
  crossingPx: p,
  levels,
  deckSeparation: levels.upper - levels.lower,
  clearanceAboveBallTop:
    levels.upper - DEFAULT_PARAMS.slabThickness - levels.lower - 2 * DEFAULT_PARAMS.ballRadius,
  upperNearest,
  lowerNearest,
  resets,
  limits:
    'Checks authored restart points and clean traversal; deliberate failed-jump catch recovery is not exercised.',
};
await writeFile(`${dir}/layer-validation.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
