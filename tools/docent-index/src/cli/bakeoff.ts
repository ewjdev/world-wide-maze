/**
 * `pnpm docent:bakeoff`: the docent model bake-off (Phase 15b). Runs eval.json and eval-heldout.json across a
 * model matrix through the production docent engine, judges answers for unsupported claims, and writes
 * tools/docent-index/bakeoff/<timestamp>/{results.jsonl,report.md,report.html,judge-sample.md,meta.json}.
 *
 *   pnpm docent:bakeoff                     dry run (default): offline mock, fake latency, mechanical judge
 *   pnpm docent:bakeoff --real              prints the cost estimate and stops
 *   pnpm docent:bakeoff --real --yes        spends real tokens through Cloudflare AI Gateway; needs
 *                                           AI_GATEWAY_ACCOUNT_ID, AI_GATEWAY_ID and ANTHROPIC_API_KEY and/or
 *                                           AI_GATEWAY_TOKEN in the environment
 *   --configs haiku-4-5,opus-5-5@low        subset of the matrix (ids from bakeoff.config.json)
 *   --sets original,heldout                 which question sets (default both)
 *   --limit N                               first N questions of each set (smoke test)
 *   --judge heldout|all|none                what the judge checks (default from the config: heldout)
 *   --concurrency N  --max-cost USD  --max-tokens N  --sample N (judge sample size, default 12)
 *   --out DIR                               output directory (default bakeoff/<timestamp>[-dry])
 *   --resume DIR                            continue a run: skips finished answers, re-judges failed judgments
 *   --latency-scale X                       dry run only: scale the fake latencies (0 = none)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docentSettings } from '../../../../apps/worker/src/docent/config.ts';
import { prepareDocent } from '../../../../apps/worker/src/docent/engine.ts';
import { buildMessages, SYSTEM_PROMPT } from '../../../../apps/worker/src/docent/prompt.ts';
import { type DocentProvider, gatewayProvider } from '../../../../apps/worker/src/docent/providers.ts';
import { INDEX, searcher } from '../../../../apps/worker/src/docent/retrieve.ts';
import {
  aggregate,
  type BakeoffSettings,
  estimateCost,
  formatEstimate,
  type JudgeScope,
  type MatrixEntry,
  type PlannedCall,
  priceFor,
  recommend,
  type SetName,
} from '../bakeoff/core.ts';
import { dryRunProvider } from '../bakeoff/dry-run.ts';
import { gatewayJudge, type Judge, mockJudge } from '../bakeoff/judge.ts';
import { renderHtml, renderJudgeSample, renderMarkdown } from '../bakeoff/report.ts';
import { type RunItem, runBakeoff } from '../bakeoff/run.ts';
import type { EvalSet } from '../eval-core.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(name);
const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '../..');
const root = resolve(pkg, '../..');
const settings = JSON.parse(readFileSync(resolve(pkg, 'bakeoff.config.json'), 'utf8')) as BakeoffSettings;

const real = has('--real');
const mode = real ? 'real' : 'dry-run';

// ── what to run ──
const wantConfigs = flag('--configs')
  ?.split(',')
  .map((s) => s.trim());
const matrix: MatrixEntry[] = wantConfigs
  ? wantConfigs.map((id) => {
      const m = settings.matrix.find((x) => x.id === id);
      if (!m) {
        console.error(`unknown config ${id}; known: ${settings.matrix.map((x) => x.id).join(', ')}`);
        process.exit(2);
      }
      return m;
    })
  : settings.matrix;
for (const m of matrix) priceFor(settings.prices, m.model); // fail early on a missing price
const sets = (flag('--sets')?.split(',') ?? ['original', 'heldout']) as SetName[];
const limit = flag('--limit') ? Number(flag('--limit')) : Number.POSITIVE_INFINITY;
const judgeScope = (flag('--judge') ?? settings.judge.scope) as JudgeScope;
const maxTokens = Number(flag('--max-tokens') ?? settings.maxTokens);
const concurrency = Number(flag('--concurrency') ?? settings.concurrency);
// the cap guards real money; dry-run costs are synthetic, so no cap unless asked for
const maxCost = Number(flag('--max-cost') ?? (real ? settings.maxCostUsd : Number.POSITIVE_INFINITY));

const file: Record<SetName, string> = { original: 'eval.json', heldout: 'eval-heldout.json' };
const items: RunItem[] = sets.flatMap((set) => {
  const s = JSON.parse(readFileSync(resolve(pkg, file[set]), 'utf8')) as EvalSet;
  return s.items.slice(0, limit).map((item) => ({ set, item }));
});

// ── estimate (retrieval and the topic check are local, so the prompts are known exactly) ──
const planned: PlannedCall[] = items.map(({ set, item }) => {
  const p = prepareDocent(
    { question: item.question, ...(item.history ? { history: item.history } : {}) },
    searcher(),
  );
  const promptChars =
    p.rejected || !p.excerpts.length
      ? 0
      : SYSTEM_PROMPT.length +
        buildMessages(p.question, p.excerpts, p.history).reduce((a, m) => a + m.content.length, 0);
  return { set, itemId: item.id, promptChars };
});
const est = estimateCost(planned, matrix, settings, judgeScope);
console.log(
  `Docent bake-off (${mode}): ${items.length} questions (${sets.join(' + ')}) × ${matrix.length} configs; ` +
    `${planned.filter((p) => p.promptChars).length} per config reach the model; judge on ${judgeScope}.`,
);
console.log(
  `\nUp-front cost estimate${real ? '' : ' (what a real run would cost)'}:\n${formatEstimate(est, settings.judge.model)}`,
);
console.log(
  `Spend cap: ${Number.isFinite(maxCost) ? `$${maxCost.toFixed(2)}` : 'none (dry run)'} (--max-cost). ` +
    'Prices: bakeoff.config.json.\n',
);

// ── providers ──
let providerFor: (m: MatrixEntry) => DocentProvider;
let judge: Judge | null;
if (real) {
  const e = process.env;
  if (!e.AI_GATEWAY_ACCOUNT_ID || !e.AI_GATEWAY_ID || !(e.ANTHROPIC_API_KEY || e.AI_GATEWAY_TOKEN)) {
    console.error(
      '--real needs AI_GATEWAY_ACCOUNT_ID, AI_GATEWAY_ID and ANTHROPIC_API_KEY and/or AI_GATEWAY_TOKEN',
    );
    process.exit(2);
  }
  if (!has('--yes')) {
    console.log('Nothing was called. Re-run with --yes to spend real tokens.');
    process.exit(0);
  }
  if (est.totalUsd > maxCost) {
    console.error(
      `The estimate ($${est.totalUsd.toFixed(2)}) is above the spend cap ($${maxCost.toFixed(2)}). ` +
        'Raise --max-cost, or narrow the run (--configs, --sets, --judge heldout|none, --limit).',
    );
    process.exit(2);
  }
  const auth = {
    accountId: e.AI_GATEWAY_ACCOUNT_ID,
    gatewayId: e.AI_GATEWAY_ID,
    ...(e.ANTHROPIC_API_KEY ? { apiKey: e.ANTHROPIC_API_KEY } : {}),
    ...(e.AI_GATEWAY_TOKEN ? { gatewayToken: e.AI_GATEWAY_TOKEN } : {}),
  };
  providerFor = (m) => {
    // the production settings path, as the Worker would read these vars (model, effort)
    const s = docentSettings({
      AI_GATEWAY_ACCOUNT_ID: auth.accountId,
      AI_GATEWAY_ID: auth.gatewayId,
      ...(auth.apiKey ? { ANTHROPIC_API_KEY: auth.apiKey } : {}),
      ...(auth.gatewayToken ? { AI_GATEWAY_TOKEN: auth.gatewayToken } : {}),
      WWM_ENV: 'production',
      DOCENT_PROVIDER: 'gateway',
      DOCENT_MODEL: m.model,
      ...(m.effort ? { DOCENT_EFFORT: m.effort } : {}),
    });
    return gatewayProvider({
      ...auth,
      model: s.model,
      ...(s.effort ? { effort: s.effort } : {}),
      skipCache: true,
    });
  };
  judge =
    judgeScope === 'none'
      ? null
      : gatewayJudge({
          ...auth,
          model: settings.judge.model,
          ...(settings.judge.effort ? { effort: settings.judge.effort } : {}),
          maxTokens: settings.judge.maxTokens,
          price: priceFor(settings.prices, settings.judge.model),
        });
} else {
  const scale = Number(flag('--latency-scale') ?? 1);
  providerFor = (m) => dryRunProvider(m, scale);
  judge = judgeScope === 'none' ? null : mockJudge();
}

// ── run ──
const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace(/-\d{3}Z$/, 'Z');
const outDir = resolve(
  flag('--resume') ?? flag('--out') ?? resolve(pkg, 'bakeoff', `${stamp}${real ? '' : '-dry'}`),
);
const startedAt = new Date().toISOString();
const chunks = new Map(INDEX.chunks.map((c) => [c.id, c]));
console.log(`Output: ${relative(process.cwd(), outDir) || '.'}`);
const summary = await runBakeoff({
  items,
  matrix,
  providerFor,
  price: (m) => priceFor(settings.prices, m),
  judge,
  judgeScope,
  searcher: searcher(),
  chunk: (id) => chunks.get(id),
  maxTokens,
  outDir,
  concurrency,
  maxCostUsd: maxCost,
  onRecord: (r, done, total) => {
    const u = r.judge?.unsupported ? ` U${r.judge.unsupported}` : '';
    const err = r.error ? ` ERROR ${r.error}` : r.judgeError ? ` JUDGE ERROR ${r.judgeError}` : '';
    console.log(
      `[${String(done).padStart(3)}/${total}] ${r.configId.padEnd(16)} ${r.set.padEnd(8)} ${r.itemId.padEnd(20)} ${r.outcome.padEnd(9)} ${r.outcomeOk ? 'ok' : 'NO'}${u} ttft ${r.ttftMs ?? '–'} ms${err}`,
    );
  },
});

// ── report ──
const stats = aggregate(summary.records, matrix);
const rec = recommend(
  stats,
  settings.recommend,
  Object.fromEntries(sets.map((s) => [s, items.filter((i) => i.set === s).length])),
);
let commit: string | undefined;
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  // not a git checkout
}
const meta = {
  title: `Docent model bake-off${real ? '' : ' (dry run)'}`,
  mode: mode as 'real' | 'dry-run',
  startedAt,
  finishedAt: new Date().toISOString(),
  ...(commit ? { commit } : {}),
  corpusHash: INDEX.hash,
  judgeModel: judge?.model ?? 'none',
  judgeScope,
  maxTokens,
  spentUsd: summary.spentUsd,
  stoppedAtCap: summary.stoppedAtCap,
  sets: Object.fromEntries(sets.map((s) => [s, items.filter((i) => i.set === s).length])),
};
writeFileSync(resolve(outDir, 'report.md'), renderMarkdown(meta, stats, rec, summary.records));
writeFileSync(resolve(outDir, 'report.html'), renderHtml(meta, stats, rec, summary.records));
writeFileSync(
  resolve(outDir, 'judge-sample.md'),
  renderJudgeSample(summary.records, Number(flag('--sample') ?? 12), outDir),
);
writeFileSync(
  resolve(outDir, 'meta.json'),
  `${JSON.stringify({ ...meta, matrix, estimate: est, settings, args }, null, 2)}\n`,
);

console.log(
  `\n${summary.ran} ran, ${summary.reused} reused; spend $${summary.spentUsd.toFixed(3)}` +
    `${summary.stoppedAtCap ? ' (STOPPED AT THE SPEND CAP: rerun with --resume to finish)' : ''}.`,
);
console.log(rec.pick ? `Recommendation: ${rec.pick}` : 'No configuration meets the recommendation rule.');
for (const v of rec.verdicts) if (!v.eligible) console.log(`  ${v.configId}: ${v.reasons.join('; ')}`);
console.log(
  `Report: ${relative(process.cwd(), resolve(outDir, 'report.md'))} (+ report.html, judge-sample.md)`,
);
