/**
 * Facts extracted from docs/build-log/*.md for the /log summary. Only what a log states in so many words is
 * extracted; anything that doesn't parse is shown as "not stated" rather than guessed. No productivity figures.
 */

export interface LogFile {
  /** File name without extension, e.g. `phase-03` or `phase-06-device-test`. */
  slug: string;
  md: string;
}

export interface LogSummary {
  slug: string;
  /** Two-digit phase (with an optional letter), e.g. "03", or null for non-phase logs. */
  phase: string | null;
  /** The document is a supplement to a phase log (e.g. a device-test script). */
  supplement: boolean;
  title: string;
  agent: string | null;
  /** The raw "Start / end" or "Time" text as written. */
  windowText: string | null;
  /** Parsed window in UTC minutes since midnight of `date` (approximate if the log says "about" or "~"). */
  window: { date: string; startMin: number; endMin: number; approx: boolean } | null;
  failedAttempts: number;
  humanInterventions: number;
  /** The human-interventions section says there were none. */
  noHumanInterventions: boolean;
  sections: string[];
}

const stripMd = (s: string) =>
  s
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();

function field(md: string, name: RegExp): string | null {
  for (const line of md.split('\n')) {
    const m = /^\s*-\s+\*\*([^*]+?):?\*\*:?\s*(.+)$/.exec(line);
    if (m?.[1] && name.test(m[1].trim())) return stripMd(m[2] ?? '');
  }
  return null;
}

/** "2026-09-25 ~08:05Z → ~08:45Z", "2026-09-25 about 07:18Z → about 07:50Z", "2026-09-25, about 08:05Z to 08:45Z". */
export function parseWindow(text: string | null): LogSummary['window'] {
  if (!text) return null;
  const date = /(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
  const times = [...text.matchAll(/(\d{1,2}):(\d{2})\s*Z/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  if (!date || times.length < 2) return null;
  const [startMin, endMin] = times as [number, number];
  return {
    date,
    startMin,
    endMin: endMin < startMin ? endMin + 1440 : endMin,
    approx: /~|about|approx/i.test(text),
  };
}

/** Top-level list items (not nested) under every `## ` heading matching `re`. */
export function countItems(md: string, re: RegExp): { count: number; none: boolean } {
  let inSection = false;
  let count = 0;
  let body = '';
  for (const line of md.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      inSection = re.test(h[1] ?? '');
      continue;
    }
    if (!inSection) continue;
    body += `${line}\n`;
    if (/^(?:-|\*|\d+\.)\s+\S/.test(line)) count++;
  }
  const none = count <= 1 && /^\s*(?:-\s+)?(?:none|no\b|nothing)/im.test(body.trim());
  return { count: none ? 0 : count, none };
}

export function summarize(file: LogFile): LogSummary {
  const title = stripMd(/^#\s+(.+)$/m.exec(file.md)?.[1] ?? file.slug)
    .replace(/^Build log:\s*/i, '')
    .replace(/\s*\(build log\)\s*$/i, '');
  const phase = /^phase-(\d{2}[a-z]?)/.exec(file.slug)?.[1] ?? null;
  const windowText = field(file.md, /^(start \/ end|time)$/i);
  const human = countItems(file.md, /human/i);
  return {
    slug: file.slug,
    phase,
    supplement: phase !== null && file.slug !== `phase-${phase}`,
    title,
    agent: field(file.md, /^agent$/i),
    windowText,
    window: parseWindow(windowText),
    failedAttempts: countItems(file.md, /fail/i).count,
    humanInterventions: human.count,
    noHumanInterventions: human.none,
    sections: [...file.md.matchAll(/^##\s+(.+)$/gm)].map((m) => stripMd(m[1] ?? '')),
  };
}

export interface Totals {
  logs: number;
  phases: number;
  models: string[];
  failedAttempts: number;
  humanInterventions: number;
  /** Earliest logged start and latest logged end (UTC), for the chart axis. */
  span: { date: string; startMin: number; endMin: number } | null;
}

/** The agent's model as the log names it ("Claude Opus 5.5 (1M context), run as…" → "Claude Opus 5.5 (1M context)"). */
export function modelOf(agent: string | null): string | null {
  if (!agent) return null;
  return agent.split(/,\s*(?:run|running)\b/i)[0]?.trim() ?? null;
}

export function totals(list: LogSummary[]): Totals {
  const mains = list.filter((l) => !l.supplement);
  const windows = mains.flatMap((l) => (l.window ? [l.window] : []));
  const models = [...new Set(mains.map((l) => modelOf(l.agent)).filter((m): m is string => !!m))];
  return {
    logs: list.length,
    phases: new Set(mains.map((l) => l.phase).filter(Boolean)).size,
    models,
    failedAttempts: mains.reduce((a, l) => a + l.failedAttempts, 0),
    humanInterventions: mains.reduce((a, l) => a + l.humanInterventions, 0),
    span: windows.length
      ? {
          date: windows[0]?.date ?? '',
          startMin: Math.min(...windows.map((w) => w.startMin)),
          endMin: Math.max(...windows.map((w) => w.endMin)),
        }
      : null,
  };
}

export const fmtClock = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
