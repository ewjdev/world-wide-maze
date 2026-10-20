import { DatabaseSync } from 'node:sqlite';
import type { DraftRevision } from '@wwm/learning';
import { type DraftParams, runDraftPipeline, type StepRunner } from '../../src/lesson-drafts/pipeline.ts';
import { type DraftModel, mockDraftModel } from '../../src/lesson-drafts/providers.ts';
import type { Sql, SqlValue } from '../../src/lesson-drafts/records.ts';

/** Steps that just run (no Workflow): enough when a test doesn't care about replay. */
export const immediateSteps: StepRunner = { do: (_name, _config, callback) => callback() };

/** `ctx.storage.sql.exec` on node:sqlite. */
export function sqliteExec(): Sql {
  const db = new DatabaseSync(':memory:');
  return (query, ...params) => {
    const statement = db.prepare(query);
    if (/^\s*(SELECT|INSERT[\s\S]*RETURNING)/i.test(query))
      return statement.all(...params) as Record<string, SqlValue>[];
    statement.run(...params);
    return [];
  };
}

/** One turn through the real pipeline with the offline mock (or another model). */
export async function mockRevision(
  overrides: Partial<DraftParams> = {},
  model: DraftModel = mockDraftModel(),
): Promise<DraftRevision> {
  let saved: DraftRevision | undefined;
  await runDraftPipeline(
    immediateSteps,
    {
      draftId: 'd-test',
      turn: 1,
      objective: 'little-word-builders',
      brief: 'Animals and things at home.',
      message: 'Animals and things at home.',
      count: 6,
      base: [],
      dropped: [],
      ...overrides,
    },
    {
      model,
      maxTokens: 8000,
      save: async (revision) => {
        saved = revision;
      },
      ready: async () => {},
    },
  );
  if (!saved) throw new Error('no revision');
  return saved;
}
