/**
 * The lesson-draft agent, its Workflow and the admin routes, end to end in workerd (wrangler's local runtime) with
 * the offline mock provider: create → generate → revision → preview → next turn with a drop → approve → export →
 * import into a scratch copy of the learning package. Access is replaced by a fixed operator (test-only Worker).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselinePath, type DraftRevision, type DraftSnapshot } from '@wwm/learning';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { checkBank, importBank } from '../../../tools/lesson-draft/src/bank-import.ts';

type Worker = Awaited<ReturnType<typeof import('wrangler').unstable_startWorker>>;
let worker: Worker;
let base: URL;
beforeAll(async () => {
  const { unstable_startWorker } = await import('wrangler');
  worker = await unstable_startWorker({
    config: fileURLToPath(new URL('./lesson-drafts-runtime/wrangler.jsonc', import.meta.url)),
    dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, persist: false, logLevel: 'warn' },
  });
  await worker.ready;
  base = await worker.url;
}, 60_000);
afterAll(async () => {
  await worker?.dispose();
});

async function api(
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; header: (name: string) => string | null }> {
  const response = await worker.fetch(
    new URL(`/api/admin/lessons${path}`, base),
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: base.origin },
          body: JSON.stringify(body),
        },
  );
  const text = await response.clone().text();
  return {
    status: response.status,
    json: text.startsWith('{') ? JSON.parse(text) : text,
    header: (name) => response.headers.get(name),
  };
}

async function settled(id: string): Promise<DraftSnapshot> {
  for (let i = 0; i < 100; i++) {
    const { json } = await api(`/${id}`);
    const snapshot = json as DraftSnapshot;
    if (snapshot.status !== 'generating') return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the workflow did not finish');
}

test('a spelling bank goes from brief to approved export through the agent and the Workflow', async () => {
  expect((await api('')).json).toMatchObject({ drafts: [], provider: { mode: 'mock' } });

  const created = await api('', {
    objective: 'little-word-builders',
    brief: 'Animals and things at home.',
    count: 4,
  });
  expect(created.status).toBe(201);
  const id = (created.json as DraftSnapshot).id;
  expect((created.json as DraftSnapshot).status).toBe('generating');

  const first = await settled(id);
  expect(first).toMatchObject({ status: 'ready', turn: 1, revisionCount: 1 });
  expect(first.messages.map((message) => message.role)).toEqual(['operator', 'agent']);
  expect(first.messages[1]?.text).toMatch(/^Turn 1: asked for 4 new items\. 4 passed/);

  const revision = (await api(`/${id}/revisions/${first.latest}`)).json as DraftRevision;
  expect(revision.bank.items).toHaveLength(4);
  expect(revision.issues).toEqual([]);

  const preview = await api(`/${id}/revisions/${first.latest}/preview`);
  expect(preview.status).toBe(200);
  expect(preview.header('content-security-policy')).toContain('sandbox');
  expect(preview.json as string).toContain('Lesson draft preview (not reviewed)');

  const dropped = revision.bank.items[0]?.id as string;
  expect(
    (await api(`/${id}/messages`, { text: 'Two more, please.', count: 2, drop: [dropped] })).status,
  ).toBe(202);
  const second = await settled(id);
  expect(second).toMatchObject({ status: 'ready', turn: 2, revisionCount: 2 });
  const latest = (await api(`/${id}/revisions/${second.latest}`)).json as DraftRevision;
  expect(latest.bank.items).toHaveLength(5);
  expect(latest.dropped).toEqual([dropped]);
  expect(latest.bank.items.map((item) => item.id)).not.toContain(dropped);
  // A dropped word isn't offered again.
  const word = revision.bank.items[0]?.practice?.text;
  expect(latest.bank.items.map((item) => item.practice?.text)).not.toContain(word);

  expect(
    (await api(`/${id}/review`, { decision: 'approved', revision: first.latest, note: 'x' })).status,
  ).toBe(409);
  const approved = await api(`/${id}/review`, {
    decision: 'approved',
    revision: second.latest,
    note: 'Words and meanings checked.',
    acknowledgeFlags: true,
  });
  expect(approved.status).toBe(200);
  expect((approved.json as DraftSnapshot).status).toBe('approved');
  expect((await api(`/${id}/messages`, { text: 'More?' })).status).toBe(409);

  const exported = await api(`/${id}/export`);
  expect(exported.status).toBe(200);
  expect(exported.header('content-disposition')).toContain('little-word-builders.json');
  expect(JSON.stringify(exported.json)).not.toContain('operator@example.com');
  expect(checkBank(exported.json, baselinePath).file.items).toHaveLength(5);
  const learningSrc = mkdtempSync(join(tmpdir(), 'wwm-bank-'));
  expect(importBank(exported.json, { learningSrc, path: baselinePath }).status).toBe('written');

  const list = (await api('')).json as { drafts: DraftSnapshot[] };
  expect(list.drafts).toMatchObject([{ id, status: 'approved', revisionCount: 2, latest: second.latest }]);
}, 60_000);
