import { expect, test } from 'vitest';
import { STAGE_DEBUGGER_NAME } from '../src/index.ts';

test('scaffold exports', () => {
  expect(STAGE_DEBUGGER_NAME).toBe('@wwm/stage-debugger');
});
