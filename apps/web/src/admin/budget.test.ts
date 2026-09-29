import { describe, expect, test } from 'vitest';
import { type BudgetSnapshot, budgetPause } from './budget.ts';

const ready: BudgetSnapshot = {
  initialized: true,
  month: '2026-09',
  level: 'normal',
  spent: 0,
  storedBytes: 0,
  staticOnly: false,
  telemetryReady: true,
  disabled: [],
  daily: {},
  monthly: {},
};
describe('operator budget status', () => {
  test('unknown and unreconciled budgets never imply availability', () => {
    expect(budgetPause(null, 'build')).toBe('Budget status unavailable');
    expect(budgetPause({ ...ready, initialized: false }, 'jev')).toBe('Reconciliation required');
  });
  test('global and operator pauses take precedence over provider configuration', () => {
    expect(budgetPause({ ...ready, staticOnly: true, disabled: ['jev'] }, 'jev')).toBe(
      'All online services paused',
    );
    expect(budgetPause({ ...ready, disabled: ['jev'] }, 'jev')).toBe('Paused by operator');
  });
  test('monthly thresholds retain the zero-cost write boundary', () => {
    expect(budgetPause({ ...ready, spent: 35_000_000 }, 'build')).toBe('Monthly reduction reached');
    expect(budgetPause({ ...ready, spent: 35_000_000 }, 'read')).toBeNull();
    expect(budgetPause({ ...ready, spent: 40_000_000 }, 'read')).toBe('Monthly stop reached');
    expect(budgetPause({ ...ready, spent: 40_000_000 }, 'write')).toBeNull();
    expect(budgetPause({ ...ready, spent: 40_000_001 }, 'write')).toBe('Monthly stop reached');
  });
  test('analytics requires a verified provider limit independently of its switch', () => {
    expect(budgetPause({ ...ready, telemetryReady: false }, 'telemetry')).toBe('Provider limit unverified');
    expect(budgetPause(ready, 'telemetry')).toBeNull();
  });
});
