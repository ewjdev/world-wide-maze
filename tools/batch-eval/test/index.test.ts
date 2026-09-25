import { expect, test } from 'vitest';
import { BATCH_EVAL_NAME } from '../src/index.ts';

test('scaffold exports', () => {
  expect(BATCH_EVAL_NAME).toBe('@wwm/batch-eval');
});
