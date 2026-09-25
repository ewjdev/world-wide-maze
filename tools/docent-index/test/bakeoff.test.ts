import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { docentSettings } from '../../../apps/worker/src/docent/config.ts';
import { gatewayProvider, modelParams } from '../../../apps/worker/src/docent/providers.ts';
import { INDEX, retrieve, searcher, searchText } from '../../../apps/worker/src/docent/retrieve.ts';
import {
  aggregate,
  type BakeoffRecord,
  type BakeoffSettings,
  classifyOutcome,
  costUsd,
  estimateCost,
  latestRecords,
  type MatrixEntry,
  percentile,
  priceFor,
  recommend,
} from '../src/bakeoff/core.ts';
import { dryRunProvider } from '../src/bakeoff/dry-run.ts';
import {
  answerForJudge,
  type Judge,
  judgeUserTurn,
  mockJudge,
  parseJudgment,
  splitSentences,
} from '../src/bakeoff/judge.ts';
import { renderHtml, renderJudgeSample, renderMarkdown } from '../src/bakeoff/report.ts';
import { RESULTS_FILE, runBakeoff } from '../src/bakeoff/run.ts';
import { corpusFiles } from '../src/build.ts';
import type { EvalSet } from '../src/eval-core.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const pkg = join(root, 'tools/docent-index');
const settings = JSON.parse(readFileSync(join(pkg, 'bakeoff.config.json'), 'utf8')) as BakeoffSettings;
const heldout = JSON.parse(readFileSync(join(pkg, 'eval-heldout.json'), 'utf8')) as EvalSet;
const original = JSON.parse(readFileSync(join(pkg, 'eval.json'), 'utf8')) as EvalSet;

describe('held-out set', () => {
  test('≥ 15 new questions: ~9 answerable, ≥ 4 not covered, ≥ 2 injection/off-topic; answers have sources', () => {
    const items = heldout.items;
    expect(items.length).toBeGreaterThanOrEqual(15);
    expect(items.filter((i) => i.expect === 'answer' && !i.kind).length).toBeGreaterThanOrEqual(9);
    expect(items.filter((i) => i.expect === 'dont_know' && !i.kind).length).toBeGreaterThanOrEqual(4);
    expect(
      items.filter((i) => i.kind === 'injection' || i.kind === 'offtopic').length,
    ).toBeGreaterThanOrEqual(2);
    for (const i of items.filter((x) => x.expect === 'answer')) expect(i.sources?.length, i.id).toBeTruthy();
    const ids = new Set(original.items.map((i) => i.id));
    const qs = new Set(original.items.map((i) => i.question.toLowerCase()));
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) {
      expect(ids.has(i.id), i.id).toBe(false);
      expect(qs.has(i.question.toLowerCase()), i.id).toBe(false);
    }
  });

  test('kept out of the retrieval corpus: not indexed, and no chunk quotes a held-out question', () => {
    expect(corpusFiles(root).some((f) => f.includes('eval'))).toBe(false);
    const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
    const texts = INDEX.chunks.map((c) => fold(c.text));
    for (const i of heldout.items) {
      const q = fold(i.question);
      expect(
        texts.some((t) => t.includes(q)),
        `${i.id} is quoted in the corpus`,
      ).toBe(false);
    }
  });

  test('every expected source path exists in the index', () => {
    const paths = new Set(INDEX.chunks.map((c) => c.path));
    for (const i of heldout.items)
      for (const s of i.sources ?? []) {
        const path = s.split('#')[0] as string;
        expect(
          s.endsWith('/') ? [...paths].some((p) => p.startsWith(s)) : paths.has(path),
          `${i.id}: ${s}`,
        ).toBe(true);
      }
  });
});

describe('retrieval ignores the answer-language hint', () => {
  test('the panel’s Japanese suffix is not searched; a Japanese-only question still is', () => {
    expect(searchText('Who made the original? (日本語で答えてください)')).toBe('Who made the original?');
    expect(searchText('Who made the original?（日本語で）')).toBe('Who made the original?');
    expect(searchText('(快速東京)')).toBe('(快速東京)');
    expect(searchText('What is 快速東京’s song?')).toBe('What is 快速東京’s song?');
    const ids = (q: string) => retrieve(searcher(), q).map((h) => h.chunk.id);
    expect(ids('Who made the original? (日本語で答えてください)')).toEqual(ids('Who made the original?'));
  });
});

