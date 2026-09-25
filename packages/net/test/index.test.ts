import { expect, test } from 'vitest';
import { NET_NAME } from '../src/index.ts';

test('scaffold exports', () => {
  expect(NET_NAME).toBe('@wwm/net');
});
