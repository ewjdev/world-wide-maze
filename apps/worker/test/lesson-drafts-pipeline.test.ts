import {
  baselinePath,
  type DraftRevision,
  type Round,
  roundSchema,
  spellingBankRound,
  spellingVocabulary,
} from '@wwm/learning';
import { describe, expect, test } from 'vitest';
import {
  BILLED_STEP,
  type DraftParams,
  MAX_REPAIRS,
  runDraftPipeline,
  SAFE_STEP,
  type StepConfig,
  type StepRunner,
} from '../src/lesson-drafts/pipeline.ts';
import { type DraftModel, type DraftRequest, mockDraftModel } from '../src/lesson-drafts/providers.ts';

const entry = (word: string) => {
  const found = spellingVocabulary.words.find((candidate) => candidate.word === word);
  if (!found) throw new Error(word);
  return found;
};
/** A valid item for a vocabulary word, blank in the middle, with vowel distractors. */
const item = (id: string, word: string) => {
  const vowel = word[1]?.toUpperCase() ?? 'A';
  return spellingBankRound(id, entry(word), 1, [
    vowel,
    ...['E', 'I', 'O', 'U', 'A'].filter((v) => v !== vowel).slice(0, 1),
  ]);
};
/** Not on the reviewed word list. */
const offList = (id: string) => ({
  ...item(id, 'pig'),
  stimulusText: 'Z _ G',
  practice: { text: 'Zig', language: 'en-US' },
});

