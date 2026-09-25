import { expect, test } from 'vitest';
import { PHYSICS_NAME } from '../src/index.ts';

test('scaffold exports', () => {
  expect(PHYSICS_NAME).toBe('@wwm/physics');
});
