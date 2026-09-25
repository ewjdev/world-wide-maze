/** Facts from docs/build-log/*.md, parsed with the same rules the /log page uses. */
import { parseWindow, summarize, totals } from '../../../apps/web/src/pages/log/parse-log.ts';

export interface LogWindow {
  text: string;
  start: string;
  end: string;
  approx: boolean;
}

/** Every "Start / end" or "Time" line in a log, in order (a log with a follow-up section has two). */
export function logWindows(md: string): LogWindow[] {
  const out: LogWindow[] = [];
  for (const line of md.split('\n')) {
    const m = /^\s*-\s+\*\*(?:Start \/ end|Time):?\*\*:?\s*(.+)$/i.exec(line);
    const w = parseWindow(m?.[1] ?? null);
    if (!m?.[1] || !w) continue;
    const day = Date.parse(`${w.date}T00:00:00Z`);
    out.push({
      text: m[1].replace(/\*\*|`/g, '').trim(),
      start: new Date(day + w.startMin * 60_000).toISOString().replace('.000Z', 'Z'),
      end: new Date(day + w.endMin * 60_000).toISOString().replace('.000Z', 'Z'),
      approx: w.approx,
    });
  }
  return out;
}

export function logFacts(files: { slug: string; md: string }[]) {
  const summaries = files.map(summarize);
  const t = totals(summaries);
  return {
    files: files.length,
    failedAttempts: t.failedAttempts,
    humanInterventions: t.humanInterventions,
    model: t.models.length === 1 ? (t.models[0] ?? null) : null,
    failedBySlug: new Map(summaries.map((s) => [s.slug, s.failedAttempts])),
  };
}
