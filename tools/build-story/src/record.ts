/**
 * Build record drift: is the public record of the build (/log, docs/facts/whats-built.md, the docent corpus) in step
 * with the work in the repository? A report, never a gate: CI posts it on the PR and carries on (see
 * `src/cli/drift.ts` and the `build-record` job in .github/workflows/ci.yml).
 *
 * Pure: the CLI reads git and the files; this module only compares.
 */

/** `content/build-story/since-launch.json`: what was added after the build clock's snapshot, shown on /log. */
export type SinceLaunchStatus = 'live' | 'paused' | 'switched-off' | 'operator-only';

export interface SinceLaunchEntry {
  id: string;
  title: string;
  /** One or two plain sentences: what a visitor (or the operator) gets. */
  summary: string;
  status: SinceLaunchStatus;
  /** Why the status is what it is (a flag, a PR, a sign-off still open). */
  statusNote: string;
  /** docs/build-log slugs (file names without .md) that record the work. */
  logs: string[];
  /** Other repo documents that record it, for work that has no build log of its own (e.g. docs/launch/*.md). */
  docs?: string[];
  /** Where to see it on the site, if anywhere. */
  href?: string;
}

export interface SinceLaunch {
  /** The build clock snapshot this list continues from (timeline.json `asOf.sha`). */
  after: string;
  entries: SinceLaunchEntry[];
}

export const SINCE_LAUNCH_FILE = 'content/build-story/since-launch.json';
export const FACTS_FILE = 'docs/facts/whats-built.md';

export interface RecordInputs {
  /** Every docs/build-log/*.md slug at the revision checked. */
  logs: string[];
  /** The slugs that already existed at the build clock's snapshot (the launch build). */
  launchLogs: string[];
  facts: string;
  sinceLaunch: SinceLaunch;
  /** timeline.json `asOf`, and how many commits the checked revision is past it. */
  clock: { sha: string; at: string; commitsSince: number };
  /** Two-digit numbers (with an optional letter) of every plans/phase-*.md. */
  planPhases: string[];
  /** Docent corpus hashes: committed `corpus.json` and what `buildIndex` computes now. */
  corpus: { committed: string | null; current: string };
  /** PR mode: the files the change touches, against its base. */
  changed?: string[];
}

export type FindingLevel = 'drift' | 'info';

export interface Finding {
  id: string;
  level: FindingLevel;
  title: string;
  /** Names of the things out of step (slugs, phases, files). */
  items: string[];
  /** File to annotate. */
  file?: string;
  fix: string;
}

/** A log is cited when the facts page names it as `slug` in backticks or as a docs/build-log path. */
export function citesLog(text: string, slug: string): boolean {
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\`${esc}\`|docs/build-log/${esc}\\.md`).test(text);
}

/**
 * Phase numbers a text names: "Phase 03", "Phases 19, 20 and 22", "Phases 24–29" (a range names every phase in it).
 */
export function phasesNamed(text: string): Set<string> {
  const out = new Set<string>();
  const id = String.raw`\d{2}[a-z]?`;
  const list = new RegExp(String.raw`\bPhases? (${id}(?:(?:, | and | or |–|-)${id})*)\b`, 'g');
  for (const m of text.matchAll(list)) {
    const body = m[1] ?? '';
    for (const r of body.matchAll(/(\d{2})[–-](\d{2})\b/g))
      for (let n = Number(r[1]); n <= Number(r[2]); n++) out.add(String(n).padStart(2, '0'));
    for (const p of body.matchAll(new RegExp(id, 'g'))) out.add(p[0]);
  }
  return out;
}

