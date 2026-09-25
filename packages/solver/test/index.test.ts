import { expect, test } from 'vitest';
import { SOLVER_NAME } from '../src/index.ts';

test('scaffold exports', () => {
  expect(SOLVER_NAME).toBe('@wwm/solver');
});
