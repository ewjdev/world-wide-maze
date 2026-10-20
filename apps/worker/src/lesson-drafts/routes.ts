/**
 * `/api/admin/lessons/*` (contracts §10.5 CCR-31-4): the operator-only lesson-draft API. Mounted under the admin
 * router, whose middleware has already checked the Access JWT, the operator allowlist and same-origin writes
 * (failing closed with 503/401/403). Here, `LESSON_DRAFTS` must be `on`, or every endpoint is 404.
 *
 * | Method and path                            | Purpose                                                   |
 * |--------------------------------------------|-----------------------------------------------------------|
 * | GET  /                                     | Drafts, open objectives, provider and vocabulary status   |
 * | POST /                                     | `{objective, brief, count?}`: create a draft, start turn 1 |
 * | GET  /:id                                  | The draft, its transcript and revision summaries          |
 * | POST /:id/messages                         | `{text, count?, drop?}`: the next turn                    |
 * | GET  /:id/revisions/:hash                  | One revision with every item's verdict                    |
 * | GET  /:id/revisions/:hash/preview          | The revision as an inert lesson page (trusted renderer)    |
 * | POST /:id/review                           | `{decision, note, revision, acknowledgeFlags?}`           |
 * | GET  /:id/export                           | The approved bank, for `pnpm learning:bank import`        |
 */
import {
  AUTHORING_OBJECTIVES,
  baselinePath,
  type DraftListResponse,
  spellingVocabulary,
} from '@wwm/learning';
import { Hono } from 'hono';
import type { AdminEnv } from '../routes/admin.ts';
import { readJsonCapped } from '../security.ts';
import type { TurnInput } from './agent.ts';
import { type LessonDraftVars, lessonDraftSettings } from './config.ts';
import { MAX_TURN_ITEMS } from './pipeline.ts';
import { PREVIEW_HEADERS, previewHtml } from './preview.ts';
import { DRAFT_INDEX } from './records.ts';
import { draftHandle, indexHandle } from './stub.ts';

const DRAFT_ID = /^d-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{32}$/;
const ITEM_ID = /^i-[0-9a-f]{12}$/;
const MAX_BODY = 8 * 1024;

class InputError extends Error {}

type Env = AdminEnv['Bindings'] & LessonDraftVars;
export const lessonDraftRoutes = new Hono<AdminEnv>();

lessonDraftRoutes.use('*', async (c, next) => {
  if (!lessonDraftSettings(c.env as Env).enabled) return c.json({ error: 'Lesson drafts are off' }, 404);
  await next();
});
lessonDraftRoutes.onError((err, c) => {
  if (err instanceof InputError) return c.json({ error: err.message }, 400);
  if (err instanceof SyntaxError) return c.json({ error: 'Invalid request' }, 400);
  c.get('services')?.log.error('lesson draft failed', { error: String(err) });
  return c.json({ error: 'Lesson draft operation failed' }, 500);
});

async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await readJsonCapped(request, MAX_BODY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Object required');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new InputError(`${name} of 1–${max} characters is required`);
  return value.trim();
}
function count(value: unknown): number {
  if (value === undefined) return 6;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_TURN_ITEMS)
    throw new InputError(`count must be 1–${MAX_TURN_ITEMS}`);
  return value as number;
}
function drop(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 24 ||
    !value.every((id) => typeof id === 'string' && ITEM_ID.test(id))
  )
    throw new InputError('drop must be a list of item ids');
  return value as string[];
}

/** The index lists every draft this Worker created; anything else is 404 without waking a new object. */
async function known(env: Env, id: string): Promise<boolean> {
  return DRAFT_ID.test(id) && (await (await indexHandle(env, DRAFT_INDEX)).indexHas(id));
}

/** Generation turns cost model calls: cap them per day across all operators (mock turns are free). */
async function allowTurn(env: Env): Promise<boolean> {
  const settings = lessonDraftSettings(env);
  if (settings.mode !== 'gateway') return true;
  const result = await env.LIMITER.get(env.LIMITER.idFromName('lesson-drafts:day')).hit(
    settings.dailyLimit,
    86_400_000,
  );
  return result.ok;
}

lessonDraftRoutes.get('/', async (c) => {
  const env = c.env as Env;
  const settings = lessonDraftSettings(env);
  const drafts = await (await indexHandle(env, DRAFT_INDEX)).indexList();
  const objectives = Object.keys(AUTHORING_OBJECTIVES).flatMap((id) => {
    const objective = baselinePath.objectives?.find((candidate) => candidate.id === id);
    const activity = baselinePath.activities.find(
      (candidate) => candidate.id === AUTHORING_OBJECTIVES[id]?.activity,
    );
    return objective && activity ? [{ id, title: activity.title, statement: objective.statement }] : [];
  });
  return c.json({
    drafts,
    objectives,
    provider: { mode: settings.mode, model: settings.model },
    vocabulary: {
      id: spellingVocabulary.id,
      reviewStatus: spellingVocabulary.reviewStatus,
      words: spellingVocabulary.words.length,
    },
  } satisfies DraftListResponse);
});

