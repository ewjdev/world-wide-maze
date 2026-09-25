/**
 * Docent model bake-off (Phase 15b): pure parts. Settings and prices, cost math, outcome classes, aggregation, the
 * recommendation rule and the cost estimate. No I/O here; `run.ts` runs the matrix and `report.ts` renders it.
 */
import type { DocentCitation } from '@wwm/schema';
import { isDontKnow } from '../../../../apps/worker/src/docent/grounding.ts';
import type { Effort } from '../../../../apps/worker/src/docent/providers.ts';
import type { Expect } from '../eval-core.ts';

// ── Settings (bakeoff.config.json) ───────────────────────────────────────────────────────────────────────────

/** USD per million tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface MatrixEntry {
  /** Stable id used in results and reports, e.g. `opus-5-5@low`. */
  id: string;
  model: string;
  effort?: Effort;
}

export interface BakeoffSettings {
  prices: Record<string, Price>;
  matrix: MatrixEntry[];
  maxTokens: number;
  concurrency: number;
  maxCostUsd: number;
  judge: { model: string; effort?: Effort; maxTokens: number; scope: JudgeScope };
  recommend: { set: SetName; maxUnsupportedAnswers: number; maxP50TtftMs: number };
  estimate: {
    charsPerToken: number;
    tokenizerFactor: Record<string, number>;
    outputTokens: Record<string, number>;
    /** Judge system prompt + wrapper, part of the cached prefix. */
    judgeSystemTokens: number;
    /** The numbered answer sentences (uncached). */
    judgeAnswerTokens: number;
    judgeOutputTokens: number;
  };
}

export type SetName = 'original' | 'heldout';
export type JudgeScope = 'heldout' | 'all' | 'none';

// ── Cost ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  thinkingTokens?: number;
}

export function priceFor(prices: Record<string, Price>, model: string): Price {
  const p = prices[model];
  if (!p) throw new Error(`no price for ${model} in bakeoff.config.json`);
  return p;
}

/**
 * USD for one call. `input_tokens` excludes cached tokens, which are billed separately; `output_tokens` already
 * includes thinking tokens.
 */
export function costUsd(u: Usage, p: Price): number {
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      (u.cacheReadTokens ?? 0) * p.cacheRead +
      (u.cacheWriteTokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

// ── Records ──────────────────────────────────────────────────────────────────────────────────────────────────

export type OutcomeClass = 'answered' | 'dont_know' | 'rejected' | 'error';

/**
 * The visitor-facing outcome. An answer that says the sources don't cover the question is a "don't know" even
 * when it adds one cited sentence on what the sources do cover (the prompt allows that; the engine counts it as
 * grounded, so its own outcome would be `answered`).
 */
export function classifyOutcome(o: {
  errorCode?: string;
  text: string;
  citations: readonly unknown[];
}): OutcomeClass {
  if (o.errorCode) return o.errorCode === 'QUESTION_REJECTED' ? 'rejected' : 'error';
  if (isDontKnow(o.text)) return 'dont_know';
  return o.citations.length ? 'answered' : 'dont_know';
}

export interface JudgedSentence {
  text: string;
  factual: boolean;
  supported: boolean;
  /** Does the excerpt the sentence cites support it? `uncited` when it cites nothing. */
  citedSupport: 'yes' | 'no' | 'uncited';
  note: string;
}

export interface JudgeResult {
  model: string;
  sentences: JudgedSentence[];
  /** Factual sentences the excerpts don't support. */
  unsupported: number;
  factual: number;
  usage?: Usage;
  costUsd: number;
  ms: number;
}

export interface BakeoffRecord {
  key: string;
  configId: string;
  model: string;
  effort?: Effort;
  set: SetName;
  itemId: string;
  kind?: string;
  expect: Expect;
  accept?: Expect[];
  question: string;
  outcome: OutcomeClass;
  outcomeOk: boolean;
  /** The engine's own reason for a "don't know" (model, ungrounded, refusal, no_excerpts). */
  reason?: string;
  stopReason?: string | null;
  citationHit?: boolean;
  citationPrecision?: number;
  retrievalHit?: boolean;
  leaked?: boolean;
  cited: string[];
  citations: DocentCitation[];
  /** Excerpt refs and chunk ids sent to the model (the judge rebuilds their text from the index). */
  excerpts: { ref: string; id: string }[];
  text: string;
  /** Model text started (time to first text token from the provider, after any thinking). */
  ttftMs: number | null;
  /** First text the visitor would see (after the grounding gate opens). */
  firstVisibleMs: number | null;
  totalMs: number;
  usage?: Usage;
  costUsd: number;
  judge?: JudgeResult;
  /** Why there is no judgment (`rejected`, `dont_know`, `scope`), or the judge's error. */
  judgeSkipped?: string;
  judgeError?: string;
  error?: string;
  at: string;
}

export const recordKey = (configId: string, set: SetName, itemId: string) => `${configId}|${set}|${itemId}`;

/** A record is final when it has no error and, if it needed a judgment, has one. */
export function isComplete(r: BakeoffRecord): boolean {
  return !r.error && !r.judgeError;
}

/** Latest record per key from results.jsonl lines (append-only; the last line for a key wins). */
export function latestRecords(lines: string[]): Map<string, BakeoffRecord> {
  const out = new Map<string, BakeoffRecord>();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as BakeoffRecord;
      out.set(r.key, r);
    } catch {
      // a line cut off by an interrupted run
    }
  }
  return out;
}

