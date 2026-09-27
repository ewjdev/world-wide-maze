import type { BudgetKind } from './budget-policy.ts';
import { ServiceError } from './errors.ts';

export type BudgetEnv = Pick<Env, 'BUDGET' | 'WWM_ENV' | 'COST_CONTROLS'>;
// Negative-only cache reduces enforcement cost during a flood; never cache permission to spend.
let readDeniedUntil = 0;
export const budget = (env: Pick<Env, 'BUDGET'>) => env.BUDGET.get(env.BUDGET.idFromName('wwm-cost-v1'));
export const controlsOn = (env: Partial<BudgetEnv>) =>
  env.WWM_ENV !== 'development' || env.COST_CONTROLS === '1';
export async function reserveCost(
  env: BudgetEnv,
  kind: BudgetKind,
  id = crypto.randomUUID() as string,
  units = 1,
  replaces?: string,
) {
  if (!controlsOn(env)) return { ok: true, reason: 'local', expires: Date.now() + 600_000, id };
  // Preview namespaces are isolated. Never grant every preview a separate real-money budget.
  if (env.WWM_ENV === 'preview') return { ok: false, reason: 'preview', expires: 0, id };
  if (kind === 'read' && Date.now() < readDeniedUntil)
    return { ok: false, reason: 'paused-cache', expires: 0, id };
  try {
    const result = await budget(env).reserve(kind, id, units, replaces);
    if (kind === 'read' && !result.ok) readDeniedUntil = Date.now() + 30_000;
    return { ...result, id };
  } catch {
    return { ok: false, reason: 'unavailable', expires: 0, id };
  }
}
export async function requireCost(env: BudgetEnv, kind: BudgetKind, id?: string, units = 1): Promise<string> {
  const r = await reserveCost(env, kind, id, units);
  if (!r.ok)
    throw new ServiceError(
      'RATE_LIMITED',
      'This service is resting. You can still play the practice maze.',
      60,
    );
  return r.id;
}
export async function releaseCost(env: BudgetEnv, id: string) {
  if (controlsOn(env))
    await budget(env)
      .release(id)
      .catch(() => {}); // lease expiry is the crash fallback
}
export async function reserveWrite(env: BudgetEnv, bytes: number) {
  if (bytes > 0) await requireCost(env, 'write', undefined, bytes);
}
