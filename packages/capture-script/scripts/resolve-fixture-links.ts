/**
 * Phase 13: link targets for the legacy capture fixtures.
 *
 * The 7 Phase 02 fixtures were captured before `DomElement.href` existed (contracts v0.3.0). Recapturing them
 * would change every screenshot and golden, so instead this script recovers each link element's target and writes
 * a sidecar, `fixtures/builder/links/<slug>.json` (`{ hrefs: { "<elementId>": "<url>" } }`), which
 * `applyLinkTargets` (@wwm/stage-builder) merges into the capture wherever fixtures are built.
 *
 * How a target is recovered (the fixture's own element ids and rects are never changed):
 * 1. Load the live page with the fixture settings (1280×800, DPR 1, reduced motion, en-US, UTC), prepare it
 *    like a capture and run the new `extractPage`, which now records `href`.
 * 2. Match each fixture link to a live link with the same text; several candidates → the nearest rect centre.
 *    A text that occurs once on both pages matches at any distance (pages shift); otherwise ≤ 80 px (the same spot).
 * 3. Hacker News only: story titles that rotated off the front page since the capture are looked up by exact
 *    title in the HN Algolia search API (`story` tags), which returns the submitted URL.
 * Links that can't be recovered stay without `href` (no portal can be made from them). Nothing is invented.
 *
 *   node packages/capture-script/scripts/resolve-fixture-links.ts [slug …]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CaptureBundle, DEFAULT_VIEWPORT, type DomElement, parseCapture } from '@wwm/schema';
import { chromium } from 'playwright';
import { type ExtractedPage, extractPage, normalizeUrl, pageExpression, preparePage } from '../src/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = [
  'hn-front',
  'wikipedia-article',
  'govuk-card-grid',
  'mdn-dark-docs',
  'example-sparse',
  'image-gallery',
];
const DARK = new Set(['mdn-dark-docs']);
/** Pages whose rows reorder between visits: a repeated text ("hide", "2 hours ago") at the same spot is another row. */
const REORDERS = new Set(['hn-front']);

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const centre = (e: DomElement) => [e.rect.x + e.rect.w / 2, e.rect.y + e.rect.h / 2] as const;

async function liveLinks(url: string, dark: boolean): Promise<DomElement[]> {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { ...DEFAULT_VIEWPORT },
      deviceScaleFactor: 1,
      colorScheme: dark ? 'dark' : 'light',
      reducedMotion: 'reduce',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    await preparePage(page, { maxHeight: 6000 });
    const got = (await page.evaluate(pageExpression(extractPage, {}))) as ExtractedPage;
    return got.elements.filter((e) => e.href && (e.kind === 'link' || e.kind === 'button'));
  } finally {
    await browser.close();
  }
}

async function hnLookup(title: string): Promise<string | null> {
  const q = new URL('https://hn.algolia.com/api/v1/search');
  q.searchParams.set('query', title);
  q.searchParams.set('tags', 'story');
  q.searchParams.set('restrictSearchableAttributes', 'title');
  const r = await fetch(q);
  if (!r.ok) return null;
  const j = (await r.json()) as { hits: { title: string; url: string | null; objectID: string }[] };
  const hit = j.hits.find((h) => norm(h.title) === norm(title));
  if (!hit) return null;
  return normalizeUrl(hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`);
}

async function resolveSlug(slug: string): Promise<void> {
  const dir = join(ROOT, 'fixtures/captures', slug);
  const capture: CaptureBundle = parseCapture(JSON.parse(readFileSync(join(dir, 'capture.json'), 'utf8')));
  const links = capture.elements.filter((e) => e.kind === 'link' && norm(e.text));
  const live = await liveLinks(capture.url, DARK.has(slug));
  const byText = new Map<string, DomElement[]>();
  for (const e of live) {
    const k = norm(e.text);
    if (!k) continue;
    byText.set(k, [...(byText.get(k) ?? []), e]);
  }
  const fixtureCount = new Map<string, number>();
  for (const e of links) fixtureCount.set(norm(e.text), (fixtureCount.get(norm(e.text)) ?? 0) + 1);

  const hrefs: Record<string, string> = {};
  let viaLive = 0;
  let viaHn = 0;
  const unresolved: number[] = [];
  for (const e of links) {
    const k = norm(e.text);
    const cands = byText.get(k) ?? [];
    let pick: DomElement | undefined;
    if (cands.length === 1 && fixtureCount.get(k) === 1) pick = cands[0];
    else if (cands.length > 0 && !REORDERS.has(slug)) {
      const [x, y] = centre(e);
      let best = Number.POSITIVE_INFINITY;
      for (const c of cands) {
        const [cx, cy] = centre(c);
        const d = Math.hypot(cx - x, cy - y);
        if (d < best) {
          best = d;
          pick = c;
        }
      }
      if (best > 80) pick = undefined;
    }
    if (pick?.href) {
      hrefs[String(e.id)] = pick.href;
      viaLive++;
      continue;
    }
    // HN story titles are the `titleline` links: long text, 13.33 px font
    if (slug === 'hn-front' && (e.text?.length ?? 0) > 12) {
      const h = await hnLookup(e.text ?? '');
      if (h) {
        hrefs[String(e.id)] = h;
        viaHn++;
        continue;
      }
    }
    unresolved.push(e.id);
  }
  const out = {
    slug,
    url: capture.url,
    captureId: capture.captureId,
    resolvedAt: new Date().toISOString(),
    method:
      'live page re-extracted with @wwm/capture-script (href) and matched by link text + nearest rect' +
      (slug === 'hn-front' ? '; rotated-off HN stories by exact title via hn.algolia.com' : ''),
    stats: { links: links.length, viaLive, viaHn, unresolved: unresolved.length },
    hrefs,
  };
  const outDir = join(ROOT, 'fixtures/builder/links');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${slug}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    `${slug}: ${links.length} links → ${viaLive} live, ${viaHn} HN, ${unresolved.length} unresolved`,
  );
}

const want = process.argv.slice(2);
for (const slug of want.length ? want : FIXTURES) {
  try {
    await resolveSlug(slug);
  } catch (err) {
    console.error(`${slug}: failed`, err);
    process.exitCode = 1;
  }
}
