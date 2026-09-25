/**
 * Integration (Phase 15): `POST /api/docent` on the real Worker in workerd (wrangler's `createTestHarness`), mock
 * provider, local KV and Limiter DO. Small test-only limits so the per-IP and daily caps are reachable.
 * Mock-mode E2E: ask → streamed SSE answer → citations → done; cache; rejection; limits; kill switch.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocentEvent } from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const configPath = resolve(root, 'apps/worker/wrangler.jsonc');

function parseSse(body: string): DocentEvent[] {
  return body
    .split(/\n\n+/)
    .filter((f) => f.trim())
    .map((frame) => {
      const type = /^event: (.+)$/m.exec(frame)?.[1] as string;
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      return { type, ...(data ? JSON.parse(data) : {}) } as DocentEvent;
    });
}
const textOf = (ev: DocentEvent[]) => ev.map((e) => (e.type === 'delta' ? e.text : '')).join('');

describe('POST /api/docent (workerd, mock provider)', () => {
  const server = createTestHarness();
  const ask = async (question: string, ip: string, extra: object = {}) => {
    const res = await server.fetch('http://localhost/api/docent', {
      method: 'POST',
      headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
      body: JSON.stringify({ question, ...extra }),
    });
    return { res, events: parseSse(await res.text()) };
  };

  beforeAll(async () => {
    await server.update({
      workers: [
        {
          configPath,
          vars: {
            DOCENT_PROVIDER: 'auto',
            DOCENT_MOCK_DELAY_MS: '0',
            DOCENT_LIMIT_PER_HOUR: '3',
            DOCENT_DAILY_LIMIT: '6',
          },
        },
      ],
    });
    await server.listen();
  }, 120_000);

  afterAll(async () => {
    await server.close();
  });

  test('streams an answer: deltas, citations, done (SSE, security headers)', async () => {
    const { res, events } = await ask('Who made the original?', '203.0.113.1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(3);
    expect(events.map((e) => e.type).slice(-2)).toEqual(['citations', 'done']);
    const cites = events.find((e) => e.type === 'citations');
    expect(cites?.type === 'citations' && cites.items.length).toBeGreaterThan(0);
    expect(textOf(events)).toMatch(/\[1\]/);
  });

  test('the same question (normalised) is served from the KV cache without spending budget', async () => {
    const first = await ask('What song promoted the launch?', '203.0.113.2');
    for (let i = 0; i < 4; i++) {
      const again = await ask('  what SONG promoted the launch ', '203.0.113.2');
      expect(textOf(again.events)).toBe(textOf(first.events));
      expect(again.events.at(-1)).toEqual({ type: 'done' });
    }
  });

  test('off-topic → QUESTION_REJECTED (no budget spent); invalid body → 400', async () => {
    for (let i = 0; i < 4; i++) {
      const { events } = await ask('What is the weather in Paris?', '203.0.113.3');
      expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'QUESTION_REJECTED' })]);
    }
    const bad = await server.fetch('http://localhost/api/docent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'x'.repeat(501) }),
    });
    expect(bad.status).toBe(400);
  });

  test('per-IP hourly limit → RATE_LIMITED (429, Retry-After)', async () => {
    const ip = '203.0.113.4';
    for (const q of [
      'When did World Wide Maze launch?',
      'What awards did World Wide Maze win?',
      'How were points scored in the 2013 game?',
    ]) {
      const { events } = await ask(q, ip);
      expect(events.at(-1)).toEqual({ type: 'done' });
    }
    const { res, events } = await ask('What was the Moving Model installation?', ip);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'RATE_LIMITED' })]);
  });

  test('global daily cap → DOCENT_UNAVAILABLE with a friendly message', async () => {
    // model calls so far: 1 + 1 + 3 = 5 of 6
    const ok = await ask('How does the solver bot check that a stage is playable?', '203.0.113.5');
    expect(ok.events.at(-1)).toEqual({ type: 'done' });
    const { res, events } = await ask('Was the phone controller tested on a real iPhone?', '203.0.113.6');
    expect(res.status).toBe(503);
    const e = events[0];
    expect(e).toMatchObject({ type: 'error', code: 'DOCENT_UNAVAILABLE' });
    expect(e?.type === 'error' && e.message).toMatch(/back tomorrow/);
    // cached answers still flow
    expect((await ask('Who made the original?', '203.0.113.7')).events.at(-1)).toEqual({ type: 'done' });
  });

  test('kill switch: KV `kill:docent` → DOCENT_UNAVAILABLE', async () => {
    const env = await server.getWorker<{ CACHE: { put(k: string, v: string): Promise<void> } }>().getEnv();
    await env.CACHE.put('kill:docent', '1');
    const { res, events } = await ask('Who made the original?', '203.0.113.8');
    expect(res.status).toBe(503);
    expect(events[0]).toMatchObject({ type: 'error', code: 'DOCENT_UNAVAILABLE' });
  });
});
