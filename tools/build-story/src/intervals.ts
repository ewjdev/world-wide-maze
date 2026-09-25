/** Interval arithmetic over millisecond timestamps. */

export interface Interval {
  start: number;
  end: number;
}

export const MIN = 60_000;
export const toMs = (iso: string) => Date.parse(iso);
export const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
/** Minutes, rounded to 0.1. */
export const minutes = (ms: number) => Math.round((ms / MIN) * 10) / 10;

/** Clip to [lo, hi]; drops intervals that fall outside. */
export function clip(list: Interval[], lo: number, hi: number): Interval[] {
  return list
    .map((i) => ({ start: Math.max(lo, i.start), end: Math.min(hi, i.end) }))
    .filter((i) => i.end > i.start);
}

/** Merge overlapping or touching intervals. */
export function union(list: Interval[]): Interval[] {
  const sorted = [...list].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export const total = (list: Interval[]) => list.reduce((a, i) => a + (i.end - i.start), 0);

/** The gaps inside [lo, hi] not covered by `list`, at least `minGap` long. */
export function gaps(list: Interval[], lo: number, hi: number, minGap = 0): Interval[] {
  const out: Interval[] = [];
  let cursor = lo;
  for (const i of union(clip(list, lo, hi))) {
    if (i.start - cursor >= minGap && i.start > cursor) out.push({ start: cursor, end: i.start });
    cursor = Math.max(cursor, i.end);
  }
  if (hi - cursor >= minGap && hi > cursor) out.push({ start: cursor, end: hi });
  return out;
}

/** The largest number of intervals open at once, and the first moment it happens. */
export function maxConcurrency(list: Interval[]): { max: number; at: number } {
  // ends sort before starts at the same instant, so back-to-back runs don't count as overlapping
  const events = list.flatMap((i) => [
    { t: i.start, d: 1 },
    { t: i.end, d: -1 },
  ]);
  events.sort((a, b) => a.t - b.t || a.d - b.d);
  let open = 0;
  let best = { max: 0, at: Number.NaN };
  for (const e of events) {
    open += e.d;
    if (open > best.max) best = { max: open, at: e.t };
  }
  return best;
}

/** Greedy lane assignment (for drawing): each interval gets the first lane free at its start. */
export function lanes(list: Interval[]): number[] {
  const order = list.map((_, k) => k).sort((a, b) => (list[a]?.start ?? 0) - (list[b]?.start ?? 0));
  const laneEnds: number[] = [];
  const out = new Array<number>(list.length).fill(0);
  for (const k of order) {
    const i = list[k] as Interval;
    let lane = laneEnds.findIndex((end) => end <= i.start);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = i.end;
    out[k] = lane;
  }
  return out;
}
