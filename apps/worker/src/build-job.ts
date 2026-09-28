/**
 * BuildJob Durable Object: one instance per job id.
 * - `start(params)` (RPC) records the job, emits `queued`, and schedules an immediate alarm. The HTTP
 *   request returns 202 right away.
 * - `alarm()` runs the pipeline (capture → build → store). Alarms get a long wall-clock budget and the
 *   Worker-wide `limits.cpu_ms`, which is what the CPU-heavy builder needs (task 4 "CPU budget").
 * - `fetch()` serves `GET /api/jobs/:jobId` as SSE: stored events replayed, then live ones.
 * Finished jobs delete their storage a day later.
 */

import { DurableObject } from 'cloudflare:workers';
import type { JobEvent } from '@wwm/schema';
import { budget, controlsOn, releaseCost, requireCost } from './budget-client.ts';
import { createServices } from './config.ts';
import { JobEventHub } from './job-events.ts';
import { type JobParams, runBuildJob } from './pipeline.ts';

type JobState = 'queued' | 'running' | 'finished';
const EXPIRE_MS = 24 * 3600_000;

export class BuildJob extends DurableObject<Env> {
  private hub: JobEventHub | undefined;

  private async loadHub(): Promise<JobEventHub> {
    if (!this.hub) this.hub = new JobEventHub((await this.ctx.storage.get<JobEvent[]>('events')) ?? []);
    return this.hub;
  }

  private async emit(e: JobEvent): Promise<void> {
    const hub = await this.loadHub();
    hub.push(e);
    await this.ctx.storage.put('events', hub.events);
  }

  async start(params: JobParams): Promise<void> {
    if (await this.ctx.storage.get('params')) return; // idempotent
    await requireCost(this.env, 'build', params.jobId);
    await this.ctx.storage.put({ params, state: 'queued' satisfies JobState });
    await this.emit({ type: 'progress', step: 'queued', pct: 0 });
    await this.ctx.storage.setAlarm(Date.now());
  }

  override async fetch(_request: Request): Promise<Response> {
    if (!(await this.ctx.storage.get('params')))
      return Response.json({ error: 'job not found' }, { status: 404 });
    const hub = await this.loadHub();
    const done = hub.events.find((e) => e.type === 'done');
    if (
      done?.type === 'done' &&
      !(await createServices(this.env, { jobId: done.runId }).store.catalog.canServeRun(done.runId))
    )
      return new JobEventHub([
        { type: 'error', code: 'CAPTURE_BLOCKED', message: 'This maze is unavailable.' },
      ]).stream();
    return hub.stream();
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<JobState>('state');
    const params = await this.ctx.storage.get<JobParams>('params');
    if (state === 'finished' || !params) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const expired =
      controlsOn(this.env) &&
      !(await budget(this.env)
        .hasLease(params.jobId)
        .catch(() => false));
    if (state === 'running' || expired) {
      // A previous attempt died mid-job (eviction/deploy). Don't loop: report and stop (and let a retry start
      // a fresh job: Phase 12b).
      await createServices(this.env, { jobId: params.jobId })
        .store.clearInflightJob(params.cacheKey, params.jobId)
        .catch(() => {});
      await this.emit({
        type: 'error',
        code: 'BUILD_FAILED',
        message: 'build was interrupted; please retry',
      });
    } else {
      await this.ctx.storage.put('state', 'running' satisfies JobState);
      const services = createServices(this.env, { jobId: params.jobId });
      await runBuildJob(params, services.pipeline, (e) => this.emit(e));
    }
    await releaseCost(this.env, params.jobId);
    await this.ctx.storage.put('state', 'finished' satisfies JobState);
    await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
  }
}
