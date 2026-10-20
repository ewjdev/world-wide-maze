/** Phase 31 M3: the `/api/learning/*` client and `syncOutbox`, against a fake fetch and an in-memory store. */
import { describe, expect, it, vi } from 'vitest';
import {
  CONSENT_VERSION,
  createSyncClient,
  type EventBatchResponse,
  evidenceId,
  LearningApiError,
  type LearningEvidence,
  MAX_EVENTS_PER_BATCH,
  newProfileId,
  type Profile,
  type ProgressStore,
  syncOutbox,
  uploadLocalProgress,
} from '../src/index.ts';

class MemoryStore implements ProgressStore {
  profiles = new Map<string, Profile>();
  log = new Map<string, LearningEvidence>();
  pending: string[] = [];
  active: string | null = null;
  token: string | null = null;
  async listProfiles() {
    return [...this.profiles.values()];
  }
  async saveProfile(p: Profile) {
    this.profiles.set(p.id, p);
  }
  async deleteProfile(id: string) {
    this.profiles.delete(id);
    for (const [k, e] of this.log) if (e.profile === id) this.log.delete(k);
    this.pending = this.pending.filter((k) => this.log.has(k));
  }
  async activeProfile() {
    return this.active;
  }
  async setActiveProfile(id: string | null) {
    this.active = id;
  }
  async appendEvidence(e: LearningEvidence) {
    if (this.log.has(e.id)) return;
    this.log.set(e.id, e);
    this.pending.push(e.id);
  }
  async events(profile: string) {
    return [...this.log.values()].filter((e) => e.profile === profile);
  }
  async seenItems(profile: string) {
    return new Set((await this.events(profile)).map((e) => e.item));
  }
  async outbox(limit: number) {
    return this.pending.slice(0, limit).map((id) => this.log.get(id) as LearningEvidence);
  }
  async markSynced(ids: readonly string[]) {
    const done = new Set(ids);
    this.pending = this.pending.filter((id) => !done.has(id));
  }
  async exportAll() {
    return { profiles: await this.listProfiles(), events: [...this.log.values()] };
  }
  async clear() {
    this.profiles.clear();
    this.log.clear();
    this.pending = [];
  }
  async deviceToken() {
    return this.token;
  }
  async setDeviceToken(token: string | null) {
    this.token = token;
  }
}

let t = Date.UTC(2026, 9, 2, 9, 0);
const event = (profile: string): LearningEvidence => {
  t += 60_000;
  return {
    v: 1,
    id: evidenceId(t),
    profile,
    at: new Date(t).toISOString(),
    activity: 'count-three',
    objective: 'count-three',
    round: 'one',
    item: 'b'.repeat(32),
    source: 'generator',
    fresh: true,
    outcome: 'first-try',
    helpLevel: 0,
    surface: 'lesson',
    input: 'tap',
    duration: 'lt10s',
  };
};

/** A fake `/api/learning` that knows some profiles and remembers events by id. */
function fakeServer(known: Set<string>) {
  const stored = new Map<string, LearningEvidence>();
  const calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
  const queue: (Response | Error)[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method: init?.method ?? 'GET',
      url,
      body,
      headers: init?.headers as Record<string, string>,
    });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (next) return next;
    if (url.endsWith('/events') && init?.method === 'POST') {
      const res: EventBatchResponse = { accepted: 0, duplicate: 0, rejected: [] };
      for (const e of body.events as LearningEvidence[]) {
        if (!known.has(e.profile)) res.rejected.push({ id: e.id, code: 'UNKNOWN_PROFILE' });
        else if (stored.has(e.id)) res.duplicate++;
        else {
          stored.set(e.id, e);
          res.accepted++;
        }
      }
      return Response.json(res);
    }
    if (url.endsWith('/profiles') && init?.method === 'POST') {
      known.add(body.id);
      return Response.json(body, { status: 201 });
    }
    return Response.json({ code: 'LEARNING_NOT_FOUND', message: 'nope' }, { status: 404 });
  });
  return { fetch, calls, stored, queue };
}