/** A model that replies from a script and counts its (billed) calls. */
function scripted(...replies: ((request: DraftRequest) => unknown[] | string)[]) {
  const requests: DraftRequest[] = [];
  const model: DraftModel = {
    name: 'gateway',
    model: 'claude-test',
    async complete(request) {
      requests.push(request);
      const reply = replies[Math.min(requests.length, replies.length) - 1];
      if (!reply) throw new Error('no scripted reply');
      const value = reply(request);
      return {
        text: typeof value === 'string' ? value : JSON.stringify(value),
        model: 'claude-test',
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
  };
  return { model, requests };
}

/**
 * A step runner with Workflow semantics: a completed step's result is stored and replayed on a later run of the same
 * instance, and its callback never runs again. `failBefore` makes the first attempt at that step throw, like an
 * eviction mid-run.
 */
function workflowSteps(failBefore?: string) {
  const stored = new Map<string, unknown>();
  const executed: string[] = [];
  const configs = new Map<string, StepConfig>();
  let failed = false;
  const runner: StepRunner = {
    async do(name, config, callback) {
      configs.set(name, config);
      if (stored.has(name)) return structuredClone(stored.get(name)) as never;
      if (name === failBefore && !failed) {
        failed = true;
        throw new Error('evicted');
      }
      executed.push(name);
      const value = await callback();
      stored.set(name, structuredClone(value));
      return value;
    },
  };
  return { runner, executed, configs };
}

function params(overrides: Partial<DraftParams> = {}): DraftParams {
  return {
    draftId: 'd-test',
    turn: 1,
    objective: 'little-word-builders',
    brief: 'Animals and things at home.',
    message: 'Animals and things at home.',
    count: 3,
    base: [],
    dropped: [],
    ...overrides,
  };
}

function sink() {
  const saved: DraftRevision[] = [];
  const ready: [number, string, string][] = [];
  return {
    saved,
    ready,
    deps: {
      maxTokens: 8000,
      now: () => new Date('2026-10-19T12:00:00Z'),
      save: async (revision: DraftRevision) => {
        saved.push(revision);
      },
      ready: async (turn: number, hash: string, summary: string) => {
        ready.push([turn, hash, summary]);
      },
    },
  };
}

describe('LESSON_DRAFT workflow steps', () => {
  test('valid output: one billed call, every item added to the revision, ready for review', async () => {
    const { model, requests } = scripted(() => [item('g1', 'pig'), item('g2', 'hen'), item('g3', 'bus')]);
    const out = sink();
    const steps = workflowSteps();
    const result = await runDraftPipeline(steps.runner, params(), { ...out.deps, model });
    expect(requests).toHaveLength(1);
    const [revision] = out.saved;
    expect(revision?.hash).toBe(result.hash);
    expect(revision?.bank.items).toHaveLength(3);
    for (const round of revision?.bank.items ?? []) {
      expect(roundSchema.parse(round)).toEqual(round);
      expect(round.id).toMatch(/^i-[0-9a-f]{12}$/);
      expect(round.objective).toBeUndefined();
    }
    expect(revision?.issues).toEqual([]);
    expect(revision?.items.every((verdict) => verdict.ok && verdict.added)).toBe(true);
    expect(revision?.items[0]?.spoken?.length).toBeGreaterThan(2);
    expect(revision?.calls).toEqual([
      { kind: 'generate', model: 'claude-test', inputTokens: 100, outputTokens: 50 },
    ]);
    expect(out.ready).toEqual([[1, result.hash, result.summary]]);
    expect(result.summary).toMatch(/3 passed \(PIG, HEN, BUS\).*Ready for review/);
    // Billed steps never retry; reads, checks and writes do.
    expect(steps.configs.get('generate')).toBe(BILLED_STEP);
    expect(BILLED_STEP.retries?.limit).toBe(0);
    for (const name of ['context', 'validate-0', 'assemble', 'save-revision', 'ready-for-review'])
      expect(steps.configs.get(name)).toBe(SAFE_STEP);
  });

  test('the prompt carries the reviewed word list and the bank so far as an exclusion list', async () => {
    const { model, requests } = scripted(() => [item('g1', 'hen')]);
    const base = [{ ...item('i-000000000001', 'pig'), id: 'i-000000000001' } as Round];
    await runDraftPipeline(workflowSteps().runner, params({ base, count: 1 }), { ...sink().deps, model });
    const prompt = requests[0]?.messages[0]?.content ?? '';
    const exclusion = /Exclusion list[^:]*: (.*)/.exec(prompt)?.[1] ?? '';
    for (const word of ['CAT', 'SUN', 'MAP', 'DOG', 'PIG']) expect(exclusion).toContain(word);
    expect(prompt).toContain('HEN: A hen is a mother chicken');
    expect(prompt).not.toMatch(/^PIG: /m);
    expect(requests[0]?.task.exclude).toEqual(expect.arrayContaining(['CAT', 'PIG']));
  });

  test('repair: a failing item gets one repair turn with its issues and the conversation so far', async () => {
    const { model, requests } = scripted(
      () => [item('g1', 'pig'), offList('g2')],
      () => [item('g2', 'hen')],
    );
    const out = sink();
    await runDraftPipeline(workflowSteps().runner, params({ count: 2 }), { ...out.deps, model });
    expect(requests).toHaveLength(2);
    const repair = requests[1];
    expect(repair?.task.ids).toEqual(['g2']);
    expect(repair?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(repair?.messages[2]?.content).toContain('g2: "ZIG" is not on the reviewed word list.');
    expect(out.saved[0]?.bank.items.map((round) => round.practice?.text)).toEqual(['Pig', 'Hen']);
    expect(out.saved[0]?.calls.map((call) => call.kind)).toEqual(['generate', 'repair']);
    expect(out.saved[0]?.summary).toContain('after 1 repair turn');
  });

  test(`gives up after ${MAX_REPAIRS} repairs: the item is left out with its issues, the rest is kept`, async () => {
    const { model, requests } = scripted(
      () => [item('g1', 'pig'), offList('g2')],
      () => [offList('g2')],
      () => 'Sorry, here it is: [{"id": "g2", "kind": "choose"',
    );
    const out = sink();
    await runDraftPipeline(workflowSteps().runner, params({ count: 2 }), { ...out.deps, model });
    expect(requests).toHaveLength(1 + MAX_REPAIRS);
    const revision = out.saved[0];
    expect(revision?.bank.items).toHaveLength(1);
    const failed = revision?.items.find((verdict) => verdict.draftId === 'g2');
    expect(failed).toMatchObject({ ok: false, added: false });
    expect(failed?.issues.join(' ')).toContain('not on the reviewed word list');
    expect(revision?.issues).toEqual([]);
    expect(revision?.summary).toMatch(/1 failed and was left out/);
  });

  test('nothing valid: the revision says there is nothing to approve', async () => {
    const { model } = scripted(() => 'no JSON here');
    const out = sink();
    await runDraftPipeline(workflowSteps().runner, params({ count: 1 }), { ...out.deps, model });
    expect(out.saved[0]?.bank.items).toEqual([]);
    expect(out.saved[0]?.items[0]?.issues[0]).toBe('No JSON array found.');
    expect(out.saved[0]?.issues).toEqual(['No items passed validation, so there is nothing to approve.']);
  });

  test.each(['validate-0', 'repair-1', 'validate-1', 'assemble', 'save-revision', 'ready-for-review'])(
    'no re-billing on retry: a run interrupted before %s replays the stored model replies',
    async (step) => {
      const { model, requests } = scripted(
        () => [item('g1', 'pig'), offList('g2')],
        () => [item('g2', 'hen')],
      );
      const out = sink();
      const steps = workflowSteps(step);
      await expect(
        runDraftPipeline(steps.runner, params({ count: 2 }), { ...out.deps, model }),
      ).rejects.toThrow('evicted');
      const result = await runDraftPipeline(steps.runner, params({ count: 2 }), { ...out.deps, model });
      // Across both runs, each billed step ran exactly once: the resumed run replays the stored replies.
      expect(requests).toHaveLength(2);
      expect(steps.executed.filter((name) => name === 'generate' || name.startsWith('repair-'))).toEqual([
        'generate',
        'repair-1',
      ]);
      expect(new Set(out.saved.map((revision) => revision.hash))).toEqual(new Set([result.hash]));
      expect(out.saved.at(-1)?.bank.items.map((round) => round.practice?.text)).toEqual(['Pig', 'Hen']);
    },
  );

  test('the bank stays within 24 items and the turn asks only for the room left', async () => {
    const words = spellingVocabulary.words
      .map((candidate) => candidate.word)
      .filter((word) => !['cat', 'sun', 'map', 'dog'].includes(word));
    const base = words
      .slice(0, 22)
      .map((word, i) => ({ ...item(`b${i}`, word), id: `i-${String(i).padStart(12, '0')}` }) as Round);
    const { model, requests } = scripted((request) =>
      request.task.ids.map((id, i) => item(id, words[22 + i] as string)),
    );
    const out = sink();
    await runDraftPipeline(workflowSteps().runner, params({ base, count: 6 }), { ...out.deps, model });
    expect(requests[0]?.task.ids).toEqual(['g1', 'g2']);
    expect(out.saved[0]?.bank.items).toHaveLength(24);
  });

  test('the offline mock writes valid, fresh items for the objective', async () => {
    const out = sink();
    await runDraftPipeline(workflowSteps().runner, params({ count: 6 }), {
      ...out.deps,
      model: mockDraftModel(),
    });
    const revision = out.saved[0];
    expect(revision?.bank.items).toHaveLength(6);
    expect(revision?.issues).toEqual([]);
    expect(revision?.calls[0]?.model).toBe('mock');
    const lesson = baselinePath.activities.find((activity) => activity.id === 'little-word-builders');
    const words = new Set(lesson?.rounds.map((round) => round.practice?.text.toUpperCase()));
    for (const round of revision?.bank.items ?? [])
      expect(words.has(round.practice?.text.toUpperCase())).toBe(false);
  });
});
