import { CONTRACT_VERSION } from '@wwm/schema';
import { expect, test } from 'vitest';
import { handleBasic } from '../src/router.ts';

test('/api/health reports the contract version', async () => {
  const res = handleBasic(new Request('http://localhost/api/health'));
  expect(res?.status).toBe(200);
  expect(await res?.json()).toEqual({ ok: true, contract: CONTRACT_VERSION });
});

test('unknown paths fall through', () => {
  expect(handleBasic(new Request('http://localhost/nope'))).toBeNull();
});