describe('createSyncClient', () => {
  it('calls every endpoint with the right method, path and body', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' || String(_input).endsWith('/signout')
        ? new Response(null, { status: 204 })
        : String(_input).endsWith('/auth/email')
          ? new Response('{}', { status: 202 })
          : Response.json({ profiles: [], devices: [], events: [] }),
    );
    const api = createSyncClient({ fetch: fetch as typeof globalThis.fetch, deviceToken: () => 'tok' });
    const id = newProfileId();
    await api.session();
    await api.requestEmailLink({
      email: 'a@example.org',
      turnstile: 'x',
      consent: { version: CONSENT_VERSION, parent: true },
    });
    await api.verifyEmailLink('t'.repeat(43));
    await api.passkeyRegisterOptions();
    await api.passkeyRegisterVerify({ id: 'cred' });
    await api.passkeyLoginOptions();
    await api.passkeyLoginVerify({ id: 'cred' });
    await api.signOut();
    expect(await api.listProfiles()).toEqual([]);
    await api.saveProfile({ id, nickname: 'Robin', avatar: 'pip-blue' });
    await api.updateProfile(id, { ageBand: null });
    await api.deleteProfile(id);
    await api.createPairCode();
    await api.claimDevice(' abc234 ', 'Tablet');
    expect(await api.listDevices()).toEqual([]);
    await api.revokeDevice('dev/1');
    await api.sendEvents([]);
    await api.eventPage({ profile: id, cursor: 'c1' });
    await api.exportFamily();
    await api.deleteFamily();
    const seen = fetch.mock.calls.map(([url, init]) => `${init?.method} ${url}`);
    expect(seen).toEqual([
      'GET /api/learning/session',
      'POST /api/learning/auth/email',
      'POST /api/learning/auth/email/verify',
      'POST /api/learning/auth/passkey/register/options',
      'POST /api/learning/auth/passkey/register/verify',
      'POST /api/learning/auth/passkey/login/options',
      'POST /api/learning/auth/passkey/login/verify',
      'POST /api/learning/auth/signout',
      'GET /api/learning/profiles',
      'POST /api/learning/profiles',
      `PATCH /api/learning/profiles/${id}`,
      `DELETE /api/learning/profiles/${id}`,
      'POST /api/learning/devices/pair-code',
      'POST /api/learning/devices/claim',
      'GET /api/learning/devices',
      'DELETE /api/learning/devices/dev%2F1',
      'POST /api/learning/events',
      `GET /api/learning/events?profile=${id}&cursor=c1`,
      'GET /api/learning/export',
      'DELETE /api/learning/family',
    ]);
    const init = fetch.mock.calls[13]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ code: 'ABC234', label: 'Tablet' });
    expect(init?.credentials).toBe('same-origin');
    expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe('Bearer tok');
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({ token: 't'.repeat(43) });
  });

  it('turns error bodies into LearningApiError with the code and Retry-After', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { code: 'LEARNING_RATE_LIMITED', message: 'slow down' },
          { status: 429, headers: { 'retry-after': '7' } },
        ),
      )
      .mockResolvedValueOnce(new Response('<html>', { status: 502 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const api = createSyncClient({ fetch });
    const first = await api.session().catch((e: unknown) => e);
    expect(first).toBeInstanceOf(LearningApiError);
    expect(first).toMatchObject({ status: 429, code: 'LEARNING_RATE_LIMITED', retryAfterMs: 7000 });
    expect(await api.session().catch((e: unknown) => e)).toMatchObject({
      status: 502,
      code: 'LEARNING_UNAVAILABLE',
    });
    expect(await api.session().catch((e: unknown) => e)).toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('allEvents follows cursors to the last page', async () => {
    const a = event('p'.repeat(16));
    const b = event('p'.repeat(16));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ events: [a], next: 'n1' }))
      .mockResolvedValueOnce(Response.json({ events: [b] }));
    const api = createSyncClient({ fetch, base: '/x/' });
    expect(await api.allEvents()).toEqual([a, b]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/x/events', '/x/events?cursor=n1']);
  });
});

