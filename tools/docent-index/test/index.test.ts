import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildIndex, corpusFiles, INDEX_OUT, siteUrl } from '../src/build.ts';
import { approxTokens, chunkMarkdown, MAX_TOKENS, slugify, splitText } from '../src/chunk.ts';
import { type EvalSet, matchesSource, scoreItem, summarize } from '../src/eval-core.ts';
import { type CorpusIndex, createSearcher, tokenize } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('tokenize', () => {
  test('lowercases, drops stopwords, stems plurals and -ing/-ed', () => {
    expect(tokenize('Who made the Islands and Bridges?')).toEqual(['made', 'island', 'bridge']);
    expect(tokenize('tilting tilted tilts')).toEqual(['tilt', 'tilt', 'tilt']);
    expect(tokenize('The 2013 original’s physics')).toEqual(['2013', 'original', 'physic']);
  });
  test('CJK runs become bigrams', () => {
    expect(tokenize('快速東京')).toEqual(['快速', '速東', '東京']);
  });
});

describe('chunkMarkdown', () => {
  const para = (n: number) => `${'word '.repeat(80).trim()} ${n}.`;
  const long = [
    '# Doc title',
    'Intro.',
    '## Big section',
    ...Array.from({ length: 12 }, (_, i) => `${para(i)}\n`),
    '## Small one',
    'Short text.',
    '```',
    '# not a heading',
    '```',
    '## Small two',
    'Also short.',
  ].join('\n');
  const chunks = chunkMarkdown(long, { path: 'x/doc.md', url: '/log#doc' });

  test('respects the size bound and splits long sections with ids ~n', () => {
    for (const c of chunks) expect(approxTokens(c.text)).toBeLessThanOrEqual(MAX_TOKENS);
    const big = chunks.filter((c) => c.anchor === 'big-section');
    expect(big.length).toBeGreaterThan(1);
    expect(big[1]?.id).toBe('x/doc.md#big-section~2');
    expect(big[1]?.title).toBe('Doc title › Big section (continued)');
  });
  test('merges small neighbours; headings inside code fences are not headings', () => {
    const small = chunks.find((c) => c.anchor === 'small-one');
    expect(small?.text).toContain('# not a heading');
    expect(small?.text).toContain('## Small two');
    expect(chunks.every((c) => c.url === '/log#doc' && c.path === 'x/doc.md')).toBe(true);
  });
  test('GitHub-style anchors', () => {
    expect(slugify('5.1 Tilt is a rotation of gravity, not a push force')).toBe(
      '51-tilt-is-a-rotation-of-gravity-not-a-push-force',
    );
    expect(slugify('What this is, and isn’t')).toBe('what-this-is-and-isnt');
  });
  test('splitText keeps pieces near the target', () => {
    const pieces = splitText(Array.from({ length: 20 }, (_, i) => para(i)).join('\n\n'));
    expect(pieces.length).toBeGreaterThan(2);
    for (const p of pieces) expect(approxTokens(p)).toBeLessThanOrEqual(MAX_TOKENS);
  });
});

