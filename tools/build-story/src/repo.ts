/** Read everything buildTimeline() needs from a git checkout at one revision (Node only). */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEGMENTS } from './annotations.ts';
import { CONTRACT_VERSION_RE, contractVersions, GIT_LOG_FORMAT, parseGitLog } from './git.ts';
import { isCountable, linesByPackage } from './lines.ts';
import { segmentEnd, type TimelineInputs } from './timeline.ts';
import type { FileBirths, PackageLines, SessionExtract, TestCounts } from './types.ts';

export const SOURCES_DIR = 'content/build-story/sources';
export const TIMELINE_FILE = 'content/build-story/timeline.json';

export function readRepo(repo: string, rev: string): TimelineInputs {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const json = <T>(p: string) => JSON.parse(readFileSync(join(repo, SOURCES_DIR, p), 'utf8')) as T;

  const commits = parseGitLog(git('log', '--reverse', `--format=${GIT_LOG_FORMAT}`, rev));
  const firstParent = parseGitLog(
    git('log', '--reverse', '--first-parent', `--format=${GIT_LOG_FORMAT}`, rev),
  );
  const versions = contractVersions(firstParent, (sha) => {
    try {
      return (
        CONTRACT_VERSION_RE.exec(
          git('grep', '-h', 'Contract version:', sha, '--', 'plans/contracts.md'),
        )?.[1] ?? null
      );
    } catch {
      return null; // no version line at this commit
    }
  });
  /** The files git tracks at a commit (`git ls-files`, for a commit). */
  const trackedAt = (r: string) => git('ls-tree', '-r', '-z', '--name-only', r).split('\0').filter(Boolean);
  const linesAt = (r: string) =>
    linesByPackage(
      trackedAt(r)
        .filter(isCountable)
        .map((path) => ({ path, text: git('show', `${r}:${path}`) })),
    );
  const tracked = trackedAt(rev);

  // each earlier stretch's closing commit: its line count, and its Vitest counts if they were collected
  const head = commits[commits.length - 1];
  const segmentLines: Record<string, PackageLines[]> = {};
  const segmentTests: Record<string, TestCounts> = {};
  for (const def of SEGMENTS) {
    const end = segmentEnd(commits, def);
    if (!end || end === head) continue;
    segmentLines[def.id] = linesAt(end.sha);
    const testsFile = join(repo, SOURCES_DIR, `tests-${def.id}.json`);
    if (existsSync(testsFile))
      segmentTests[def.id] = JSON.parse(readFileSync(testsFile, 'utf8')) as TestCounts;
  }
  const logs = tracked
    .filter((p) => /^docs\/build-log\/[^/]+\.md$/.test(p))
    .sort()
    .map((p) => ({ slug: p.replace(/^.*\//, '').replace(/\.md$/, ''), md: git('show', `${rev}:${p}`) }));

  return {
    commits,
    contractVersions: versions,
    session: json<SessionExtract>('session.json'),
    births: json<FileBirths>('files.json'),
    tests: json<TestCounts>('tests.json'),
    lines: linesAt(rev),
    logs,
    segmentLines,
    segmentTests,
  };
}
