/** Audit frozen elevation courses and produce a compact review manifest. */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RaceCourse } from '../packages/race/src/index.ts';
import { bridgeGradeMetrics, validateStage } from '../packages/schema/src/index.ts';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'fixtures/race');
const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const courses = [];
for (const entry of await readdir(dir, { withFileTypes: true })) {
  if (!entry.isDirectory() || !existsSync(resolve(dir, entry.name, 'course.json'))) continue;
  const course: RaceCourse = await read(resolve(dir, entry.name, 'course.json'));
  if (course.physicsProfile !== 'elevation-v1') throw Error(`${entry.name}: missing elevation profile`);
  const published = await read(resolve(root, 'apps/web/public/race', entry.name, 'course.json'));
  if (JSON.stringify(published) !== JSON.stringify(course)) throw Error(`${entry.name}: public drift`);
  const validation = validateStage(course.stage, { mode: 'race' });
  if (validation.errors.length) throw Error(`${entry.name}: ${JSON.stringify(validation.errors)}`);
  const bridges = course.stage.bridges.map((bridge) => {
    const grade = bridgeGradeMetrics(bridge);
    return {
      id: bridge.id,
      from: bridge.from,
      to: bridge.to,
      riseMetres: bridge.levelB - bridge.levelA,
      runMetres: grade.runMeters,
      meanDegrees: (Math.atan(grade.meanGrade) * 180) / Math.PI,
      maximumLocalDegrees: (Math.atan(grade.maxGrade) * 180) / Math.PI,
      shallowConnector: grade.meanGrade < Math.tan((5 * Math.PI) / 180),
    };
  });
  const climbCount = bridges.filter((b) => b.riseMetres > 0).length;
  const descentCount = bridges.filter((b) => b.riseMetres < 0).length;
  if (!climbCount || !descentCount) throw Error(`${entry.name}: needs both climbs and descents`);
  const report = {
    slug: entry.name,
    courseId: course.courseId,
    physicsProfile: course.physicsProfile,
    elevationRangeMetres: [
      Math.min(...course.stage.islands.map((i) => i.level)),
      Math.max(...course.stage.islands.map((i) => i.level)),
    ],
    climbCount,
    descentCount,
    maximumLocalDegrees: Math.max(...bridges.map((b) => b.maximumLocalDegrees)),
    shallowConnectors: bridges.filter((b) => b.shallowConnector),
    bridges,
    twoDimensionalReview: `elevation-review/${entry.name}.html`,
  };
  courses.push(report);
  console.log(
    `${entry.name}: ${climbCount} climbs / ${descentCount} descents; local max ${report.maximumLocalDegrees.toFixed(2)}°`,
  );
}
if (courses.length !== 14) throw Error(`Expected 14 courses, found ${courses.length}`);
await writeFile(
  resolve(dir, 'elevation-validation.json'),
  `${JSON.stringify({ schema: 'wwm.race-elevation-audit/1', courses }, null, 2)}\n`,
);
