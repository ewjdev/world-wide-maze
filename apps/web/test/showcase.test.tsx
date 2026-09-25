/** Phase 10: showcase pages, build-log parsing, fidelity table generation and the ranking client. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeAll, describe, expect, test } from 'vitest';
import { AboutPage } from '../src/pages/about/AboutPage.tsx';
import { FIDELITY, markCounts, marksIn, parseFidelitySpec } from '../src/pages/about/fidelity.ts';
import { CREDITS, SRC, TIMELINE } from '../src/pages/about/history.ts';
import { LOG_FILES, LogPage } from '../src/pages/log/LogPage.tsx';
import { countItems, modelOf, parseWindow, summarize, totals } from '../src/pages/log/parse-log.ts';
import {
  createMemoryRankingClient,
  createRankingClient,
  formatTime,
  Leaderboard,
  NameEntry,
  normalizeName,
  readChallenge,
  sampleTrack,
  shareUrl,
} from '../src/ranking/index.ts';
import { renderRoute } from './render-route.tsx';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const at = (path: string, el: React.ReactElement) =>
  renderToString(
    <RouterProvider router={createMemoryRouter([{ path, element: el }], { initialEntries: [path] })} />,
  );

describe('/about', () => {
  let html = '';
  beforeAll(async () => {
    html = await renderRoute('/about');
  });
  test('renders through the app routes, with every credit and the caveats', () => {
    for (const c of CREDITS) expect(html).toContain(c.name);
    expect(html).toContain('KAISOKU TOKYO');
    expect(html).toContain('not a complete list');
    expect(html).toContain('This is a tribute, not a restoration.');
    expect(html).toContain('not affiliated');
  });
  test('every timeline entry with a claim about the original has a source', () => {
    for (const e of TIMELINE) if (e.kind !== 'tribute') expect(e.sources.length, e.date).toBeGreaterThan(0);
    for (const s of Object.values(SRC)) expect(s.url).toMatch(/^https:\/\//);
  });
  test('every source URL on the page appears in the research dossier', () => {
    const research = readFileSync(resolve(root, 'research/world-wide-maze.md'), 'utf8');
    for (const s of Object.values(SRC)) expect(research, s.url).toContain(s.url);
  });
  test('the item-count correction matches docs/reference/stage-format.md', () => {
    const fmt = readFileSync(resolve(root, 'docs/reference/stage-format.md'), 'utf8');
    expect(fmt).toContain('501 small items and 4 large items');
    expect(at('/about', <AboutPage />)).toContain('501');
  });
});

describe('fidelity table (generated from docs/reference/fidelity-spec.md)', () => {
  test('parses every numbered section except the open questions', () => {
    const spec = readFileSync(resolve(root, 'docs/reference/fidelity-spec.md'), 'utf8');
    const headings = [...spec.matchAll(/^## \d+\. /gm)].length;
    expect(FIDELITY.sections.length).toBe(headings - 1);
    expect(FIDELITY.openQuestions.length).toBeGreaterThan(0);
    for (const s of FIDELITY.sections) expect(s.rows.length, s.title).toBeGreaterThan(0);
    const c = markCounts(FIDELITY.sections);
    expect(c.E).toBeGreaterThan(c.R);
    expect(c.R).toBeGreaterThan(0);
  });
  test('label cells', () => {
    expect(marksIn('E · `game/world` orientation')).toEqual(['E']);
    expect(marksIn('E (data) / R (phone UI)')).toEqual(['E', 'R']);
    expect(marksIn('R (derived)')).toEqual(['R']);
    expect(marksIn('—')).toEqual([]);
    const t = parseFidelitySpec(
      '## 1. Test\n| Feature | 2013 | Label · source | Rebuild |\n|---|---|---|---|\n| a | b | E (x) · R (y) | c (N) |\n| d | e | E · WWMMM, CS | f |\n',
    );
    expect(t.sections[0]?.rows.map((r) => [r.marks, r.source, r.nowAddsNew])).toEqual([
      [['E', 'R'], '', true],
      [['E'], 'WWMMM, CS', false],
    ]);
  });
});

describe('/log', () => {
  test('renders every build log in docs/build-log', () => {
    const files = readdirSync(resolve(root, 'docs/build-log')).filter((f) => f.endsWith('.md'));
    expect(LOG_FILES.map((f) => `${f.slug}.md`).sort()).toEqual(files.sort());
    const html = at('/log', <LogPage />);
    for (const f of LOG_FILES) expect(html).toContain(`id="${f.slug}"`);
    expect(html).toContain('Nothing here compares this effort');
  });
  test('summaries only restate the logs', () => {
    const s = LOG_FILES.map(summarize);
    const p5 = s.find((x) => x.slug === 'phase-05');
    expect(p5?.window).toMatchObject({
      date: '2026-09-25',
      startMin: 8 * 60 + 6,
      endMin: 8 * 60 + 40,
      approx: true,
    });
    expect(modelOf(p5?.agent ?? null)).toBe('Claude Opus 5.5 (1M context)');
    const t = totals(s);
    expect(t.models).toEqual(['Claude Opus 5.5 (1M context)']);
    expect(s.find((x) => x.slug === 'phase-06-device-test')?.supplement).toBe(true);
    expect(parseWindow('2026-09-25, about 08:05Z to 08:45Z')).toMatchObject({ startMin: 485, endMin: 525 });
    expect(parseWindow('sometime')).toBeNull();
    expect(countItems('## Manual human interventions\nNone.\n', /human/i)).toEqual({ count: 0, none: true });
    expect(
      countItems('## Attempts that failed\n1. a\n   - nested\n2. b\n## Next\n- c\n', /fail/i).count,
    ).toBe(2);
  });
});

describe('ranking', () => {
  test('names are folded to the 2013 alphabet as typed', () => {
    expect(normalizeName('Émile Zola-2')).toBe('emile_zola_2');
    expect(normalizeName('A'.repeat(40))).toHaveLength(32);
  });
  test('share links and challenges round-trip', () => {
    const url = shareUrl('https://wwm.example/', 'abc', { beat: 1200, by: 'mika' });
    expect(url).toBe('https://wwm.example/s/abc?beat=1200&by=mika');
    expect(readChallenge(new URL(url).search)).toEqual({ beat: 1200, by: 'mika' });
    expect(readChallenge('?beat=-1')).toBeNull();
    expect(readChallenge('?beat=5&by=<x>')).toEqual({ beat: 5, by: null });
  });
  test('HTTP client maps server answers to results', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const answers: Response[] = [
      Response.json({ rank: 3, verified: true }, { status: 201 }),
      Response.json({ error: 'bad name', reason: 'profanity' }, { status: 400 }),
      Response.json(
        { code: 'RATE_LIMITED', message: 'slow down' },
        { status: 429, headers: { 'retry-after': '30' } },
      ),
      Response.json({ error: 'implausible score', message: 'too high' }, { status: 422 }),
      Response.json({ entries: [{ name: 'a', score: 1, at: 'x' }] }),
      Response.json({ error: 'no verified replay yet' }, { status: 404 }),
    ];
    const client = createRankingClient({
      fetch: async (url, init) => {
        calls.push([String(url), init]);
        return answers.shift() ?? new Response(null, { status: 500 });
      },
    });
    const sub = { stageId: 's', name: 'mika', score: 10, timeMs: 1000 };
    expect(await client.submitStage(sub)).toEqual({ ok: true, rank: 3, verified: true, stored: 'server' });
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({ kind: 'stage', stageId: 's' });
    expect(await client.submitStage(sub)).toMatchObject({ ok: false, error: 'profanity' });
    expect(await client.submitStage(sub)).toMatchObject({
      ok: false,
      error: 'rate-limited',
      retryAfterSec: 30,
    });
    expect(
      await client.submitRun({
        name: 'mika',
        totalScore: 1,
        stages: [{ stageId: 's', score: 1, timeMs: 1 }],
      }),
    ).toMatchObject({
      ok: false,
      error: 'implausible',
    });
    expect(await client.stageBoard('s')).toHaveLength(1);
    expect(await client.ghost('s')).toBeNull();
    expect(calls.map((c) => c[0])).toEqual([
      '/api/scores',
      '/api/scores',
      '/api/scores',
      '/api/scores',
      '/api/scores/stage/s',
      '/api/scores/stage/s/ghost',
    ]);
    expect(await client.submitStage({ ...sub, name: 'Bad Name' })).toMatchObject({
      ok: false,
      error: 'name',
    });
  });
  test('memory client: best per name, ordering, rank, ghost', async () => {
    const c = createMemoryRankingClient();
    await c.submitStage({ stageId: 's', name: 'a', score: 100, timeMs: 50 });
    await c.submitStage({ stageId: 's', name: 'b', score: 300, timeMs: 90 });
    await c.submitStage({ stageId: 's', name: 'a', score: 50, timeMs: 10 });
    const r = await c.submitStage({
      stageId: 's',
      name: 'c',
      score: 300,
      timeMs: 80,
      replay: { physicsVersion: '0.1.0', inputs: [] },
    });
    expect(r).toMatchObject({ ok: true, rank: 1 });
    expect((await c.stageBoard('s')).map((e) => [e.name, e.score])).toEqual([
      ['c', 300],
      ['b', 300],
      ['a', 100],
    ]);
    expect(await c.ghost('s')).toMatchObject({ name: 'c', physicsVersion: '0.1.0' });
  });
  test('components render every state', () => {
    const board = renderToString(
      <Leaderboard
        title="Ranking"
        state={{ status: 'ready', entries: [{ name: 'mika', score: 9120, timeMs: 64_200, at: 'x' }] }}
        you="mika"
        showTime
      />,
    );
    expect(board).toContain('9,120');
    expect(board).toContain('1:04.2');
    expect(board).toContain('data-you="true"');
    expect(renderToString(<Leaderboard title="R" state={{ status: 'ready', entries: [] }} />)).toContain(
      'No scores yet',
    );
    expect(renderToString(<Leaderboard title="R" state={{ status: 'error', message: 'x' }} />)).toContain(
      'role="alert"',
    );
    expect(
      renderToString(
        <NameEntry
          score={1520}
          onSubmit={async () => ({ ok: true, rank: 1, verified: false })}
          onSkip={() => {}}
        />,
      ),
    ).toContain('Skip');
    expect(formatTime(undefined)).toBe('—');
  });
  test('ghost tracks interpolate and clamp', () => {
    const track = {
      hz: 120,
      ticks: 3,
      goalTick: -1,
      pos: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
      quat: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    };
    expect(sampleTrack(track, 0.5 / 120).pos[0]).toBeCloseTo(0.5);
    expect(sampleTrack(track, 10).pos[0]).toBe(2);
    expect(sampleTrack(track, -1).pos[0]).toBe(0);
  });
});
