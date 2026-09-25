/**
 * `pnpm docent:eval`: runs tools/docent-index/eval.json against the docent and reports outcome accuracy,
 * citation accuracy, retrieval recall and injection handling.
 *
 *   pnpm docent:eval                 in-process with the mock provider (no network, no keys)
 *   pnpm docent:eval --real          in-process through Cloudflare AI Gateway; needs AI_GATEWAY_ACCOUNT_ID,
 *                                    AI_GATEWAY_ID and ANTHROPIC_API_KEY and/or AI_GATEWAY_TOKEN in the
 *                                    environment (DOCENT_MODEL optional). Spends real tokens (~26 calls).
 *   pnpm docent:eval --url http://localhost:8797   over HTTP against a running Worker (POST /api/docent)
 *   --set eval-heldout.json          another set in tools/docent-index (default eval.json)
 *   --only grounding,s3-ai-role      only these item ids or item kinds
 *   --out <file>                     also write the JSON report
 * Citations are labelled with their source kind; answers that present a plan as fact are flagged (Phase 15c).
 *   --min-outcome 0.8 --min-citation 0.8           exit 1 below these thresholds
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocentEvent } from '@wwm/schema';
import { DEFAULT_MODEL } from '../../../../apps/worker/src/docent/config.ts';
import { answerDocent, prepareDocent } from '../../../../apps/worker/src/docent/engine.ts';
import {
  type DocentProvider,
  gatewayProvider,
  mockProvider,
} from '../../../../apps/worker/src/docent/providers.ts';
import { INDEX, searcher } from '../../../../apps/worker/src/docent/retrieve.ts';
import {
  type EvalSet,
  formatReport,
  kindResolver,
  type Observed,
  scoreItem,
  summarize,
} from '../eval-core.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const here = dirname(fileURLToPath(import.meta.url));
const setFile = flag('--set') ?? 'eval.json';
const set = JSON.parse(readFileSync(resolve(here, '../..', setFile), 'utf8')) as EvalSet;
const only = flag('--only')?.split(',');
if (only) set.items = set.items.filter((i) => only.includes(i.id) || only.includes(i.kind ?? ''));
const kindOf = kindResolver(INDEX.chunks);
const url = flag('--url');
const real = args.includes('--real');

function provider(): DocentProvider {
  if (!real) return mockProvider();
  const e = process.env;
  if (!e.AI_GATEWAY_ACCOUNT_ID || !e.AI_GATEWAY_ID || !(e.ANTHROPIC_API_KEY || e.AI_GATEWAY_TOKEN)) {
    console.error(
      '--real needs AI_GATEWAY_ACCOUNT_ID, AI_GATEWAY_ID and ANTHROPIC_API_KEY and/or AI_GATEWAY_TOKEN',
    );
    process.exit(2);
  }
  return gatewayProvider({
    accountId: e.AI_GATEWAY_ACCOUNT_ID,
    gatewayId: e.AI_GATEWAY_ID,
    ...(e.ANTHROPIC_API_KEY ? { apiKey: e.ANTHROPIC_API_KEY } : {}),
    ...(e.AI_GATEWAY_TOKEN ? { gatewayToken: e.AI_GATEWAY_TOKEN } : {}),
    model: e.DOCENT_MODEL || DEFAULT_MODEL,
  });
}

/** Parse an SSE body into DocentEvents (`event: <type>` + `data: {...}`). */
function parseSse(body: string): DocentEvent[] {
  return body
    .split(/\n\n+/)
    .map((frame) => {
      const type = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      return type ? ({ type, ...(data ? JSON.parse(data) : {}) } as DocentEvent) : null;
    })
    .filter((e): e is DocentEvent => e !== null);
}

function observe(events: DocentEvent[], extra: Partial<Observed> = {}): Observed {
  const text = events.map((e) => (e.type === 'delta' ? e.text : '')).join('');
  const err = events.find((e) => e.type === 'error');
  const cites = events.find((e) => e.type === 'citations');
  const citations = cites?.type === 'citations' ? cites.items : [];
  let outcome: Observed['outcome'];
  if (err?.type === 'error') outcome = err.code === 'QUESTION_REJECTED' ? 'rejected' : 'error';
  else outcome = citations.length ? 'answered' : 'dont_know';
  return { outcome, text, citations, ...(err?.type === 'error' ? { errorCode: err.code } : {}), ...extra };
}

const scores = [];
const observed: Record<string, Observed> = {};
const p = url ? null : provider();
let i = 0;
for (const item of set.items) {
  const req = { question: item.question, ...(item.history ? { history: item.history } : {}) };
  const t0 = Date.now();
  let o: Observed;
  if (url) {
    const res = await fetch(new URL('/api/docent', url), {
      method: 'POST',
      // a distinct client per question, so the per-IP limit doesn't stop the run (only honoured locally)
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${(i++ % 250) + 1}` },
      body: JSON.stringify(req),
    });
    o = observe(parseSse(await res.text()), { ms: Date.now() - t0 });
  } else {
    const prepared = prepareDocent(req, searcher());
    const events: DocentEvent[] = [];
    const run = await answerDocent(prepared, { provider: p as DocentProvider, maxTokens: 600 }, (e) =>
      events.push(e),
    );
    o = observe(events, {
      retrieved: run.retrieved,
      ms: Date.now() - t0,
      ...(run.result?.usage
        ? { inputTokens: run.result.usage.inputTokens, outputTokens: run.result.usage.outputTokens }
        : {}),
    });
  }
  observed[item.id] = o;
  scores.push(scoreItem(item, o, kindOf));
}

const label = url
  ? `HTTP ${url}`
  : real
    ? `AI Gateway, ${process.env.DOCENT_MODEL || DEFAULT_MODEL}`
    : 'mock provider';
const sum = summarize(scores);
console.log(formatReport(scores, sum, label));
const tokens = Object.values(observed).reduce(
  (a, o) => ({ in: a.in + (o.inputTokens ?? 0), out: a.out + (o.outputTokens ?? 0) }),
  { in: 0, out: 0 },
);
if (tokens.in || tokens.out) console.log(`tokens             ${tokens.in} in, ${tokens.out} out`);

const out = flag('--out');
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(
    resolve(out),
    `${JSON.stringify({ label, at: new Date().toISOString(), summary: sum, scores, observed }, null, 2)}\n`,
  );
  console.log(`report → ${out}`);
}

const minOutcome = Number(flag('--min-outcome') ?? 0);
const minCitation = Number(flag('--min-citation') ?? 0);
if (sum.outcomeAccuracy < minOutcome || sum.citationAccuracy < minCitation || sum.injection.leaked > 0)
  process.exit(1);
