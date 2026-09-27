import { DurableObject } from 'cloudflare:workers';
import {
  BASE_RESERVE,
  type BudgetKind,
  type BudgetState,
  debitBudget,
  evaluateBudget,
  freshBudget,
  POLICIES,
  rollBudget,
  STOP_AT,
  USD,
} from './budget-policy.ts';

/** One coordinator for scarce paid admissions, never for WebSocket frames or static assets.
 * Synchronous SQL transactions make read/check/debit atomic even across concurrent RPCs.
 * Debits are deliberately NOT refunded: timeouts/failed calls may still have been billed.
 */
export class Budget extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS budget_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)',
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS budget_receipts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, expires INTEGER NOT NULL, retain_until INTEGER NOT NULL)',
    );
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS budget_receipts_expiry ON budget_receipts(expires)');
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS budget_receipts_retention ON budget_receipts(retain_until)',
    );
  }
  private read(now: number): BudgetState {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM budget_state WHERE id=1')
      .toArray()[0];
    return rollBudget(row ? (JSON.parse(row.value) as BudgetState) : freshBudget(now), now);
  }
  private save(state: BudgetState) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO budget_state VALUES (1,?)', JSON.stringify(state));
  }
  async reserve(
    kind: BudgetKind,
    id: string,
    units = 1,
    replaces?: string,
  ): Promise<{ ok: boolean; reason: string; expires: number }> {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const state = this.read(now);
      const reason = evaluateBudget(state, kind, units);
      if (reason) return { ok: false, reason, expires: 0 };
      if (!/^[a-zA-Z0-9:._-]{1,180}$/.test(id)) return { ok: false, reason: 'invalid-id', expires: 0 };
      // Retrying an already admitted operation must not execute it a second time.
      if (this.ctx.storage.sql.exec('SELECT id FROM budget_receipts WHERE id=?', id).toArray().length)
        return { ok: false, reason: 'duplicate', expires: 0 };
      const p = POLICIES[kind];
      // A room renews its own slot atomically, including when all 20 slots are occupied.
      if (replaces) {
        const old = this.ctx.storage.sql
          .exec<{ kind: string }>('SELECT kind FROM budget_receipts WHERE id=?', replaces)
          .toArray()[0];
        if (kind !== 'room' || old?.kind !== 'room')
          return { ok: false, reason: 'invalid-renewal', expires: 0 };
      }
      if (p.concurrent) {
        const active = this.ctx.storage.sql
          .exec<{ n: number }>(
            `SELECT COUNT(*) AS n FROM budget_receipts WHERE
             ${p.pool === 'ai' ? "kind IN ('docent','moderation','jev')" : 'kind=?'}
             AND expires>? AND id<>?`,
            ...(p.pool === 'ai' ? [] : [kind]),
            now,
            replaces ?? '',
          )
          .one().n;
        if (active >= p.concurrent) return { ok: false, reason: 'busy', expires: 0 };
      }
      if (replaces) this.ctx.storage.sql.exec('UPDATE budget_receipts SET expires=0 WHERE id=?', replaces);
      const expires = now + p.leaseMs;
      const next = debitBudget(state, kind, units);
      this.save(next);
      for (const threshold of [25, 35, 40]) {
        if (state.spent < threshold * USD && next.spent >= threshold * USD)
          console.warn(
            JSON.stringify({ svc: 'wwm-budget', thresholdUsd: threshold, spentMicros: next.spent }),
          );
      }
      if (p.concurrent)
        this.ctx.storage.sql.exec(
          'INSERT INTO budget_receipts VALUES (?,?,?,?)',
          id,
          kind,
          expires,
          now + 86400_000,
        );
      return { ok: true, reason: 'reserved', expires };
    });
  }
  async hasLease(id: string): Promise<boolean> {
    return (
      this.ctx.storage.sql
        .exec('SELECT id FROM budget_receipts WHERE id=? AND expires>?', id, Date.now())
        .toArray().length === 1
    );
  }
  async release(id: string): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE budget_receipts SET expires=0 WHERE id=?', id);
  }
  async snapshot(): Promise<BudgetState & { level: string; targetUsd: number }> {
    const state = this.read(Date.now());
    return {
      ...state,
      targetUsd: 50,
      level: !state.initialized
        ? 'uninitialized'
        : state.staticOnly
          ? 'paused'
          : state.spent >= STOP_AT
            ? 'stopped'
            : state.spent >= 35 * USD
              ? 'reduced'
              : state.spent >= 25 * USD
                ? 'warning'
                : 'normal',
    };
  }
  /** Access-authenticated admin routes only. Prior spend cannot be reduced, including within a month. */
  async configure(
    input: {
      spentMicros?: number;
      storedBytes?: number;
      disabled?: BudgetKind[];
      staticOnly?: boolean;
      telemetryReady?: boolean;
    },
    actor: string,
  ): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      const s = this.read(Date.now());
      if (input.spentMicros !== undefined) {
        if (!Number.isSafeInteger(input.spentMicros) || input.spentMicros < Math.max(s.spent, BASE_RESERVE))
          throw new Error('Spend must cover existing reservations and fixed costs');
        s.spent = input.spentMicros;
      }
      if (input.storedBytes !== undefined) {
        if (!Number.isSafeInteger(input.storedBytes) || input.storedBytes < 0)
          throw new Error('Invalid reconciled storage');
        s.storedBytes = input.storedBytes;
      }
      if (input.spentMicros !== undefined || input.storedBytes !== undefined) {
        if (!s.initialized && (input.spentMicros === undefined || input.storedBytes === undefined))
          throw new Error('Reconcile prior spend and storage before enabling');
        s.initialized = true;
      }
      if (input.disabled !== undefined) {
        if (!Array.isArray(input.disabled) || input.disabled.some((k) => !Object.hasOwn(POLICIES, k)))
          throw new Error('Invalid feature');
        s.disabled = input.disabled;
      }
      for (const k of ['staticOnly', 'telemetryReady'] as const) {
        if (input[k] !== undefined) {
          if (typeof input[k] !== 'boolean') throw new Error('Invalid switch');
          s[k] = input[k];
        }
      }
      this.save(s);
    });
    console.log(JSON.stringify({ svc: 'wwm-budget', msg: 'operator reconciliation', actor }));
  }
  async sweep(): Promise<void> {
    this.ctx.storage.sql.exec(
      'DELETE FROM budget_receipts WHERE id IN (SELECT id FROM budget_receipts WHERE retain_until<? LIMIT 1000)',
      Date.now(),
    );
  }
}
