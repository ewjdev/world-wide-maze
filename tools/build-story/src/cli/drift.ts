/**
 * `pnpm record:drift`: report where the build record (/log's "Since launch" list, docs/facts/whats-built.md, the
 * docent corpus) lags the repository. Reads the working tree, so it sees uncommitted edits.
 *
 *   node tools/build-story/src/cli/drift.ts [--base <ref>] [--format text|md] [--out <file>] [--github] [--strict]
 *
 * --base    also check the change against <ref> (PR mode: product code changed without a build-log update)
 * --out     write the Markdown report (the PR comment) to a file
 * --github  print warning annotations and append the report to $GITHUB_STEP_SUMMARY
 * --strict  exit 1 when anything is out of sync (default: always exit 0; CI never blocks on this)
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildIndex, INDEX_OUT } from '../../../docent-index/src/build.ts';
import {
  checkRecord,
  FACTS_FILE,
  renderAnnotations,
  renderMarkdown,
  renderText,
  SINCE_LAUNCH_FILE,
  type SinceLaunch,
} from '../record.ts';
import { TIMELINE_FILE } from '../repo.ts';
import type { Timeline } from '../types.ts';

const repo = resolve(import.meta.dirname, '../../../..');
const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    format: { type: 'string', default: 'text' },
    out: { type: 'string' },
    github: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
  },
});

const read = (p: string) => readFileSync(join(repo, p), 'utf8');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const lines = (s: string) => s.split('\n').filter(Boolean);
const slugOf = (p: string) => (p.split('/').pop() ?? '').replace(/\.md$/, '');

const timeline = JSON.parse(read(TIMELINE_FILE)) as Timeline;
const logs = readdirSync(join(repo, 'docs/build-log'))
  .filter((f) => f.endsWith('.md'))
  .map(slugOf)
  .sort();

// The launch build's logs: what existed at the clock's snapshot. A shallow clone can't see it; fall back to the
// logs the timeline's runs cite (supplements then show up as unlisted, which says to fetch history).
let launchLogs: string[];
let commitsSince: number;
try {
  launchLogs = lines(git('ls-tree', '--name-only', timeline.asOf.sha, 'docs/build-log/'))
    .filter((p) => p.endsWith('.md'))
    .map(slugOf);
  commitsSince = Number(git('rev-list', '--count', `${timeline.asOf.sha}..HEAD`));
} catch {
  launchLogs = timeline.runs.flatMap((r) => (r.log ? [r.log] : []));
  commitsSince = Number.NaN;
}

let committed: string | null = null;
if (existsSync(join(repo, INDEX_OUT))) committed = (JSON.parse(read(INDEX_OUT)) as { hash: string }).hash;

let changed: string[] | undefined;
if (values.base) {
  const mergeBase = git('merge-base', values.base, 'HEAD');
  // committed and uncommitted changes since the branch point, plus new untracked files
  changed = [
    ...new Set([
      ...lines(git('diff', '--name-only', mergeBase)),
      ...lines(git('ls-files', '--others', '--exclude-standard')),
    ]),
  ];
}

const findings = checkRecord({
  logs,
  launchLogs,
  facts: read(FACTS_FILE),
  sinceLaunch: JSON.parse(read(SINCE_LAUNCH_FILE)) as SinceLaunch,
  clock: { sha: timeline.asOf.sha, at: timeline.asOf.at, commitsSince },
  planPhases: readdirSync(join(repo, 'plans'))
    .map((f) => /^phase-(\d{2}[a-z]?)-/.exec(f)?.[1])
    .filter((p): p is string => !!p)
    .sort(),
  corpus: { committed, current: buildIndex(repo).hash },
  ...(changed ? { changed } : {}),
});

const md = renderMarkdown(findings);
if (values.out) writeFileSync(values.out, md);
if (values.github) {
  const notes = renderAnnotations(findings);
  if (notes) console.log(notes);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
process.stdout.write(values.format === 'md' ? md : renderText(findings));

const drift = findings.some((f) => f.level === 'drift');
if (values.github) {
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `drift=${drift}\n`);
}
process.exit(values.strict && drift ? 1 : 0);