describe('config', () => {
  test('every matrix model and the judge have a price; matrix ids are unique', () => {
    for (const m of settings.matrix) expect(() => priceFor(settings.prices, m.model)).not.toThrow();
    expect(() => priceFor(settings.prices, settings.judge.model)).not.toThrow();
    expect(new Set(settings.matrix.map((m) => m.id)).size).toBe(settings.matrix.length);
    expect(settings.judge.model).toBe('claude-opus-5');
  });
});

describe('per-model request parameters', () => {
  test('effort only where the model takes it; never thinking or temperature', () => {
    expect(modelParams('claude-haiku-4-5', 'low')).toEqual({});
    expect(modelParams('claude-sonnet-5')).toEqual({});
    expect(modelParams('claude-sonnet-5', 'low')).toEqual({ output_config: { effort: 'low' } });
    expect(modelParams('claude-opus-5-5', 'medium')).toEqual({ output_config: { effort: 'medium' } });
    expect(modelParams('claude-opus-5', 'low')).toEqual({ output_config: { effort: 'low' } });
  });

  test('DOCENT_EFFORT flows from the Worker settings into the gateway request; skip-cache header', async () => {
    const s = docentSettings({
      AI_GATEWAY_ACCOUNT_ID: 'a',
      AI_GATEWAY_ID: 'g',
      ANTHROPIC_API_KEY: 'k',
      DOCENT_MODEL: 'claude-opus-5-5',
      DOCENT_EFFORT: 'LOW',
      WWM_ENV: 'production',
    });
    expect(s).toMatchObject({ mode: 'gateway', model: 'claude-opus-5-5', effort: 'low' });
    expect(docentSettings({ DOCENT_EFFORT: 'extreme' }).effort).toBeUndefined();

    const bodies: Record<string, unknown>[] = [];
    const heads: Headers[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      heads.push(req.headers);
      bodies.push(JSON.parse(await req.text()));
      const ev = (e: object) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`;
      return new Response(
        [
          ev({
            type: 'message_start',
            message: {
              id: 'm',
              type: 'message',
              role: 'assistant',
              model: 'claude-opus-5-5',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 1 },
            },
          }),
          ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
          ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi [S1].' } }),
          ev({ type: 'content_block_stop', index: 0 }),
          ev({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 90, output_tokens_details: { thinking_tokens: 60 } },
          }),
          ev({ type: 'message_stop' }),
        ].join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;
    for (const [model, effort] of [
      ['claude-opus-5-5', 'low'],
      ['claude-haiku-4-5', 'low'],
    ] as const) {
      const p = gatewayProvider({
        accountId: 'a',
        gatewayId: 'g',
        apiKey: 'k',
        model,
        effort,
        skipCache: true,
        fetch: f,
      });
      const r = await p.stream(
        {
          system: 's',
          messages: [{ role: 'user', content: 'q' }],
          excerpts: [],
          question: 'q',
          maxTokens: 1024,
        },
        () => {},
      );
      expect(r.usage).toMatchObject({ inputTokens: 10, outputTokens: 90, thinkingTokens: 60 });
    }
    expect(bodies[0]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' } });
    expect(bodies[1]?.output_config).toBeUndefined();
    for (const b of bodies) {
      expect(b.thinking).toBeUndefined();
      expect(b.temperature).toBeUndefined();
    }
    expect(heads[0]?.get('cf-aig-skip-cache')).toBe('true');
  });
});

describe('cost math', () => {
  const haiku = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
  test('per-million pricing, cache reads and writes billed separately', () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, haiku)).toBeCloseTo(6);
    expect(costUsd({ inputTokens: 3000, outputTokens: 200 }, haiku)).toBeCloseTo(0.004);
    expect(
      costUsd(
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
        haiku,
      ),
    ).toBeCloseTo(1.35);
    // opus 5.5: $4 / $20
    expect(
      costUsd({ inputTokens: 4000, outputTokens: 500 }, priceFor(settings.prices, 'claude-opus-5-5')),
    ).toBeCloseTo(0.026);
  });

  test('estimate: exact prompt sizes, skipped rejections, cached judge prefix', () => {
    const s: BakeoffSettings = {
      ...settings,
      prices: { a: haiku, j: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
      judge: { model: 'j', maxTokens: 1000, scope: 'heldout' },
      estimate: {
        charsPerToken: 4,
        tokenizerFactor: { default: 1 },
        outputTokens: { default: 100 },
        judgeSystemTokens: 0,
        judgeAnswerTokens: 10,
        judgeOutputTokens: 20,
      },
    };
    const matrix: MatrixEntry[] = [
      { id: 'x', model: 'a' },
      { id: 'y', model: 'a' },
    ];
    const est = estimateCost(
      [
        { set: 'heldout', itemId: '1', promptChars: 4000 },
        { set: 'original', itemId: '2', promptChars: 4000 },
        { set: 'heldout', itemId: '3', promptChars: 0 },
      ],
      matrix,
      s,
    );
    expect(est.rows[0]).toMatchObject({ calls: 2, inputTokens: 2000, outputTokens: 200 });
    expect(est.rows[0]?.usd).toBeCloseTo((2000 * 1 + 200 * 5) / 1e6);
    // judge: 1 held-out question × 2 configs; prefix 1000 written once, read once; 2×10 in, 2×20 out
    expect(est.judge.calls).toBe(2);
    expect(est.judge.usd).toBeCloseTo((1000 * 6.25 + 1000 * 0.5 + 20 * 5 + 40 * 25) / 1e6);
    expect(est.totalUsd).toBeCloseTo((est.rows[0]?.usd ?? 0) * 2 + est.judge.usd);
    expect(
      estimateCost([{ set: 'heldout', itemId: '1', promptChars: 4000 }], matrix, s, 'none').judge.calls,
    ).toBe(0);
  });
});

describe('outcomes, percentiles, records', () => {
  test('classifyOutcome: "don’t know" wins even with a cited extra sentence', () => {
    expect(classifyOutcome({ errorCode: 'QUESTION_REJECTED', text: '', citations: [] })).toBe('rejected');
    expect(classifyOutcome({ errorCode: 'X', text: '', citations: [] })).toBe('error');
    expect(classifyOutcome({ text: 'PARTY was the agency [1].', citations: [{}] })).toBe('answered');
    expect(
      classifyOutcome({
        text: 'The sources don’t cover that. They do list the credits [1].',
        citations: [{}],
      }),
    ).toBe('dont_know');
    expect(classifyOutcome({ text: 'The sources don’t cover that.', citations: [] })).toBe('dont_know');
  });

  test('nearest-rank percentile', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });

  test('latestRecords: last line per key wins, a cut-off line is ignored', () => {
    const a = { key: 'k', costUsd: 1 } as BakeoffRecord;
    const b = { key: 'k', costUsd: 2 } as BakeoffRecord;
    const m = latestRecords([JSON.stringify(a), JSON.stringify(b), '{"key":"z","cos']);
    expect(m.size).toBe(1);
    expect(m.get('k')?.costUsd).toBe(2);
  });
});

function rec(configId: string, over: Partial<BakeoffRecord>): BakeoffRecord {
  return {
    key: `${configId}|heldout|${over.itemId ?? 'q'}`,
    configId,
    model: configId,
    set: 'heldout',
    itemId: 'q',
    expect: 'answer',
    question: 'q',
    outcome: 'answered',
    outcomeOk: true,
    cited: [],
    citations: [],
    excerpts: [],
    text: 't [1].',
    ttftMs: 800,
    firstVisibleMs: 900,
    totalMs: 2000,
    usage: { inputTokens: 1000, outputTokens: 100 },
    costUsd: 0.01,
    at: '',
    ...over,
  };
}
const judged = (unsupported: number) => ({
  model: 'j',
  sentences: [],
  unsupported,
  factual: 1,
  costUsd: 0.02,
  ms: 1,
});

describe('aggregate and the recommendation rule', () => {
  const matrix: MatrixEntry[] = ['cheap', 'mid', 'slow', 'dear'].map((id) => ({ id, model: id }));
  const rule = { set: 'heldout' as const, maxUnsupportedAnswers: 0, maxP50TtftMs: 1500 };

  test('cheapest config with zero unsupported held-out answers and p50 TTFT ≤ 1.5 s', () => {
    const records = [
      rec('cheap', { itemId: 'a', costUsd: 0.001, judge: judged(1) }), // unsupported claim
      rec('cheap', { itemId: 'b', costUsd: 0.001, judge: judged(0) }),
      rec('mid', { itemId: 'a', costUsd: 0.005, judge: judged(0) }),
      rec('mid', { itemId: 'b', costUsd: 0.005, judge: judged(0), ttftMs: 1400 }),
      rec('slow', { itemId: 'a', costUsd: 0.002, judge: judged(0), ttftMs: 1600 }),
      rec('slow', { itemId: 'b', costUsd: 0.002, judge: judged(0), ttftMs: 1700 }),
      rec('dear', { itemId: 'a', costUsd: 0.05, judge: judged(0) }),
      rec('dear', { itemId: 'b', costUsd: 0.05, judge: judged(0) }),
    ];
    const stats = aggregate(records, matrix);
    expect(stats[0]?.sets.heldout).toMatchObject({ n: 2, judged: 2, unsupportedAnswers: 1 });
    expect(stats[1]).toMatchObject({
      costUsd: 0.01,
      costPerModelCall: 0.005,
      judgeCostUsd: 0.04,
      ttftP50: 800,
    });
    const r = recommend(stats, rule, { heldout: 2 });
    expect(r.pick).toBe('mid');
    expect(r.verdicts.find((v) => v.configId === 'cheap')?.reasons).toEqual([
      '1 heldout answer(s) with unsupported claims',
    ]);
    expect(r.verdicts.find((v) => v.configId === 'slow')?.reasons[0]).toMatch(/p50 TTFT 1.60 s/);
    // incomplete runs and missing judgments disqualify
    expect(recommend(stats, rule, { heldout: 3 }).pick).toBeNull();
    const unjudged = aggregate([rec('mid', { judgeSkipped: 'scope' })], matrix);
    expect(recommend(unjudged, rule).verdicts[1]?.reasons).toContain('1 heldout answer(s) not judged');
    const errored = aggregate(
      [rec('mid', { judge: judged(0) }), rec('mid', { itemId: 'e', outcome: 'error' })],
      matrix,
    );
    expect(recommend(errored, rule).verdicts[1]?.eligible).toBe(false);
  });
});

describe('judge', () => {
  const chunk = (id: string, path: string, anchor?: string) => ({
    id,
    title: id,
    path,
    ...(anchor ? { anchor } : {}),
    text: `text of ${id}`,
  });
  const excerpts = [
    { ref: 'S1', chunk: chunk('a.md#x', 'a.md', 'x') },
    { ref: 'S2', chunk: chunk('b.md#y', 'b.md', 'y') },
    { ref: 'S3', chunk: chunk('b.md#y~2', 'b.md', 'y') },
  ];
  const input = {
    question: 'Who?',
    text: 'PARTY was the agency [1]. It used AID-DCC [2][1]. Unsourced claim.',
    citations: [
      { title: 'B', path: 'b.md', anchor: 'y' },
      { title: 'A', path: 'a.md', anchor: 'x' },
    ],
    excerpts,
  };

  test('display markers map back to excerpt ids (split parts of one section stay ambiguous)', () => {
    expect(answerForJudge(input)).toBe(
      'PARTY was the agency [S2 or S3]. It used AID-DCC [S1][S2 or S3]. Unsourced claim.',
    );
    const t = judgeUserTurn(input);
    expect(t.sentences).toEqual([
      'PARTY was the agency [S2 or S3].',
      'It used AID-DCC [S1][S2 or S3].',
      'Unsourced claim.',
    ]);
    expect(t.prefix).toContain('<excerpt id="S3" title="b.md#y~2">');
    expect(t.prefix).not.toContain('PARTY'); // the cached prefix holds no answer text
    expect(t.answer).toContain('3. Unsourced claim.');
  });

  test('parseJudgment validates every sentence and computes counts', () => {
    const raw = JSON.stringify({
      verdicts: [
        { n: 1, factual: true, supported: true, cited_support: 'yes', note: '' },
        { n: 2, factual: true, supported: false, cited_support: 'no', note: 'AID-DCC role' },
        { n: 3, factual: false, supported: false, cited_support: 'uncited', note: '' },
      ],
    });
    const s = parseJudgment(raw, ['a', 'b', 'c']);
    expect(s.map((x) => x.supported)).toEqual([true, false, true]); // non-factual is never "unsupported"
    expect(s[1]).toMatchObject({ text: 'b', citedSupport: 'no', note: 'AID-DCC role' });
    expect(() => parseJudgment(raw, ['a', 'b', 'c', 'd'])).toThrow(/sentence 4/);
    expect(() => parseJudgment('{"sentences":[]}', ['a'])).toThrow(/verdicts/);
  });

  test('splitSentences keeps markers with their sentence', () => {
    expect(splitSentences('One [1]. Two [2][3]. 2013 was the year [1].\nNext line')).toEqual([
      'One [1].',
      'Two [2][3].',
      '2013 was the year [1].',
      'Next line',
    ]);
  });

  test('mock judge: uncited factual sentences are unsupported; "don’t know" is not a claim', async () => {
    const r = await mockJudge().judge({
      ...input,
      text: 'A [1]. B has no source. The sources don’t cover that.',
    });
    expect(r).toMatchObject({ factual: 2, unsupported: 1 });
  });
});

describe('runner (dry run, no network)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wwm-bakeoff-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const matrix: MatrixEntry[] = [
    { id: 'haiku-4-5', model: 'claude-haiku-4-5' },
    { id: 'opus-5-5@low', model: 'claude-opus-5-5', effort: 'low' },
  ];
  const pick = (set: EvalSet, ids: string[]) => set.items.filter((i) => ids.includes(i.id));
  const items = [
    ...pick(original, ['s1-who-made', 'off-poem']).map((item) => ({ set: 'original' as const, item })),
    ...pick(heldout, ['ho-attempts', 'nc-players']).map((item) => ({ set: 'heldout' as const, item })),
  ];
  const chunks = new Map(INDEX.chunks.map((c) => [c.id, c]));
  let failJudge = true;
  const flaky: Judge = {
    model: 'flaky',
    async judge(input) {
      if (failJudge) throw new Error('judge down');
      return mockJudge('flaky').judge(input);
    },
  };
  const opts = (judge: Judge) => ({
    items,
    matrix,
    providerFor: (m: MatrixEntry) => dryRunProvider(m, 0),
    price: (m: string) => priceFor(settings.prices, m),
    judge,
    judgeScope: 'heldout' as const,
    searcher: searcher(),
    chunk: (id: string) => chunks.get(id),
    maxTokens: 1024,
    outDir: dir,
    concurrency: 3,
    maxCostUsd: Number.POSITIVE_INFINITY,
  });

  test('runs the matrix through the production engine, records timing, cost and judgments', async () => {
    const s = await runBakeoff(opts(flaky));
    expect(s.ran).toBe(8);
    const byKey = new Map(s.records.map((r) => [r.key, r]));
    const who = byKey.get('opus-5-5@low|original|s1-who-made') as BakeoffRecord;
    expect(who).toMatchObject({
      outcome: 'answered',
      outcomeOk: true,
      citationHit: true,
      judgeSkipped: 'scope',
    });
    expect(who.ttftMs).not.toBeNull();
    expect(who.usage?.inputTokens).toBeGreaterThan(500);
    expect(who.costUsd).toBeCloseTo(
      costUsd(who.usage ?? { inputTokens: 0, outputTokens: 0 }, priceFor(settings.prices, 'claude-opus-5-5')),
    );
    expect(byKey.get('haiku-4-5|original|off-poem')).toMatchObject({ outcome: 'rejected', costUsd: 0 });
    expect(byKey.get('haiku-4-5|heldout|ho-attempts')?.judgeError).toBe('judge down');
  });

  test('resume: finished answers are reused, failed judgments are redone without a new answer', async () => {
    failJudge = false;
    const before = readFileSync(join(dir, RESULTS_FILE), 'utf8').split('\n').filter(Boolean).length;
    const s = await runBakeoff(opts(flaky));
    const redone = s.records.filter((r) => r.set === 'heldout' && r.itemId === 'ho-attempts');
    expect(s.ran).toBeGreaterThan(0);
    expect(s.reused + s.ran).toBe(8);
    for (const r of redone) expect(r.judge?.model).toBe('flaky');
    const again = await runBakeoff(opts(flaky));
    expect(again).toMatchObject({ ran: 0, reused: 8 });
    const lines = readFileSync(join(dir, RESULTS_FILE), 'utf8').split('\n').filter(Boolean).length;
    expect(lines).toBe(before + s.ran);

    const stats = aggregate(again.records, matrix);
    const r = recommend(stats, settings.recommend, { original: 2, heldout: 2 });
    const meta = {
      title: 't',
      mode: 'dry-run' as const,
      startedAt: '',
      finishedAt: '',
      corpusHash: INDEX.hash,
      judgeModel: 'flaky',
      judgeScope: 'heldout',
      maxTokens: 1024,
      spentUsd: 0,
      stoppedAtCap: false,
      sets: { original: 2, heldout: 2 },
    };
    const md = renderMarkdown(meta, stats, r, again.records);
    expect(md).toContain('DRY RUN');
    expect(md).toContain('| `haiku-4-5` | `opus-5-5@low` |');
    expect(md).toMatch(/\| heldout \| ho-attempts \| answer \|/);
    const html = renderHtml(meta, stats, r, again.records);
    expect(html).toContain('<table>');
    expect(html).not.toMatch(/<script/);
    expect(renderJudgeSample(again.records, 3, 'seed')).toContain('# Judge sample');
  });

  test('spend cap stops new calls', async () => {
    const capped = mkdtempSync(join(tmpdir(), 'wwm-bakeoff-cap-'));
    try {
      const s = await runBakeoff({
        ...opts(mockJudge()),
        outDir: capped,
        concurrency: 1,
        maxCostUsd: 0.0001,
      });
      expect(s.stoppedAtCap).toBe(true);
      expect(s.ran).toBeLessThan(8);
    } finally {
      rmSync(capped, { recursive: true, force: true });
    }
  });
});
