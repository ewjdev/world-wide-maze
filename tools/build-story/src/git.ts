import type { Commit } from './types.ts';

/** `git log` format the parser expects: sha, parents, author date (strict ISO), subject; one record per commit. */
export const GIT_LOG_FORMAT = '%H%x1f%P%x1f%aI%x1f%s%x1e';

export function parseGitLog(out: string): Commit[] {
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha = '', parents = '', at = '', subject = ''] = r.split('\x1f');
      return { sha, parents: parents.split(' ').filter(Boolean), at, subject };
    });
}

/** "Merge phase 03b/05b: …" → "03b/05b"; "Merge phase 12 (local): …" → "12". */
export function mergedPhase(c: Commit): string | null {
  if (c.parents.length < 2) return null;
  const m = /^Merge phase\s+(\d{2}[a-z]?(?:\/\d{2}[a-z]?)?)(?:\s+follow-through)?\b/i.exec(c.subject);
  if (!m?.[1]) return null;
  return /follow-through/i.test(c.subject) ? null : m[1];
}

/** Gate milestones as the orchestrator recorded them in commit subjects ("Gate G1 passed", "gate G0 passed"). */
export function gateOf(c: Commit): string | null {
  return /\bgate\s+(G\d)\s+passed\b/i.exec(c.subject)?.[1]?.toUpperCase() ?? null;
}

/**
 * The first commit at which each contract version appears, given `versionAt(sha)` for commits in order (oldest
 * first). A version that never changes between commits is reported once.
 */
export function contractVersions(
  commits: Commit[],
  versionAt: (sha: string) => string | null,
): { version: string; at: string; sha: string }[] {
  const out: { version: string; at: string; sha: string }[] = [];
  for (const c of commits) {
    const v = versionAt(c.sha);
    if (v && !out.some((o) => o.version === v)) out.push({ version: v, at: c.at, sha: c.sha.slice(0, 7) });
  }
  return out;
}

/** plans/contracts.md states the version on one line: "**Contract version: `0.2.1`**". */
export const CONTRACT_VERSION_RE = /Contract version:\**\s*`v?([\d.]+)`/;
