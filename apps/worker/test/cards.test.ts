/**
 * Phase 18 share cards, in Node: text safety and layout, card data keys, the journey-link distrust rules, the PNG
 * thumbnailer, the meta-tag injection, and one render of every card kind through the same resvg WASM + fonts the
 * Worker uses (the Worker path itself is covered by cards.integration.test.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StageData } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { fixtureArt, nodeFonts, renderNode } from '../node/cards-node.ts';
import { stageArt } from '../src/cards/art.ts';
import { type CardData, cardKey, RENDERER_VERSION, type StageInfo } from '../src/cards/data.ts';
import { decodeTrail, drawnHosts, PER_SITE_MAX, safeHost } from '../src/cards/journey.ts';
import { encodePng, pngCropThumb, pngSize } from '../src/cards/png.ts';
import { cardSvg } from '../src/cards/svg.ts';
import {
  CARD_TEXT_RE,
  cardTitle,
  cleanText,
  covers,
  escapeXml,
  fit,
  hostOf,
  measure,
  wrap,
} from '../src/cards/text.ts';
import { injectMeta, type PageMeta, sharePage } from '../src/routes/share-html.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const stage = JSON.parse(
  readFileSync(resolve(root, 'fixtures/stages/handmade-simple.json'), 'utf8'),
) as StageData;
const texture = new Uint8Array(readFileSync(resolve(root, 'fixtures/stages/handmade-simple.png')));
const fonts = nodeFonts();

const b64url = (s: string) =>
  Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const info = (over: Partial<StageInfo> = {}): StageInfo => ({
  stageId: stage.stageId,
  title: 'Example News',
  host: 'news.example.org',
  slice: { index: 0, count: 1 },
  difficulty: 'normal',
  stars: null,
  art: { kind: 'islands', texture: 'none' },
  ...over,
});

describe('text safety', () => {
  test('escapeXml escapes markup and drops characters XML forbids', () => {
    expect(escapeXml(`<script>"a" & 'b'</script>`)).toBe(
      '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;',
    );
    expect(escapeXml('a\u0000b\u0008c\u001Fd\uFFFEe')).toBe('abcde');
    expect(escapeXml('x\uD800y')).toBe('xy'); // lone surrogate
    expect(escapeXml('😀')).toBe('😀'); // a valid pair survives
    expect(escapeXml('tab\tline\nok')).toBe('tab\tline\nok');
  });
  test('cleanText removes bidi overrides and invisible characters, collapses space, caps length', () => {
    expect(cleanText('evil\u202Egnp.exe', 50)).toBe('evilgnp.exe');
    expect(cleanText('a\u200Bb\u2066c\u2069\uFEFFd', 50)).toBe('abcd');
    expect(cleanText('  many \n\t spaces  ', 50)).toBe('many spaces');
    expect(cleanText('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
    expect([...cleanText('😀'.repeat(20), 5)]).toHaveLength(5);
  });
  test('titles the fonts cannot draw fall back to the host', () => {
    expect(cardTitle('Hacker News', 'news.ycombinator.com')).toBe('Hacker News');
    expect(cardTitle('迷路 - Wikipedia', 'ja.wikipedia.org')).toBe('');
    expect(cardTitle('Émile’s café — “menu”', 'x.org')).toBe('Émile’s café — “menu”');
    expect(cardTitle('example.org', 'example.org')).toBe(''); // no "Play “example.org”"
    expect(hostOf('https://WWW.Example.org/a?b')).toBe('example.org');
    expect(hostOf('javascript:alert(1)')).toBe('');
  });
  test('every character CARD_TEXT_RE admits is in the headline and text fonts', () => {
    const ranges = [[0x20, 0x2200]];
    const missing: string[] = [];
    for (const [a, b] of ranges)
      for (let cp = a as number; cp <= (b as number); cp++) {
        const ch = String.fromCodePoint(cp);
        if (!CARD_TEXT_RE.test(ch)) continue;
        // U+2028/2029 (line/paragraph separators) and some format characters have no glyph by design
        if (/[\u2028\u2029\u200B-\u200F\u00AD\u2011]/.test(ch)) continue;
        for (const [name, f] of [
          ['bold', fonts.bold],
          ['uiBold', fonts.uiBold],
        ] as const)
          if (!covers(f, ch)) missing.push(`${name} U+${cp.toString(16)}`);
      }
    expect(missing).toEqual([]);
    for (const ch of '0123456789,#') expect(covers(fonts.display, ch)).toBe(true);
  });
});

describe('layout', () => {
  test('wrap never exceeds the width; overflow ellipsizes the last line', () => {
    const text = 'Welcome to GOV.UK: the best place to find government services and information';
    const r = wrap(fonts.bold, text, 50, 520, 3);
    expect(r.lines.length).toBeLessThanOrEqual(3);
    for (const l of r.lines) expect(measure(fonts.bold, l, 50)).toBeLessThanOrEqual(520);
    expect(r.overflow).toBe(true);
    expect(r.lines.at(-1)?.endsWith('…')).toBe(true);
    const host = wrap(fonts.uiBold, 'a'.repeat(120), 30, 300, 2); // no spaces: broken by characters
    for (const l of host.lines) expect(measure(fonts.uiBold, l, 30)).toBeLessThanOrEqual(300);
  });
  test('fit picks the largest size that fits and balances lines without breaking words', () => {
    const r = fit(fonts.uiBold, 'on “Example News”. Can you beat it?', {
      sizes: [32, 30, 28],
      maxW: 530,
      maxLines: 2,
    });
    expect(r.overflow).toBe(false);
    expect(r.size).toBe(32);
    expect(r.lines.join(' ')).toBe('on “Example News”. Can you beat it?');
    if (r.lines.length === 2) expect(r.lines[1]?.split(' ').length).toBeGreaterThan(1); // no lone word
  });
});

describe('card data', () => {
  test('keys are content addresses: same data → same key; any change → a new key', async () => {
    const d: CardData = { kind: 'stage', stage: info() };
    const a = await cardKey(d, 'wwm.ewj.dev');
    expect(a.key).toMatch(/^cards\/stage\/[0-9a-f]{64}\.png$/);
    expect(a.version).toHaveLength(16);
    expect(await cardKey({ kind: 'stage', stage: info() }, 'wwm.ewj.dev')).toEqual(a);
    expect((await cardKey({ kind: 'stage', stage: info({ stars: 3 }) }, 'wwm.ewj.dev')).key).not.toBe(a.key);
    expect((await cardKey(d, 'pr-1-wwm.example.workers.dev')).key).not.toBe(a.key);
    expect(RENDERER_VERSION).toMatch(/^cards-\d+$/);
  });
  test('stage art is bounded', () => {
    const big = {
      ...stage,
      islands: Array.from({ length: 900 }, (_, i) => ({
        ...(stage.islands[0] as StageData['islands'][number]),
        id: i,
        contour: Array.from({ length: 5000 }, (_, k) => [k % 640, (k * 7) % 800] as [number, number]),
      })),
    };
    const art = stageArt(big);
    expect(art.islands.length).toBeLessThanOrEqual(400);
    expect(Math.max(...art.islands.map((i) => i.contour.length))).toBeLessThanOrEqual(160);
  });
});

describe('journey links are distrusted', () => {
  const enc = (o: unknown) => b64url(JSON.stringify(o));
  test('valid payloads decode; hosts only, never the free-text titles', () => {
    const t = decodeTrail(
      enc({
        v: 1,
        s: [
          ['News.Example.org', '<b>t</b>'],
          ['www.python.org', 'x', 'f'.repeat(64)],
        ],
      }),
    );
    expect(t).toEqual({
      stops: [
        { host: 'news.example.org', stageId: null },
        { host: 'python.org', stageId: 'f'.repeat(64) },
      ],
      total: null,
      name: null,
    });
  });
  test('names must pass the leaderboard rules; totals must be plausible; bad hosts become "another site"', () => {
    const t = decodeTrail(
      enc({
        v: 1,
        s: [
          ['fuck.example', 'x'],
          ['a b.com', 'y'],
          ['ok.example', 'z'],
        ],
        p: 3 * PER_SITE_MAX + 1,
        n: 'sh1t',
      }),
    );
    expect(t?.name).toBeNull();
    expect(t?.total).toBeNull();
    expect(t?.stops.map((s) => s.host)).toEqual(['another site', 'another site', 'ok.example']);
    expect(decodeTrail(enc({ v: 1, s: [['a.example', 'x']], p: 1200, n: 'ann_1' }))).toMatchObject({
      total: 1200,
      name: 'ann_1',
    });
    expect(decodeTrail(enc({ v: 1, s: [['a.example', 'x']], n: 'Ann <b>' }))?.name).toBeNull();
  });
  test('garbage is rejected', () => {
    for (const bad of [
      '',
      '!!!',
      b64url('not json'),
      enc({ v: 2, s: [['a.b', 'c']] }),
      enc({ v: 1, s: [] }),
      enc({ v: 1, s: Array(13).fill(['a.b', 'c']) }),
    ])
      expect(decodeTrail(bad)).toBeNull();
    expect(safeHost('localhost')).toBeNull();
    expect(safeHost('xn--80ak6aa92e.com')).toBe('xn--80ak6aa92e.com');
  });
  test('long journeys draw the first stops and the last', () => {
    expect(drawnHosts(['a', 'b', 'c'])).toEqual({ hosts: ['a', 'b', 'c'], more: 0 });
    expect(drawnHosts(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual({
      hosts: ['a', 'b', 'c', 'd', 'g'],
      more: 2,
    });
  });
});

describe('the drawing', () => {
  test('untrusted text is escaped in the SVG; "verified" appears only for verified scores', () => {
    const score = (verified: boolean): CardData => ({
      kind: 'score',
      scoreId: 'x'.repeat(16),
      stage: info({ title: '</text><script>alert(1)</script>"&' }),
      name: 'ann',
      score: 1484,
      rank: 3,
      verified,
      detail: verified ? { small: 9, large: 2, timeBonus: 1275 } : null,
      timeMs: 45_000,
    });
    const svg = cardSvg(score(true), fonts, {}, 'wwm.ewj.dev');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;/text&gt;&lt;script&gt;');
    expect(svg).toContain('Replay verified');
    expect(svg).toContain('255 s left');
    const plain = cardSvg(score(false), fonts, {}, 'wwm.ewj.dev');
    expect(plain).not.toContain('verified');
    expect(plain).not.toContain('large ·'); // no item breakdown without a verified replay
  });
});

describe('PNG thumbnails', () => {
  test('crop + box-downscale streams a slice of the screenshot; encodePng round-trips', async () => {
    expect(pngSize(texture)).toEqual({ width: 1280, height: 1600 });
    const t = await pngCropThumb(texture, 400, 1200, 4);
    expect(t).toMatchObject({ width: 320, height: 200 });
    expect(t.data.length).toBe(320 * 200 * 3);
    const png = await encodePng(t);
    expect(pngSize(png)).toEqual({ width: 320, height: 200 });
    const back = await pngCropThumb(png, 0, 200, 1);
    expect(back.data).toEqual(t.data);
    await expect(pngCropThumb(new Uint8Array([1, 2, 3]), 0, 1, 1)).rejects.toThrow('not a PNG');
  });
});

describe('meta tags', () => {
  const m: PageMeta = {
    title: 'ann scored 1,484 on "Example" <News>',
    description: 'd & e',
    canonical: 'https://wwm.ewj.dev/s/abc',
    image: { url: 'https://wwm.ewj.dev/api/cards/stage/abc.png?v=1', alt: 'alt', width: 1200, height: 630 },
  };
  test('injectMeta replaces the shell’s preview tags and keeps everything else', () => {
    const shell = `<!doctype html><html><head><meta charset="UTF-8" />
<meta name="description" content="old" />
<title>Old</title>
<meta property="og:title" content="Old" />
<meta property="og:image" content="https://old/x.png" />
<meta name="twitter:card" content="summary" />
<script type="module" src="/assets/index.js"></script>
</head><body><div id="root"></div></body></html>`;
    const out = injectMeta(shell, m);
    expect(out).not.toContain('Old');
    expect(out).not.toContain('https://old/x.png');
    expect(out).toContain('<script type="module" src="/assets/index.js"></script>');
    expect(out).toContain(
      '<meta property="og:title" content="ann scored 1,484 on &quot;Example&quot; &lt;News&gt;">',
    );
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(out.match(/og:title/g)).toHaveLength(1);
  });
  test('sharePage has no scripts and escapes everything', () => {
    const html = sharePage(m, '/play/abc?beat=1&by=x', 'Play');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('content="0; url=/play/abc?beat=1&amp;by=x"');
    expect(sharePage(m, null, '')).not.toContain('http-equiv="refresh"');
  });
});

describe('rendering (resvg WASM in Node)', () => {
  const cases: [string, CardData][] = [
    ['stage', { kind: 'stage', stage: info({ stars: 4 }) }],
    [
      'score',
      {
        kind: 'score',
        scoreId: 'y'.repeat(16),
        stage: info(),
        name: 'cocktail_hancock',
        score: 1484,
        rank: 1,
        verified: true,
        detail: { small: 9, large: 2, timeBonus: 1275 },
        timeMs: 45_000,
      },
    ],
    [
      'run',
      {
        kind: 'run',
        scoreId: 'z'.repeat(16),
        name: 'ann',
        total: 12_450,
        rank: 3,
        sites: 4,
        stages: 7,
        hosts: ['a.org', 'b.org', 'c.org', 'd.org'],
      },
    ],
    ['journey', { kind: 'journey', hosts: ['a.org', 'b.org'], more: 0, total: null, name: null }],
    ['site', { kind: 'site' }],
  ];
  test.each(cases)(
    '%s → 1200×630 PNG',
    async (_k, data) => {
      const art =
        data.kind === 'stage' || data.kind === 'score' || data.kind === 'site'
          ? await fixtureArt(stage, texture)
          : {};
      const r = await renderNode(data, art);
      expect({ width: r.width, height: r.height }).toEqual({ width: 1200, height: 630 });
      expect(pngSize(r.png)).toEqual({ width: 1200, height: 630 });
    },
    30_000,
  );
});
