import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';

const configPath = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
describe('budget ledger (real workerd / SQLite / RPC)', { timeout: 30000 }, () => {
  const server = createTestHarness();
  let env: Env;
  beforeAll(async () => {
    await server.update({ workers: [{ configPath, vars: { COST_CONTROLS: '1' } }] });
    await server.listen();
    env = await server.getWorker<Env>().getEnv();
  }, 120000);
  afterAll(() => server.close());
  const ledger = (name: string) => env.BUDGET.get(env.BUDGET.idFromName(name));
  const initialize = async (name: string, spentMicros = 5_000_000) => {
    const b = ledger(name);
    await b.configure({ spentMicros, storedBytes: 0 }, 'test@example.com');
    return b;
  };
  test('concurrent RPCs cannot overbook slots; retry/release cannot refund or replay', async () => {
    const b = await initialize('concurrency');
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => b.reserve('build', `job:${i}`)));
    const allowed = results.flatMap((r, i) => (r.ok ? [i] : []));
    expect(allowed).toHaveLength(2);
    expect((await b.snapshot()).spent).toBe(5_020_000);
    expect(await b.hasLease(`job:${allowed[0]}`)).toBe(true);
    await b.release(`job:${allowed[0]}`);
    expect(await b.hasLease(`job:${allowed[0]}`)).toBe(false);
    expect(await b.reserve('build', `job:${allowed[0]}`)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect((await b.reserve('build', 'new')).ok).toBe(true);
    expect((await ledger('concurrency').snapshot()).spent).toBe(5_030_000);
  });
  test('atomic dollar admission never crosses $40 under concurrency', async () => {
    const b = await initialize('near-stop', 39_999_900);
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => b.reserve('read', `read:${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect((await b.snapshot()).spent).toBe(40_000_000);
    await expect(b.configure({ spentMicros: 5_000_000 }, 'test')).rejects.toThrow();
    expect((await b.reserve('read', 'after-stop')).ok).toBe(false);
  });
  test('AI shares concurrency across providers and room renewal preserves its slot', async () => {
    const b = await initialize('shared');
    expect((await b.reserve('docent', 'd')).ok).toBe(true);
    expect((await b.reserve('moderation', 'm')).ok).toBe(true);
    expect(await b.reserve('jev', 'j')).toMatchObject({ ok: false, reason: 'busy' });
    for (let i = 0; i < 20; i++) expect((await b.reserve('room', `room:${i}`, 10)).ok).toBe(true);
    expect(await b.reserve('room', 'extra', 10)).toMatchObject({ ok: false, reason: 'busy' });
    expect((await b.reserve('room', 'renewed', 10, 'room:0')).ok).toBe(true);
    expect(await b.reserve('room', 'extra', 10)).toMatchObject({ ok: false, reason: 'busy' });
    expect((await b.snapshot()).monthly.room).toBe(210);
  });
  test('uninitialized shutdown can be set without granting an allowance', async () => {
    const b = ledger('not-initialized');
    await b.configure({ staticOnly: true }, 'test');
    expect(await b.snapshot()).toMatchObject({ initialized: false, staticOnly: true });
    await expect(b.configure({ spentMicros: 5_000_000 }, 'test')).rejects.toThrow();
  });
  test('unfunded public requests fail before bodies, database or providers; admin cannot bypass Access', async () => {
    for (const path of ['/api/stages', '/api/stages/upload', '/api/scores', '/api/docent', '/api/rooms']) {
      const r = await server.fetch(`http://localhost${path}`, { method: 'POST', body: 'not valid JSON' });
      expect(r.status).toBe(429);
      expect(r.headers.get('x-wwm-mode')).toBe('static');
    }
    const t = await server.fetch('http://localhost/api/t', { method: 'POST', body: 'invalid' });
    expect(t.status).toBe(204);
    const admin = await server.fetch('http://localhost/api/admin/budget');
    expect([401, 503]).toContain(admin.status);
    expect((await ledger('wwm-cost-v1').snapshot()).spent).toBe(5_000_000);
  });
});
