/**
 * Phase 31 M3: `/api/learning/*` in real workerd with D1 (`LEARNING_DB`), the `FamilyRecords` Durable Object,
 * KV (the development mock mailbox) and the rate-limit bindings. Contracts §10.5 (CCR-31-3).
 */
import { createHash } from 'node:crypto';
import {
  CONSENT_VERSION,
  type EventBatchResponse,
  type EventPage,
  type FamilyExport,
  MAX_EVENTS_PER_BATCH,
  type SessionResponse,
} from '@wwm/learning';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { SoftAuthenticator } from './learning-records-authenticator.ts';
import { client, configPath, evidence, PAGE_ORIGIN, profile } from './learning-records-client.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (ms: number) => new Date(ms).toISOString();

describe('learning records API (real workerd + D1 + Durable Objects)', { timeout: 60_000 }, () => {
  const server = createTestHarness();
  const api = client(server);
  const { call, signIn, pairDevice } = api;
  let env: Env;
  let worker: ReturnType<typeof server.getWorker<Env>>;
  let n = 0;
  const email = (tag: string) => `parent-${tag}-${++n}@example.org`;

  beforeAll(async () => {
    await server.update({ workers: [{ configPath }] });
    await server.listen();
    worker = server.getWorker<Env>();
    await worker.applyD1Migrations('DB');
    await worker.applyD1Migrations('LEARNING_DB');
    env = await worker.getEnv();
  }, 180_000);
  afterAll(() => server.close());

  const rows = async (sql: string, ...args: (string | number)[]) =>
    (
      await env.LEARNING_DB.prepare(sql)
        .bind(...args)
        .all()
    ).results;
  const doTables = async (familyId: string) => {
    const storage = await worker.getDurableObjectStorage('FAMILY_RECORDS', { name: familyId });
    return (await storage.exec(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'",
    )) as { name: string }[];
  };

  test('anonymous session, JSON errors with LEARNING_* codes, and no-store everywhere', async () => {
    const res = await call('/session');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ signedIn: false });
    for (const [method, path] of [
      ['GET', '/profiles'],
      ['GET', '/devices'],
      ['GET', '/events'],
      ['GET', '/export'],
      ['DELETE', '/family'],
      ['POST', '/devices/pair-code'],
      ['POST', '/auth/passkey/register/options'],
    ] as const) {
      const r = await call(path, { method });
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(((await r.json()) as { code: string }).code).toBe('LEARNING_AUTH_REQUIRED');
    }
    const unknown = await call('/nope');
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe('LEARNING_NOT_FOUND');
  });

  test('a new email creates a family only with consent; consent version and time are recorded', async () => {
    const address = email('consent');
    // without consent: 202, an explanation email with no link, and no family
    expect((await api.requestLink(address, false)).status).toBe(202);
    const [first] = await api.waitForMail(address);
    expect(api.tokenFrom(first?.text ?? '')).toBeNull();
    expect(first?.text).toContain('tick the box');
    expect(await rows('SELECT id FROM parents WHERE email = ?', address)).toEqual([]);
    // a link minted without consent (forged here) cannot create a family either
    const token = 'n'.repeat(43);
    await env.LEARNING_DB.prepare(
      'INSERT INTO sign_in_links (token_hash, email, consent_version, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)',
    )
      .bind(hash(token), address, iso(Date.now()), iso(Date.now() + 600_000))
      .run();
    const refused = await call('/auth/email/verify', { method: 'POST', body: { token } });
    expect(refused.status).toBe(400);
    expect(await rows('SELECT id FROM parents WHERE email = ?', address)).toEqual([]);
    // with consent: a family, the version and the time
    const before = Date.now();
    const { familyId, cookie } = await signIn(address);
    const [parent] = (await rows('SELECT * FROM parents WHERE id = ?', familyId)) as {
      email: string;
      consent_version: string;
      consent_at: string;
    }[];
    expect(parent?.email).toBe(address);
    expect(parent?.consent_version).toBe(CONSENT_VERSION);
    expect(Date.parse(parent?.consent_at ?? '')).toBeGreaterThanOrEqual(before - 1000);
    const session = (await (await call('/session', { cookie })).json()) as SessionResponse;
    expect(session).toEqual({
      signedIn: true,
      as: 'parent',
      family: { id: familyId, profiles: [], passkeys: 0, consentVersion: CONSENT_VERSION },
    });
    // the email is normalized: the same family for a differently cased address
    const again = await signIn(address.toUpperCase());
    expect(again.familyId).toBe(familyId);
  });

  test('the session cookie is HttpOnly, Secure, SameSite=Lax, Path=/api/learning, 30 days', async () => {
    const address = email('cookie');
    await api.requestLink(address);
    const [mail] = await api.waitForMail(address);
    const res = await call('/auth/email/verify', {
      method: 'POST',
      body: { token: api.tokenFrom(mail?.text ?? '') },
    });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^wwm_learning_session=[A-Za-z0-9_-]{43}; /);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/learning'])
      expect(cookie).toContain(part);
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBeGreaterThan(30 * 86400 - 60);
    expect(maxAge).toBeLessThanOrEqual(30 * 86400);
    // the link went to /learn/account/verify in the fragment, and only its hash is stored
    expect(mail?.text).toContain(`${PAGE_ORIGIN}/learn/account/verify#token=`);
    const token = api.tokenFrom(mail?.text ?? '') ?? '';
    expect(await rows('SELECT token_hash FROM sign_in_links WHERE token_hash = ?', token)).toEqual([]);
    expect(await rows('SELECT token_hash FROM sign_in_links WHERE token_hash = ?', hash(token))).toHaveLength(
      1,
    );
    const sessionToken = /wwm_learning_session=([^;]+)/.exec(cookie)?.[1] ?? '';
    expect(await rows('SELECT 1 FROM sessions WHERE token_hash = ?', sessionToken)).toEqual([]);
    expect(await rows('SELECT 1 FROM sessions WHERE token_hash = ?', hash(sessionToken))).toHaveLength(1);
  });

  test('sign-in links work once and expire after 15 minutes', async () => {
    const address = email('once');
    await api.requestLink(address);
    const [mail] = await api.waitForMail(address);
    const token = api.tokenFrom(mail?.text ?? '') as string;
    const [link] = (await rows(
      'SELECT created_at, expires_at FROM sign_in_links WHERE token_hash = ?',
      hash(token),
    )) as {
      created_at: string;
      expires_at: string;
    }[];
    expect(Date.parse(link?.expires_at ?? '') - Date.parse(link?.created_at ?? '')).toBe(15 * 60_000);
    expect((await call('/auth/email/verify', { method: 'POST', body: { token } })).status).toBe(200);
    const reused = await call('/auth/email/verify', { method: 'POST', body: { token } });
    expect(reused.status).toBe(400);
    expect(((await reused.json()) as { code: string }).code).toBe('LEARNING_INVALID');
    // an expired link
    const expired = 'e'.repeat(43);
    await env.LEARNING_DB.prepare(
      'INSERT INTO sign_in_links (token_hash, email, consent_version, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(hash(expired), address, CONSENT_VERSION, iso(Date.now() - 16 * 60_000), iso(Date.now() - 60_000))
      .run();
    expect((await call('/auth/email/verify', { method: 'POST', body: { token: expired } })).status).toBe(400);
    expect((await call('/auth/email/verify', { method: 'POST', body: { token: 'short' } })).status).toBe(400);
  });

  test('no account enumeration: existing, new and consent-less emails get the same answer', async () => {
    const existing = email('exists');
    await signIn(existing);
    const answers = [];
    for (const [address, consent] of [
      [existing, false],
      [existing, true],
      [email('new'), true],
      [email('new-no-consent'), false],
    ] as const) {
      const res = await api.requestLink(address, consent);
      answers.push({ status: res.status, body: await res.text(), type: res.headers.get('content-type') });
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 202, body: '{}', type: 'application/json' });
    // Turnstile is required (and checked) before anything happens
    const noTurnstile = await call('/auth/email', { method: 'POST', body: { email: existing } });
    expect(noTurnstile.status).toBe(400);
  });

  test('profiles: device-made ids, upsert, patch, validation, and devices may only read', async () => {
    const { cookie } = await signIn(email('profiles'));
    const robin = profile('Robin');
    const created = await call('/profiles', { method: 'POST', cookie, body: robin });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(robin);
    expect((await call('/profiles', { method: 'POST', cookie, body: robin })).status).toBe(200);
    const patched = await call(`/profiles/${robin.id}`, {
      method: 'PATCH',
      cookie,
      body: { nickname: "Ro O'Neil", avatar: 'pip-teal', ageBand: 5 },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ ...robin, nickname: "Ro O'Neil", avatar: 'pip-teal', ageBand: 5 });
    const cleared = await call(`/profiles/${robin.id}`, { method: 'PATCH', cookie, body: { ageBand: null } });
    expect(await cleared.json()).toEqual({ ...robin, nickname: "Ro O'Neil", avatar: 'pip-teal' });
    for (const bad of [
      { ...profile(), nickname: 'R0bin<script>' },
      { ...profile(), avatar: 'dragon' },
      { ...profile(), id: 'short' },
      { ...profile(), birthday: '2020-01-01' },
    ])
      expect((await call('/profiles', { method: 'POST', cookie, body: bad })).status).toBe(400);
    expect((await call(`/profiles/${profile().id}`, { method: 'PATCH', cookie, body: {} })).status).toBe(404);
    const device = await pairDevice(cookie);
    const listed = await call('/profiles', { bearer: device.token });
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { profiles: unknown[] }).profiles).toHaveLength(1);
    expect((await call('/profiles', { method: 'POST', bearer: device.token, body: profile() })).status).toBe(
      401,
    );
    expect((await call(`/profiles/${robin.id}`, { method: 'DELETE', bearer: device.token })).status).toBe(
      401,
    );
    const asDevice = (await (await call('/session', { bearer: device.token })).json()) as SessionResponse;
    expect(asDevice.as).toBe('device');
    expect(asDevice.device).toEqual(device.device);
    expect(asDevice.family?.profiles).toHaveLength(1);
  });

  test('pair codes: 6 characters from A-HJ-NP-Z2-9, 10 minutes, one use; claims return a bearer token', async () => {
    const { cookie, familyId } = await signIn(email('pair'));
    const res = await call('/devices/pair-code', { method: 'POST', cookie });
    expect(res.status).toBe(201);
    const { code, expiresAt } = (await res.json()) as { code: string; expiresAt: string };
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect(await rows('SELECT 1 FROM pair_codes WHERE code_hash = ?', code)).toEqual([]);
    const claim = await call('/devices/claim', { method: 'POST', body: { code, label: 'Kitchen tablet' } });
    expect(claim.status).toBe(201);
    const claimed = (await claim.json()) as { token: string; device: { id: string; label: string } };
    expect(claimed.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(claimed.device.label).toBe('Kitchen tablet');
    expect((await call('/devices/claim', { method: 'POST', body: { code } })).status).toBe(400);
    // expired
    await env.LEARNING_DB.prepare(
      'INSERT INTO pair_codes (code_hash, family_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
      .bind(hash('ZZZZ22'), familyId, iso(Date.now() - 11 * 60_000), iso(Date.now() - 60_000))
      .run();
    expect((await call('/devices/claim', { method: 'POST', body: { code: 'ZZZZ22' } })).status).toBe(400);
    for (const bad of ['ABCDE', 'ABCDE1', 'abcdef', 'ABCDEO'])
      expect((await call('/devices/claim', { method: 'POST', body: { code: bad } })).status).toBe(400);
    const devices = (await (await call('/devices', { cookie })).json()) as { devices: { id: string }[] };
    expect(devices.devices.map((d) => d.id)).toEqual([claimed.device.id]);
    expect(await rows('SELECT 1 FROM devices WHERE token_hash = ?', claimed.token)).toEqual([]);
  });

  test('events: idempotent by id, unknown profiles and invalid events rejected, paged oldest first', async () => {
    const { cookie } = await signIn(email('events'));
    const child = profile('Sam');
    await call('/profiles', { method: 'POST', cookie, body: child });
    const device = await pairDevice(cookie);
    const batch = [evidence(child.id), evidence(child.id)];
    const post = (events: unknown[], bearer = device.token) =>
      call('/events', { method: 'POST', bearer, body: { events } });
    expect(await (await post(batch)).json()).toEqual({ accepted: 2, duplicate: 0, rejected: [] });
    expect(await (await post(batch)).json()).toEqual({ accepted: 0, duplicate: 2, rejected: [] });
    const stranger = evidence(profile().id);
    const broken = { ...evidence(child.id), helpLevel: 9 };
    const mixed = (await (await post([evidence(child.id), stranger, broken])).json()) as EventBatchResponse;
    expect(mixed.accepted).toBe(1);
    expect(mixed.rejected).toEqual([
      { id: stranger.id, code: 'UNKNOWN_PROFILE' },
      { id: broken.id, code: 'INVALID' },
    ]);
    expect((await post([])).status).toBe(400);
    expect(
      (await post(Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => evidence(child.id)))).status,
    ).toBe(400);
    // a parent can send events too; only a parent can read them
    expect(
      (await call('/events', { method: 'POST', cookie, body: { events: [evidence(child.id)] } })).status,
    ).toBe(200);
    expect((await call('/events', { bearer: device.token })).status).toBe(401);
    // paging: 600 more, pages of 500, oldest first, cursor continues exactly
    for (let i = 0; i < 3; i++)
      await post(Array.from({ length: MAX_EVENTS_PER_BATCH }, () => evidence(child.id)));
    const first = (await (await call(`/events?profile=${child.id}`, { cookie })).json()) as EventPage;
    expect(first.events).toHaveLength(500);
    expect(first.next).toBeTruthy();
    const second = (await (
      await call(`/events?profile=${child.id}&cursor=${first.next}`, { cookie })
    ).json()) as EventPage;
    expect(second.next).toBeUndefined();
    const all = [...first.events, ...second.events];
    expect(all).toHaveLength(604);
    expect(new Set(all.map((e) => e.id)).size).toBe(604);
    const keys = all.map((e) => `${e.at}|${e.id}`);
    expect(keys).toEqual([...keys].sort());
    expect(all[0]).toEqual(batch[0]);
    expect((await call('/events?cursor=%%%', { cookie })).status).toBe(400);
  });

  test('deleting a profile deletes its events (and only its events)', async () => {
    const { cookie, familyId } = await signIn(email('cascade'));
    const [a, b] = [profile('Ada'), profile('Ben')];
    for (const p of [a, b]) await call('/profiles', { method: 'POST', cookie, body: p });
    await call('/events', {
      method: 'POST',
      cookie,
      body: { events: [evidence(a.id), evidence(a.id), evidence(b.id)] },
    });
    expect((await call(`/profiles/${a.id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await call(`/profiles/${a.id}`, { method: 'DELETE', cookie })).status).toBe(404);
    const page = (await (await call('/events', { cookie })).json()) as EventPage;
    expect(page.events.map((e) => e.profile)).toEqual([b.id]);
    const storage = await worker.getDurableObjectStorage('FAMILY_RECORDS', { name: familyId });
    expect(await storage.exec('SELECT COUNT(*) AS n FROM events WHERE profile = ?', a.id)).toEqual([
      { n: 0 },
    ]);
    // events for the deleted profile are now rejected
    const late = (await (
      await call('/events', { method: 'POST', cookie, body: { events: [evidence(a.id)] } })
    ).json()) as EventBatchResponse;
    expect(late.rejected).toEqual([expect.objectContaining({ code: 'UNKNOWN_PROFILE' })]);
  });

  test('cross-family isolation: family B’s session or device can never read or write family A', async () => {
    const A = await signIn(email('iso-a'));
    const B = await signIn(email('iso-b'));
    const childA = profile('Alma');
    await call('/profiles', { method: 'POST', cookie: A.cookie, body: childA });
    const deviceA = await pairDevice(A.cookie);
    const deviceB = await pairDevice(B.cookie);
    await call('/events', { method: 'POST', bearer: deviceA.token, body: { events: [evidence(childA.id)] } });

    // B writing events for A's child: rejected, nothing lands anywhere
    for (const auth of [{ cookie: B.cookie }, { bearer: deviceB.token }]) {
      const res = (await (
        await call('/events', { method: 'POST', ...auth, body: { events: [evidence(childA.id)] } })
      ).json()) as EventBatchResponse;
      expect(res.accepted).toBe(0);
      expect(res.rejected[0]?.code).toBe('UNKNOWN_PROFILE');
    }
    // B reading: its own (empty) family only
    expect(
      ((await (await call(`/events?profile=${childA.id}`, { cookie: B.cookie })).json()) as EventPage).events,
    ).toEqual([]);
    expect(
      ((await (await call('/profiles', { bearer: deviceB.token })).json()) as { profiles: unknown[] })
        .profiles,
    ).toEqual([]);
    // B changing A's things by id: not found
    expect(
      (await call(`/profiles/${childA.id}`, { method: 'PATCH', cookie: B.cookie, body: { nickname: 'X' } }))
        .status,
    ).toBe(404);
    expect((await call(`/profiles/${childA.id}`, { method: 'DELETE', cookie: B.cookie })).status).toBe(404);
    expect((await call(`/devices/${deviceA.device.id}`, { method: 'DELETE', cookie: B.cookie })).status).toBe(
      404,
    );
    // A is untouched
    const page = (await (await call('/events', { cookie: A.cookie })).json()) as EventPage;
    expect(page.events).toHaveLength(1);
    expect(
      ((await (await call('/profiles', { cookie: A.cookie })).json()) as { profiles: unknown[] }).profiles,
    ).toEqual([childA]);
    expect(
      (
        await call('/events', {
          bearer: deviceA.token,
          method: 'POST',
          body: { events: [evidence(childA.id)] },
        })
      ).status,
    ).toBe(200);
    // B's export has nothing of A's
    const exportB = (await (await call('/export', { cookie: B.cookie })).json()) as FamilyExport;
    expect(exportB.profiles).toEqual([]);
    expect(exportB.events).toEqual([]);
    expect(exportB.devices.map((d) => d.id)).toEqual([deviceB.device.id]);
  });

  test('revoking a device stops its token immediately', async () => {
    const { cookie } = await signIn(email('revoke'));
    const child = profile();
    await call('/profiles', { method: 'POST', cookie, body: child });
    const device = await pairDevice(cookie);
    expect((await call('/profiles', { bearer: device.token })).status).toBe(200);
    expect((await call(`/devices/${device.device.id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await call('/profiles', { bearer: device.token })).status).toBe(401);
    expect(
      (
        await call('/events', {
          method: 'POST',
          bearer: device.token,
          body: { events: [evidence(child.id)] },
        })
      ).status,
    ).toBe(401);
    expect(await (await call('/session', { bearer: device.token })).json()).toEqual({ signedIn: false });
    expect(((await (await call('/devices', { cookie })).json()) as { devices: unknown[] }).devices).toEqual(
      [],
    );
  });

  test('CSRF: cookie-authenticated changes and sign-in must come from an allowed origin', async () => {
    const { cookie } = await signIn(email('csrf'));
    const child = profile();
    for (const origin of ['https://evil.example', null, 'null']) {
      const res = await call('/profiles', { method: 'POST', cookie, body: child, origin });
      expect(res.status, String(origin)).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('LEARNING_FORBIDDEN');
      expect((await call('/family', { method: 'DELETE', cookie, origin })).status).toBe(403);
      expect(
        (await call('/auth/email/verify', { method: 'POST', body: { token: 'x'.repeat(43) }, origin }))
          .status,
      ).toBe(403);
    }
    // the configured page origin (Vite on :5174 in dev) is allowed, as is the Worker's own origin
    expect(
      (await call('/profiles', { method: 'POST', cookie, body: child, origin: PAGE_ORIGIN })).status,
    ).toBe(201);
    // the browser's own cross-site signal is refused before anything else
    const crossSite = await server.fetch('http://localhost/api/learning/devices/claim', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ABCDEF' }),
    });
    expect(crossSite.status).toBe(403);
    // a device token alone needs no Origin (a browser never attaches it by itself)
    const device = await pairDevice(cookie);
    expect(
      (
        await call('/events', {
          method: 'POST',
          bearer: device.token,
          origin: null,
          body: { events: [evidence(child.id)] },
        })
      ).status,
    ).toBe(200);
  });

  test('passkeys: register after email sign-in, then sign in with it (WebAuthn in workerd)', async () => {
    const address = email('passkey');
    const { cookie, familyId } = await signIn(address);
    const authenticator = new SoftAuthenticator('localhost', PAGE_ORIGIN);
    const options = (await (
      await call('/auth/passkey/register/options', { method: 'POST', cookie, origin: PAGE_ORIGIN })
    ).json()) as { challenge: string; user: { id: string; name: string }; rp: { id: string } };
    expect(options.rp.id).toBe('localhost');
    const registered = await call('/auth/passkey/register/verify', {
      method: 'POST',
      cookie,
      origin: PAGE_ORIGIN,
      body: await authenticator.register(options),
    });
    expect(registered.status).toBe(200);
    expect(((await registered.json()) as SessionResponse).family?.passkeys).toBe(1);
    // a replayed registration (challenge already used) is refused
    expect(
      (
        await call('/auth/passkey/register/verify', {
          method: 'POST',
          cookie,
          origin: PAGE_ORIGIN,
          body: await authenticator.register(options),
        })
      ).status,
    ).toBe(400);

    const login = async (origin = PAGE_ORIGIN) => {
      const opts = (await (await call('/auth/passkey/login/options', { method: 'POST' })).json()) as {
        challenge: string;
        allowCredentials?: unknown[];
      };
      expect(opts.allowCredentials ?? []).toEqual([]); // discoverable: reveals no accounts
      return { opts, body: await authenticator.login(opts, origin) };
    };
    const { body } = await login();
    const res = await call('/auth/passkey/login/verify', { method: 'POST', body, origin: PAGE_ORIGIN });
    expect(res.status).toBe(200);
    const fresh = api.cookieFrom(res);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(cookie);
    expect(((await res.json()) as SessionResponse).family?.id).toBe(familyId);
    // the same assertion again: challenge used up
    expect(
      (await call('/auth/passkey/login/verify', { method: 'POST', body, origin: PAGE_ORIGIN })).status,
    ).toBe(401);
    // signed for another origin
    const wrong = await login('https://evil.example');
    expect(
      (await call('/auth/passkey/login/verify', { method: 'POST', body: wrong.body, origin: PAGE_ORIGIN }))
        .status,
    ).toBe(401);
    // the stored key is a public key, never anything secret
    const [key] = (await rows(
      'SELECT id, public_key, counter FROM passkeys WHERE family_id = ?',
      familyId,
    )) as {
      id: string;
      counter: number;
    }[];
    expect(key?.id).toBe(authenticator.id);
    expect(key?.counter).toBe(1);
  });

  test('sign-out deletes the session', async () => {
    const { cookie } = await signIn(email('signout'));
    const res = await call('/auth/signout', { method: 'POST', cookie });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await rows('SELECT 1 FROM sessions WHERE token_hash = ?', hash(cookie))).toEqual([]);
    expect(await (await call('/session', { cookie })).json()).toEqual({ signedIn: false });
  });

  test('export has the family, every profile, device and event', async () => {
    const address = email('export');
    const { cookie, familyId } = await signIn(address);
    const kids = [profile('Ada'), { ...profile('Ben'), ageBand: 4 as const }];
    for (const p of kids) await call('/profiles', { method: 'POST', cookie, body: p });
    const device = await pairDevice(cookie, 'Old phone');
    const events = [evidence(kids[0]?.id ?? ''), evidence(kids[1]?.id ?? ''), evidence(kids[1]?.id ?? '')];
    await call('/events', { method: 'POST', bearer: device.token, body: { events } });
    const res = await call('/export', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const exported = (await res.json()) as FamilyExport;
    expect(exported.format).toBe('wwm-learning-family-export/1');
    expect(exported.family).toEqual({
      id: familyId,
      email: address,
      consentVersion: CONSENT_VERSION,
      consentAt: expect.any(String),
      createdAt: expect.any(String),
    });
    expect(exported.profiles).toEqual(kids);
    expect(exported.devices).toEqual([
      expect.objectContaining({ id: device.device.id, label: 'Old phone', createdAt: expect.any(String) }),
    ]);
    expect(exported.events).toEqual(events);
  });

  test('deleting the family removes every D1 row and all Durable Object data, then signs out', async () => {
    const address = email('delete');
    const { cookie, familyId } = await signIn(address);
    const child = profile();
    await call('/profiles', { method: 'POST', cookie, body: child });
    const device = await pairDevice(cookie);
    await call('/devices/pair-code', { method: 'POST', cookie }); // an unused code too
    await call('/auth/passkey/register/options', { method: 'POST', cookie }); // and a pending challenge
    await call('/events', { method: 'POST', bearer: device.token, body: { events: [evidence(child.id)] } });
    expect((await doTables(familyId)).length).toBeGreaterThan(0);

    const res = await call('/family', { method: 'DELETE', cookie });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    for (const table of ['passkeys', 'sessions', 'devices', 'pair_codes', 'auth_challenges'])
      expect(await rows(`SELECT * FROM ${table} WHERE family_id = ?`, familyId), table).toEqual([]);
    expect(await rows('SELECT * FROM parents WHERE id = ? OR email = ?', familyId, address)).toEqual([]);
    expect(await rows('SELECT * FROM sign_in_links WHERE email = ?', address)).toEqual([]);
    expect(await doTables(familyId)).toEqual([]);
    expect(await (await call('/session', { cookie })).json()).toEqual({ signedIn: false });
    expect((await call('/profiles', { bearer: device.token })).status).toBe(401);
    // the address can start again (with consent) as a brand new family
    const again = await signIn(address);
    expect(again.familyId).not.toBe(familyId);
  });

  test('retention: the cron deletes families inactive for 24 months and expired tokens', async () => {
    const stale = await signIn(email('stale'));
    const active = await signIn(email('active'));
    const child = profile();
    await call('/profiles', { method: 'POST', cookie: stale.cookie, body: child });
    await call('/events', { method: 'POST', cookie: stale.cookie, body: { events: [evidence(child.id)] } });
    const longAgo = iso(Date.now() - 731 * 86400_000);
    await env.LEARNING_DB.prepare('UPDATE parents SET last_active_at = ? WHERE id = ?')
      .bind(longAgo, stale.familyId)
      .run();
    await env.LEARNING_DB.prepare(
      'INSERT INTO sign_in_links (token_hash, email, consent_version, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)',
    )
      .bind(hash('old-link'), 'someone@example.org', longAgo, longAgo)
      .run();
    await worker.scheduled({ cron: '17 */4 * * *', scheduledTime: new Date() });
    expect(await rows('SELECT * FROM parents WHERE id = ?', stale.familyId)).toEqual([]);
    expect(await rows('SELECT * FROM sessions WHERE family_id = ?', stale.familyId)).toEqual([]);
    expect(await doTables(stale.familyId)).toEqual([]);
    expect(await rows('SELECT * FROM sign_in_links WHERE token_hash = ?', hash('old-link'))).toEqual([]);
    expect(await rows('SELECT id FROM parents WHERE id = ?', active.familyId)).toHaveLength(1);
    expect((await call('/session', { cookie: active.cookie })).status).toBe(200);
  });

  test('rate limits: per IP on auth/* and devices/claim, per family on events', async () => {
    const ip = '192.0.2.77';
    const statuses = [];
    for (let i = 0; i < 21; i++)
      statuses.push((await call('/auth/passkey/login/options', { method: 'POST', ip })).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
    const limited = await call('/devices/claim', { method: 'POST', ip, body: { code: 'ABCDEF' } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(((await limited.json()) as { code: string }).code).toBe('LEARNING_RATE_LIMITED');
    // another IP is unaffected
    expect((await call('/auth/passkey/login/options', { method: 'POST' })).status).toBe(200);

    const { cookie } = await signIn(email('events-limit'));
    const child = profile();
    await call('/profiles', { method: 'POST', cookie, body: child });
    const device = await pairDevice(cookie);
    const results = [];
    for (let i = 0; i < 61; i++)
      results.push(
        (
          await call('/events', {
            method: 'POST',
            bearer: device.token,
            body: { events: [evidence(child.id)] },
          })
        ).status,
      );
    expect(results.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(results[60]).toBe(429);
    // the family's limit, whichever credential is used
    expect(
      (await call('/events', { method: 'POST', cookie, body: { events: [evidence(child.id)] } })).status,
    ).toBe(429);
  });

  test('privacy: nothing in the Worker logs carries an email address or a nickname', async () => {
    server.clearLogs();
    const address = email('logs');
    const { cookie } = await signIn(address);
    await call('/profiles', { method: 'POST', cookie, body: profile('Zebediah') });
    await call('/profiles', { method: 'POST', cookie, body: { nickname: 'Bad<' } });
    await call('/auth/email/verify', { method: 'POST', body: { token: 'q'.repeat(43) } });
    const text = JSON.stringify(server.getLogs());
    expect(text).not.toContain(address);
    expect(text).not.toContain('@example.org');
    expect(text).not.toContain('Zebediah');
  });
});
