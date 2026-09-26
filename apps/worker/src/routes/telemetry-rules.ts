/** Shared schemas strip unapproved properties at both envelope and event boundaries. */
import { TelemetryEnvelopeSchema, TelemetryEventSchema, type TelemetryRecord } from '@wwm/schema';
export const MAX_TELEMETRY_EVENTS = 50;
export function sanitizeTelemetry(body: unknown, now = Date.now()): TelemetryRecord[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  const result: TelemetryRecord[] = [];
  for (const value of events.slice(0, MAX_TELEMETRY_EVENTS)) {
    const envelope = TelemetryEnvelopeSchema.safeParse(value);
    const event = TelemetryEventSchema.safeParse(value);
    if (!envelope.success || !event.success) continue;
    const e = envelope.data;
    if (e.timestamp > now + 60_000 || e.timestamp < now - 86_400_000) continue;
    if (e.identity === 'browser' && !e.visitor) continue;
    if (e.identity !== 'browser') delete e.visitor;
    result.push({ ...e, ...event.data });
  }
  return result;
}
