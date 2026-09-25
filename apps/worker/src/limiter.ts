/**
 * Limiter Durable Object (task 7). One instance per key:
 * - `build:<ip>`: sliding-window log for the 10 builds / hour / IP limit (the Rate Limiting binding only
 *   supports 10 s and 60 s periods).
 * - `browser`: global semaphore capping concurrent browser sessions, with leases so a crashed job can't
 *   leak a slot forever.
 * DO storage is strongly consistent and each instance is single-threaded, so there are no races.
 * Phase 12: an alarm deletes an instance's storage once nothing in it is live any more, so per-IP objects don't
 * keep old timestamps forever (privacy notice).
 */
import { DurableObject } from 'cloudflare:workers';

export interface LimitResult {
  ok: boolean;
  retryAfterSec: number;
  count: number;
}

export class Limiter extends DurableObject<Env> {
  /** Record one event if fewer than `limit` happened in the last `windowMs`. */
  async hit(limit: number, windowMs: number): Promise<LimitResult> {
    const now = Date.now();
    const hits = ((await this.ctx.storage.get<number[]>('hits')) ?? []).filter((t) => t > now - windowMs);
    if (hits.length >= limit) {
      const oldest = hits[0] as number;
      await this.ctx.storage.put('hits', hits);
      return { ok: false, retryAfterSec: Math.ceil((oldest + windowMs - now) / 1000), count: hits.length };
    }
    hits.push(now);
    await this.ctx.storage.put({ hits, windowMs });
    await this.#cleanupAt(now + windowMs);
    return { ok: true, retryAfterSec: 0, count: hits.length };
  }

  /** Schedule the cleanup alarm unless one is already due earlier. */
  async #cleanupAt(t: number): Promise<void> {
    const cur = await this.ctx.storage.getAlarm();
    if (cur === null || cur > t) await this.ctx.storage.setAlarm(t + 1000);
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const windowMs = (await this.ctx.storage.get<number>('windowMs')) ?? 0;
    const hits = ((await this.ctx.storage.get<number[]>('hits')) ?? []).filter((t) => t > now - windowMs);
    const leases = Object.values((await this.ctx.storage.get<Record<string, number>>('leases')) ?? {}).filter(
      (exp) => exp > now,
    );
    if (hits.length === 0 && leases.length === 0) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const next = Math.min(...hits.map((t) => t + windowMs), ...leases);
    await this.ctx.storage.setAlarm(next + 1000);
  }

  /** Take one of `max` slots for `holder` until it's released or `leaseMs` passes. */
  async acquire(holder: string, max: number, leaseMs: number): Promise<LimitResult> {
    const now = Date.now();
    const leases = Object.fromEntries(
      Object.entries((await this.ctx.storage.get<Record<string, number>>('leases')) ?? {}).filter(
        ([, exp]) => exp > now,
      ),
    );
    if (!(holder in leases) && Object.keys(leases).length >= max) {
      const soonest = Math.min(...Object.values(leases));
      await this.ctx.storage.put('leases', leases);
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil((soonest - now) / 1000)),
        count: Object.keys(leases).length,
      };
    }
    leases[holder] = now + leaseMs;
    await this.ctx.storage.put('leases', leases);
    await this.#cleanupAt(now + leaseMs);
    return { ok: true, retryAfterSec: 0, count: Object.keys(leases).length };
  }

  async release(holder: string): Promise<void> {
    const leases = (await this.ctx.storage.get<Record<string, number>>('leases')) ?? {};
    delete leases[holder];
    await this.ctx.storage.put('leases', leases);
  }
}
