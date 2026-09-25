import { expect, test } from 'vitest';
import { AI_NAME } from '../src/index.ts';

test('scaffold exports', () => {
  expect(AI_NAME).toBe('@wwm/ai');
});
