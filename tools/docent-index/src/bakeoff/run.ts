/**
 * Runs the bake-off matrix through the production docent pipeline (`prepareDocent` → `answerDocent`: the same
 * sanitising, retrieval, topic check, prompt and streamed grounding gate the Worker uses), times it, prices it,
 * judges it, and appends one JSON line per answer to `results.jsonl`. Concurrency-limited and resumable: a
 * rerun on the same directory skips finished answers and re-judges answers whose judgment failed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocentEvent } from '@wwm/schema';
import { answerDocent, prepareDocent } from '../../../../apps/worker/src/docent/engine.ts';
import { DONT_KNOW, DONT_KNOW_JA } from '../../../../apps/worker/src/docent/prompt.ts';
import type { DocentProvider } from '../../../../apps/worker/src/docent/providers.ts';
import type { Searcher } from '../bm25.ts';
import { type EvalItem, scoreItem } from '../eval-core.ts';
import type { CorpusChunk } from '../types.ts';
import {
  type BakeoffRecord,
  classifyOutcome,
  costUsd,
  isComplete,
  type JudgeScope,
  latestRecords,
  type MatrixEntry,
  type Price,
  recordKey,
  type SetName,
} from './core.ts';
import type { Judge } from './judge.ts';

export interface RunItem {
  set: SetName;
  item: EvalItem;
}

export interface RunOptions {
  items: RunItem[];
  matrix: MatrixEntry[];
  providerFor: (entry: MatrixEntry) => DocentProvider;
  price: (model: string) => Price;
  judge: Judge | null;
  judgeScope: JudgeScope;
  searcher: Searcher;
  /** Chunk lookup by id (to rebuild the excerpts for a re-judgment). */
  chunk: (id: string) => CorpusChunk | undefined;
  maxTokens: number;
  outDir: string;
  concurrency: number;
  /** Stop starting new calls once the run directory's recorded spend reaches this. */
  maxCostUsd: number;
  onRecord?: (r: BakeoffRecord, done: number, total: number) => void;
}

export interface RunSummary {
  records: BakeoffRecord[];
  /** Answers already complete in the directory before this invocation. */
  reused: number;
  ran: number;
  spentUsd: number;
  stoppedAtCap: boolean;
}

export const RESULTS_FILE = 'results.jsonl';

export function loadRecords(outDir: string): Map<string, BakeoffRecord> {
  const file = join(outDir, RESULTS_FILE);
  return existsSync(file) ? latestRecords(readFileSync(file, 'utf8').split('\n')) : new Map();
}

const recordSpend = (r: BakeoffRecord) => r.costUsd + (r.judge?.costUsd ?? 0);

function needsJudgment(set: SetName, scope: JudgeScope): boolean {
  return scope === 'all' || (scope === 'heldout' && set === 'heldout');
}

/** The bare "don't know" sentence: nothing to check. */
const bareDontKnow = (t: string) => t.trim() === DONT_KNOW || t.trim() === DONT_KNOW_JA;

async function judgeInto(r: BakeoffRecord, opts: RunOptions): Promise<BakeoffRecord> {
  const base: BakeoffRecord = { ...r };
  delete base.judgeSkipped;
  delete base.judgeError;
  delete base.judge;
  if (r.outcome === 'rejected' || r.outcome === 'error') return { ...base, judgeSkipped: r.outcome };
  if (!opts.judge || !needsJudgment(r.set, opts.judgeScope)) return { ...base, judgeSkipped: 'scope' };
  if (bareDontKnow(r.text)) return { ...base, judgeSkipped: 'dont_know' };
  const excerpts = r.excerpts.flatMap((e) => {
    const chunk = opts.chunk(e.id);
    return chunk ? [{ ref: e.ref, chunk }] : [];
  });
  try {
    const judge = await opts.judge.judge({
      question: r.question,
      text: r.text,
      citations: r.citations,
      excerpts,
    });
    return { ...base, judge };
  } catch (err) {
    return { ...base, judgeError: err instanceof Error ? err.message : String(err) };
  }
}

