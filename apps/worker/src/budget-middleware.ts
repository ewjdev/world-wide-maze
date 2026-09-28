import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './app-env.ts';
import { releaseCost, requireCost } from './budget-client.ts';
import type { BudgetKind } from './budget-policy.ts';
/** Reserve BEFORE parsing potentially large bodies; errors keep the conservative debit. */
export const paidOperation =
  (kind: BudgetKind): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const id = await requireCost(c.env, kind);
    try {
      await next();
    } finally {
      await releaseCost(c.env, id);
    }
  };
