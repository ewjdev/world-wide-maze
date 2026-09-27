import { MODEL } from '../../../../packages/maze-agent/src/contracts.ts';

// Pinned model's published tariff: https://docs.typesafe.ai/models (verified 2026-09-27).
// Reserve the entire 64k input context before dispatch. Output tokens are free.
export const INPUT_MICROS_PER_MILLION = 42_000;
export const MAX_INPUT_TOKENS = 64_000;
export const RESERVATION_MICROS = 2688;
export type JevSql = Pick<SqlStorage, 'exec'>;
export interface BudgetSnapshot {
  enabled: boolean;
  dailyLimitMicros: number;
  day: string;
  spentMicros: number;
  reservedMicros: number;
  remainingMicros: number;
  attempts: number;
  resetsAt: string;
  model: string;
  reservationMicros: number;
}
export class JevBudget {
  constructor(
    readonly sql: JevSql,
    readonly transaction: <T>(fn: () => T) => T,
    readonly now = () => new Date(),
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS jev_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL,daily_limit INTEGER NOT NULL);
      INSERT OR IGNORE INTO jev_settings VALUES(1,0,0);
      CREATE TABLE IF NOT EXISTS jev_spend(run_id TEXT NOT NULL,attempt_id TEXT NOT NULL,day TEXT NOT NULL,amount INTEGER NOT NULL,settled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(run_id,attempt_id));
      CREATE INDEX IF NOT EXISTS jev_spend_day ON jev_spend(day);
      CREATE TABLE IF NOT EXISTS jev_settings_audit(at TEXT NOT NULL,actor TEXT NOT NULL,enabled INTEGER NOT NULL,daily_limit INTEGER NOT NULL);`);
  }
  snapshot(): BudgetSnapshot {
    const day = this.now().toISOString().slice(0, 10);
    const config = this.sql
      .exec<{ enabled: number; daily_limit: number }>('SELECT * FROM jev_settings WHERE id=1')
      .one();
    const usage = this.sql
      .exec<{ spent: number; reserved: number; attempts: number }>(
        `SELECT COALESCE(SUM(CASE WHEN settled=1 THEN amount ELSE 0 END),0) spent,COALESCE(SUM(CASE WHEN settled=0 THEN amount ELSE 0 END),0) reserved,COUNT(*) attempts FROM jev_spend WHERE day=?`,
        day,
      )
      .one();
    return {
      enabled: !!config.enabled,
      dailyLimitMicros: config.daily_limit,
      day,
      spentMicros: usage.spent,
      reservedMicros: usage.reserved,
      attempts: usage.attempts,
      remainingMicros: Math.max(0, config.daily_limit - usage.spent - usage.reserved),
      resetsAt: new Date(Date.parse(day) + 86400000).toISOString(),
      model: MODEL,
      reservationMicros: RESERVATION_MICROS,
    };
  }
  configure(value: unknown, actor: string) {
    const v = value as { enabled?: unknown; dailyLimitCents?: unknown };
    if (
      typeof v?.enabled !== 'boolean' ||
      !Number.isSafeInteger(v.dailyLimitCents) ||
      Number(v.dailyLimitCents) < 0 ||
      Number(v.dailyLimitCents) > 1_000_000
    )
      throw new Error('Use a daily limit from $0 to $10,000, in whole cents');
    if (v.enabled && Number(v.dailyLimitCents) === 0)
      throw new Error('Set a positive daily limit before enabling Jev');
    return this.transaction(() => {
      this.sql.exec(
        'UPDATE jev_settings SET enabled=?,daily_limit=? WHERE id=1',
        v.enabled ? 1 : 0,
        Number(v.dailyLimitCents) * 10000,
      );
      this.sql.exec(
        'INSERT INTO jev_settings_audit VALUES(?,?,?,?)',
        this.now().toISOString(),
        actor,
        v.enabled ? 1 : 0,
        Number(v.dailyLimitCents) * 10000,
      );
      return this.snapshot();
    });
  }
  reserve(runId: string, attemptId: string) {
    return this.transaction(() => {
      if (
        this.sql.exec('SELECT 1 FROM jev_spend WHERE run_id=? AND attempt_id=?', runId, attemptId).toArray()
          .length
      )
        throw new Error('Attempt already reserved; outcome may be unknown');
      const s = this.snapshot();
      if (!s.enabled) throw new Error('Jev is disabled by an administrator');
      if (s.remainingMicros < RESERVATION_MICROS)
        throw new Error('Daily Jev budget exhausted; increase the limit or wait for the UTC reset');
      this.sql.exec(
        'INSERT INTO jev_spend(run_id,attempt_id,day,amount) VALUES(?,?,?,?)',
        runId,
        attemptId,
        s.day,
        RESERVATION_MICROS,
      );
    });
  }
  settle(runId: string, attemptId: string, inputTokens: number) {
    if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > MAX_INPUT_TOKENS)
      throw new Error('Provider usage outside the pinned pricing contract; full reservation retained');
    const amount = Math.ceil((inputTokens * INPUT_MICROS_PER_MILLION) / 1_000_000);
    this.sql.exec(
      'UPDATE jev_spend SET amount=?,settled=1 WHERE run_id=? AND attempt_id=? AND settled=0',
      amount,
      runId,
      attemptId,
    );
  }
}
