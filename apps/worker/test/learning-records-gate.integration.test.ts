/**
 * Phase 31 M3: the `LEARNING_ACCOUNTS` gate (off | allowlist | on), Turnstile, and fail-closed configuration,
 * in real workerd with vars and secrets overridden per case.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { client, configPath } from './learning-records-client.ts';

describe('learning accounts gate (real workerd)', { timeout: 60_000 }, () => {
  const server = createTestHarness();
  const api = client(server);
  const configure = async (vars: Record<string, string>, secrets: Record<string, string> = {}) => {
    await server.update({ workers: [{ configPath, vars, secrets }] });
    const worker = server.getWorker<Env>();
    await worker.applyD1Migrations('LEARNING_DB');
  };

  beforeAll(async () => {
    await server.update({ workers: [{ configPath }] });
    await server.listen();
  }, 180_000);
  afterAll(() => server.close());

  test('off (the default for production and previews): every endpoint is 404 LEARNING_UNAVAILABLE', async () => {
    await configure({ LEARNING_ACCOUNTS: 'off' });
    for (const [method, path] of [
      ['GET', '/session'],
      ['POST', '/auth/email'],
      ['POST', '/auth/email/verify'],
      ['POST', '/auth/passkey/login/options'],
      ['GET', '/profiles'],
      ['POST', '/devices/claim'],
      ['POST', '/events'],
      ['GET', '/export'],
      ['DELETE', '/family'],
      ['GET', '/dev/mailbox'],
      ['GET', '/anything-else'],
    ] as const) {
      const res = await api.call(path, { method, ...(method === 'GET' ? {} : { body: {} }) });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({
        code: 'LEARNING_UNAVAILABLE',
        message: expect.any(String),
      });
    }
    // an unknown value is off too
    await configure({ LEARNING_ACCOUNTS: 'yes please' });
    expect((await api.call('/session')).status).toBe(404);
  });

  test('allowlist: only listed emails get a link; the answer is identical for everyone', async () => {
    await configure(
      { LEARNING_ACCOUNTS: 'allowlist' },
      { LEARNING_ALLOWED_EMAILS: ' Invited@Example.org , other@example.org' },
    );
    const invited = await api.requestLink('invited@example.org');
    const stranger = await api.requestLink('stranger@example.org');
    expect(invited.status).toBe(202);
    expect(stranger.status).toBe(202);
    expect(await stranger.text()).toBe(await invited.text());
    const { cookie } = await api.signIn('invited@example.org');
    expect(((await (await api.call('/session', { cookie })).json()) as { signedIn: boolean }).signedIn).toBe(
      true,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(await api.mailbox('stranger@example.org')).toEqual([]);
  });

  test('on: anyone can sign up with consent', async () => {
    await configure({ LEARNING_ACCOUNTS: 'on' });
    const { familyId } = await api.signIn('anyone@example.org');
    expect(familyId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('Turnstile failure stops the request before any email', async () => {
    await configure({ LEARNING_ACCOUNTS: 'on' }, { TURNSTILE_SECRET: '2x0000000000000000000000000000000AA' });
    const res = await api.requestLink('blocked@example.org');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('LEARNING_FORBIDDEN');
    await new Promise((r) => setTimeout(r, 300));
    expect(await api.mailbox('blocked@example.org')).toEqual([]);
  });
});
