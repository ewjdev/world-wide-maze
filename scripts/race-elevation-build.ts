/** Apply reviewed island elevations to frozen Race layouts. No external solver is required. */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RaceCourse } from '../packages/race/src/index.ts';
import { PX_PER_METER, validateStage } from '../packages/schema/src/index.ts';
import {
  applyRaceElevation,
  type RaceElevationDesign,
} from '../packages/stage-builder/src/race-elevation.ts';
import { chromium } from '../tools/fixture-capture/node_modules/playwright/index.mjs';

const root = resolve(import.meta.dirname, '..');
const selected = process.argv.includes('--slug') ? process.argv[process.argv.indexOf('--slug') + 1] : null;
const draft = process.argv.includes('--draft');
const fixtures = resolve(root, 'fixtures/race');
const output = resolve(fixtures, 'elevation-review');
await mkdir(output, { recursive: true });
const entries = (await readdir(fixtures, { withFileTypes: true })).filter(
  (e) => e.isDirectory() && (!selected || e.name === selected),
);
const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const browser = await chromium.launch({ headless: true });
const cards: string[] = [];
try {
  for (const entry of entries) {
    const slug = entry.name,
      dir = resolve(fixtures, slug);
    let design: RaceElevationDesign;
    try {
      design = JSON.parse(await readFile(resolve(dir, 'elevation-design.json'), 'utf8'));
    } catch {
      continue;
    }
    const original: RaceCourse = JSON.parse(await readFile(resolve(dir, 'course.json'), 'utf8'));
    const oldBridges = structuredClone(original.stage.bridges);
    const levels = design.islandLevels;
    const course = applyRaceElevation(original, design);
    const check = validateStage(course.stage, { mode: 'race' });
    if (!draft && check.errors.length) throw new Error(`${slug}: ${JSON.stringify(check.errors)}`);
    const min = Math.min(...Object.values(levels)),
      max = Math.max(...Object.values(levels));
    const color = (level: number) =>
      `hsl(${Math.round(205 - ((level - min) / (max - min || 1)) * 165)} 58% 48%)`;
    const path = (b: RaceCourse['stage']['bridges'][number]) =>
      b.control ? `M${b.a} Q${b.control} ${b.b}` : `M${b.a} L${b.b}`;
    const w = course.stage.size.width,
      h = course.stage.size.height;
    let spec:
      | { nodes: Record<string, unknown>; routes: [string, string, string][]; jumps: string[] }
      | undefined;
    try {
      spec = JSON.parse(await readFile(resolve(dir, 'maze.json'), 'utf8'));
    } catch {}
    const labels = spec
      ? Object.keys(spec.nodes).filter((id) => !id.startsWith('X'))
      : course.stage.islands.map((i) => String(i.id));
    const nodeIndex = new Map(labels.map((id, i) => [id, i]));
    const profiles = spec
      ? spec.routes.map((r) => ({
          name: r[0],
          ids: r[1]
            .split(' ')
            .filter((id) => !id.startsWith('X'))
            .map((id) => nodeIndex.get(id) as number),
        }))
      : [{ name: 'Main circuit', ids: course.stage.islands.map((i) => i.id) }];
    let up = 0,
      down = 0;
    for (const b of course.stage.bridges) {
      if (b.levelB > b.levelA) up++;
      else if (b.levelB < b.levelA) down++;
    }
    const profileSvg = profiles
      .map((route) => {
        const nodes = route.ids.map((id) => course.stage.islands.find((i) => i.id === id)).filter((i) => !!i);
        let distance = 0;
        const samples = nodes.map((i, k) => {
          if (k) {
            const p = nodes[k - 1].restartPoints[0],
              q = i.restartPoints[0];
            distance += Math.hypot(q[0] - p[0], q[1] - p[1]) / PX_PER_METER;
          }
          return { x: distance, y: i.level, label: labels[i.id] ?? i.id };
        });
        const pts = samples
          .map((p) => `${45 + (p.x / (distance || 1)) * 1110},${140 - ((p.y - min) / (max - min || 1)) * 95}`)
          .join(' ');
        return `<h3>${escapeHtml(route.name)}</h3><svg viewBox="0 0 1200 178" role="img" aria-label="${escapeHtml(route.name)} elevation profile"><title>${escapeHtml(route.name)} elevation profile</title><path d="M45 20V145H1170" fill="none" stroke="#496074"/><polyline points="${pts}" fill="none" stroke="#66daca" stroke-width="3"/>${samples.map((p, k) => `<circle cx="${45 + (p.x / (distance || 1)) * 1110}" cy="${140 - ((p.y - min) / (max - min || 1)) * 95}" r="3" fill="${color(p.y)}"/>${k % 2 === 0 || k === samples.length - 1 ? `<text x="${45 + (p.x / (distance || 1)) * 1110}" y="${130 - ((p.y - min) / (max - min || 1)) * 95}" text-anchor="middle">${p.label} ${p.y.toFixed(1)}m</text>` : ''}`).join('')}<text x="5" y="28">${max.toFixed(1)}m</text><text x="5" y="145">${min.toFixed(1)}m</text><text x="45" y="170">Start</text><text x="1100" y="170">${distance.toFixed(0)}m</text></svg>`;
      })
      .join('');
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(course.title)} · elevation study</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#111d29;color:#e8f1f8;font:16px system-ui}h1{margin:0;font-size:34px}p{color:#b8cad8;line-height:1.5}header,.map,.profiles{max-width:1200px;margin:0 auto 24px}.map{height:670px;border:1px solid #344c60;border-radius:12px;background:#172838}.map svg{width:100%;height:100%}h3{font-size:16px;margin-bottom:0}text{font:12px system-ui;fill:#dcecf4}.map text{font-size:27px;text-anchor:middle;paint-order:stroke;stroke:#152331;stroke-width:5px}.profiles svg{width:100%;height:178px}.badge{display:inline-block;background:#264354;padding:7px 12px;border-radius:16px;margin-right:8px}</style><header><h1>${escapeHtml(course.title)}</h1><p>Elevation design · ${min.toFixed(1)}–${max.toFixed(1)}m · ${up} climbs / ${down} descents</p><p><span class="badge">Smooth ramp crests</span><span class="badge">≤20° local grade</span><span class="badge">No downhill turbo earning</span></p><p>Blue = lower islands · gold = higher islands · dashed gold = flight gaps. Side profiles connect island centres; actual ramps ease into level platforms.</p></header><div class="map"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(course.title)} island height map"><title>${escapeHtml(course.title)} island height map</title>${course.stage.bridges.map((b) => `<path d="${path(b)}" fill="none" stroke="${color((b.levelA + b.levelB) / 2)}" stroke-width="${b.width}"/><path d="${path(b)}" fill="none" stroke="#e5f1ff" stroke-opacity=".45" stroke-width="3"/>`).join('')}${(
      course.stage.flightLinks ?? []
    )
      .map((f) => {
        const a = course.stage.islands.find((i) => i.id === f.from),
          b = course.stage.islands.find((i) => i.id === f.to);
        return a && b
          ? `<path d="M${a.restartPoints[0]} L${b.restartPoints[0]}" stroke="#ffd071" stroke-width="9" stroke-dasharray="15 12"/>`
          : '';
      })
      .join(
        '',
      )}${course.stage.islands.map((i) => `<polygon points="${i.contour.map((p) => p.join(',')).join(' ')}" fill="${color(i.level)}" stroke="#b2d4dd" stroke-width="2"/><text x="${i.restartPoints[0][0]}" y="${i.restartPoints[0][1]}">${labels[i.id] ?? 'lip'}</text><text x="${i.restartPoints[0][0]}" y="${i.restartPoints[0][1] + 32}">${i.level.toFixed(1)}m</text>`).join('')}</svg></div><section class="profiles">${profileSvg}</section><p>Design audit: ${check.errors.length ? `${check.errors.length} constraints pending` : 'validated'} · ${course.stage.bridges.length} connectors · physics profile elevation-v1</p></html>`;
    await writeFile(resolve(output, `${slug}.html`), html);
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(resolve(output, `${slug}.html`)).href);
    await page.screenshot({ path: resolve(output, `${slug}.png`), fullPage: true });
    await page.close();
    cards.push(
      `<article><h2>${escapeHtml(course.title)}</h2><a href="${slug}.html"><img src="${slug}.png" alt="${escapeHtml(course.title)} elevation map"/></a></article>`,
    );
    if (!draft && design.bridgeControls) {
      try {
        const routePath = resolve(dir, 'route-points.json');
        const data = JSON.parse(await readFile(routePath, 'utf8'));
        for (const [id, control] of Object.entries(design.bridgeControls)) {
          const bridge = course.stage.bridges.find((b) => b.id === Number(id));
          if (!bridge) continue;
          for (const route of data.routes) {
            const oldBridge = oldBridges.find((b) => b.id === Number(id)) ?? bridge;
            const start = route.points.findIndex(
              (p: { x: number; z: number }) => Math.hypot(p.x - oldBridge.a[0], p.z - oldBridge.a[1]) < 0.01,
            );
            if (start < 0) continue;
            route.points[start].x = bridge.a[0];
            route.points[start].z = bridge.a[1];
            for (let j = start + 1; j < route.points.length; j++) {
              const p = route.points[j];
              const match = p.id?.match(/-curve-([\d.]+)$/);
              if (!match) {
                if (p.id?.endsWith('-entry')) {
                  p.x = bridge.b[0];
                  p.z = bridge.b[1];
                }
                break;
              }
              const t = Number(match[1]);
              p.x = (1 - t) ** 2 * bridge.a[0] + 2 * (1 - t) * t * control[0] + t * t * bridge.b[0];
              p.z = (1 - t) ** 2 * bridge.a[1] + 2 * (1 - t) * t * control[1] + t * t * bridge.b[1];
            }
          }
        }
        await writeFile(routePath, `${JSON.stringify(data, null, 2)}\n`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (!draft) {
      const json = `${JSON.stringify(course, null, 2)}\n`;
      await writeFile(resolve(dir, 'course.json'), json);
      await writeFile(resolve(root, 'apps/web/public/race', slug, 'course.json'), json);
    }
    console.log(
      `${slug}: ${up} climbs, ${down} descents, ${min.toFixed(1)}–${max.toFixed(1)}m; ${check.errors.length} validation errors${draft ? ' (design only)' : ''}`,
    );
  }
  cards.length = 0;
  for (const item of await readdir(fixtures, { withFileTypes: true })) {
    if (
      !item.isDirectory() ||
      !existsSync(resolve(output, `${item.name}.png`)) ||
      !existsSync(resolve(fixtures, item.name, 'course.json'))
    )
      continue;
    const reviewed: RaceCourse = JSON.parse(
      await readFile(resolve(fixtures, item.name, 'course.json'), 'utf8'),
    );
    cards.push(
      `<article><h2>${escapeHtml(reviewed.title)}</h2><a href="${item.name}.html"><img src="${item.name}.png" alt="${escapeHtml(reviewed.title)} elevation map"/></a></article>`,
    );
  }
  await writeFile(
    resolve(output, 'index.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Race elevation designs</title><style>body{background:#111d29;color:#e8f1f8;font:16px system-ui;margin:32px}main{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}img{width:100%}h1{font-size:32px}</style><h1>Race · fourteen elevation studies</h1><p>Top-down island layout and side profiles. Open each course for details.</p><main>${cards.join('')}</main></html>`,
  );
  const sheet = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await sheet.goto(pathToFileURL(resolve(output, 'index.html')).href);
  await sheet.screenshot({ path: resolve(output, 'overview.png'), fullPage: true });
  await sheet.close();
} finally {
  await browser.close();
}
