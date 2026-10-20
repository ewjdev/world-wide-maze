/** Phase 31 M3: the account pages' static HTML and the account helpers M2's Progress page uses. */
import {
  baselinePath,
  type EventBatchResponse,
  evidenceId,
  type LearningEvidence,
  newProfileId,
  type Profile,
  type ProgressStore,
  type SessionResponse,
} from '@wwm/learning';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountPage, PRIVACY_NOTICE_URL, verifyPage } from '../src/account-page.ts';
import {
  progressEvents,
  progressProfiles,
  pushProfile,
  removeProfile,
  syncNow,
} from '../src/account-sync.ts';

describe('account pages', () => {
  it('render every section, the consent box, the privacy summary and no inline script', () => {
    const html = accountPage(baselinePath);
    for (const id of [
      'email-form',
      'consent',
      'turnstile',
      'passkey-login',
      'claim-form',
      'pair-code',
      'make-code',
      'pair-qr',
      'device-list',
      'add-passkey',
      'export',
      'delete-confirm',
      'delete-family',
      'sign-out',
      'privacy',
    ])
      expect(html, id).toContain(`id="${id}"`);
    expect(html).toContain(PRIVACY_NOTICE_URL);
    expect(html).toContain('Type <strong>DELETE</strong> to confirm');
    expect(html).toMatch(/<button class="primary danger" type="button" id="delete-family" disabled>/);
    expect(html).not.toMatch(/<script>(?!\s*$)|<script type="module">/);
    expect(html).toContain('<script type="module" src="/src/account.ts">');
    const verify = verifyPage(baselinePath);
    expect(verify).toContain('class="account-page account-verify"');
    expect(verify).toContain('id="verify-status"');
  });
});

// ── helpers for the Progress page, against a fake /api/learning ─────────────────────────────────────────────

class Store implements Partial<ProgressStore> {
  profiles = new Map<string, Profile>();
  log: LearningEvidence[] = [];
  pending: LearningEvidence[] = [];
  async listProfiles() {
    return [...this.profiles.values()];
  }
  async saveProfile(p: Profile) {
    this.profiles.set(p.id, p);
  }
  async events(profile: string) {
    return this.log.filter((e) => e.profile === profile);
  }
  async outbox(limit: number) {
    return this.pending.slice(0, limit);
  }
  async markSynced(ids: readonly string[]) {
    this.pending = this.pending.filter((e) => !ids.includes(e.id));
  }
  async deviceToken() {
    return null;
  }
}

let minute = Date.UTC(2026, 9, 3, 9, 0);
const event = (profile: string): LearningEvidence => {
  minute += 60_000;
  return {
    v: 1,
    id: evidenceId(minute),
    profile,
    at: new Date(minute).toISOString(),
    activity: 'count-three',
    objective: 'count-three',
    round: 'one',
    item: 'd'.repeat(32),
    source: 'generator',
    fresh: true,
    outcome: 'first-try',
    helpLevel: 0,
    surface: 'lesson',
    input: 'tap',
    duration: 'lt10s',
  };
};

function fakeApi(session: SessionResponse, serverEvents: LearningEvidence[] = []) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('/api/learning', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', path, body });
    if (path === '/session') return Response.json(session);
    if (path === '/profiles' && init?.method === 'POST') return Response.json(body, { status: 201 });
    if (path.startsWith('/profiles/') && init?.method === 'DELETE')
      return new Response(null, { status: 204 });
    if (path === '/events' && init?.method === 'POST') {
      const r: EventBatchResponse = { accepted: body.events.length, duplicate: 0, rejected: [] };
      return Response.json(r);
    }
    if (path.startsWith('/events')) return Response.json({ events: serverEvents });
    return Response.json({ code: 'LEARNING_NOT_FOUND', message: 'x' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('account sync helpers', () => {
  const kid = (nickname: string): Profile => ({ id: newProfileId(), nickname, avatar: 'pip-red' });

  it('syncNow (parent): uploads missing local profiles with their ids, pulls the family’s, sends the outbox', async () => {
    const store = new Store();
    const local = kid('Ada');
    const remote = kid('Ben');
    await store.saveProfile(local);
    store.pending = [event(local.id), event(local.id)];
    const calls = fakeApi({
      signedIn: true,
      as: 'parent',
      family: { id: 'fam', profiles: [remote], passkeys: 0, consentVersion: 'x' },
    });
    const result = await syncNow(store as unknown as ProgressStore);
    expect(result).toMatchObject({ status: 'done', accepted: 2, profiles: 1 });
    expect(calls.find((c) => c.path === '/profiles')?.body).toEqual(local);
    expect(store.profiles.get(remote.id)).toEqual(remote);
    expect(store.pending).toEqual([]);
  });

  it('syncNow (device): never creates profiles, still pulls them and sends', async () => {
    const store = new Store();
    const remote = kid('Cy');
    store.pending = [event(remote.id)];
    const calls = fakeApi({
      signedIn: true,
      as: 'device',
      device: { id: 'd', label: 'Tablet' },
      family: { id: 'fam', profiles: [remote], passkeys: 0, consentVersion: 'x' },
    });
    expect(await syncNow(store as unknown as ProgressStore)).toMatchObject({ status: 'done', accepted: 1 });
    expect(calls.some((c) => c.path === '/profiles' && c.method === 'POST')).toBe(false);
    expect(store.profiles.has(remote.id)).toBe(true);
  });

  it('without an account (or with accounts off) everything stays local and nothing throws', async () => {
    const store = new Store();
    const local = kid('Dee');
    await store.saveProfile(local);
    store.log = [event(local.id)];
    fakeApi({ signedIn: false });
    expect(await syncNow(store as unknown as ProgressStore)).toBeNull();
    expect(await progressEvents(store as unknown as ProgressStore, local.id)).toEqual(store.log);
    expect(await pushProfile(local)).toBe(false);
    expect(await removeProfile(local.id)).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ code: 'LEARNING_UNAVAILABLE', message: 'off' }, { status: 404 })),
    );
    expect(await syncNow(store as unknown as ProgressStore)).toBeNull();
    expect(await progressProfiles(store as unknown as ProgressStore)).toEqual([local]);
  });

  it('a signed-in parent sees the family’s events merged with this device’s unsent ones', async () => {
    const store = new Store();
    const child = kid('Eve');
    const fromTablet = [event(child.id), event(child.id)];
    const unsent = event(child.id);
    store.log = [fromTablet[0] as LearningEvidence, unsent];
    fakeApi(
      {
        signedIn: true,
        as: 'parent',
        family: { id: 'fam', profiles: [child], passkeys: 1, consentVersion: 'x' },
      },
      fromTablet,
    );
    expect(await progressEvents(store as unknown as ProgressStore, child.id)).toEqual([
      ...fromTablet,
      unsent,
    ]);
    expect(await progressProfiles(store as unknown as ProgressStore)).toEqual([child]);
    expect(await pushProfile(child)).toBe(true);
    expect(await removeProfile(child.id)).toBe(true);
  });
});
