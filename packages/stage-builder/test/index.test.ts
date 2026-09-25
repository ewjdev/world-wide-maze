import { expect, test } from 'vitest';
import { STAGE_BUILDER_VERSION } from '../src/index.ts';

test('scaffold exports', () => {
  expect(STAGE_BUILDER_VERSION).toBe('0.0.0');
});