/** Product code: what a visitor or operator runs. Tests, docs and tooling config aren't. */
export function isProductPath(path: string): boolean {
  if (!/^(apps|packages)\/[^/]+\/src\//.test(path)) return false;
  return !/(\.test|\.spec|\.e2e)\.[cm]?[jt]sx?$|\/(test|__tests__)\//.test(path);
}

/** Changes that count as updating the record. */
export function isRecordPath(path: string): boolean {
  return /^docs\/build-log\/[^/]+\.md$/.test(path) || path === FACTS_FILE || path === SINCE_LAUNCH_FILE;
}

export function checkRecord(i: RecordInputs): Finding[] {
  const out: Finding[] = [];
  const logs = new Set(i.logs);
  const launch = new Set(i.launchLogs);
  const listed = new Set(i.sinceLaunch.entries.flatMap((e) => e.logs));

  const unlisted = i.logs.filter((s) => !launch.has(s) && !listed.has(s));
  if (unlisted.length)
    out.push({
      id: 'since-launch-unlisted',
      level: 'drift',
      title: 'Build logs written after the launch build are missing from /log’s “Since launch” list',
      items: unlisted,
      file: SINCE_LAUNCH_FILE,
      fix: `Add each log to an entry's \`logs\` in ${SINCE_LAUNCH_FILE} (a new entry for new work).`,
    });

  const unknown = [...listed].filter((s) => !logs.has(s));
  if (unknown.length)
    out.push({
      id: 'since-launch-unknown',
      level: 'drift',
      title: '“Since launch” cites build logs that don’t exist',
      items: unknown,
      file: SINCE_LAUNCH_FILE,
      fix: 'Fix the slug (a docs/build-log file name without .md) or remove it.',
    });

  if (i.sinceLaunch.after !== i.clock.sha)
    out.push({
      id: 'since-launch-after',
      level: 'drift',
      title: '“Since launch” doesn’t continue from the build clock’s snapshot',
      items: [`since-launch.json after: ${i.sinceLaunch.after}`, `timeline.json asOf: ${i.clock.sha}`],
      file: SINCE_LAUNCH_FILE,
      fix: 'Set `after` to timeline.json `asOf.sha`; move entries the clock now covers out of the list.',
    });

  const uncited = i.logs.filter((s) => !citesLog(i.facts, s));
  if (uncited.length)
    out.push({
      id: 'facts-uncited-logs',
      level: 'drift',
      title: 'The “what exists today” page doesn’t cite every build log',
      items: uncited,
      file: FACTS_FILE,
      fix: 'Describe the work in docs/facts/whats-built.md and cite each log as `slug`; then `pnpm docent:index`.',
    });

  const named = phasesNamed(i.facts);
  const phases = i.planPhases.filter((p) => !named.has(p));
  if (phases.length)
    out.push({
      id: 'facts-missing-phases',
      level: 'drift',
      title: 'Planned phases the “what exists today” page doesn’t mention (built or not)',
      items: phases.map((p) => `Phase ${p}`),
      file: FACTS_FILE,
      fix: 'Name each (“Phase 07”, “Phases 24–29”) and say what became of it: built (with its logs) or under “Planned but not built”.',
    });

  if (!i.facts.includes(i.clock.sha))
    out.push({
      id: 'facts-clock-snapshot',
      level: 'drift',
      title: 'The “what exists today” page quotes build-clock numbers from a different snapshot',
      items: [`timeline.json asOf: ${i.clock.sha}`],
      file: FACTS_FILE,
      fix: 'Copy the numbers under “Numbers from the build story” from content/build-story/timeline.json.',
    });

  if (i.corpus.committed !== i.corpus.current)
    out.push({
      id: 'docent-corpus',
      level: 'drift',
      title: 'The docent corpus is stale (a research, build-log or facts file changed)',
      items: [`${i.corpus.committed ?? 'missing'} → ${i.corpus.current}`],
      file: 'apps/worker/src/docent/corpus.json',
      fix: 'Run `pnpm docent:index` and commit apps/worker/src/docent/corpus.json.',
    });

  if (i.changed) {
    const product = i.changed.filter(isProductPath);
    if (product.length && !i.changed.some(isRecordPath))
      out.push({
        id: 'pr-no-record',
        level: 'drift',
        title: 'This change touches product code but not the build record',
        items: summarizePaths(product),
        fix: 'Add or extend a docs/build-log/*.md entry (and the facts page, if a feature changed). Fine to skip for refactors and fixes too small to log.',
      });
  }

  out.push({
    id: 'clock-snapshot',
    level: 'info',
    title: `The build clock is a fixed snapshot at ${i.clock.sha} (${i.clock.at.slice(0, 10)}), ${i.clock.commitsSince} commits ago`,
    items: [],
    fix: 'By design: it measures the launch build. Later work goes in “Since launch”. Re-measuring it is a separate decision (tools/build-story/README.md).',
  });
  return out;
}

/** Group changed files by package so a large PR stays readable. */
function summarizePaths(paths: string[]): string[] {
  const by = new Map<string, number>();
  for (const p of paths) {
    const pkg = /^(\w+\/[^/]+)/.exec(p)?.[1] ?? p;
    by.set(pkg, (by.get(pkg) ?? 0) + 1);
  }
  return [...by].map(([pkg, n]) => `${pkg} (${n} file${n === 1 ? '' : 's'})`);
}

export const COMMENT_MARKER = '<!-- wwm-build-record -->';

/** The PR comment / job summary. */
export function renderMarkdown(findings: Finding[]): string {
  const drift = findings.filter((f) => f.level === 'drift');
  const info = findings.filter((f) => f.level === 'info');
  const lines = [COMMENT_MARKER];
  lines.push(
    drift.length
      ? `### Build record: ${drift.length} item${drift.length === 1 ? '' : 's'} out of sync (non-blocking)`
      : '### Build record: in sync',
  );
  lines.push('');
  if (drift.length) {
    lines.push(
      'The public build record (`/log`, `docs/facts/whats-built.md`, the docent corpus) lags this change. This check never fails the build; fix it here or in a follow-up. Agents: use the `build-record` skill.',
      '',
    );
    for (const f of drift) {
      lines.push(`- **${f.title}**${f.items.length ? `: ${f.items.map((x) => `\`${x}\``).join(', ')}` : ''}`);
      lines.push(`  ${f.fix}`);
    }
    lines.push('');
  }
  for (const f of info) lines.push(`<sub>ℹ️ ${f.title}. ${f.fix}</sub>`);
  lines.push('', '<sub>Run locally: `pnpm record:drift` (add `--base origin/main` for the PR check).</sub>');
  return `${lines.join('\n')}\n`;
}

/** Plain text, for a terminal. */
export function renderText(findings: Finding[]): string {
  const drift = findings.filter((f) => f.level === 'drift');
  const lines = [
    drift.length ? `build record: ${drift.length} item(s) out of sync` : 'build record: in sync',
  ];
  for (const f of findings) {
    lines.push(`${f.level === 'drift' ? '✗' : 'i'} ${f.title}`);
    for (const x of f.items) lines.push(`    ${x}`);
    lines.push(`    → ${f.fix}`);
  }
  return `${lines.join('\n')}\n`;
}

/** GitHub workflow commands: one warning annotation per drift finding. */
export function renderAnnotations(findings: Finding[]): string {
  const esc = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return findings
    .filter((f) => f.level === 'drift')
    .map(
      (f) =>
        `::warning ${f.file ? `file=${f.file},` : ''}title=Build record out of sync::${esc(
          `${f.title}${f.items.length ? `: ${f.items.join(', ')}` : ''}. ${f.fix}`,
        )}`,
    )
    .join('\n');
}
