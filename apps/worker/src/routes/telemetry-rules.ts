/** Telemetry allow-list (pure, no Worker types, so Node tests can import it). See routes/telemetry.ts. */
const NAMES = new Set(['title', 'paired', 'played', 'finished', 'ended', 'build_failed', 'client_error']);
/** Allowed fields per event and their shape; everything else is dropped. */
const FIELDS: Record<string, (v: unknown) => boolean> = {
  input: (v) => v === 'keyboard' || v === 'phone' || v === 'unknown',
  run: (v) => v === 'practice' || v === 'fixture' || v === 'api',
  slice: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 100,
  reason: (v) => v === 'gameover' || v === 'timeup',
  code: (v) => typeof v === 'string' && /^[A-Z_]{1,24}$/.test(v),
  kind: (v) => typeof v === 'string' && /^[\w.$ -]{1,40}$/.test(v),
  message: (v) => typeof v === 'string' && v.length <= 160,
  visit: (v) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v),
  ms: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 864e5,
};
export const MAX_TELEMETRY_EVENTS = 50;

/** Keep only allow-listed events and fields. */
export function sanitizeTelemetry(body: unknown): Record<string, unknown>[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  const out: Record<string, unknown>[] = [];
  for (const e of events.slice(0, MAX_TELEMETRY_EVENTS)) {
    if (!e || typeof e !== 'object') continue;
    const name = (e as { name?: unknown }).name;
    if (typeof name !== 'string' || !NAMES.has(name)) continue;
    const clean: Record<string, unknown> = { event: name };
    for (const [k, ok] of Object.entries(FIELDS)) {
      const v = (e as Record<string, unknown>)[k];
      if (v !== undefined && ok(v)) clean[k] = v;
    }
    out.push(clean);
  }
  return out;
}
