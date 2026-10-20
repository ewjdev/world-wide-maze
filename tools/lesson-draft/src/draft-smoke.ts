/**
 * One real lesson-draft turn (Phase 31 M4 smoke test): the Worker's LESSON_DRAFT pipeline (prompt, validation,
 * repair ≤ 2) with Claude through AI Gateway `wwm`, reached via the local helper Worker (proxy/, `wrangler dev`, your
 * wrangler login; the Anthropic key stays in the gateway). At most three paid model calls.
 *
 * Usage: node src/draft-smoke.ts [--count 6] [--model claude-sonnet-5-5]
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DraftRevision } from '@wwm/learning';
import { runDraftPipeline, type StepRunner } from '../../../apps/worker/src/lesson-drafts/pipeline.ts';
import type { DraftModel } from '../../../apps/worker/src/lesson-drafts/providers.ts';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const MODEL = flag('model', 'claude-sonnet-5-5');
const COUNT = Number(flag('count', '6'));
const PORT = 8798;
const base = `http://localhost:${PORT}`;
const up = () =>
  fetch(`${base}/`).then(
    () => true,
    () => false,
  );

async function startProxy(): Promise<ChildProcess | undefined> {
  if (await up()) return undefined;
  const proxy = spawn(
    'pnpm',
    ['exec', 'wrangler', 'dev', '-c', 'proxy/wrangler.jsonc', '--port', String(PORT)],
    {
      cwd: join(here, '..'),
      stdio: 'ignore',
    },
  );
  for (let i = 0; i < 60; i++) {
    if (await up()) return proxy;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  proxy.kill();
  throw new Error('The helper Worker did not start. Is `wrangler login` current?');
}

const model: DraftModel = {
  name: 'gateway',
  model: MODEL,
  async complete(request) {
    const response = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
      }),
    });
    if (!response.ok) throw new Error(`model ${response.status}: ${await response.text()}`);
    const body = (await response.json()) as {
      model: string;
      content: { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };
    return {
      text: body.content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join(''),
      model: body.model,
      usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens },
    };
  },
};

const steps: StepRunner = { do: (_name, _config, callback) => callback() };
const proxy = await startProxy();
try {
  let revision: DraftRevision | undefined;
  await runDraftPipeline(
    steps,
    {
      draftId: 'd-smoke',
      turn: 1,
      objective: 'little-word-builders',
      brief: 'Animals and everyday things at home. Vary the blank position.',
      message: 'Animals and everyday things at home. Vary the blank position.',
      count: COUNT,
      base: [],
      dropped: [],
    },
    {
      model,
      maxTokens: 8000,
      save: async (value) => {
        revision = value;
      },
      ready: async () => {},
    },
  );
  if (!revision) throw new Error('no revision');
  console.log(revision.summary);
  for (const item of revision.items)
    console.log(
      `${item.ok ? 'ok  ' : 'FAIL'} ${item.label || item.draftId} ${[...item.issues, ...item.flags].join(' | ')}`,
    );
  console.log(`issues: ${revision.issues.length}, flags: ${revision.flags.length}`);
  for (const call of revision.calls)
    console.log(`${call.kind}: ${call.model}, ${call.inputTokens} input, ${call.outputTokens} output tokens`);
} finally {
  proxy?.kill();
}
