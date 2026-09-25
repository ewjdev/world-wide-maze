/**
 * Traceability of the committed content: timeline.json is exactly what the tool computes from git and the
 * committed sources, and every quote in bugs.json is in the file it cites.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readRepo, TIMELINE_FILE } from '../src/repo.ts';
import { buildTimeline } from '../src/timeline.ts';
import type { Timeline } from '../src/types.ts';

const repo = resolve(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');
const timeline = JSON.parse(read(TIMELINE_FILE)) as Timeline;

const hasCommit = (sha: string) => {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repo, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
/**
 * A shallow clone (CI's default checkout) can't see old commits, so the git checks skip there, and only there. In a
 * full clone a missing commit FAILS: after the pre-publication history rewrite every SHA changed, and a silent skip
 * let the references rot. Map old SHAs with .git/filter-repo/commit-map.
 */
const shallow =
  execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: repo, encoding: 'utf8' }).trim() ===
  'true';
const gitTest = shallow ? test.skip : test;

/** Every commit id the committed story cites: timeline.json, bugs.json and the draft post. */
function citedCommits(): { where: string; sha: string }[] {
  const out: { where: string; sha: string }[] = [
    { where: 'timeline asOf', sha: timeline.asOf.sha },
    { where: 'timeline firstCommit', sha: timeline.git.firstCommit.sha },
    ...timeline.segments.map((s) => ({ where: `segment ${s.id}`, sha: s.end.sha })),
    ...timeline.runs.flatMap((r) => (r.merge ? [{ where: `merge of ${r.phase}`, sha: r.merge.sha }] : [])),
    ...timeline.gates.map((g) => ({ where: `gate ${g.id}`, sha: g.sha })),
    ...timeline.contractVersions.map((c) => ({ where: `contract ${c.version}`, sha: c.sha })),
  ];
  const bugsText = read('content/build-story/bugs.json');
  for (const m of bugsText.matchAll(/git:([0-9a-f]{7,40})\b/g))
    out.push({ where: 'bugs.json', sha: m[1] ?? '' });
  for (const m of bugsText.matchAll(/\bat ([0-9a-f]{7,40})\b/g))
    out.push({ where: 'bugs.json', sha: m[1] ?? '' });
  // the draft cites commits in backticks
  for (const m of read('content/build-story/linkedin-draft.md').matchAll(/`([0-9a-f]{7,40})`/g))
    out.push({ where: 'linkedin-draft.md', sha: m[1] ?? '' });
  for (const f of ['tests.json', 'tests-night-1.json'])
    if (existsSync(join(repo, 'content/build-story/sources', f)))
      out.push({
        where: f,
        sha: (JSON.parse(read(`content/build-story/sources/${f}`)) as { commit: string }).commit,
      });
  return out;
}

describe('timeline.json', () => {
  gitTest('every commit it, bugs.json and the draft cite exists in this repository', () => {
    const cited = citedCommits();
    expect(cited.length).toBeGreaterThan(20);
    const missing = cited.filter((c) => !hasCommit(c.sha));
    expect(missing, 'stale commit ids (history rewritten? see .git/filter-repo/commit-map)').toEqual([]);
  });
  gitTest(
    'is exactly what buildTimeline computes from git and content/build-story/sources at its snapshot',
    () => {
      expect(hasCommit(timeline.asOf.sha), `snapshot ${timeline.asOf.sha} is not in this repository`).toBe(
        true,
      );
      expect(buildTimeline(readRepo(repo, timeline.asOf.sha))).toEqual(timeline);
    },
    120_000,
  );
  test('night 1 is kept as its own stretch, and the stretches add up to the whole', () => {
    const [night, ...rest] = timeline.segments;
    expect(night?.id).toBe('night-1');
    expect(night?.wallClock.start).toBe(timeline.wallClock.start);
    expect(timeline.segments.at(-1)?.wallClock.end).toBe(timeline.wallClock.end);
    for (const [k, s] of rest.entries()) expect(s.wallClock.start).toBe(timeline.segments[k]?.wallClock.end);
    const sum = (f: (s: (typeof timeline.segments)[number]) => number) =>
      Math.round(timeline.segments.reduce((a, s) => a + f(s), 0) * 10) / 10;
    expect(sum((s) => s.wallClock.min)).toBeCloseTo(timeline.wallClock.min, 0);
    expect(sum((s) => s.agents.agentMin)).toBeCloseTo(timeline.agents.agentMin, 0);
    expect(sum((s) => s.git.commits)).toBe(timeline.git.commits);
    expect(sum((s) => s.owner.messages)).toBe(timeline.owner.messages);
  });
  test('never claims a speed-up, and names its unknowns', () => {
    const text = read(TIMELINE_FILE);
    expect(text).not.toMatch(/\d+\s*[×x]\s*faster|faster than/i);
    expect(timeline.unknowns.join(' ')).toMatch(/original 2013 team/);
  });
  test('the session extract holds no prompt text', () => {
    const s = read('content/build-story/sources/session.json');
    expect(s).not.toMatch(/"(text|content|message|prompt)"\s*:/);
  });
});

