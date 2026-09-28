import { existsSync } from 'node:fs';
/** Audit playable authored routes: a long straight exceeds 24m before accumulating a 20deg turn. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RaceCourse } from '../packages/race/src/index.ts';
import { bridgeSections, PX_PER_METER, type Vec2 } from '../packages/schema/src/index.ts';

const root = resolve(import.meta.dirname, '../fixtures/race');
const arg = process.argv.indexOf('--slug'),
  slug = arg >= 0 ? process.argv[arg + 1] : undefined;
const turn = (20 * Math.PI) / 180;
let failures = 0;
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (
    !entry.isDirectory() ||
    !existsSync(resolve(root, entry.name, 'course.json')) ||
    (slug && entry.name !== slug)
  )
    continue;
  const dir = resolve(root, entry.name);
  const course: RaceCourse = JSON.parse(await readFile(resolve(dir, 'course.json'), 'utf8'));
  const limitMetres = 3 * (course.stunts?.cruiseSpeed ?? 8);
  const limit = limitMetres * PX_PER_METER;
  let spec: {
    nodes: Record<string, Vec2>;
    margin: number;
    scale: Vec2;
    routes: [string, string, string][];
    catch?: string[];
  };
  try {
    spec = JSON.parse(await readFile(resolve(dir, 'maze.json'), 'utf8'));
  } catch {
    if (entry.name === 'island-leap') {
      // Authored branch centre lines, including the launch runway and lower catch return.
      spec = {
        margin: 0,
        scale: [1, 1],
        nodes: {
          S: course.stage.start.pos,
          A: [870, 290],
          B: [870, 465],
          C: [1250, 525],
          D: [1375, 580],
          F: [1375, 730],
          N: [1240, 270],
          N2: [1230, 520],
          L: [1380, 210],
          L2: [1360, 530],
          R: [1130, 265],
          R1: [1130, 340],
          R2: [1080, 404],
          R3: [975, 475],
          R4: [1110, 475],
          R5: [1190, 505],
        },
        routes: [
          ['Ground', 'S A B C D F', ''],
          ['Near hop', 'S N N2 D F', ''],
          ['Far leap', 'S L L2 D F', ''],
          ['Catch return', 'R R1 R2 R3 C D F', ''],
        ],
      };
    } else {
      const author = JSON.parse(await readFile(resolve(dir, 'authoring.json'), 'utf8'));
      spec = {
        margin: 0,
        scale: [1, 1],
        nodes: Object.fromEntries(author.sections.map((s: { id: string; center: Vec2 }) => [s.id, s.center])),
        routes: [['Main route', author.sections.map((s: { id: string }) => s.id).join(' '), '']],
      };
    }
  }
  const names = Object.keys(spec.nodes).filter((n) => !n.startsWith('X'));
  const point = (n: string): Vec2 => [
    spec.margin + spec.nodes[n][0] * spec.scale[0],
    spec.margin + spec.nodes[n][1] * spec.scale[1],
  ];
  const all = new Map<string, { from: Vec2; to: Vec2; metres: number; edges: string[] }>();
  const results = [];
  const auditRoutes = [...spec.routes];
  let recovery: string[] = [];
  for (const edge of (spec.catch ?? []).slice(1)) {
    const [a, b] = edge.split(' ');
    if (recovery.length && recovery.at(-1) !== a) {
      auditRoutes.push(['Catch return', recovery.join(' '), '']);
      recovery = [];
    }
    if (!recovery.length) recovery.push(a);
    recovery.push(b);
  }
  if (recovery.length) auditRoutes.push(['Catch return', recovery.join(' '), '']);
  for (const [label, route] of auditRoutes) {
    const path: { p: Vec2; edge: string }[] = [];
    const nodes = route.split(' ').filter((n: string) => !n.startsWith('X'));
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1],
        b = nodes[i],
        key = `${a} ${b}`;
      path.push({ p: point(a), edge: key });
      const bridge =
        entry.name === 'island-leap'
          ? ['B C', 'R3 C'].includes(key)
            ? course.stage.bridges.find((br) => br.id === 4)
            : undefined
          : course.stage.bridges.find((br) => br.from === names.indexOf(a) && br.to === names.indexOf(b));
      if (bridge?.control) for (const s of bridgeSections(bridge)) path.push({ p: s.pos, edge: key });
      path.push({ p: point(b), edge: key });
    }
    let length = 0,
      heading: number | undefined,
      angle = 0,
      start = path[0].p,
      last = start,
      edges = new Set<string>();
    const spans = [];
    const flush = () => {
      if (length > limit) {
        const key =
          entry.name === 'island-leap' && start === path[0].p && path[0].edge.startsWith('S ')
            ? 'shared-opening-runway'
            : [start, last]
                .map((p) => p.map((x) => Math.round(x)).join(','))
                .sort()
                .join('/');
        const span = { from: start, to: last, metres: length / PX_PER_METER, edges: [...edges] };
        all.set(key, span);
        spans.push(span);
      }
      length = 0;
      angle = 0;
      edges = new Set();
    };
    for (let i = 1; i < path.length; i++) {
      const p = path[i].p,
        dx = p[0] - last[0],
        dy = p[1] - last[1],
        d = Math.hypot(dx, dy);
      if (d < 0.001) continue;
      const h = Math.atan2(dy, dx);
      const delta =
        heading === undefined ? 0 : Math.abs(Math.atan2(Math.sin(h - heading), Math.cos(h - heading)));
      if (angle + delta >= turn) {
        flush();
        start = last;
      } else angle += delta;
      length += d;
      edges.add(path[i].edge);
      heading = h;
      last = p;
    }
    flush();
    results.push({ label, longStraights: spans });
  }
  const unique = [...all.values()];
  const pass = unique.length <= 1;
  if (!pass) failures++;
  const result = {
    courseId: course.courseId,
    definition: `More than ${limitMetres}m (3 seconds at this course's cruise speed) before accumulating 20 degrees of heading change; includes island-centre approaches, full jump spans and catch returns. Shared spans are deduplicated; Island Leap's three overlapping opening branches use one shared runway.`,
    limitMetres,
    turnDegrees: 20,
    longStraights: unique,
    routes: results,
    pass,
  };
  await writeFile(resolve(dir, 'straight-validation.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    entry.name,
    pass ? 'PASS' : 'FAIL',
    unique.length,
    unique.map((s) => `${s.metres.toFixed(1)}m:${s.edges.join('/')}`).join(', '),
  );
}
if (failures) process.exitCode = 1;
