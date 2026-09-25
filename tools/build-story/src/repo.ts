/** Read everything buildTimeline() needs from a git checkout at one revision (Node only). */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_VERSION_RE, contractVersions, GIT_LOG_FORMAT, parseGitLog } from './git.ts';
import { isCountable, linesByPackage } from './lines.ts';
import type { TimelineInputs } from './timeline.ts';
import type { FileBirths, SessionExtract, TestCounts } from './types.ts';

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
  /** The files git tracks at `rev` (`git ls-files`, for a commit). */
  const tracked = git('ls-tree', '-r', '-z', '--name-only', rev).split('\0').filter(Boolean);
  const files = tracked.filter(isCountable).map((path) => ({ path, text: git('show', `${rev}:${path}`) }));
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
    lines: linesByPackage(files),
    logs,
  };
}
