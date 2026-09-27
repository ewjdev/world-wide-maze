/** Verify authored restart points select their intended physical layer. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_PARAMS } from '../packages/physics/src/index.ts';
import { createRaceSimulation, type RaceCourse } from '../packages/race/src/index.ts';

const dir = resolve(import.meta.dirname, '../fixtures/race');
let failed = 0;
for (const entry of await readdir(dir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  let course: RaceCourse;
  try {
    await readFile(resolve(dir, entry.name, 'maze.json'));
    course = JSON.parse(await readFile(resolve(dir, entry.name, 'course.json'), 'utf8'));
  } catch {
    continue;
  }
  const sim = await createRaceSimulation(course);
  await sim.load(course.stage);
  const checks = [];
  try {
    for (const island of course.stage.islands)
      for (const pos of island.restartPoints) {
        sim.reset(pos);
        const actual = sim.getBallState().pos[1],
          expected = island.level + DEFAULT_PARAMS.ballRadius + 0.01;
        const pass = Math.abs(actual - expected) < 0.05;
        checks.push({ islandId: island.id, pos, expected, actual, pass });
        if (!pass) {
          failed++;
          console.log(entry.name, checks.at(-1));
        }
      }
  } finally {
    sim.dispose();
  }
  await writeFile(
    resolve(dir, entry.name, 'reset-validation.json'),
    `${JSON.stringify({ courseId: course.courseId, checks }, null, 2)}\n`,
  );
}
if (failed) throw Error(`${failed} restart layer failures`);
console.log('All authored restart points select their intended layer');