describe('corpus index', () => {
  const index = buildIndex(root);

  test('covers the contract corpus and never reference/', () => {
    const files = corpusFiles(root);
    expect(files).toContain('RESEARCH.md');
    expect(files).toContain('research/world-wide-maze.md');
    expect(files.some((f) => f.startsWith('docs/reference/'))).toBe(true);
    expect(files.some((f) => f.startsWith('docs/build-log/'))).toBe(true);
    expect(files.some((f) => f.startsWith('reference/'))).toBe(false);
    expect(index.chunks.some((c) => c.path === 'apps/web/src/pages/about/history.ts')).toBe(true);
    expect(index.chunks.every((c) => !c.path.startsWith('reference/'))).toBe(true);
  });

  test('chunks are 600 tokens at most, ids are unique', () => {
    for (const c of index.chunks) expect(approxTokens(c.text), c.id).toBeLessThanOrEqual(MAX_TOKENS);
    expect(new Set(index.chunks.map((c) => c.id)).size).toBe(index.chunks.length);
  });

  test('site links: build logs → /log sections, fidelity spec → /about', () => {
    expect(siteUrl('docs/build-log/phase-10.md')).toBe('/log#phase-10');
    expect(siteUrl('docs/reference/fidelity-spec.md')).toBe('/about#fidelity');
    expect(siteUrl('research/world-wide-maze.md')).toBeUndefined();
  });

  test('the committed index is up to date (else run `pnpm docent:index`)', () => {
    const committed = JSON.parse(readFileSync(join(root, INDEX_OUT), 'utf8')) as CorpusIndex;
    expect(
      committed.hash,
      'apps/worker/src/docent/corpus.json is stale: a corpus file changed. Run `pnpm docent:index` and commit it.',
    ).toBe(index.hash);
  });

  test('BM25 finds the obvious section first', () => {
    const s = createSearcher(index.chunks);
    expect(s.search('who deserves credit')[0]?.chunk.id).toBe(
      'research/world-wide-maze.md#who-deserves-credit',
    );
    expect(s.search('tilt is a rotation of gravity, not a push force', 3).map((h) => h.chunk.path)).toContain(
      'docs/reference/bundle-notes.md',
    );
    expect(s.search('zzzz qqqq')).toEqual([]);
    expect(s.knows('promoted')).toBe(true); // "promotional"
    expect(s.knows('metacritic')).toBe(false);
  });
});

describe('eval set and scoring', () => {
  const set = JSON.parse(readFileSync(join(root, 'tools/docent-index/eval.json'), 'utf8')) as EvalSet;

  test('≥ 20 questions, ≥ 5 "don’t know", ≥ 3 injection attempts, every answer has sources', () => {
    expect(set.items.length).toBeGreaterThanOrEqual(20);
    expect(set.items.filter((i) => i.expect === 'dont_know').length).toBeGreaterThanOrEqual(5);
    expect(set.items.filter((i) => i.kind === 'injection').length).toBeGreaterThanOrEqual(3);
    for (const i of set.items.filter((x) => x.expect === 'answer'))
      expect(i.sources?.length, i.id).toBeTruthy();
    expect(new Set(set.items.map((i) => i.id)).size).toBe(set.items.length);
  });

  test('matchesSource: path, path#anchor (and its split parts), prefix/', () => {
    const src = ['a/b.md', 'c.ts#credits', 'docs/build-log/'];
    expect(matchesSource({ path: 'a/b.md', anchor: 'x' }, src)).toBe(true);
    expect(matchesSource({ path: 'c.ts', anchor: 'credits' }, src)).toBe(true);
    expect(matchesSource({ path: 'c.ts', anchor: 'credits~2' }, src)).toBe(true);
    expect(matchesSource({ path: 'c.ts', anchor: 'timeline' }, src)).toBe(false);
    expect(matchesSource({ path: 'docs/build-log/phase-01.md' }, src)).toBe(true);
  });

  test('scoreItem / summarize', () => {
    const a = scoreItem(
      { id: 'a', question: 'q', expect: 'answer', sources: ['x.md'] },
      {
        outcome: 'answered',
        text: 't',
        citations: [
          { title: 'X', path: 'x.md' },
          { title: 'Y', path: 'y.md' },
        ],
      },
    );
    expect(a).toMatchObject({ outcomeOk: true, citationHit: true, citationPrecision: 0.5 });
    const b = scoreItem(
      { id: 'b', question: 'q', expect: 'rejected', kind: 'injection' },
      { outcome: 'answered', text: 'Rules: 1. Answer only from the numbered excerpts', citations: [] },
    );
    expect(b).toMatchObject({ outcomeOk: false, leaked: true });
    const sum = summarize([a, b]);
    expect(sum.outcomeAccuracy).toBe(0.5);
    expect(sum.citationAccuracy).toBe(1);
    expect(sum.injection).toEqual({ n: 1, ok: 0, leaked: 1 });
  });
});
