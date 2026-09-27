/** Conservative admission allowances, in USD microdollars (not a provider invoice). */
export const USD = 1_000_000;
export const BASE_RESERVE = 5 * USD;
export const STOP_AT = 40 * USD;
export const MAX_STORED_BYTES = 20 * 1024 ** 3;
export const MONTHLY_WRITE_BYTES = 10 * 1024 ** 3;
export const POLICIES = {
  build: { day: 300, month: 3000, cost: 10_000, pool: 'build', concurrent: 2, leaseMs: 600_000 },
  docent: { day: 100, month: 1000, cost: 10_000, pool: 'ai', concurrent: 2, leaseMs: 35_000 },
  moderation: { day: 100, month: 1000, cost: 150_000, pool: 'ai', concurrent: 2, leaseMs: 25_000 },
  jev: { day: 100, month: 1000, cost: 3000, pool: 'ai', concurrent: 2, leaseMs: 35_000 },
  room: { day: 10_000, month: 50_000, cost: 500, pool: 'room', concurrent: 20, leaseMs: 600_000 },
  telemetry: { day: 20_000, month: 500_000, cost: 1, pool: 'other', concurrent: 0, leaseMs: 0 },
  score: { day: 1000, month: 10_000, cost: 10_000, pool: 'other', concurrent: 2, leaseMs: 600_000 },
  card: { day: 300, month: 3000, cost: 10_000, pool: 'other', concurrent: 2, leaseMs: 600_000 },
  read: { day: 100_000, month: 1_000_000, cost: 20, pool: 'other', concurrent: 0, leaseMs: 0 },
  write: {
    day: MONTHLY_WRITE_BYTES,
    month: MONTHLY_WRITE_BYTES,
    cost: 0,
    pool: 'build',
    concurrent: 0,
    leaseMs: 0,
  },
} as const;
export type BudgetKind = keyof typeof POLICIES;
export type BudgetState = {
  initialized: boolean;
  month: string;
  day: string;
  hour: string;
  hourly: Record<string, number>;
  spent: number;
  pools: Record<string, number>;
  monthly: Record<string, number>;
  daily: Record<string, number>;
  storedBytes: number;
  disabled: BudgetKind[];
  staticOnly: boolean;
  telemetryReady: boolean;
};
export function freshBudget(now: number): BudgetState {
  const date = new Date(now).toISOString();
  return {
    initialized: false,
    month: date.slice(0, 7),
    day: date.slice(0, 10),
    hour: date.slice(0, 13),
    hourly: {},
    spent: BASE_RESERVE,
    pools: {},
    monthly: {},
    daily: {},
    storedBytes: 0,
    disabled: [],
    staticOnly: false,
    telemetryReady: false,
  };
}
export function rollBudget(state: BudgetState, now: number): BudgetState {
  const fresh = freshBudget(now);
  if (fresh.month !== state.month) {
    // Never assume the previous month's provider bill/storage balance was reconciled. Re-open explicitly.
    return {
      ...fresh,
      storedBytes: state.storedBytes,
      disabled: state.disabled,
      staticOnly: state.staticOnly,
      telemetryReady: state.telemetryReady,
    };
  }
  return {
    ...state,
    day: fresh.day,
    daily: fresh.day === state.day ? state.daily : {},
    hour: fresh.hour,
    hourly: fresh.hour === state.hour ? state.hourly : {},
  };
}
export function evaluateBudget(state: BudgetState, kind: BudgetKind, units: number): string | null {
  const p = POLICIES[kind];
  if (!Object.hasOwn(POLICIES, kind) || !p || !Number.isSafeInteger(units) || units < 1) return 'invalid';
  if (!state.initialized) return 'uninitialized';
  if (state.staticOnly || state.disabled.includes(kind)) return 'paused';
  if (state.spent >= 35 * USD && ['build', 'moderation', 'jev', 'card', 'telemetry'].includes(kind))
    return 'reduced';
  if (kind === 'telemetry' && !state.telemetryReady) return 'provider-limit-unverified';
  if ((state.daily[kind] ?? 0) + units > p.day || (state.monthly[kind] ?? 0) + units > p.month)
    return 'quota';
  if ((kind === 'build' || kind === 'card') && (state.hourly[kind] ?? 0) + units > 60) return 'hourly-quota';
  if (state.spent + p.cost * units > STOP_AT) return 'monthly-budget';
  if (p.pool === 'ai' && (state.daily.$ai ?? 0) + p.cost * units > USD) return 'daily-ai-budget';
  const poolLimit = p.pool === 'other' ? 5 * USD : 10 * USD;
  if ((state.pools[p.pool] ?? 0) + p.cost * units > poolLimit) return 'feature-budget';
  if (kind === 'write' && state.storedBytes + units > MAX_STORED_BYTES) return 'storage';
  return null;
}
export function debitBudget(state: BudgetState, kind: BudgetKind, units: number): BudgetState {
  const p = POLICIES[kind];
  return {
    ...state,
    spent: state.spent + p.cost * units,
    pools: { ...state.pools, [p.pool]: (state.pools[p.pool] ?? 0) + p.cost * units },
    daily: {
      ...state.daily,
      [kind]: (state.daily[kind] ?? 0) + units,
      $ai: (state.daily.$ai ?? 0) + (p.pool === 'ai' ? p.cost * units : 0),
    },
    hourly: { ...state.hourly, [kind]: (state.hourly[kind] ?? 0) + units },
    monthly: { ...state.monthly, [kind]: (state.monthly[kind] ?? 0) + units },
    storedBytes: state.storedBytes + (kind === 'write' ? units : 0),
  };
}
