import { describe, expect, test } from 'vitest';
import { CATALOG, catalogEntry, FIXTURES, PRACTICE } from '../src/game/catalog.ts';
import { normalizeInputUrl } from '../src/game/stages.ts';
import { en } from '../src/i18n/en.ts';
import { ja } from '../src/i18n/ja.ts';

describe('URL input', () => {
  test.each([
    ['wikipedia.org', 'https://wikipedia.org/'],
    ['  https://news.ycombinator.com  ', 'https://news.ycombinator.com/'],
    ['http://example.com/a?b=1', 'http://example.com/a?b=1'],
    ['localhost:8080/admin', 'https://localhost:8080/admin'],
  ])('%s → %s', (raw, want) => {
    expect(normalizeInputUrl(raw)).toBe(want);
  });
  test.each(['', 'not a url', 'ftp://example.com', 'javascript:alert(1)', 'intranet'])('rejects %s', (raw) => {
    expect(normalizeInputUrl(raw)).toBeNull();
  });
});

describe('catalog', () => {
  test('practice + every fixture capture, with thumbnails', () => {
    expect(CATALOG[0]).toBe(PRACTICE);
    expect(FIXTURES.map((f) => f.slug).sort()).toEqual([
      'bbc-news-grid',
      'example-sparse',
      'govuk-card-grid',
      'hn-front',
      'image-gallery',
      'mdn-dark-docs',
      'wikipedia-article',
    ]);
    for (const e of CATALOG) expect(e.thumb).toMatch(/^\/thumbs\/.+\.webp$/);
    expect(catalogEntry('handmade-simple')).toBe(PRACTICE);
    expect(catalogEntry('fixture-hn-front')?.slug).toBe('hn-front');
  });
});

describe('i18n tables', () => {
  const keys = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? keys(v as object, `${p}${k}.`) : [`${p}${k}`],
    );
  test('ja has exactly the en keys, none empty', () => {
    expect(keys(ja).sort()).toEqual(keys(en).sort());
    for (const k of keys(ja)) {
      const v = k.split('.').reduce<unknown>((o, s) => (o as Record<string, unknown>)[s], ja);
      expect(String(v).length, k).toBeGreaterThan(0);
    }
  });
  test('tutorial glyph placeholders survive translation', () => {
    for (const step of ['step3', 'step4', 'step5'] as const) {
      const g = (s: string) => (s.match(/__[A-Z_]+__/g) ?? []).sort();
      expect(g(ja.tutorial.mobile[step])).toEqual(g(en.tutorial.mobile[step]));
      expect(g(ja.tutorial.pc[step])).toEqual(g(en.tutorial.pc[step]));
    }
  });
});
