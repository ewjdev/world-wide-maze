/**
 * Collect the local-only sources into content/build-story/sources/, so the timeline can be rebuilt (and checked)
 * from files in the repo:
 *   - session.json: a content-free extract of the orchestrating Claude Code session (timestamps, word counts,
 *     agent descriptions; no prompt or tool text);
 *   - files.json: birth times of the research and plan files written before the first commit;
 *   - tests.json: test counts from a Vitest JSON report.
 *
 *   node tools/build-story/src/cli/collect.ts [--session <file.jsonl>] [--root <owner checkout>] [--vitest <report.json>]
 *
 * Without --vitest it runs `pnpm vitest run --reporter=json` (about 2–3 minutes).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PRE_GIT_FILES } from '../annotations.ts';
import { extractSession } from '../session.ts';
import type { FileBirths, TestCounts } from '../types.ts';

const repo = resolve(import.meta.dirname, '../../../..');
const out = join(repo, 'content/build-story/sources');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

const { values } = parseArgs({
  options: { session: { type: 'string' }, root: { type: 'string' }, vitest: { type: 'string' } },
});

/** The owner's checkout (worktrees share its .git), where file birth times and the session live. */
const ownerRoot = values.root ?? dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir'));
mkdirSync(out, { recursive: true });

// ── session ──
const projectDir = join(homedir(), '.claude/projects', ownerRoot.replace(/[/.]/g, '-'));
const sessionFile =
  values.session ??
  readdirSync(projectDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(projectDir, f))
    .sort((a, b) => statSync(b).size - statSync(a).size)[0];
if (!sessionFile || !existsSync(sessionFile)) throw new Error(`no session transcript in ${projectDir}`);
const sessionId = basename(sessionFile, '.jsonl');
const subDir = join(dirname(sessionFile), sessionId, 'subagents');
const agents = existsSync(subDir)
  ? readdirSync(subDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
        const metaFile = join(subDir, f.replace(/\.jsonl$/, '.meta.json'));
        return {
          id,
          meta: existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {},
          jsonl: readFileSync(join(subDir, f), 'utf8'),
        };
      })
  : [];
const session = extractSession(sessionId, readFileSync(sessionFile, 'utf8'), agents);
writeFileSync(join(out, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
console.log(
  `session ${sessionId}: ${session.ownerMessages.length} owner messages, ${session.turns.length} turns, ${session.agents.length} agents`,
);

// ── file births ──
const births: FileBirths = {
  root: ownerRoot.replace(homedir(), '~'),
  method: 'file birth time (stat st_birthtime) in the owner’s checkout',
  files: PRE_GIT_FILES.filter((p) => existsSync(join(ownerRoot, p))).map((p) => ({
    path: p,
    born: statSync(join(ownerRoot, p))
      .birthtime.toISOString()
      .replace(/\.\d{3}Z$/, 'Z'),
  })),
};
writeFileSync(join(out, 'files.json'), `${JSON.stringify(births, null, 2)}\n`);
console.log(`files: ${births.files.map((f) => `${f.path} ${f.born}`).join(', ')}`);

// ── tests ──
let reportFile = values.vitest;
const command = 'pnpm vitest run --reporter=json';
if (!reportFile) {
  reportFile = join(tmpdir(), `wwm-vitest-${process.pid}.json`);
  try {
    execFileSync('pnpm', ['vitest', 'run', '--reporter=json', `--outputFile=${reportFile}`], {
      cwd: repo,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch {
    // failures still write the report; the counts say so
  }
}
interface VitestReport {
  numPassedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  numFailedTests: number;
  testResults: { name: string; assertionResults: { status: string }[] }[];
}
const report = JSON.parse(readFileSync(reportFile, 'utf8')) as VitestReport;
const byProject = new Map<string, { passed: number; skipped: number }>();
for (const f of report.testResults) {
  const rel = relative(repo, f.name);
  const project = /^((?:apps|packages|tools)\/[^/]+)/.exec(rel)?.[1] ?? 'other';
  const row = byProject.get(project) ?? { passed: 0, skipped: 0 };
  for (const a of f.assertionResults) {
    if (a.status === 'passed') row.passed++;
    else if (a.status === 'pending' || a.status === 'skipped' || a.status === 'todo') row.skipped++;
  }
  byProject.set(project, row);
}
const tests: TestCounts = {
  commit: git('rev-parse', '--short', 'HEAD'),
  command,
  passed: report.numPassedTests,
  skipped: report.numPendingTests + report.numTodoTests,
  failed: report.numFailedTests,
  files: report.testResults.length,
  byProject: [...byProject.entries()]
    .map(([project, v]) => ({ project, ...v }))
    .sort((a, b) => b.passed - a.passed),
};
writeFileSync(join(out, 'tests.json'), `${JSON.stringify(tests, null, 2)}\n`);
console.log(
  `tests at ${tests.commit}: ${tests.passed} passed, ${tests.skipped} skipped, ${tests.failed} failed`,
);