// ── Aggregation ──────────────────────────────────────────────────────────────────────────────────────────────

/** Nearest-rank percentile; null for no data. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] as number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface SetStats {
  n: number;
  errors: number;
  outcomeOk: number;
  answered: number;
  dontKnow: number;
  rejected: number;
  /** Answer items citing an expected source / answer items scored. */
  citationHits: number;
  citationScored: number;
  citationPrecision: number | null;
  /**
   * Answers the judge checked; answers that needed a judgment and have none (judge error, or outside the judge's
   * scope); answers with at least one unsupported factual sentence; such sentences.
   */
  judged: number;
  judgePending: number;
  unsupportedAnswers: number;
  unsupportedSentences: number;
  /** Cited sentences whose cited excerpt doesn't support them (even if another excerpt does). */
  miscitedSentences: number;
  leaked: number;
}

export interface ConfigStats {
  configId: string;
  model: string;
  effort?: Effort;
  sets: Partial<Record<SetName, SetStats>>;
  all: SetStats;
  ttftP50: number | null;
  ttftP90: number | null;
  visibleP50: number | null;
  totalP50: number | null;
  totalP90: number | null;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  /** Answer calls only. */
  costUsd: number;
  /** Mean answer cost over the questions that reached the model. */
  costPerModelCall: number | null;
  judgeCostUsd: number;
  modelCalls: number;
}

function setStats(rs: BakeoffRecord[]): SetStats {
  const s: SetStats = {
    n: rs.length,
    errors: 0,
    outcomeOk: 0,
    answered: 0,
    dontKnow: 0,
    rejected: 0,
    citationHits: 0,
    citationScored: 0,
    citationPrecision: null,
    judged: 0,
    judgePending: 0,
    unsupportedAnswers: 0,
    unsupportedSentences: 0,
    miscitedSentences: 0,
    leaked: 0,
  };
  const precisions: number[] = [];
  for (const r of rs) {
    if (r.outcome === 'error') s.errors++;
    if (r.outcomeOk) s.outcomeOk++;
    if (r.outcome === 'answered') s.answered++;
    if (r.outcome === 'dont_know') s.dontKnow++;
    if (r.outcome === 'rejected') s.rejected++;
    if (r.citationHit !== undefined) {
      s.citationScored++;
      if (r.citationHit) s.citationHits++;
      precisions.push(r.citationPrecision ?? 0);
    }
    if (r.leaked) s.leaked++;
    if (r.judge) {
      s.judged++;
      if (r.judge.unsupported > 0) s.unsupportedAnswers++;
      s.unsupportedSentences += r.judge.unsupported;
      s.miscitedSentences += r.judge.sentences.filter((x) => x.factual && x.citedSupport === 'no').length;
    } else if (r.judgeError || r.judgeSkipped === 'scope') s.judgePending++;
  }
  s.citationPrecision = mean(precisions);
  return s;
}

