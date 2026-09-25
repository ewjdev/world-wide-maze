import { expect, test } from 'vitest';
import { ENGINE_NAME } from '../src/index.ts';

test('scaffold exports', () => {
  expect(ENGINE_NAME).toBe('@wwm/engine');
});