/** Markdown emphasis, code ticks and line wraps don't count when matching a quote. */
const norm = (s: string) =>
  s
    .replace(/\*\*|`/g, '')
    .replace(/^\s*\|\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

interface Quote {
  file: string;
  quote: string;
}
const bugs = JSON.parse(read('content/build-story/bugs.json')) as {
  batch: { quotes: Quote[]; images: Record<string, string> };
  solver: {
    id: string;
    title: string;
    plain: string;
    saw: string;
    sawCommand: string;
    evidence: Quote;
    fix: Quote;
    images: Record<string, string>;
  }[];
  other: { id: string; title: string; plain: string; evidence: Quote; diff?: string[] }[];
};

function source(file: string): string {
  const commit = /^git:(\w+)$/.exec(file)?.[1];
  if (commit) {
    if (shallow) return '';
    // a missing commit throws here, and the test fails
    return execFileSync('git', ['show', commit], { cwd: repo, encoding: 'utf8' });
  }
  return read(file);
}

describe('bugs.json', () => {
  const quotes: Quote[] = [
    ...bugs.batch.quotes,
    ...bugs.solver.flatMap((b) => [b.evidence, b.fix]),
    ...bugs.other.map((o) => o.evidence),
  ];
  test.each(quotes.map((q) => [q.file, q.quote]))('%s says: %s', (file, quote) => {
    const text = source(file);
    if (text) expect(norm(text)).toContain(norm(quote));
  });
  test('the solver’s words: log quotes are in the log, re-run messages match the solver’s templates', () => {
    const solverSrc = readdirSync(join(repo, 'packages/solver/src'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => read(`packages/solver/src/${f}`))
      .join('\n');
    for (const b of bugs.solver) {
      const file = /^(docs\/[^,]+\.md)/.exec(b.sawCommand)?.[1];
      if (file) expect(norm(read(file))).toContain(norm(b.saw));
      else {
        // e.g. "island 9 is split by a neck narrower than the ball" → the template's fixed words
        const words = b.saw.split(/[;(]/)[0]?.replace(/\d+/g, '').replace(/\s+/g, ' ').trim() ?? '';
        const fixed = words.split(' ').filter((w) => w.length > 3);
        for (const w of fixed) expect(solverSrc).toContain(w);
      }
    }
  });
  test('plain-language text carries no figures (numbers come from quotes and timeline.json)', () => {
    for (const b of [...bugs.solver, ...bugs.other])
      expect(`${b.title} ${b.plain}`.replace(/2013/g, '')).not.toMatch(/\d/);
  });
  test('every image exists', () => {
    const imgs = [bugs.batch.images, ...bugs.solver.map((b) => b.images)].flatMap((i) => Object.values(i));
    for (const i of imgs) expect(existsSync(join(repo, 'docs/build-log/assets', i)), i).toBe(true);
  });
  test('the ref:fetch diff is the commit’s diff', () => {
    const o = bugs.other.find((x) => x.id === 'ref-fetch');
    expect(o?.diff?.length).toBeGreaterThan(0);
    if (!o?.diff || shallow) return;
    const show = source(o.evidence.file);
    for (const line of o.diff) expect(show).toContain(line);
  });
});