async function answer(entry: MatrixEntry, ri: RunItem, opts: RunOptions): Promise<BakeoffRecord> {
  const { set, item } = ri;
  const req = { question: item.question, ...(item.history ? { history: item.history } : {}) };
  const base = {
    key: recordKey(entry.id, set, item.id),
    configId: entry.id,
    model: entry.model,
    ...(entry.effort ? { effort: entry.effort } : {}),
    set,
    itemId: item.id,
    ...(item.kind ? { kind: item.kind } : {}),
    expect: item.expect,
    ...(item.accept ? { accept: item.accept } : {}),
    question: item.question,
  };
  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);
  let ttft: number | null = null;
  let visible: number | null = null;
  const inner = opts.providerFor(entry);
  const provider: DocentProvider = {
    name: inner.name,
    model: inner.model,
    stream: (input, onText) =>
      inner.stream(input, (t) => {
        ttft ??= since();
        onText(t);
      }),
  };
  const events: DocentEvent[] = [];
  const prepared = prepareDocent(req, opts.searcher);
  const excerpts = prepared.excerpts.map((e) => ({ ref: e.ref, id: e.chunk.id }));
  try {
    const run = await answerDocent(prepared, { provider, maxTokens: opts.maxTokens }, (e) => {
      if (e.type === 'delta' && visible === null) visible = since();
      events.push(e);
    });
    const totalMs = since();
    const text = events.map((e) => (e.type === 'delta' ? e.text : '')).join('');
    const err = events.find((e) => e.type === 'error');
    const errorCode = err?.type === 'error' ? err.code : undefined;
    const outcome = classifyOutcome({ ...(errorCode ? { errorCode } : {}), text, citations: run.citations });
    const score = scoreItem(item, {
      outcome,
      text,
      citations: run.citations,
      retrieved: run.retrieved,
    });
    const usage = run.result?.usage;
    return {
      ...base,
      outcome,
      outcomeOk: score.outcomeOk,
      ...(run.reason ? { reason: run.reason } : {}),
      ...(run.result ? { stopReason: run.result.stopReason } : {}),
      ...(score.citationHit !== undefined ? { citationHit: score.citationHit } : {}),
      ...(score.citationPrecision !== undefined ? { citationPrecision: score.citationPrecision } : {}),
      ...(score.retrievalHit !== undefined ? { retrievalHit: score.retrievalHit } : {}),
      ...(score.leaked !== undefined ? { leaked: score.leaked } : {}),
      cited: score.cited,
      citations: run.citations,
      excerpts,
      text,
      ttftMs: ttft,
      firstVisibleMs: visible,
      totalMs,
      ...(usage ? { usage } : {}),
      costUsd: usage ? costUsd(usage, opts.price(entry.model)) : 0,
      at: new Date().toISOString(),
    };
  } catch (e) {
    return {
      ...base,
      outcome: 'error',
      outcomeOk: false,
      cited: [],
      citations: [],
      excerpts,
      text: '',
      ttftMs: ttft,
      firstVisibleMs: visible,
      totalMs: since(),
      costUsd: 0,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      at: new Date().toISOString(),
    };
  }
}

export async function runBakeoff(opts: RunOptions): Promise<RunSummary> {
  mkdirSync(opts.outDir, { recursive: true });
  const file = join(opts.outDir, RESULTS_FILE);
  const existing = loadRecords(opts.outDir);
  let spent = [...existing.values()].reduce((a, r) => a + recordSpend(r), 0);

  type Task = { entry: MatrixEntry; ri: RunItem; rejudge?: BakeoffRecord };
  const tasks: Task[] = [];
  let reused = 0;
  // item-major order, so an interrupted or capped run has every config on the same questions
  for (const ri of opts.items)
    for (const entry of opts.matrix) {
      const prev = existing.get(recordKey(entry.id, ri.set, ri.item.id));
      if (prev && isComplete(prev)) reused++;
      else if (prev && !prev.error && prev.judgeError) tasks.push({ entry, ri, rejudge: prev });
      else tasks.push({ entry, ri });
    }

  const records = new Map(existing);
  let next = 0;
  let done = 0;
  let stoppedAtCap = false;
  const worker = async () => {
    while (next < tasks.length) {
      if (spent >= opts.maxCostUsd) {
        stoppedAtCap = true;
        return;
      }
      const t = tasks[next++] as Task;
      const before = t.rejudge ? recordSpend(t.rejudge) : 0;
      const answered = t.rejudge ?? (await answer(t.entry, t.ri, opts));
      const r = await judgeInto(answered, opts);
      spent += recordSpend(r) - before;
      appendFileSync(file, `${JSON.stringify(r)}\n`);
      records.set(r.key, r);
      done++;
      opts.onRecord?.(r, done, tasks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));

  // keep only this run's keys, in a stable order
  const order = new Map(
    opts.items.flatMap((ri, i) =>
      opts.matrix.map((m, j) => [recordKey(m.id, ri.set, ri.item.id), i * 1000 + j] as const),
    ),
  );
  const out = [...records.values()]
    .filter((r) => order.has(r.key))
    .sort((a, b) => (order.get(a.key) as number) - (order.get(b.key) as number));
  return { records: out, reused, ran: done, spentUsd: spent, stoppedAtCap };
}
