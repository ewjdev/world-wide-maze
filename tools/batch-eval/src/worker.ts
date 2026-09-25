/** worker_threads entry: runs eval jobs posted by the CLI pool. */
import { parentPort } from 'node:worker_threads';
import { type EvalJob, runJob } from './run.ts';

parentPort?.on('message', async (msg: { id: number; job: EvalJob }) => {
  try {
    const rec = await runJob(msg.job);
    parentPort?.postMessage({ id: msg.id, rec });
  } catch (e) {
    parentPort?.postMessage({ id: msg.id, error: (e as Error).stack ?? String(e) });
  }
});
