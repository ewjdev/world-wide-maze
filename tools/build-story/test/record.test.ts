import { describe, expect, test } from 'vitest';
import {
  COMMENT_MARKER,
  checkRecord,
  citesLog,
  type Finding,
  isProductPath,
  isRecordPath,
  phasesNamed,
  type RecordInputs,
  renderAnnotations,
  renderMarkdown,
} from '../src/record.ts';

const inSync: RecordInputs = {
  logs: ['phase-01', 'phase-24-race-mode', 'portal-windows'],
  launchLogs: ['phase-01'],
  facts: 'Phase 01 (`phase-01`). Phase 24 (`phase-24-race-mode`), and `portal-windows`. Snapshot `abc1234`.',
  sinceLaunch: {
    after: 'abc1234',
    entries: [
      {
        id: 'race',
        title: 'Race',
        summary: 'Race.',
        status: 'live',
        statusNote: 'on',
        logs: ['phase-24-race-mode'],
      },
      {
        id: 'portals',
        title: 'Portal windows',
        summary: 'See through.',
        status: 'switched-off',
        statusNote: 'off',
        logs: ['portal-windows'],
      },
    ],
  },
  clock: { sha: 'abc1234', at: '2026-09-25T11:18:56-07:00', commitsSince: 12 },
  planPhases: ['01', '24'],
  corpus: { committed: 'h1', current: 'h1' },
};

const ids = (f: Finding[]) => f.filter((x) => x.level === 'drift').map((x) => x.id);

describe('checkRecord', () => {
  test('an in-sync record has no drift, only the clock note', () => {
    const f = checkRecord(inSync);
    expect(ids(f)).toEqual([]);
    expect(f.map((x) => x.id)).toEqual(['clock-snapshot']);
    expect(f[0]?.title).toContain('12 commits ago');
  });

  test('a new build log must be listed under “Since launch” and cited on the facts page', () => {
    const f = checkRecord({ ...inSync, logs: [...inSync.logs, 'phase-32'] });
    expect(ids(f)).toEqual(['since-launch-unlisted', 'facts-uncited-logs']);
    expect(f[0]?.items).toEqual(['phase-32']);
  });

  test('launch-build logs need only the facts page', () => {
    const f = checkRecord({
      ...inSync,
      logs: [...inSync.logs, 'phase-02'],
      launchLogs: ['phase-01', 'phase-02'],
    });
    expect(ids(f)).toEqual(['facts-uncited-logs']);
  });

  test('a cited log that does not exist, a stale `after`, a stale snapshot and a stale corpus', () => {
    const f = checkRecord({
      ...inSync,
      logs: ['phase-01', 'phase-24-race-mode'],
      clock: { ...inSync.clock, sha: 'def5678' },
      corpus: { committed: 'h1', current: 'h2' },
    });
    expect(ids(f)).toEqual([
      'since-launch-unknown',
      'since-launch-after',
      'facts-clock-snapshot',
      'docent-corpus',
    ]);
  });

  test('a planned phase the facts page never names', () => {
    const f = checkRecord({ ...inSync, planPhases: ['01', '24', '33'] });
    expect(ids(f)).toEqual(['facts-missing-phases']);
    expect(f[0]?.items).toEqual(['Phase 33']);
  });

  test('PR mode: product code without a record change is flagged; with one, or tests only, it is not', () => {
    const code = ['apps/web/src/race/Race.tsx', 'apps/web/src/race/race.ts'];
    expect(ids(checkRecord({ ...inSync, changed: code }))).toEqual(['pr-no-record']);
    expect(checkRecord({ ...inSync, changed: code })[0]?.items).toEqual(['apps/web (2 files)']);
    expect(
      ids(checkRecord({ ...inSync, changed: [...code, 'docs/build-log/phase-24-race-mode.md'] })),
    ).toEqual([]);
    expect(ids(checkRecord({ ...inSync, changed: ['apps/web/src/race/race.test.ts'] }))).toEqual([]);
  });
});

describe('helpers', () => {
  test('phasesNamed reads single phases, lists and ranges', () => {
    const got = phasesNamed('Phase 03 and Phase 15b. Phases 19, 20 and 22. Phases 24–29, but not phase-31.');
    expect([...got].sort()).toEqual(['03', '15b', '19', '20', '22', '24', '25', '26', '27', '28', '29']);
  });
  test('citesLog wants the exact slug, not a prefix of a longer one', () => {
    expect(citesLog('see `phase-08-playtest`', 'phase-08')).toBe(false);
    expect(citesLog('see `phase-08`', 'phase-08')).toBe(true);
    expect(citesLog('docs/build-log/phase-08.md', 'phase-08')).toBe(true);
    expect(citesLog('docs/build-log/phase-08-playtest.md', 'phase-08')).toBe(false);
  });
  test('product and record paths', () => {
    expect(isProductPath('packages/engine/src/world.ts')).toBe(true);
    expect(isProductPath('packages/engine/src/world.test.ts')).toBe(false);
    expect(isProductPath('apps/web/src/test/render-route.tsx')).toBe(false);
    expect(isProductPath('apps/web/e2e/play.e2e.ts')).toBe(false);
    expect(isProductPath('tools/build-story/src/record.ts')).toBe(false);
    expect(isRecordPath('docs/build-log/portal-windows.md')).toBe(true);
    expect(isRecordPath('docs/build-log/assets/x.png')).toBe(false);
  });
});

describe('rendering', () => {
  test('the comment carries the sticky marker and says it never blocks', () => {
    const md = renderMarkdown(checkRecord({ ...inSync, logs: [...inSync.logs, 'phase-32'] }));
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain('2 items out of sync (non-blocking)');
    expect(md).toContain('`phase-32`');
    expect(renderMarkdown(checkRecord(inSync))).toContain('### Build record: in sync');
  });
  test('annotations are one warning per drift finding, newlines escaped', () => {
    const a = renderAnnotations(checkRecord({ ...inSync, corpus: { committed: null, current: 'h2' } }));
    expect(a.split('\n')).toHaveLength(1);
    expect(a).toMatch(
      /^::warning file=apps\/worker\/src\/docent\/corpus\.json,title=Build record out of sync::/,
    );
  });
});