describe('syncOutbox', () => {
  const noSleep = { sleep: async () => {}, isOnline: () => true };

  it('sends batches of at most MAX_EVENTS_PER_BATCH and marks accepted and duplicate ids synced', async () => {
    const store = new MemoryStore();
    const child = newProfileId();
    for (let i = 0; i < 450; i++) await store.appendEvidence(event(child));
    const server = fakeServer(new Set([child]));
    // one batch was already delivered before (e.g. the response was lost): it comes back as duplicates
    const first = await store.outbox(MAX_EVENTS_PER_BATCH);
    for (const e of first.slice(0, 10)) server.stored.set(e.id, e);
    const result = await syncOutbox(store, createSyncClient({ fetch: server.fetch }), noSleep);
    expect(result).toEqual({ status: 'done', accepted: 440, duplicate: 10, rejected: [] });
    expect(server.calls.map((c) => (c.body as { events: unknown[] }).events.length)).toEqual([200, 200, 50]);
    expect(store.pending).toEqual([]);
    expect(store.log.size).toBe(450); // events stay on the device
  });

  it('keeps rejected events in the outbox and still syncs the ones behind them', async () => {
    const store = new MemoryStore();
    const known = newProfileId();
    const unknown = newProfileId();
    for (let i = 0; i < 250; i++) await store.appendEvidence(event(unknown));
    for (let i = 0; i < 5; i++) await store.appendEvidence(event(known));
    const server = fakeServer(new Set([known]));
    const result = await syncOutbox(store, createSyncClient({ fetch: server.fetch }), noSleep);
    expect(result.status).toBe('done');
    expect(result.accepted).toBe(5);
    expect(result.rejected).toHaveLength(250);
    expect(new Set(result.rejected.map((r) => r.code))).toEqual(new Set(['UNKNOWN_PROFILE']));
    expect(store.pending).toHaveLength(250);
    expect((await store.outbox(1000)).every((e) => e.profile === unknown)).toBe(true);
  });

  it('backs off on 429 using Retry-After, then continues', async () => {
    const store = new MemoryStore();
    const child = newProfileId();
    await store.appendEvidence(event(child));
    const server = fakeServer(new Set([child]));
    server.queue.push(
      Response.json(
        { code: 'LEARNING_RATE_LIMITED', message: 'x' },
        { status: 429, headers: { 'retry-after': '3' } },
      ),
    );
    const sleep = vi.fn(async () => {});
    const result = await syncOutbox(store, createSyncClient({ fetch: server.fetch }), {
      sleep,
      isOnline: () => true,
    });
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(result).toMatchObject({ status: 'done', accepted: 1 });
  });

  it('gives up for now after repeated failures, reporting when to retry', async () => {
    const store = new MemoryStore();
    const child = newProfileId();
    await store.appendEvidence(event(child));
    const server = fakeServer(new Set([child]));
    for (let i = 0; i < 4; i++) server.queue.push(new TypeError('Failed to fetch'));
    const sleep = vi.fn(async () => {});
    const result = await syncOutbox(store, createSyncClient({ fetch: server.fetch }), {
      sleep,
      isOnline: () => true,
      baseDelayMs: 500,
    });
    expect(sleep.mock.calls.map((c: unknown[]) => c[0])).toEqual([500, 1000, 2000]);
    expect(result).toMatchObject({ status: 'offline', accepted: 0, retryAfterMs: 4000 });
    expect(store.pending).toHaveLength(1);
  });

  it('does nothing while offline, and stops when signed out', async () => {
    const store = new MemoryStore();
    const child = newProfileId();
    await store.appendEvidence(event(child));
    const server = fakeServer(new Set([child]));
    const api = createSyncClient({ fetch: server.fetch });
    expect((await syncOutbox(store, api, { isOnline: () => false })).status).toBe('offline');
    expect(server.fetch).not.toHaveBeenCalled();
    server.queue.push(Response.json({ code: 'LEARNING_AUTH_REQUIRED', message: 'x' }, { status: 401 }));
    expect((await syncOutbox(store, api, noSleep)).status).toBe('signed-out');
    expect(store.pending).toHaveLength(1);
  });

  it('uploadLocalProgress posts each local profile with its own id, then syncs', async () => {
    const store = new MemoryStore();
    const robin: Profile = { id: newProfileId(), nickname: 'Robin', avatar: 'pip-green' };
    await store.saveProfile(robin);
    await store.appendEvidence(event(robin.id));
    const server = fakeServer(new Set());
    const result = await uploadLocalProgress(store, createSyncClient({ fetch: server.fetch }), noSleep);
    expect(result.profiles).toBe(1);
    expect(result.sync).toMatchObject({ status: 'done', accepted: 1, rejected: [] });
    expect(server.calls[0]).toMatchObject({ method: 'POST', url: '/api/learning/profiles', body: robin });
    expect(store.pending).toEqual([]);
  });
});
