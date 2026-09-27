import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Catalog } from '../../src/catalog.ts';

/** Execute production migrations and SQL using SQLite; storage doubles only model R2/KV. */
export function fixture(beforeCatalog?: (db: DatabaseSync) => void) {
  const sqlite = new DatabaseSync(':memory:');
  const directory = new URL('../../migrations/', import.meta.url);
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (file.startsWith('0005')) beforeCatalog?.(sqlite);
    sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  const statement = (sql: string, args: (string | number | null)[] = []) => ({
    bind: (...values: (string | number | null)[]) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args), success: true }),
    run: async () => ({ success: true, meta: sqlite.prepare(sql).run(...args) }),
  });
  const objects = new Map<string, string>();
  const cache = new Map<string, string>();
  const env = {
    DB: {
      prepare: statement,
      batch: async (statements: ReturnType<typeof statement>[]) => {
        sqlite.exec('BEGIN');
        try {
          const out = [];
          for (const s of statements) out.push(await s.all());
          sqlite.exec('COMMIT');
          return out;
        } catch (e) {
          sqlite.exec('ROLLBACK');
          throw e;
        }
      },
    },
    CACHE: {
      get: async (key: string) => cache.get(key) ?? null,
      delete: async (key: string) => {
        cache.delete(key);
      },
    },
    STAGES: {
      get: async (key: string) =>
        objects.has(key) ? { body: objects.get(key), httpMetadata: { contentType: 'image/png' } } : null,
      head: async (key: string) => (objects.has(key) ? { key } : null),
      delete: async (keys: string | string[]) => {
        for (const key of typeof keys === 'string' ? [keys] : keys) objects.delete(key);
      },
      list: async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
        const keys = [...objects.keys()]
          .filter((k) => k.startsWith(prefix) && (!cursor || k > cursor))
          .sort();
        const page = keys.slice(0, 2);
        return { objects: page.map((key) => ({ key })), truncated: keys.length > 2, cursor: page.at(-1) };
      },
    },
  } as unknown as ConstructorParameters<typeof Catalog>[0];
  const cat = new Catalog(env);
  const run = (
    id: string,
    url = 'https://example.com/',
    captureId = `capture-${id}`,
    createdAt = '2026-09-26T01:00:00Z',
  ) => {
    sqlite
      .prepare(
        `INSERT INTO runs(run_id,url,title,capture_id,slice_count,difficulty,seed,builder_version,status,created_at) VALUES (?,?,?, ?,1,'normal',42,'v1','complete',?)`,
      )
      .run(id, url, id, captureId, createdAt);
    sqlite
      .prepare(`INSERT INTO stages VALUES (?, ?,0,?,?,?,'v1',?,1,0,0,0,?)`)
      .run(`stage-${id}`, id, url, id, captureId, `textures/${captureId}/0.webp`, createdAt);
    objects.set(`stages/stage-${id}.json`, 'stage');
    objects.set(`textures/${captureId}/0.webp`, 'texture');
    objects.set(`captures/${captureId}/screenshot.png`, 'screenshot');
    objects.set(`captures/${captureId}/capture.json`, 'capture');
  };
  const record = (
    id: string,
    status: 'approved' | 'pending_review' | 'blocked' = 'approved',
    url = 'https://example.com/',
    cacheKey: string | null = 'key',
    captureId = `capture-${id}`,
    submittedUrl = url,
  ) =>
    cat.recordRun({
      runId: id,
      url,
      submittedUrl,
      cacheKey,
      status,
      reason: 'test verdict',
      provider: 'fixture',
      policyVersion: 'v1',
      captureId,
    });
  return { env, cat, sqlite, objects, cache, run, record, close: () => sqlite.close() };
}
