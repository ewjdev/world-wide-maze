/**
 * Shared helpers for the learning-records integration tests: a harness on the real wrangler.jsonc (workerd, D1,
 * Durable Objects, rate limits, KV), an HTTP helper that behaves like the account pages (same-origin `Origin`,
 * the session cookie, a device bearer token) and sign-in through the development mock mailbox.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONSENT_VERSION,
  evidenceId,
  type LearningEvidence,
  newProfileId,
  type Profile,
} from '@wwm/learning';
import { expect } from 'vitest';
import type { createTestHarness } from 'wrangler';

export const root = fileURLToPath(new URL('../../..', import.meta.url));
export const configPath = resolve(root, 'apps/worker/wrangler.jsonc');
export const BASE = 'http://localhost';
/** What the dev config trusts for WebAuthn (LEARNING_ORIGIN / LEARNING_RP_ID). */
export const PAGE_ORIGIN = 'http://localhost:5174';
export const TURNSTILE_DUMMY = 'XXXX.DUMMY.TOKEN.XXXX';

export type Harness = ReturnType<typeof createTestHarness>;

export interface CallInit {
  method?: string;
  body?: unknown;
  cookie?: string | undefined;
  bearer?: string | undefined;
  /** `null` sends no Origin header. Default: the Worker's own origin, as a same-origin page would. */
  origin?: string | null;
  ip?: string;
}

let ipSeq = 0;
export const freshIp = () => {
  ipSeq++;
  return `198.18.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
};

export function client(server: Harness) {
  const call = (path: string, init: CallInit = {}) => {
    const headers: Record<string, string> = { 'cf-connecting-ip': init.ip ?? freshIp() };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.cookie) headers.cookie = `wwm_learning_session=${init.cookie}`;
    if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
    if (init.origin !== null) headers.origin = init.origin ?? BASE;
    return server.fetch(`${BASE}/api/learning${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined
        ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) }
        : {}),
    });
  };

  const mailbox = async (email: string) => {
    const res = await call(`/dev/mailbox?to=${encodeURIComponent(email)}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { messages: { to: string; subject: string; text: string }[] }).messages;
  };

  /** Wait for the `count`th message to `email` (the mail is sent after the 202, in waitUntil). */
  const waitForMail = async (email: string, count = 1) => {
    for (let i = 0; i < 100; i++) {
      const messages = await mailbox(email);
      if (messages.length >= count) return messages;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no mail #${count} for the test address`);
  };

  const requestLink = (email: string, consent = true, init: CallInit = {}) =>
    call('/auth/email', {
      method: 'POST',
      body: {
        email,
        turnstile: TURNSTILE_DUMMY,
        ...(consent ? { consent: { version: CONSENT_VERSION, parent: true } } : {}),
      },
      ...init,
    });

  const tokenFrom = (text: string) => /verify#token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;

  const cookieFrom = (res: { headers: { get(name: string): string | null } }) =>
    /wwm_learning_session=([A-Za-z0-9_-]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;

  /** Email sign-in end to end: request, read the mock mailbox, verify. Returns the session cookie value. */
  const signIn = async (email: string, consent = true) => {
    const before = (await mailbox(email)).length;
    expect((await requestLink(email, consent)).status).toBe(202);
    const messages = await waitForMail(email, before + 1);
    const token = tokenFrom(messages.at(-1)?.text ?? '');
    if (!token) throw new Error('no sign-in link in the message');
    const res = await call('/auth/email/verify', { method: 'POST', body: { token } });
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    if (!cookie) throw new Error('no session cookie');
    const session = (await res.json()) as { family: { id: string } };
    return { cookie, familyId: session.family.id };
  };

  /** A paired child device for a signed-in parent. */
  const pairDevice = async (cookie: string, label = 'Tablet') => {
    const code = (await (await call('/devices/pair-code', { method: 'POST', cookie })).json()) as {
      code: string;
    };
    const res = await call('/devices/claim', { method: 'POST', body: { code: code.code, label } });
    expect(res.status).toBe(201);
    return (await res.json()) as { token: string; device: { id: string; label: string } };
  };

  return { call, mailbox, waitForMail, requestLink, tokenFrom, cookieFrom, signIn, pairDevice };
}

export function profile(nickname = 'Robin'): Profile {
  return { id: newProfileId(), nickname, avatar: 'pip-blue' };
}

let minute = Date.UTC(2026, 9, 1, 8, 0);
export function evidence(profileId: string, overrides: Partial<LearningEvidence> = {}): LearningEvidence {
  minute += 60_000;
  return {
    v: 1,
    id: evidenceId(minute),
    profile: profileId,
    at: new Date(minute).toISOString(),
    activity: 'compare-groups',
    objective: 'compare-groups',
    round: 'warm-up',
    item: 'a'.repeat(32),
    source: 'lesson',
    fresh: true,
    outcome: 'first-try',
    helpLevel: 0,
    surface: 'lesson',
    input: 'tap',
    duration: 'lt30s',
    ...overrides,
  };
}