lessonDraftRoutes.post('/', async (c) => {
  const env = c.env as Env;
  const input = await body(c.req.raw);
  const objective = text(input.objective, 'objective', 64);
  if (!AUTHORING_OBJECTIVES[objective])
    return c.json({ error: 'This objective is not open for drafts' }, 400);
  const turn: TurnInput = {
    text: text(input.brief, 'A brief', 2000),
    count: count(input.count),
    drop: [],
    operator: c.get('adminEmail'),
  };
  if (lessonDraftSettings(env).mode === 'off')
    return c.json({ error: 'No model provider is configured' }, 503);
  if (!(await allowTurn(env))) return c.json({ error: 'Daily lesson-draft limit reached' }, 429);
  const id = `d-${crypto.randomUUID()}`;
  const result = await (await draftHandle(env, id)).createDraft({ ...turn, objective });
  return result.ok ? c.json(result.value, 201) : c.json({ error: result.error }, result.status);
});

lessonDraftRoutes.get('/:id', async (c) => {
  const env = c.env as Env;
  const id = c.req.param('id');
  if (!(await known(env, id))) return c.json({ error: 'Draft not found' }, 404);
  const snapshot = await (await draftHandle(env, id)).snapshot();
  return snapshot ? c.json(snapshot) : c.json({ error: 'Draft not found' }, 404);
});

lessonDraftRoutes.post('/:id/messages', async (c) => {
  const env = c.env as Env;
  const id = c.req.param('id');
  const input = await body(c.req.raw);
  const turn: TurnInput = {
    text: text(input.text, 'A message', 2000),
    count: count(input.count),
    drop: drop(input.drop),
    operator: c.get('adminEmail'),
  };
  if (!(await known(env, id))) return c.json({ error: 'Draft not found' }, 404);
  if (lessonDraftSettings(env).mode === 'off')
    return c.json({ error: 'No model provider is configured' }, 503);
  if (!(await allowTurn(env))) return c.json({ error: 'Daily lesson-draft limit reached' }, 429);
  const result = await (await draftHandle(env, id)).sendMessage(turn);
  return result.ok ? c.json(result.value, 202) : c.json({ error: result.error }, result.status);
});

lessonDraftRoutes.get('/:id/revisions/:hash', async (c) => {
  const env = c.env as Env;
  const { id, hash } = c.req.param();
  if (!HASH.test(hash) || !(await known(env, id))) return c.json({ error: 'Revision not found' }, 404);
  const revision = await (await draftHandle(env, id)).getRevision(hash);
  return revision ? c.json(revision) : c.json({ error: 'Revision not found' }, 404);
});

lessonDraftRoutes.get('/:id/revisions/:hash/preview', async (c) => {
  const env = c.env as Env;
  const { id, hash } = c.req.param();
  if (!HASH.test(hash) || !(await known(env, id))) return c.json({ error: 'Revision not found' }, 404);
  const revision = await (await draftHandle(env, id)).getRevision(hash);
  if (!revision) return c.json({ error: 'Revision not found' }, 404);
  if (!revision.bank.items.length) return c.json({ error: 'This revision has no items to preview' }, 409);
  return new Response(previewHtml(revision), { headers: PREVIEW_HEADERS });
});

lessonDraftRoutes.post('/:id/review', async (c) => {
  const env = c.env as Env;
  const id = c.req.param('id');
  const input = await body(c.req.raw);
  if (input.decision !== 'approved' && input.decision !== 'rejected')
    return c.json({ error: 'decision must be approved or rejected' }, 400);
  const revision = typeof input.revision === 'string' ? input.revision : '';
  if (input.decision === 'approved' && !HASH.test(revision))
    return c.json({ error: 'Choose a revision to approve' }, 400);
  const review = {
    decision: input.decision,
    note: text(input.note, 'A note', 1000),
    revision,
    acknowledgeFlags: input.acknowledgeFlags === true,
    operator: c.get('adminEmail'),
  } as const;
  if (!(await known(env, id))) return c.json({ error: 'Draft not found' }, 404);
  const result = await (await draftHandle(env, id)).review(review);
  return result.ok ? c.json(result.value) : c.json({ error: result.error }, result.status);
});

lessonDraftRoutes.get('/:id/export', async (c) => {
  const env = c.env as Env;
  const id = c.req.param('id');
  if (!(await known(env, id))) return c.json({ error: 'Draft not found' }, 404);
  const file = await (await draftHandle(env, id)).exportBank();
  if (!file) return c.json({ error: 'Only an approved draft can be exported' }, 409);
  return new Response(`${JSON.stringify(file, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${file.objective}.json"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});
