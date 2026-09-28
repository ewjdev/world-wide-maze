/** Authored Race graphs -> frozen StageData, owned HTML/texture, route-control waypoints. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type RaceCourse, validateGates, validateStunts } from '../packages/race/src/index.ts';
import {
  type Bridge,
  distanceToRing,
  type Island,
  PX_PER_METER,
  pointInPolygon,
  type Vec2,
  validateStage,
} from '../packages/schema/src/index.ts';
import { pageToWorld } from '../packages/schema/src/space.ts';
import { chromium } from '../tools/fixture-capture/node_modules/playwright/index.mjs';

const root = resolve(import.meta.dirname, '..');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2),
  which = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;
const names = [
  'flow-delta',
  'hairpin-terraces',
  'skipping-stones',
  'twin-canyons',
  'cliff-ribbon',
  'bankshot-basin',
  'switchyard',
  'sky-weave',
  'needle-garden',
  'redline-relay',
];
const slugs = which ? [which] : names;
type Spec = {
  slug: string;
  number: number;
  name: string;
  skill: string;
  nodes: Record<string, Vec2>;
  routes: [string, string, string][];
  jumps: string[];
  tight: string[];
  catch: string[];
  levels: Record<string, number>;
  gateNormals: Record<string, Vec2>;
  largePads?: string[];
  bank?: string;
  bankControl?: Vec2;
  edgeControls?: Record<string, Vec2>;
  scale: Vec2;
  margin: number;
  islandRadius: number;
  wideRadius: number;
  deckWidth: number;
  targetSpeed: number;
  launchSpeed: number;
  jumpGap: number;
  radiusOverrides?: Record<string, number>;
  edgeWidths?: Record<string, number>;
  upSpeed?: number;
  gapOverrides?: Record<string, number>;
  routeSpeeds?: Record<string, number>;
  bankRadians?: number;
  bankSpeed?: number;
  curveSamples?: number;
};
const add = (a: Vec2, b: Vec2, s = 1): Vec2 => [a[0] + b[0] * s, a[1] + b[1] * s];
const unit = (a: Vec2, b: Vec2): Vec2 => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};
function hull(points: Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lo: Vec2[] = [],
    hi: Vec2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo.at(-2) as Vec2, lo.at(-1) as Vec2, q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (hi.length >= 2 && cross(hi.at(-2) as Vec2, hi.at(-1) as Vec2, q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function boundary(center: Vec2, direction: Vec2, contour: Vec2[]): Vec2 {
  let lo = 0,
    hi = 10000;
  for (let k = 0; k < 48; k++) {
    const mid = (lo + hi) / 2;
    if (pointInPolygon(add(center, direction, mid), contour, [])) lo = mid;
    else hi = mid;
  }
  return add(center, direction, lo);
}
const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const browser = await chromium.launch({ headless: true });
try {
  for (const slug of slugs) {
    const dir = resolve(root, 'fixtures/race', slug),
      pub = resolve(root, 'apps/web/public/race', slug);
    await mkdir(pub, { recursive: true });
    const raw = await readFile(resolve(dir, 'maze.json'), 'utf8'),
      s = JSON.parse(raw) as Spec;
    const position = (p: Vec2): Vec2 => [s.margin + p[0] * s.scale[0], s.margin + p[1] * s.scale[1]];
    const points = Object.fromEntries(
      Object.entries(s.nodes)
        .filter(([id]) => !id.startsWith('X'))
        .map(([id, p]) => [id, position(p)]),
    );
    const ids = Object.keys(points),
      index = Object.fromEntries(ids.map((id, i) => [id, i]));
    const routes = s.routes.map(
      (r) => [r[0], r[1].split(' ').filter((id) => !id.startsWith('X')), r[2]] as const,
    );
    const edges = new Map<string, [string, string]>();
    for (const [, route] of routes)
      for (let i = 1; i < route.length; i++)
        edges.set(`${route[i - 1]} ${route[i]}`, [route[i - 1], route[i]]);
    for (const key of s.catch.slice(1)) {
      const [a, b] = key.split(' ');
      edges.set(key, [a, b]);
    }
    const contours: Record<string, Vec2[]> = {};
    for (const id of ids) {
      const p = points[id];
      const near = Math.min(
        ...ids
          .filter((j) => j !== id && j !== 'R')
          .map((j) => Math.hypot(points[j][0] - p[0], points[j][1] - p[1])),
      );
      const radius =
        s.radiusOverrides?.[id] ??
        Math.min(s.largePads?.includes(id) ? s.wideRadius : s.islandRadius, near * 0.35);
      contours[id] = Array.from({ length: 8 }, (_, i) =>
        add(p, [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)], radius),
      );
    }
    // Tangible run-up and landing tongues keep long graph edges from becoming implausibly huge flight gaps.
    for (const key of s.jumps) {
      const [a, b] = key.split(' '),
        p = points[a],
        q = points[b],
        u = unit(p, q),
        v: Vec2 = [-u[1], u[0]],
        d = Math.hypot(q[0] - p[0], q[1] - p[1]),
        gap = s.gapOverrides?.[key] ?? s.jumpGap;
      const mid = add(p, u, d / 2),
        lip = add(mid, u, -gap / 2),
        land = add(mid, u, gap / 2),
        half = Math.max(26, s.deckWidth * 0.65);
      contours[a] = hull([...contours[a], add(lip, v, half), add(lip, v, -half)]);
      contours[b] = hull([...contours[b], add(land, v, half), add(land, v, -half)]);
    }
    const islands: Island[] = ids.map((id) => ({
      id: index[id],
      contour: contours[id],
      holes: [],
      level: s.levels[id] ?? 10,
      guardrails: [],
      restartPoints: [points[id]],
      sourceElementIds: [index[id]],
    }));
    const bridges: Bridge[] = [],
      byEdge = new Map<string, Bridge>();
    for (const [key, [a, b]] of edges) {
      if (s.jumps.includes(key)) continue;
      const u = unit(points[a], points[b]);
      const authoredControl = s.edgeControls?.[key] ?? (key === s.bank ? s.bankControl : undefined);
      const control = authoredControl ? position(authoredControl) : undefined;
      const startDirection = control ? unit(points[a], control) : u,
        endDirection = control ? unit(points[b], control) : ([-u[0], -u[1]] as Vec2);
      const start = boundary(points[a], startDirection, contours[a]),
        end = boundary(points[b], endDirection, contours[b]);
      const bridge: Bridge = {
        id: bridges.length,
        from: index[a],
        to: index[b],
        a: start,
        b: end,
        width: s.edgeWidths?.[key] ?? Math.max(35, s.deckWidth * (s.tight.includes(key) ? 0.75 : 1)),
        levelA: s.levels[a] ?? 10,
        levelB: s.levels[b] ?? 10,
        type: s.levels[a] === s.levels[b] ? 'flat' : 'ramp',
        rails: false,
        ...(control ? { control, ...(key === s.bank ? { bank: s.bankRadians ?? 0.18 } : {}) } : {}),
      };
      bridges.push(bridge);
      byEdge.set(key, bridge);
    }
    const launchOrigins: Record<string, number> = {},
      launchLevels: Record<string, number> = {};
    // Every assisted lip has a real rail-free climbing deck and a distinct raised takeoff platform.
    for (const key of s.jumps) {
      const [a, b] = key.split(' '),
        u = unit(points[a], points[b]),
        v: Vec2 = [-u[1], u[0]],
        edge = boundary(points[a], u, contours[a]);
      const edgeDistance = Math.hypot(edge[0] - points[a][0], edge[1] - points[a][1]);
      const rampStart = Math.max(10, edgeDistance - 118),
        rise = Math.min(0.6, Math.max(0.04, ((edgeDistance - 23 - rampStart) / PX_PER_METER) * 0.14));
      const label = `${a}-lip-${b}`,
        center = add(edge, u, -13),
        half = Math.max(28, s.deckWidth * 0.65),
        level = (s.levels[a] ?? 10) + rise;
      launchLevels[key] = level;
      const contour = hull([
        add(add(center, u, -18), v, -half),
        add(add(center, u, -18), v, half),
        add(add(center, u, 18), v, -half),
        add(add(center, u, 18), v, half),
      ]);
      const lipId = islands.length;
      launchOrigins[key] = lipId;
      ids.push(label);
      points[label] = center;
      index[label] = lipId;
      contours[label] = contour;
      s.levels[label] = level;
      islands.push({
        id: lipId,
        contour,
        holes: [],
        level,
        guardrails: [],
        restartPoints: [center],
        sourceElementIds: [lipId],
      });
      bridges.push({
        id: bridges.length,
        from: index[a],
        to: lipId,
        a: add(points[a], u, rampStart),
        b: add(edge, u, -23),
        width: half * 2,
        levelA: s.levels[a] ?? 10,
        levelB: level,
        type: 'ramp',
        rails: false,
      });
    }
    // Reset currently resolves height from a 2D point. Lower catches need an exposed,
    // ball-clear restart patch, otherwise recovery incorrectly spawns on the upper runway.
    for (const island of islands) {
      const above = islands.filter((other) => other.level > island.level + 0.05);
      const safe = (p: Vec2) =>
        pointInPolygon(p, island.contour, island.holes) &&
        distanceToRing(p, island.contour) >= 8 &&
        above.every(
          (other) => !pointInPolygon(p, other.contour, other.holes) && distanceToRing(p, other.contour) >= 8,
        );
      const center = island.restartPoints[0] as Vec2;
      if (safe(center)) continue;
      let replacement: Vec2 | undefined;
      for (let radius = 8; radius < 400 && !replacement; radius += 8) {
        for (let angle = 0; angle < 32; angle++) {
          const p: Vec2 = [
            center[0] + radius * Math.cos((angle * Math.PI) / 16),
            center[1] + radius * Math.sin((angle * Math.PI) / 16),
          ];
          if (safe(p)) {
            replacement = p;
            break;
          }
        }
      }
      if (!replacement) throw new Error(`${slug}: island ${island.id} has no exposed restart patch`);
      island.restartPoints = [replacement];
    }
    const gates = ['G1', 'G2', 'G3', 'F'].map((id) => {
      const n = s.gateNormals[id],
        l = Math.hypot(...n),
        normal: Vec2 = [n[0] / l, n[1] / l];
      const p = add(points[id], normal, -18);
      return {
        id,
        center: pageToWorld(p, (s.levels[id] ?? 10) + 0.5),
        normal,
        halfWidth: (Math.max(s.wideRadius, s.islandRadius) * 1.1) / PX_PER_METER,
        halfHeight: 2.5,
        kind: id === 'F' ? ('finish' as const) : ('sector' as const),
      };
    });
    const pads = s.jumps.map((key) => {
      const [a, b] = key.split(' '),
        u = unit(points[a], points[b]),
        edge = boundary(points[a], u, contours[a]),
        lip = add(edge, u, -5);
      return {
        id: key.replace(' ', '-'),
        gate: {
          id: `lip-${key}`,
          center: pageToWorld(lip, launchLevels[key] + 0.5),
          normal: u,
          halfWidth: Math.max(26, s.deckWidth * 0.65) / PX_PER_METER,
          halfHeight: 1,
          kind: 'sector' as const,
        },
        upSpeed: s.upSpeed ?? 14,
        minSpeed: 3,
        landingIslandIds: [index[b]],
      };
    });
    const width = Math.ceil(Math.max(...islands.flatMap((i) => i.contour.map((p) => p[0]))) + s.margin),
      height = Math.ceil(Math.max(...islands.flatMap((i) => i.contour.map((p) => p[1]))) + s.margin);
    const path = (b: Bridge) => (b.control ? `M ${b.a} Q ${b.control} ${b.b}` : `M ${b.a} L ${b.b}`);
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(s.name)}</title><style>*{box-sizing:border-box}body{margin:0;background:#162332}svg{display:block}text{font-family:system-ui;fill:#ecf6ff;text-anchor:middle;font-weight:600}</style><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M 60 0 H0 V60" fill="none" stroke="#203246" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#grid)"/>${bridges.map((b) => `<path d="${path(b)}" fill="none" stroke="${b.control ? '#dc9349' : '#52758c'}" stroke-width="${b.width}"/>`).join('')}${islands.map((island, i) => `<g id="island-${ids[i]}" data-island="${i}"><polygon points="${island.contour.map((p) => p.join(',')).join(' ')}" fill="${ids[i] === 'R' ? '#886381' : ids[i] === 'F' ? '#48855e' : '#426b7e'}" stroke="#98c2d2" stroke-width="3"/><text x="${points[ids[i]][0]}" y="${points[ids[i]][1] + 9}" font-size="28">${escapeHtml(ids[i])}</text></g>`).join('')}${pads
      .map((p) => {
        const [x, , z] = p.gate.center;
        const [u, v] = p.gate.normal;
        return `<path d="M ${x * PX_PER_METER - v * 24} ${z * PX_PER_METER + u * 24} l ${v * 48} ${-u * 48}" stroke="#ffd178" stroke-width="9"/>`;
      })
      .join('')}${gates
      .map((g) => {
        const [x, , z] = g.center,
          n = g.normal;
        return `<path d="M ${x * PX_PER_METER - n[1] * 32} ${z * PX_PER_METER + n[0] * 32} l ${n[1] * 64} ${-n[0] * 64}" stroke="#e5f7df" stroke-width="5" stroke-dasharray="8 5"/>`;
      })
      .join('')}</svg></html>`;
    await writeFile(resolve(dir, 'index.html'), html);
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(resolve(dir, 'index.html')).href);
    const png = await page.screenshot({ fullPage: true });
    await page.close();
    await writeFile(resolve(dir, 'texture.png'), png);
    await writeFile(resolve(pub, 'texture.png'), png);
    const course: RaceCourse = {
      schema: 'wwm.race-course/1',
      courseId: '0'.repeat(64),
      title: s.name,
      description: s.skill,
      generatorVersion: 'race-maze/1',
      seed: 100 + s.number,
      textureUrl: `/race/${slug}/texture.png`,
      stage: {
        schema: 'wwm.stage/2',
        stageId: '0'.repeat(64),
        builderVersion: '1.2.0',
        seed: 100 + s.number,
        difficulty: 'normal',
        source: {
          url: `https://worldwidemaze.com/race/${slug}`,
          title: s.name,
          captureId: hash(html),
          pageWidth: width,
          pageHeight: height,
          slice: { index: 0, count: 1, y: 0, height },
        },
        size: { width, height },
        texture: { path: `/race/${slug}/texture.png`, width, height, scale: 1 },
        timeLimitSec: 300,
        islands,
        bridges,
        flightLinks: s.jumps.map((key) => {
          const [_a, b] = key.split(' ');
          return { from: launchOrigins[key], to: index[b] };
        }),
        elevators: [],
        items: [],
        portals: [],
        start: { pos: points.S, islandId: index.S },
        goal: { pos: points.F, islandId: index.F, radius: 18 },
        provenance: {
          keptElementIds: ids.map((id) => index[id]),
          dropped: [],
          notes: [
            `Authored owned HTML, source SHA256 ${hash(html)}`,
            `Graph SHA256 ${hash(raw)}; texture SHA256 ${hash(png)}`,
            'Jump runways, levels and gates are explicit authored geometry; no webpage extraction inference.',
          ],
        },
      },
      gates,
      stunts: {
        version: 1,
        cruiseSpeed: 8,
        chargeTicks: 360,
        turboDeltaV: 8,
        turboMaxSpeed: 24,
        landingDeltaV: 1,
        launchPads: pads,
      },
    };
    course.courseId = hash(JSON.stringify(course));
    course.stage.stageId = course.courseId;
    const check = validateStage(course.stage),
      errors = [
        ...check.errors.map((e) => `${e.code}: ${e.message}`),
        ...validateGates(gates),
        ...validateStunts(course),
      ];
    if (errors.length) throw new Error(`${slug}: ${errors.join('\n')}`);
    const routeData = routes.map(([label, route], ri) => {
      const waypoints: {
        id: string;
        x: number;
        z: number;
        speed?: number;
        radius?: number;
        launch?: boolean;
      }[] = [];
      const put = (id: string, p: Vec2, extra = {}) =>
        waypoints.push({ id, x: p[0], z: p[1], radius: 0.7, ...extra });
      put('S', points.S);
      let jumps = 0;
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1],
          b = route[i],
          key = `${a} ${b}`;
        const br = byEdge.get(key);
        if (s.jumps.includes(key)) {
          const pad = pads.find((p) => p.id === key.replace(' ', '-'));
          if (!pad) throw new Error(`Missing launch pad ${key}`);
          const lip: Vec2 = [pad.gate.center[0] * PX_PER_METER, pad.gate.center[2] * PX_PER_METER];
          put(`${a}-runup`, add(lip, pad.gate.normal, -55), { speed: s.launchSpeed, radius: 0.65 });
          put(`${a}-lip`, lip, { speed: s.launchSpeed, launch: true, radius: 0.5 });
          put(b, points[b], { speed: s.launchSpeed, launch: true, radius: 1 });
          jumps++;
        } else if (br) {
          put(`${a}-exit`, br.a, {});
          if (br.control) {
            for (const t of br.bank
              ? [0.2, 0.4, 0.6, 0.8]
              : Array.from({ length: s.curveSamples ?? 9 }, (_, i) => (i + 1) / ((s.curveSamples ?? 9) + 1)))
              put(
                `${a}-curve-${t}`,
                [
                  (1 - t) ** 2 * br.a[0] + 2 * (1 - t) * t * br.control[0] + t * t * br.b[0],
                  (1 - t) ** 2 * br.a[1] + 2 * (1 - t) * t * br.control[1] + t * t * br.b[1],
                ],
                { speed: br.bank ? Math.min(s.targetSpeed, s.bankSpeed ?? 6) : s.targetSpeed },
              );
          }
          put(`${b}-entry`, br.b, {});
          put(b, points[b], {});
        }
      }
      const finish = gates.at(-1);
      if (!finish) throw new Error('Missing finish gate');
      put('finish-exit', add(points.F, finish.normal, 35), {});
      return {
        id: `route-${ri}`,
        label,
        points: waypoints,
        expectedLaunches: jumps,
        targetSeconds: 60,
        targetSpeed: s.routeSpeeds?.[`route-${ri}`] ?? s.targetSpeed,
      };
    });
    await writeFile(
      resolve(dir, 'route-points.json'),
      `${JSON.stringify(
        {
          schema: 'wwm.race-route-points/1',
          defaultRoute: routeData.find((r) => r.expectedLaunches === 0)?.id ?? 'route-0',
          routes: routeData,
        },
        null,
        2,
      )}\n`,
    );
    const json = `${JSON.stringify(course, null, 2)}\n`;
    await writeFile(resolve(dir, 'course.json'), json);
    await writeFile(resolve(pub, 'course.json'), json);
    console.log(
      slug,
      course.courseId,
      `${islands.length} islands, ${bridges.length} bridges, ${pads.length} jumps`,
    );
  }
} finally {
  await browser.close();
}
