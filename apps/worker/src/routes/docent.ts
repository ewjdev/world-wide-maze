/**
 * `POST /api/docent` (contracts §10.3, Phase 15): the AI docent. Mounted at `/api` by the router, so the
 * `/api/*` read limiter (100/min/IP, registered by stages.ts) applies too.
 *
 * Order: validate → sanitise, retrieve and reject off-topic questions (no budget spent) → answer cache (KV, by
 * normalised question, only without history) → per-IP hourly limit and global 24 h cap (Limiter DO; only model
 * calls count) → model through AI Gateway (or the mock), streamed as SSE through the grounding gate → cache.
 * Every DOCENT error is an SSE `error` event; the HTTP status mirrors it (429 / 503) for logs and tools.
 */
import { type DocentEvent, DocentRequestSchema } from '@wwm/schema';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env.ts';
import { createProvider, type DocentVars, docentSettings } from '../docent/config.ts';
import { answerDocent, type DocentRun, prepareDocent } from '../docent/engine.ts';
import { normalizeQuestion } from '../docent/guard.ts';
import { INDEX, searcher } from '../docent/retrieve.ts';
import { sseLive, sseOnce } from '../docent/sse.ts';
import { BodyTooLargeError, readJsonCapped, tooLarge } from '../security.ts';

/** Question ≤ 500 chars + history ≤ 6 × 4000 chars, as UTF-8, with room for JSON. */
export const MAX_DOCENT_REQUEST_BYTES = 96 * 1024;

const UNAVAILABLE =
  'The docent is resting right now. The history page and the build record have everything it knows.';
const DAILY_CAP =
  'The docent has answered all the questions it can for today. It will be back tomorrow; meanwhile the history page and the build record have everything it knows.';

interface CachedAnswer {
  text: string;
  citations: Extract<DocentEvent, { type: 'citations' }>['items'];
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The cached answer replayed as a few deltas so the client path is the same as a live answer. */
function replay(a: CachedAnswer): DocentEvent[] {
  const parts = a.text.match(/[\s\S]{1,160}(?=\s|$)|[\s\S]{1,160}/g) ?? [a.text];
  return [
    ...parts.map((text): DocentEvent => ({ type: 'delta', text })),
    { type: 'citations', items: a.citations },
    { type: 'done' },
  ];
}

export const docentRoutes = new Hono<AppEnv>();

docentRoutes.post('/docent', async (c) => {
  const { log } = c.get('services');
  const env = c.env as Env & DocentVars;
  const t0 = Date.now();

  let raw: unknown;
  try {
    raw = await readJsonCapped(c.req.raw, MAX_DOCENT_REQUEST_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return tooLarge(e);
    throw e;
  }
  const body = DocentRequestSchema.safeParse(raw);
  if (!body.success)
    return Response.json(
      { error: 'bad request', message: body.error.issues[0]?.message ?? 'invalid body' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );

  const s = docentSettings(env);
  const provider = createProvider(env, s);
  if (!provider || (await env.CACHE.get('kill:docent')) !== null) {
    log.warn('docent unavailable', { reason: s.offReason ?? 'kill switch (KV kill:docent)' });
    return sseOnce([{ type: 'error', code: 'DOCENT_UNAVAILABLE', message: UNAVAILABLE }], 503);
  }

  const p = prepareDocent(body.data, searcher());
  if (p.rejected) {
    log.info('docent rejected', { injection: p.injection, chars: body.data.question.length });
    const events: DocentEvent[] = [];
    await answerDocent(p, { provider, maxTokens: s.maxTokens }, (e) => events.push(e));
    return sseOnce(events);
  }

  // Answer cache: only questions without history (a follow-up's answer depends on the conversation).
  const cacheable = p.history.length === 0;
  const key = cacheable
    ? `docent:v${INDEX.format}:${INDEX.hash}:${provider.model}:${(await sha256(normalizeQuestion(p.question))).slice(0, 32)}`
    : null;
  if (key) {
    const hit = await env.CACHE.get<CachedAnswer>(key, 'json');
    if (hit) {
      log.info('docent cache hit', { ms: Date.now() - t0 });
      return sseOnce(replay(hit));
    }
  }

  // Budgets: only answers that reach the model count.
  const limiter = (name: string) => env.LIMITER.get(env.LIMITER.idFromName(name));
  const perIp = await limiter(`docent:${c.get('ip')}`).hit(s.perIpPerHour, 3_600_000);
  if (!perIp.ok) {
    const minutes = Math.max(1, Math.ceil(perIp.retryAfterSec / 60));
    return sseOnce(
      [
        {
          type: 'error',
          code: 'RATE_LIMITED',
          message: `You’ve asked a lot of questions this hour. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        },
      ],
      429,
      { 'retry-after': String(Math.max(1, perIp.retryAfterSec)) },
    );
  }
  const global = await limiter('docent:global').hit(s.dailyLimit, 86_400_000);
  if (!global.ok) {
    log.warn('docent daily cap reached', { limit: s.dailyLimit });
    return sseOnce([{ type: 'error', code: 'DOCENT_UNAVAILABLE', message: DAILY_CAP }], 503);
  }

  const { response, done } = sseLive<DocentRun>(async (emit, signal) => {
    try {
      const run = await answerDocent(p, { provider, maxTokens: s.maxTokens, signal }, emit);
      // Token counts per answer (Workers Logs); no question text, no IP.
      log.info('docent answer', {
        provider: provider.name,
        model: run.result?.model ?? provider.model,
        outcome: run.outcome,
        reason: run.reason,
        stopReason: run.result?.stopReason,
        inputTokens: run.result?.usage?.inputTokens,
        outputTokens: run.result?.usage?.outputTokens,
        excerpts: p.excerpts.length,
        cited: run.citations.length,
        injection: p.injection,
        cache: key ? 'miss' : 'bypass',
        ms: Date.now() - t0,
      });
      const cacheOk = run.outcome === 'answered' || (run.outcome === 'dont_know' && run.reason === 'model');
      if (key && cacheOk && !signal.aborted)
        await env.CACHE.put(
          key,
          JSON.stringify({ text: run.text, citations: run.citations } satisfies CachedAnswer),
          {
            expirationTtl: s.cacheTtlSec,
          },
        );
      return run;
    } catch (err) {
      log.error('docent failed', { provider: provider.name, error: String(err), ms: Date.now() - t0 });
      throw err;
    }
  }, c.req.raw.signal);
  c.executionCtx.waitUntil(done);
  return response;
});
