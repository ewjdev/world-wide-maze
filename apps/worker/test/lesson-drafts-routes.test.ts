import type { DraftRevision } from '@wwm/learning';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { authenticateAdmin } from '../src/admin-auth.ts';
import { draftHandle, indexHandle } from '../src/lesson-drafts/stub.ts';
import { adminRoutes } from '../src/routes/admin.ts';
import { mockRevision } from './helpers/lesson-drafts.ts';

vi.mock('../src/admin-auth.ts', () => ({ authenticateAdmin: vi.fn() }));
vi.mock('../src/lesson-drafts/stub.ts', () => ({ draftHandle: vi.fn(), indexHandle: vi.fn() }));
const auth = vi.mocked(authenticateAdmin);

const ID = 'd-00000000-0000-4000-8000-000000000000';
const HASH = '0123456789abcdef0123456789abcdef';
const ENDPOINTS: [string, string][] = [
  ['', 'GET'],
  ['', 'POST'],
  [`/${ID}`, 'GET'],
  [`/${ID}/messages`, 'POST'],
  [`/${ID}/revisions/${HASH}`, 'GET'],
  [`/${ID}/revisions/${HASH}/preview`, 'GET'],
  [`/${ID}/review`, 'POST'],
  [`/${ID}/export`, 'GET'],
];

function setup(vars: Record<string, string> = {}) {
  const handle = {
    createDraft: vi.fn(async () => ({ ok: true, value: { id: ID } })),
    sendMessage: vi.fn(async () => ({ ok: true, value: { id: ID } })),
    snapshot: vi.fn(async () => ({ id: ID })),
    getRevision: vi.fn(async (): Promise<DraftRevision | null> => null),
    review: vi.fn(async () => ({
      ok: false,
      status: 409,
      error: 'Read and acknowledge the reviewer flags.',
    })),
    exportBank: vi.fn(async () => null as unknown),
  };
  const index = { indexList: vi.fn(async () => []), indexHas: vi.fn(async (id: string) => id === ID) };
  vi.mocked(draftHandle).mockResolvedValue(handle as never);
  vi.mocked(indexHandle).mockResolvedValue(index as never);
  const hit = vi.fn(async () => ({ ok: true }));
  const env = {
    ADMIN_ACCESS_TEAM_DOMAIN: 'maze.cloudflareaccess.com',
    ADMIN_ACCESS_AUD: 'app',
    ADMIN_EMAILS: 'operator@example.com',
    LESSON_DRAFTS: 'on',
    LESSON_DRAFT_PROVIDER: 'mock',
    WWM_ENV: 'development',
    LIMITER: { idFromName: (name: string) => name, get: () => ({ hit }) },
    ...vars,
  };
  const app = new Hono().route('/api/admin', adminRoutes);
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    app.request(
      `https://maze.example/api/admin/lessons${path}`,
      {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      },
      env,
    );
  return { request, handle, index, hit };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ email: 'operator@example.com' });
});