export function aggregate(records: BakeoffRecord[], matrix: MatrixEntry[]): ConfigStats[] {
  return matrix.map((m) => {
    const rs = records.filter((r) => r.configId === m.id);
    const sets: ConfigStats['sets'] = {};
    for (const name of ['original', 'heldout'] as const) {
      const part = rs.filter((r) => r.set === name);
      if (part.length) sets[name] = setStats(part);
    }
    const calls = rs.filter((r) => r.usage);
    const ttft = rs.map((r) => r.ttftMs).filter((x): x is number => x !== null);
    const visible = rs.map((r) => r.firstVisibleMs).filter((x): x is number => x !== null);
    const total = calls.map((r) => r.totalMs);
    const cost = calls.reduce((a, r) => a + r.costUsd, 0);
    return {
      configId: m.id,
      model: m.model,
      ...(m.effort ? { effort: m.effort } : {}),
      sets,
      all: setStats(rs),
      ttftP50: percentile(ttft, 0.5),
      ttftP90: percentile(ttft, 0.9),
      visibleP50: percentile(visible, 0.5),
      totalP50: percentile(total, 0.5),
      totalP90: percentile(total, 0.9),
      inputTokens: calls.reduce((a, r) => a + (r.usage?.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((a, r) => a + (r.usage?.outputTokens ?? 0), 0),
      thinkingTokens: calls.reduce((a, r) => a + (r.usage?.thinkingTokens ?? 0), 0),
      costUsd: cost,
      costPerModelCall: calls.length ? cost / calls.length : null,
      judgeCostUsd: rs.reduce((a, r) => a + (r.judge?.costUsd ?? 0), 0),
      modelCalls: calls.length,
    };
  });
}

// ── Recommendation ───────────────────────────────────────────────────────────────────────────────────────────

export interface Verdict {
  configId: string;
  eligible: boolean;
  reasons: string[];
}

export interface Recommendation {
  /** Cheapest eligible config, or null when none qualifies. */
  pick: string | null;
  rule: string;
  verdicts: Verdict[];
}

/**
 * Cheapest config (mean answer cost per model call) with zero unsupported claims on the held-out set (every
 * held-out answer judged) and p50 time-to-first-token within the limit. Errors disqualify: a config that
 * didn't answer everything wasn't fully measured.
 */
export function recommend(
  stats: ConfigStats[],
  rule: BakeoffSettings['recommend'],
  /** Questions per set in the run: a config with fewer results (spend cap, interruption) is incomplete. */
  expected: Partial<Record<SetName, number>> = {},
): Recommendation {
  const text =
    `cheapest config (mean cost per answered call) with ≤ ${rule.maxUnsupportedAnswers} answers containing ` +
    `unsupported claims on the ${rule.set} set, every such answer judged, all questions run without errors, and p50 TTFT ≤ ${(
      rule.maxP50TtftMs / 1000
    ).toFixed(1)} s`;
  const verdicts = stats.map((s): Verdict => {
    const reasons: string[] = [];
    const set = s.sets[rule.set];
    if (!set) reasons.push(`no ${rule.set} results`);
    else {
      if (set.unsupportedAnswers > rule.maxUnsupportedAnswers)
        reasons.push(`${set.unsupportedAnswers} ${rule.set} answer(s) with unsupported claims`);
      if (set.judgePending) reasons.push(`${set.judgePending} ${rule.set} answer(s) not judged`);
    }
    for (const [name, n] of Object.entries(expected) as [SetName, number][]) {
      const got = s.sets[name]?.n ?? 0;
      if (got < n) reasons.push(`incomplete: ${got}/${n} ${name} questions`);
    }
    if (s.all.errors) reasons.push(`${s.all.errors} error(s)`);
    if (s.ttftP50 === null) reasons.push('no latency data');
    else if (s.ttftP50 > rule.maxP50TtftMs) reasons.push(`p50 TTFT ${(s.ttftP50 / 1000).toFixed(2)} s`);
    if (s.costPerModelCall === null) reasons.push('no model calls');
    return { configId: s.configId, eligible: reasons.length === 0, reasons };
  });
  const ok = stats
    .filter((s) => verdicts.find((v) => v.configId === s.configId)?.eligible)
    .sort((a, b) => (a.costPerModelCall ?? 0) - (b.costPerModelCall ?? 0));
  return { pick: ok[0]?.configId ?? null, rule: text, verdicts };
}

// ── Up-front estimate ────────────────────────────────────────────────────────────────────────────────────────

/** A question as it will be sent: known before any call (retrieval and the topic check are local). */
export interface PlannedCall {
  set: SetName;
  itemId: string;
  /** Characters of system prompt + messages; 0 when the question is rejected before the model. */
  promptChars: number;
}

export interface Estimate {
  rows: {
    configId: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    usd: number;
  }[];
  judge: { calls: number; inputTokens: number; outputTokens: number; usd: number };
  totalUsd: number;
}

export function estimateCost(
  planned: PlannedCall[],
  matrix: MatrixEntry[],
  s: BakeoffSettings,
  judgeScope: JudgeScope = s.judge.scope,
): Estimate {
  const e = s.estimate;
  const factor = (model: string) => e.tokenizerFactor[model] ?? e.tokenizerFactor.default ?? 1;
  const calls = planned.filter((p) => p.promptChars > 0);
  const rows = matrix.map((m) => {
    const inputTokens = calls.reduce(
      (a, p) => a + Math.ceil((p.promptChars / e.charsPerToken) * factor(m.model)),
      0,
    );
    const outputTokens = calls.length * (e.outputTokens[m.id] ?? e.outputTokens.default ?? 500);
    const usd = costUsd({ inputTokens, outputTokens }, priceFor(s.prices, m.model));
    return { configId: m.id, model: m.model, calls: calls.length, inputTokens, outputTokens, usd };
  });
  // upper bound: every question that reaches the model gets a judged answer. The excerpts + question prefix is
  // the same for every config, so it is written to the cache once (1.25×) and read by the others (0.1×).
  const judged =
    judgeScope === 'none' ? [] : calls.filter((p) => judgeScope === 'all' || p.set === 'heldout');
  const jf = factor(s.judge.model);
  const k = matrix.length;
  let jWrite = 0;
  let jRead = 0;
  for (const p of judged) {
    const prefix = Math.ceil((p.promptChars / e.charsPerToken + e.judgeSystemTokens) * jf);
    jWrite += prefix;
    jRead += prefix * (k - 1);
  }
  const jCalls = judged.length * k;
  const jIn = Math.ceil(jCalls * e.judgeAnswerTokens * jf);
  const jOut = jCalls * e.judgeOutputTokens;
  const jUsd = costUsd(
    { inputTokens: jIn, outputTokens: jOut, cacheReadTokens: jRead, cacheWriteTokens: jWrite },
    priceFor(s.prices, s.judge.model),
  );
  return {
    rows,
    judge: { calls: jCalls, inputTokens: jIn + jWrite + jRead, outputTokens: jOut, usd: jUsd },
    totalUsd: rows.reduce((a, r) => a + r.usd, 0) + jUsd,
  };
}

export function formatEstimate(est: Estimate, judgeModel: string): string {
  const usd = (x: number) => `$${x.toFixed(2)}`;
  const lines = [
    'config            model              calls   in tok   out tok    est. $',
    ...est.rows.map(
      (r) =>
        `${r.configId.padEnd(17)} ${r.model.padEnd(18)} ${String(r.calls).padStart(5)} ${String(r.inputTokens).padStart(8)} ${String(r.outputTokens).padStart(9)} ${usd(r.usd).padStart(9)}`,
    ),
    `${'judge'.padEnd(17)} ${judgeModel.padEnd(18)} ${String(est.judge.calls).padStart(5)} ${String(est.judge.inputTokens).padStart(8)} ${String(est.judge.outputTokens).padStart(9)} ${usd(est.judge.usd).padStart(9)}`,
    `${'total (estimate)'.padEnd(64)} ${usd(est.totalUsd).padStart(9)}`,
  ];
  return lines.join('\n');
}
