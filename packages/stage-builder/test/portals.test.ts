/**
 * Phase 13: link portals (contracts §10.1). Choice and placement on synthetic captures, the helpers, and the
 * acceptance checks on the 6 capture fixtures (portals on real link islands: Hacker News stories, Wikipedia links).
 */
import {
  BALL_RADIUS_PX,
  type CaptureBundle,
  createRng,
  distanceToPolygonEdge,
  MAX_PORTALS,
  type Portal,
  pointInPolygon,
  type Rect,
  type StageData,
  sliceCount,
  validateStage,
} from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { applyLinkTargets, buildStage, D, portalHrefOk, portalLabel } from '../src/index.ts';
import { loadCapture } from '../src/node/index.ts';
import { rankPortalCandidates } from '../src/portals.ts';
import type { SliceElement } from '../src/slice-elements.ts';
import { synthCapture } from './helpers.ts';

/** Six link "cards" in two rows (each its own island), plus a junk link and a same-site link. */
function linkPage() {
  const cards: { x: number; y: number; text: string; href: string }[] = [
    { x: 40, y: 60, text: 'The history of labyrinths', href: 'https://history.example/labyrinths' },
    { x: 260, y: 60, text: 'Marble machines explained', href: 'https://marbles.example/' },
    { x: 480, y: 60, text: 'Log in', href: 'https://example.test/login' },
    { x: 40, y: 260, text: 'Hedge mazes of England', href: 'https://hedge.example/england' },
    { x: 260, y: 260, text: 'About this site', href: 'https://example.test/about' },
    { x: 480, y: 260, text: 'Rolling ball sculpture', href: 'https://art.example/rolling' },
  ];
  return synthCapture(
    660,
    420,
    cards.map((c) => ({
      rect: { x: c.x, y: c.y, w: 150, h: 100 },
      kind: 'link' as const,
      color: [70, 90, 160] as [number, number, number],
      text: c.text,
      href: c.href,
    })),
  );
}

function rectDist(p: [number, number], r: Rect): number {
  const dx = Math.max(r.x - p[0], 0, p[0] - (r.x + r.w));
  const dy = Math.max(r.y - p[1], 0, p[1] - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** Every §10.1 invariant plus the builder's own placement rules. */
function checkPortals(stage: StageData, capture: CaptureBundle, where: string): Portal[] {
  const portals = stage.portals ?? [];
  expect(validateStage(stage).errors, where).toEqual([]);
  expect(portals.length, where).toBeLessThanOrEqual(MAX_PORTALS);
  expect(new Set(portals.map((p) => p.href)).size, where).toBe(portals.length);
  const byId = new Map(capture.elements.map((e) => [e.id, e]));
  for (const p of portals) {
    const w = `${where} portal ${p.id} (${p.label})`;
    const isl = stage.islands.find((i) => i.id === p.islandId);
    expect(isl, w).toBeDefined();
    if (!isl) continue;
    expect(pointInPolygon(p.pos, isl.contour, isl.holes), w).toBe(true);
    expect(distanceToPolygonEdge(p.pos, isl.contour, isl.holes), w).toBeGreaterThanOrEqual(BALL_RADIUS_PX);
    expect(
      Math.hypot(p.pos[0] - stage.start.pos[0], p.pos[1] - stage.start.pos[1]),
      w,
    ).toBeGreaterThanOrEqual(4 * D - 0.01);
    expect(Math.hypot(p.pos[0] - stage.goal.pos[0], p.pos[1] - stage.goal.pos[1]), w).toBeGreaterThanOrEqual(
      4 * D - 0.01,
    );
    expect(p.label.length, w).toBeLessThanOrEqual(60);
    // the portal comes from a real link on this slice and sits on (or right by) its text
    const el = byId.get(p.sourceElementId);
    expect(el?.href, w).toBe(p.href);
    expect(['link', 'button'], w).toContain(el?.kind);
    if (el) {
      const local = { ...el.rect, y: el.rect.y - stage.source.slice.y };
      expect(rectDist(p.pos, local), w).toBeLessThanOrEqual(3.6 * D);
    }
    for (const q of portals)
      if (q !== p)
        expect(Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1]), w).toBeGreaterThan(6 * D - 0.01);
  }
  return portals;
}

describe('portals on a synthetic page', () => {
  test('link islands get portals: off-site first, junk and chrome links skipped, invariants hold', () => {
    const { capture, image } = linkPage();
    const { stage } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
    const portals = checkPortals(stage, capture, 'synthetic');
    expect(portals.length).toBeGreaterThanOrEqual(2);
    const labels = portals.map((p) => p.label);
    expect(labels).not.toContain('Log in');
    // off-site links rank above the same-site "About this site"
    const aboutIdx = labels.indexOf('About this site');
    if (aboutIdx >= 0)
      expect(portals.slice(0, aboutIdx).every((p) => !p.href.includes('example.test'))).toBe(true);
  });

  test('deterministic per seed, and small items never sit inside a portal ring', () => {
    const { capture, image } = linkPage();
    const input = { capture, image, sliceIndex: 0, seed: 7, difficulty: 'normal' as const };
    const a = buildStage(input).stage;
    expect(JSON.stringify(buildStage(input).stage.portals)).toBe(JSON.stringify(a.portals));
    for (const p of a.portals ?? [])
      for (const it of a.items)
        if (it.kind === 'small')
          expect(Math.hypot(it.pos[0] - p.pos[0], it.pos[1] - p.pos[1])).toBeGreaterThan(12);
  });

  test('a page without link targets has no portals (and every stage carries the field)', () => {
    const { capture, image } = synthCapture(640, 400, [
      { rect: { x: 60, y: 100, w: 200, h: 150 }, kind: 'image' },
      { rect: { x: 320, y: 100, w: 200, h: 150 }, kind: 'link', text: 'No target here' },
    ]);
    const { stage } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
    expect(stage.portals).toEqual([]);
  });
});

