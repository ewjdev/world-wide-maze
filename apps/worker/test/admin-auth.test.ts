import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, test } from 'vitest';
import { authenticateAdmin } from '../src/admin-auth.ts';
import { adminRoutes } from '../src/routes/admin.ts';

const config = {
  ADMIN_ACCESS_TEAM_DOMAIN: 'maze.cloudflareaccess.com',
  ADMIN_ACCESS_AUD: 'admin-app',
  ADMIN_EMAILS: 'operator@example.com',
};
const pair = await generateKeyPair('RS256');
const jwk = await exportJWK(pair.publicKey);
const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'key', alg: 'RS256' }] });
const token = async (overrides: Record<string, unknown> = {}) =>
  new SignJWT({ email: 'operator@example.com', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'key' })
    .setIssuer('https://maze.cloudflareaccess.com')
    .setAudience('admin-app')
    .setSubject('operator-id')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(pair.privateKey);
const request = (jwt: string) =>
  new Request('https://maze.example/api/admin/session', { headers: { 'cf-access-jwt-assertion': jwt } });

describe('operator authorization', () => {
  test('verifies signature issuer audience expiry and email allowlist', async () => {
    expect(await authenticateAdmin(request(await token()), config, keys)).toEqual({
      email: 'operator@example.com',
    });
    expect(
      await authenticateAdmin(request(await token({ email: 'stranger@example.com' })), config, keys),
    ).toBeNull();
    expect(
      await authenticateAdmin(request(await token()), { ...config, ADMIN_ACCESS_AUD: 'other' }, keys),
    ).toBeNull();
    expect(
      await authenticateAdmin(
        request(await token()),
        { ...config, ADMIN_ACCESS_TEAM_DOMAIN: 'other.cloudflareaccess.com' },
        keys,
      ),
    ).toBeNull();
  });
  test('rejects expired, unsigned, spoofed headers, or unconfigured authentication', async () => {
    const expired = await new SignJWT({ email: 'operator@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'key' })
      .setIssuer('https://maze.cloudflareaccess.com')
      .setAudience('admin-app')
      .setSubject('id')
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(pair.privateKey);
    expect(await authenticateAdmin(request(expired), config, keys)).toBeNull();
    expect(
      await authenticateAdmin(
        request('eyJhbGciOiJub25lIn0.eyJlbWFpbCI6Im9wZXJhdG9yQGV4YW1wbGUuY29tIn0.'),
        config,
        keys,
      ),
    ).toBeNull();
    expect(
      await authenticateAdmin(
        new Request('https://maze.example', {
          headers: { 'cf-access-authenticated-user-email': 'operator@example.com' },
        }),
        config,
        keys,
      ),
    ).toBeNull();
    expect(await authenticateAdmin(request(await token()), {}, keys)).toBeNull();
  });
  test('every private endpoint denies unauthenticated evidence and mutations', async () => {
    for (const [method, path] of [
      ['GET', '/session'],
      ['GET', '/catalog'],
      ['GET', '/rules'],
      ['GET', '/runs/a'],
      ['GET', '/runs/a/evidence/screenshot'],
      ['POST', '/rules'],
      ['POST', '/runs/a/decision'],
      ['POST', '/runs/a/remove'],
      ['POST', '/runs/a/refresh'],
    ]) {
      const response = await adminRoutes.request(`https://maze.example${path}`, { method }, config as never);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect((await adminRoutes.request('https://maze.example/catalog', {}, {} as never)).status).toBe(503);
  });
});
