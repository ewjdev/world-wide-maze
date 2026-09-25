/**
 * `POST /api/t`: client telemetry ingest (Phase 12). Mounted at `/api` by the router, so the `/api/*` read
 * limiter applies. **Off unless `TELEMETRY_INGEST=1`**: it then answers 204 and drops the body unread.
 *
 * Accepted events are the funnel of `apps/web/src/telemetry` (allow-listed names and fields only, anything else
 * dropped) and are written as one structured Workers Logs line each (`msg: 'telemetry'`). Nothing is stored:
 * no D1, no KV, no IP, no user agent. Workers Logs retention applies (see docs/launch/runbook.md).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../app-env.ts';
import { BodyTooLargeError, MAX_TELEMETRY_BYTES, readJsonCapped, tooLarge } from '../security.ts';
import { sanitizeTelemetry } from './telemetry-rules.ts';

export const telemetryRoutes = new Hono<AppEnv>();

telemetryRoutes.post('/t', async (c) => {
  if (c.env.TELEMETRY_INGEST !== '1') return c.body(null, 204);
  let body: unknown;
  try {
    body = await readJsonCapped(c.req.raw, MAX_TELEMETRY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return tooLarge(e);
    throw e;
  }
  const { log } = c.get('services');
  for (const e of sanitizeTelemetry(body)) log.info('telemetry', e);
  return c.body(null, 204);
});