describe('helpers', () => {
  const el = (id: number, text: string, href: string, kind: SliceElement['kind'] = 'link'): SliceElement => ({
    id,
    kind,
    rect: { x: 0, y: 0, w: 100, h: 20 },
    lines: [],
    bg: null,
    depth: 1,
    z: 0,
    fontSize: 14,
    text,
    href,
  });

  test('rankPortalCandidates: filters junk and duplicates, prefers off-site, deterministic', () => {
    const els = [
      el(0, 'login', 'https://page.example/login'),
      el(1, '12 comments', 'https://page.example/item?id=1'),
      el(2, 'A long same-site article title', 'https://page.example/a'),
      el(3, 'Off-site story', 'https://other.example/s'),
      el(4, 'Off-site story again', 'https://other.example/s'),
      el(5, '[3]', 'https://page.example/#cite'),
      el(6, 'Report', 'https://page.example/report.pdf'),
      el(7, 'Some help page', 'https://en.wikipedia.org/wiki/Help:Contents'),
      el(8, 'Wrapped button target', 'https://third.example/', 'button'),
      el(9, 'Plain text', 'https://x.example/', 'text'),
    ];
    const r = rankPortalCandidates(els, 'https://page.example/', createRng(1));
    // one of the two links to other.example survives (the better label), the same-site article ranks last
    const ids = r.map((c) => c.element.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(8);
    expect(ids.filter((i) => i === 3 || i === 4)).toHaveLength(1);
    expect(ids[2]).toBe(2);
    expect(r[0]?.offsite).toBe(true);
    const again = rankPortalCandidates(els, 'https://page.example/', createRng(1));
    expect(again.map((c) => c.score)).toEqual(r.map((c) => c.score));
  });

  test('portalHrefOk and portalLabel', () => {
    expect(portalHrefOk('https://a.example/x', 'https://b.example/')).toBe(true);
    expect(portalHrefOk('https://b.example/#top', 'https://b.example/')).toBe(false);
    expect(portalHrefOk('ftp://a.example/', 'https://b.example/')).toBe(false);
    expect(portalHrefOk('https://u:p@a.example/', 'https://b.example/')).toBe(false);
    expect(portalHrefOk('https://a.example/file.zip', 'https://b.example/')).toBe(false);
    expect(portalHrefOk(`https://a.example/${'x'.repeat(2050)}`, 'https://b.example/')).toBe(false);
    expect(portalLabel('  two   words ')).toBe('two words');
    const long = portalLabel('x'.repeat(80));
    expect(long.length).toBe(60);
    expect(long.endsWith('…')).toBe(true);
  });

  test('applyLinkTargets merges only into the capture it was made for, only links without a target', () => {
    const { capture } = linkPage();
    const stripped: CaptureBundle = { ...capture, elements: capture.elements.map(({ href: _, ...e }) => e) };
    const merged = applyLinkTargets(stripped, {
      captureId: capture.captureId,
      hrefs: { '0': 'https://merged.example/', '99': 'https://nowhere.example/', '1': 'javascript:alert(1)' },
    });
    expect(merged.elements[0]?.href).toBe('https://merged.example/');
    expect(merged.elements[1]?.href).toBeUndefined();
    expect(applyLinkTargets(stripped, { captureId: 'other', hrefs: { '0': 'https://x.example/' } })).toBe(
      stripped,
    );
    expect(applyLinkTargets(stripped, null)).toBe(stripped);
  });
});

describe('the 6 capture fixtures (acceptance)', () => {
  const FIXTURES = [
    'hn-front',
    'wikipedia-article',
    'govuk-card-grid',
    'mdn-dark-docs',
    'example-sparse',
    'image-gallery',
  ];

  test.each(FIXTURES)(
    '%s: every slice × difficulty keeps valid portals on link islands',
    { timeout: 120_000 },
    (slug) => {
      const { capture, image } = loadCapture(slug);
      let total = 0;
      for (const difficulty of ['easy', 'normal', 'hard'] as const)
        for (let sliceIndex = 0; sliceIndex < sliceCount(capture); sliceIndex++) {
          const { stage } = buildStage({ capture, image, sliceIndex, seed: 1, difficulty });
          total += checkPortals(stage, capture, `${slug} ${difficulty} slice ${sliceIndex}`).length;
        }
      expect(total, slug).toBeGreaterThan(0);
    },
  );

  test('Hacker News: portals are story links to the submitted sites', () => {
    const { capture, image } = loadCapture('hn-front');
    const { stage } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
    const portals = stage.portals ?? [];
    expect(portals.length).toBeGreaterThanOrEqual(4);
    for (const p of portals) expect(new URL(p.href).hostname).not.toBe('news.ycombinator.com');
  });

  test('Wikipedia: every slice links onward to articles', () => {
    const { capture, image } = loadCapture('wikipedia-article');
    for (let sliceIndex = 0; sliceIndex < sliceCount(capture); sliceIndex++) {
      const { stage } = buildStage({ capture, image, sliceIndex, seed: 1, difficulty: 'normal' });
      const wiki = (stage.portals ?? []).filter((p) => /^https:\/\/en\.wikipedia\.org\/wiki\//.test(p.href));
      expect(wiki.length, `slice ${sliceIndex}`).toBeGreaterThanOrEqual(3);
    }
  });
});
