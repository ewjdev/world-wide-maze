/**
 * Phase 16: the data behind the build story on /log. Every number shown comes from
 * content/build-story/timeline.json (built by tools/build-story from git, the build logs and the session record)
 * or is a verbatim quote from content/build-story/bugs.json. This module only formats.
 */
import bugsJson from '../../../../../content/build-story/bugs.json';
import timelineJson from '../../../../../content/build-story/timeline.json';
import type { Run, Timeline } from '../../../../../tools/build-story/src/types.ts';

export const TL = timelineJson as unknown as Timeline;

export interface Quote {
  file: string;
  quote: string;
}
export interface SolverBug {
  id: string;
  title: string;
  plain: string;
  repro: string;
  saw: string;
  sawCommand: string;
  evidence: Quote;
  fix: Quote;
  fixedIn: string;
  images: { before: string; after: string };
  imageLabels?: { before: string; after: string };
}
export interface OtherBug {
  id: string;
  title: string;
  caughtBy: string;
  plain: string;
  kind: 'bug' | 'security' | 'check';
  evidence: Quote;
  diff?: string[];
}
export const BUGS = bugsJson as unknown as {
  batch: {
    title: string;
    quotes: Quote[];
    rows: { label: string; before: string; after: string; quoteIndex: number }[];
    images: { before: string; after: string };
  };
  solver: SolverBug[];
  other: OtherBug[];
};

export type { Run, Timeline };

const ms = (iso: string) => Date.parse(iso);

/** "10 h 13 min", "34 min", "5 h". */
export function dur(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Clock time in the owner's time zone: "11:44 pm". */
export function clock(iso: string, withDay = false): string {
  const d = new Date(iso);
  const t = new Intl.DateTimeFormat('en-US', { timeZone: TL.timeZone, hour: 'numeric', minute: '2-digit' })
    .format(d)
    .replace(' AM', ' am')
    .replace(' PM', ' pm');
  if (!withDay) return t;
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: TL.timeZone,
    month: 'short',
    day: 'numeric',
  }).format(d);
  return `${t}, ${day}`;
}

/** Hours on a 12-hour dial (0–12, 0 at the top) in the owner's time zone. */
export function dialHours(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TL.timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return ((get('hour') % 12) + get('minute') / 60 + get('second') / 3600) % 12;
}

export const fmtInt = (n: number) => n.toLocaleString('en-US');

/** Position (0–1) of a moment inside the wall-clock window. */
export function frac(iso: string): number {
  const a = ms(TL.wallClock.start);
  const b = ms(TL.wallClock.end);
  return Math.min(1, Math.max(0, (ms(iso) - a) / (b - a)));
}

export const WAVE_NAMES: Record<number, string> = {
  0: 'Reference and foundation',
  1: 'Components',
  2: 'Integration and solver',
  3: 'Showcase and fixes',
  4: 'Launch hardening',
};

/** Top-level runs and their helpers, grouped by wave, in start order. */
export function runsByWave(): { wave: number; runs: (Run & { helpers: Run[] })[] }[] {
  const tops = TL.runs.filter((r) => r.kind !== 'helper');
  const waves = [...new Set(tops.map((r) => r.wave))].sort((a, b) => a - b);
  return waves.map((wave) => ({
    wave,
    runs: tops
      .filter((r) => r.wave === wave)
      .map((r) => ({
        ...r,
        helpers: TL.runs.filter(
          (h) =>
            h.kind === 'helper' &&
            h.phase === r.phase &&
            ms(h.span.start) >= ms(r.span.start) &&
            ms(h.span.end) <= ms(r.span.end) + 60_000,
        ),
      })),
  }));
}

/** Hour marks inside the window, in the owner's time zone. */
export function hourTicks(): { iso: string; label: string }[] {
  const a = ms(TL.wallClock.start);
  const b = ms(TL.wallClock.end);
  const out: { iso: string; label: string }[] = [];
  // the owner's zone has whole-hour offsets, so UTC hour boundaries are local hour boundaries
  for (let t = Math.ceil(a / 3_600_000) * 3_600_000; t <= b; t += 3_600_000) {
    const iso = new Date(t).toISOString();
    out.push({ iso, label: clock(iso).replace(':00', '') });
  }
  return out;
}

export const phaseAnchor = (r: Run) => (r.log ? `#${r.log}` : null);

/** "phase-09/dashboard.png" → the evidence asset URL, from the build-log asset glob. */
export function assetUrl(assets: Record<string, string>, rel: string): string | undefined {
  const hit = Object.entries(assets).find(([p]) => p.endsWith(`/assets/${rel}`));
  return hit?.[1];
}

export const sourceHref = (file: string) => {
  const commit = /^git:(\w+)$/.exec(file)?.[1];
  if (commit) return null;
  const slug = /^docs\/build-log\/([^/]+)\.md$/.exec(file)?.[1];
  return slug ? `#${slug}` : null;
};
