/** Reproducible owned HTML capture. Run: node scripts/race-capture.ts [--build-only] */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { capturePage } from '../packages/capture-script/src/capture.ts';
import { solveStage } from '../packages/solver/src/solve.ts';
import { decodePng } from '../packages/stage-builder/src/node/png.ts';
import { buildRaceCourse, type RaceAuthoring } from '../packages/stage-builder/src/race.ts';
import { chromium } from '../tools/fixture-capture/node_modules/playwright/index.mjs';

const root = resolve(import.meta.dirname, '..');
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const slugs = ['flow-sprint', 'switchback', 'longline'];
const server = createServer(async (req, res) => {
  const slug = req.url?.split('/')[2];
  if (!slug || !slugs.includes(slug)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(await readFile(resolve(root, 'fixtures/race', slug, 'index.html')));
});
await new Promise<void>((ok) => server.listen(4179, '127.0.0.1', ok));
try {
  for (const slug of slugs) {
    const dir = resolve(root, 'fixtures/race', slug);
    const pub = resolve(root, 'apps/web/public/race', slug);
    await mkdir(pub, { recursive: true });
    if (!process.argv.includes('--build-only')) {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 1280, height: 1200 },
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
          locale: 'en-US',
        });
        const r = await capturePage(page, `http://127.0.0.1:4179/race/${slug}`, {
          screenshotPath: 'texture.png',
          viewport: { width: 1280, height: 1200 },
          now: () => new Date('2026-09-26T00:00:00Z'),
        });
        const sections = await page.locator('section[data-order]').evaluateAll((elements) =>
          elements
            .map((el) => {
              const b = el.getBoundingClientRect();
              return {
                id: el.id,
                order: Number(el.getAttribute('data-order')),
                center: [b.x + b.width / 2, b.y + b.height / 2],
                rect: { x: b.x, y: b.y, w: b.width, h: b.height },
              };
            })
            .sort((a, b) => a.order - b.order),
        );
        const description = await page.locator('meta[name=description]').getAttribute('content');
        await writeFile(resolve(dir, 'capture.json'), JSON.stringify(r.bundle, null, 2));
        await writeFile(resolve(dir, 'texture.png'), r.png);
        const author = {
          schema: 'wwm.race-authoring/1',
          title: r.bundle.title,
          description,
          sections: sections.map((s) => ({
            id: s.id,
            center: s.center,
            elementIds: r.bundle.elements
              .filter(
                (e) =>
                  e.rect.x >= s.rect.x &&
                  e.rect.y >= s.rect.y &&
                  e.rect.x + e.rect.w <= s.rect.x + s.rect.w + 1 &&
                  e.rect.y + e.rect.h <= s.rect.y + s.rect.h + 1,
              )
              .map((e) => e.id),
          })),
          sourceHash: hash(await readFile(resolve(dir, 'index.html'))),
          textureHash: hash(r.png),
          textureUrl: `/race/${slug}/texture.png`,
          enableTurbo: true,
          descentPerBridge: slug === 'longline' ? 0.2 : 0.35,
          bridgeWidthPx: slug === 'switchback' ? 72 : 84,
        };
        await writeFile(resolve(dir, 'authoring.json'), JSON.stringify(author, null, 2));
      } finally {
        await browser.close();
      }
    }
    const capture = JSON.parse(await readFile(resolve(dir, 'capture.json'), 'utf8'));
    const png = decodePng(await readFile(resolve(dir, 'texture.png')));
    const image = { ...png, data: new Uint8ClampedArray(png.data) };
    const author = JSON.parse(await readFile(resolve(dir, 'authoring.json'), 'utf8')) as RaceAuthoring;
    const course = buildRaceCourse({ capture, image, sliceIndex: 0, seed: 24, difficulty: 'normal' }, author);
    await writeFile(resolve(pub, 'course.json'), JSON.stringify(course, null, 2));
    await copyFile(resolve(dir, 'texture.png'), resolve(pub, 'texture.png'));
    await writeFile(resolve(dir, 'course.json'), JSON.stringify(course, null, 2));
    const solved = await solveStage(course.stage, { maxSimSec: 180, firstClean: true });
    const { inputs, ...report } = solved;
    await writeFile(resolve(dir, 'solver.json'), JSON.stringify(report, null, 2));
    await writeFile(
      resolve(dir, 'solver-inputs.json'),
      JSON.stringify({ courseId: course.courseId, inputs }),
    );
    console.log(
      slug,
      course.courseId,
      'islands',
      course.stage.islands.length,
      'solver',
      solved.success,
      solved.timeSec,
      'falls',
      solved.falls,
      'jumps',
      solved.jumps,
    );
    if (!solved.success || solved.falls || solved.jumps)
      throw new Error(`${slug}: failed clean rolling traversal: ${JSON.stringify(solved.failure)}`);
  }
} finally {
  server.close();
}
