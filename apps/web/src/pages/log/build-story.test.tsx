/** Phase 16: the build story on /log renders from timeline.json and bugs.json, and the share cards render. */
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeAll, describe, expect, test } from 'vitest';
import { renderRoute } from '../../../test/render-route.tsx';
import { CARD_VARIANTS } from './SocialCard.tsx';
import { BUGS, clock, dur, FIRST, fmtInt, hourTicks, LATER, runsByWave, TL } from './story.ts';

const decode = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

describe('/log build story', () => {
  let html = '';
  beforeAll(async () => {
    html = decode(await renderRoute('/log'));
  });

  test('the hero states Night 1 as its own labelled figure, with its breakdown, from timeline.json', () => {
    expect(FIRST.id).toBe('night-1');
    expect(html).toContain(
      `>${FIRST.label} · ${clock(FIRST.wallClock.start)} → ${clock(FIRST.wallClock.end)}<`,
    );
    expect(html).toMatch(
      new RegExp(`<h1[^>]*>Built in <span[^>]*>${dur(FIRST.wallClock.min)}</span> of wall-clock time</h1>`),
    );
    for (const s of [
      clock(FIRST.wallClock.start, true),
      clock(FIRST.wallClock.end, true),
      FIRST.end.sha,
      dur(FIRST.activeMin),
      dur(FIRST.idle.min),
      dur(FIRST.agents.agentMin),
      `${FIRST.owner.messages} messages`,
      fmtInt(FIRST.owner.words),
      `${fmtInt(FIRST.tests?.passed ?? 0)} tests`,
      fmtInt(FIRST.lines.source),
      `${FIRST.git.commits} commits`,
    ])
      expect(html).toContain(s);
  });

  test('later stretches follow as their own segment, then the total to the snapshot', () => {
    expect(LATER.length).toBeGreaterThan(0);
    for (const s of LATER)
      for (const x of [
        s.label,
        `${dur(s.wallClock.min)} more`,
        dur(s.agents.agentMin),
        `${s.agents.runs} runs`,
        `${s.owner.messages} messages`,
        `${s.git.commits} commits`,
      ])
        expect(html).toContain(x);
    for (const x of [
      `${dur(TL.wallClock.min)}</strong> in all`,
      TL.asOf.sha,
      clock(TL.wallClock.end, true),
      `${fmtInt(TL.tests.passed)} tests`,
      fmtInt(TL.lines.total.source),
      `${TL.git.commits} commits`,
      dur(TL.agents.agentMin),
    ])
      expect(html).toContain(x);
  });

  test('formatting: the wall clock is end − start, shown in the owner’s time zone', () => {
    const min = (Date.parse(TL.wallClock.end) - Date.parse(TL.wallClock.start)) / 60_000;
    expect(dur(TL.wallClock.min)).toBe(dur(min));
    expect(dur(613.2)).toBe('10 h 13 min');
    expect(dur(34)).toBe('34 min');
    expect(clock('2026-09-25T06:44:34Z')).toBe('11:44 pm'); // PDT
    expect(clock('2026-09-25T16:57:48Z', true)).toBe('9:57 am, Sep 25');
    expect(dur(694.4)).toBe('11 h 34 min');
    expect(hourTicks().every((t) => /^\d{1,2} (am|pm)$/.test(t.label))).toBe(true);
  });

  test('the swimlane has every top-level run, grouped by wave, with gates', () => {
    const groups = runsByWave();
    for (const g of groups) for (const r of g.runs) expect(html).toContain(r.title.replace(/’/g, '’'));
    expect(groups.flatMap((g) => g.runs.flatMap((r) => r.helpers))).toHaveLength(TL.agents.helperRuns);
    for (const g of TL.gates) expect(html).toContain(`>${g.id}<`);
  });

  test('the bug gallery shows each solver issue and every other catch, with its quotes', () => {
    for (const b of BUGS.solver) {
      expect(html).toContain(b.id);
      expect(html).toContain(b.saw);
      expect(html).toContain(b.evidence.quote);
    }
    for (const o of BUGS.other) expect(html).toContain(o.title);
  });

  test('2013 vs 2026 draws no verdict; no speed-up claims anywhere', () => {
    expect(html).toContain('2013 and 2026, side by side');
    expect(html).toContain('the original team’s effort was never published');
    expect(html).not.toMatch(/\d+\s*[×x]\s*faster|times faster|faster than/i);
  });

  test('the build record (Phase 10) is still there, below', () => {
    expect(html).toContain('The build record');
    expect(html).toContain('Nothing here compares this effort');
  });

  test('the Phase 15 docent is mounted on the page', () => {
    const src = readFileSync(new URL('./LogPage.tsx', import.meta.url), 'utf8');
    expect(src).toContain('<DocentPanel');
  });
});

describe('share cards', () => {
  test.each(CARD_VARIANTS)('/log?card=%s renders a bare card', async (variant) => {
    const { LogPage } = await import('./LogPage.tsx');
    const router = createMemoryRouter([{ path: '/log', element: <LogPage /> }], {
      initialEntries: [`/log?card=${variant}`],
    });
    const out = decode(renderToString(<RouterProvider router={router} />));
    expect(out).toContain(`data-variant="${variant}"`);
    expect(out).not.toContain('sc-mast'); // no site chrome
    expect(out).toContain(TL.asOf.sha);
  });
});
