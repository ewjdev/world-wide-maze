/** Runs the frozen pilot through the same durable local API and physical controller as the UI. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type InputSample, SIM_HZ } from '@wwm/schema';
import {
  digest,
  LIMITS,
  MODEL,
  type Receipt,
  type TickedEvent,
  VERSION,
} from '../../../packages/maze-agent/src/contracts.ts';
import { FIXTURES } from '../../../packages/maze-agent/src/fixtures.ts';
import { MazePilot } from '../../../packages/maze-agent/src/pilot.ts';

const origin = 'http://127.0.0.1:5176';
const bootstrap = (await fetch(`${origin}/api/jev/session`, {
  headers: { 'sec-fetch-site': 'same-origin' },
}).then((r) => r.json())) as { token: string; available: boolean };
const request = async <T>(path: string, data?: unknown): Promise<T> => {
  const r = await fetch(`${origin}/api/jev/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'x-jev-session': bootstrap.token, origin, 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const v = (await r.json()) as { error?: string };
  if (!r.ok) throw new Error(v.error ?? String(r.status));
  return v as T;
};
const smoke = process.argv.includes('--smoke');
const fixtures = FIXTURES.filter((f) => f.id !== 'confirmation').slice(0, smoke ? 1 : 3);
const results: Record<string, unknown>[] = [];
const out = resolve('plans/evidence/jev-evaluation');
mkdirSync(out, { recursive: true });
const report = {
  version: VERSION,
  model: MODEL,
  at: new Date().toISOString(),
  mode: smoke ? 'smoke' : 'measured',
  account: 'User-provided TYPESAFE_API_KEY in ignored .env.jev; account identity not exposed by this API',
  pricing: {
    source: 'https://docs.typesafe.ai/models',
    inputPerMillionUSD: 0.042,
    outputUSD: 0,
    conservativePilotEstimateUSD: 1.6128,
    basis:
      '600 requests × 64000 model context tokens; actual 16 KiB payload cap is smaller; estimate, not a billing guarantee',
  },
  limits: LIMITS,
  fixtures: await Promise.all(fixtures.map(async (f) => ({ id: f.id, hash: await digest(f.stage) }))),
  results,
};
const save = () =>
  writeFileSync(resolve(out, smoke ? 'smoke.json' : 'pilot.json'), JSON.stringify(report, null, 2) + '\n');
save();
if (!bootstrap.available) throw new Error('Live evaluation requires configured key');
for (const f of fixtures)
  for (let seed = 0; seed < (smoke ? 1 : 3); seed++)
    for (const policy of (smoke ? ['jev'] : ['baseline', 'jev']) as ('jev' | 'baseline')[]) {
      const documentId = crypto.randomUUID();
      const run = await request<{ id: string; owner: string }>('runs', {
        fixture: f.id,
        policy,
        orderSeed: seed,
        documentId,
      });
      const auth = { owner: run.owner, documentId, epoch: 0 };
      const command = (type: string, data: unknown) =>
        request(`runs/${run.id}/command`, { ...auth, type, data });
      const pilot = await new MazePilot(f, seed).init();
      let chunks = 0,
        from = 0,
        decisions = 0,
        forced = 0,
        revisits = 0;
      let inputs: InputSample[] = [],
        events: TickedEvent[] = [];
      const latencies: number[] = [];
      let inputTokens = 0,
        outputTokens = 0;
      const start = performance.now();
      let status = 'failed',
        reason = '';
      const flush = async () => {
        if (!inputs.length) return;
        await command('chunk', {
          sequence: chunks++,
          from,
          to: pilot.tick,
          inputs,
          events,
          ball: pilot.ball,
          digest: await digest(pilot.ball),
        });
        from = pilot.tick;
        inputs = [];
        events = [];
      };
      try {
        await command('status', { status: 'running' });
        while (decisions < LIMITS.actions) {
          const candidates = pilot.exploration.candidates();
          const frame = {
            id: `decision-${++decisions}`,
            tick: pilot.tick,
            digest: await digest(pilot.ball),
            observation: pilot.exploration.observation(),
            candidates,
          };
          await command('frame', frame);
          const receipt = await request<Receipt>(`runs/${run.id}/decide`, {
            ...auth,
            decisionId: frame.id,
            attemptId: `attempt-${decisions}`,
          });
          if (receipt.source.startsWith('forced')) forced++;
          if (receipt.source === 'jev') {
            latencies.push(receipt.latencyMs);
            inputTokens += receipt.usage?.input_tokens ?? 0;
            outputTokens += receipt.usage?.output_tokens ?? 0;
          }
          if (candidates.find((c) => c.id === receipt.choice)?.traversals) revisits++;
          await command('action', { attemptId: receipt.attemptId });
          pilot.choose(receipt.choice);
          let outcome: string | null = null;
          while (!outcome) {
            const r = pilot.step();
            inputs.push(r.input);
            events.push(...r.result.events.map((event) => ({ tick: pilot.tick, event })));
            outcome = r.outcome;
            if (outcome || inputs.length >= SIM_HZ) await flush();
          }
          await command('outcome', { attemptId: receipt.attemptId, outcome, tick: pilot.tick });
          if (outcome !== 'arrived') {
            status = outcome === 'goal' ? 'finished' : 'failed';
            reason = outcome;
            break;
          }
        }
        if (!reason) reason = 'Action cap';
      } catch (e) {
        reason = e instanceof Error ? e.message : String(e);
        await flush().catch(() => {});
      }
      await command('status', { status, reason }).catch(() => {});
      const elapsed = performance.now() - start;
      const detail = await request<Record<string, unknown>>(`runs/${run.id}`);
      // Full evidence remains in the authoritative local archive; the report links by run ID.
      const expected = await digest(pilot.ball);
      await pilot.sim.load(f.stage);
      const allInputs = (detail.events as { type: string; data: { chunk?: { inputs: InputSample[] } } }[])
        .filter((e) => e.type === 'chunk')
        .flatMap((e) => e.data.chunk?.inputs ?? []);
      for (const i of allInputs) pilot.sim.step(i);
      const replayMatch = (await digest(pilot.sim.getBallState())) === expected;
      latencies.sort((a, b) => a - b);
      const pct = (p: number) =>
        latencies.length
          ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)]
          : null;
      const row = {
        runId: run.id,
        fixture: f.id,
        policy,
        seed,
        status,
        reason,
        decisions,
        forced,
        revisits,
        ticks: pilot.tick,
        activeSeconds: pilot.tick / SIM_HZ,
        providerWaitMs: latencies.reduce((a, b) => a + b, 0),
        executionWallMs: elapsed,
        latencyP50: pct(0.5),
        latencyP95: pct(0.95),
        inputTokens,
        outputTokens,
        estimatedUsageCostUSD: (inputTokens / 1e6) * 0.042,
        replayMatch,
      };
      results.push(row);
      save();
      console.info(JSON.stringify(row));
      pilot.dispose();
      // Stop after the first provider failure in smoke; measured trials preserve every failure independently.
    }
