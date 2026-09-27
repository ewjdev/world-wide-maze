import { describe, expect, test } from 'vitest';
import { reserveCost } from '../src/budget-client.ts';
import {
  debitBudget,
  evaluateBudget,
  freshBudget,
  MAX_STORED_BYTES,
  rollBudget,
  USD,
} from '../src/budget-policy.ts';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const ready = () => ({ ...freshBudget(NOW), initialized: true });
describe('cost admission policy', () => {
  test('requires reconciliation, and no environment typo can opt out', async () => {
    expect(evaluateBudget(freshBudget(NOW), 'build', 1)).toBe('uninitialized');
    expect((await reserveCost({ WWM_ENV: 'production', COST_CONTROLS: '0' } as Env, 'build')).ok).toBe(false);
    expect((await reserveCost({ WWM_ENV: 'preview', COST_CONTROLS: '0' } as Env, 'build')).reason).toBe(
      'preview',
    );
    expect((await reserveCost({ WWM_ENV: 'development', COST_CONTROLS: '0' } as Env, 'build')).ok).toBe(true);
  });
  test('retains all debits, checks every dimensional cap, and stops optional work at $35', () => {
    const s = ready();
    expect(evaluateBudget({ ...s, hourly: { build: 60 } }, 'build', 1)).toBe('hourly-quota');
    expect(evaluateBudget({ ...s, daily: { build: 300 } }, 'build', 1)).toBe('quota');
    expect(evaluateBudget({ ...s, monthly: { room: 49991 } }, 'room', 10)).toBe('quota');
    expect(evaluateBudget({ ...s, pools: { ai: 10 * USD } }, 'docent', 1)).toBe('feature-budget');
    expect(evaluateBudget({ ...s, daily: { $ai: USD } }, 'moderation', 1)).toBe('daily-ai-budget');
    expect(evaluateBudget({ ...s, spent: 35 * USD }, 'build', 1)).toBe('reduced');
    expect(evaluateBudget({ ...s, spent: 40 * USD }, 'room', 10)).toBe('monthly-budget');
    expect(evaluateBudget({ ...s, storedBytes: MAX_STORED_BYTES }, 'write', 1)).toBe('storage');
    expect(evaluateBudget(s, 'telemetry', 1)).toBe('provider-limit-unverified');
    expect(evaluateBudget({ ...s, staticOnly: true }, 'read', 1)).toBe('paused');
    for (const n of [0, -1, NaN, Infinity, 0.5]) expect(evaluateBudget(s, 'build', n)).toBe('invalid');
    expect(debitBudget(s, 'build', 1).spent).toBe(s.spent + 10000);
  });
  test('UTC rollover preserves storage and switches but requires new monthly reconciliation', () => {
    const s = {
      ...ready(),
      storedBytes: 123,
      disabled: ['build' as const],
      staticOnly: true,
      daily: { read: 20 },
    };
    expect(rollBudget(s, Date.parse('2026-09-28T00:00:00Z')).daily).toEqual({});
    const next = rollBudget(s, Date.parse('2026-10-01T00:00:00Z'));
    expect(next).toMatchObject({
      initialized: false,
      spent: 5 * USD,
      storedBytes: 123,
      disabled: ['build'],
      staticOnly: true,
    });
  });
});
