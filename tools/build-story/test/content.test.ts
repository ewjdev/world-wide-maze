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
    return false; // shallow clone
  }
};

describe('timeline.json', () => {
  test.skipIf(!hasCommit(timeline.asOf.sha))(
    'is exactly what buildTimeline computes from git and content/build-story/sources at its snapshot',
    () => {
      expect(buildTimeline(readRepo(repo, timeline.asOf.sha))).toEqual(timeline);
    },
    60_000,
  );
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
    if (!hasCommit(commit)) return '';
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
    if (!o?.diff || !hasCommit('96414f5')) return;
    const show = source('git:96414f5');
    for (const line of o.diff) expect(show).toContain(line);
  });
});