describe('lesson-draft endpoints fail closed', () => {
  test('every endpoint rejects an unauthenticated visitor before touching a draft', async () => {
    auth.mockResolvedValue(null);
    const s = setup();
    for (const [path, method] of ENDPOINTS) expect((await s.request(path, method)).status).toBe(401);
    expect(draftHandle).not.toHaveBeenCalled();
    expect(indexHandle).not.toHaveBeenCalled();
  });

  test('without the Access configuration every endpoint is unavailable', async () => {
    const s = setup({ ADMIN_ACCESS_AUD: '' });
    for (const [path, method] of ENDPOINTS) expect((await s.request(path, method)).status).toBe(503);
    expect(auth).not.toHaveBeenCalled();
    expect(draftHandle).not.toHaveBeenCalled();
  });

  test('cross-site writes are refused', async () => {
    const s = setup();
    for (const [path, method] of ENDPOINTS.filter(([, m]) => m === 'POST'))
      expect((await s.request(path, method, {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect(draftHandle).not.toHaveBeenCalled();
  });

  test.each(['off', '', 'yes'])(
    'LESSON_DRAFTS=%j hides every endpoint (404) even from an operator',
    async (value) => {
      const s = setup({ LESSON_DRAFTS: value });
      for (const [path, method] of ENDPOINTS) expect((await s.request(path, method)).status).toBe(404);
      expect(draftHandle).not.toHaveBeenCalled();
      expect(indexHandle).not.toHaveBeenCalled();
    },
  );

  test('without a model provider in a deployed environment, nothing is generated', async () => {
    const s = setup({ LESSON_DRAFT_PROVIDER: 'auto', WWM_ENV: 'production' });
    const res = await s.request('', 'POST', { objective: 'little-word-builders', brief: 'Animals' });
    expect(res.status).toBe(503);
    expect(s.handle.createDraft).not.toHaveBeenCalled();
  });
});

describe('lesson-draft endpoints', () => {
  test('list shows the open objectives, the provider and the vocabulary review status', async () => {
    const res = await setup().request('');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      drafts: [],
      objectives: [{ id: 'little-word-builders', title: 'Little word builders' }],
      provider: { mode: 'mock', model: 'mock' },
      vocabulary: { reviewStatus: 'needs-owner-review' },
    });
  });

  test('create validates the objective, brief and count, and records the operator', async () => {
    const s = setup();
    expect((await s.request('', 'POST', { objective: 'count-three', brief: 'x' })).status).toBe(400);
    expect((await s.request('', 'POST', { objective: 'little-word-builders', brief: ' ' })).status).toBe(400);
    expect(
      (await s.request('', 'POST', { objective: 'little-word-builders', brief: 'Animals', count: 50 }))
        .status,
    ).toBe(400);
    const res = await s.request('', 'POST', {
      objective: 'little-word-builders',
      brief: 'Animals',
      count: 4,
    });
    expect(res.status).toBe(201);
    expect(s.handle.createDraft).toHaveBeenCalledWith({
      objective: 'little-word-builders',
      text: 'Animals',
      count: 4,
      drop: [],
      operator: 'operator@example.com',
    });
    expect(vi.mocked(draftHandle).mock.calls[0]?.[1]).toMatch(/^d-[0-9a-f-]{36}$/);
  });

  test('gateway turns are capped per day; mock turns are free', async () => {
    const s = setup({
      LESSON_DRAFT_PROVIDER: 'gateway',
      AI_GATEWAY_ACCOUNT_ID: 'acct',
      AI_GATEWAY_ID: 'wwm',
      AI_GATEWAY_TOKEN: 'token',
    });
    s.hit.mockResolvedValueOnce({ ok: false });
    const res = await s.request(`/${ID}/messages`, 'POST', { text: 'More animals' });
    expect(res.status).toBe(429);
    expect(s.handle.sendMessage).not.toHaveBeenCalled();
    const free = setup();
    expect((await free.request(`/${ID}/messages`, 'POST', { text: 'More' })).status).toBe(202);
    expect(free.hit).not.toHaveBeenCalled();
  });

  test('unknown drafts are 404 without waking a new object; drop ids are validated', async () => {
    const s = setup();
    expect((await s.request('/d-not-a-draft')).status).toBe(404);
    expect((await s.request('/d-00000000-0000-4000-8000-000000000001')).status).toBe(404);
    expect(draftHandle).not.toHaveBeenCalled();
    expect((await s.request(`/${ID}/messages`, 'POST', { text: 'x', drop: ['<b>'] })).status).toBe(400);
  });

  test('review needs a decision, a note and (to approve) a revision; conflicts come back as 409', async () => {
    const s = setup();
    expect((await s.request(`/${ID}/review`, 'POST', { decision: 'maybe', note: 'x' })).status).toBe(400);
    expect((await s.request(`/${ID}/review`, 'POST', { decision: 'approved', note: 'x' })).status).toBe(400);
    expect(
      (await s.request(`/${ID}/review`, 'POST', { decision: 'approved', revision: HASH, note: '' })).status,
    ).toBe(400);
    const res = await s.request(`/${ID}/review`, 'POST', {
      decision: 'approved',
      revision: HASH,
      note: 'Checked',
    });
    expect(res.status).toBe(409);
    expect(s.handle.review).toHaveBeenCalledWith({
      decision: 'approved',
      note: 'Checked',
      revision: HASH,
      acknowledgeFlags: false,
      operator: 'operator@example.com',
    });
  });

  test('preview is inert HTML from the trusted renderer, framable only by the workbench', async () => {
    const s = setup();
    const revision = await mockRevision();
    s.handle.getRevision.mockResolvedValue(revision);
    const res = await s.request(`/${ID}/revisions/${revision.hash}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox');
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('script-src');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toContain('Lesson draft preview (not reviewed)');
  });

  test('export is an attachment, only for an approved draft', async () => {
    const s = setup();
    expect((await s.request(`/${ID}/export`)).status).toBe(409);
    s.handle.exportBank.mockResolvedValue({
      format: 'wwm-learning-bank/1',
      objective: 'little-word-builders',
    });
    const res = await s.request(`/${ID}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="little-word-builders.json"');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});
