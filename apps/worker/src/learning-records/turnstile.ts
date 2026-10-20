/**
 * Turnstile siteverify (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
 * In development the documented test secrets answer locally (always pass / always fail), so `pnpm dev` and the
 * integration tests need no network. `learningConfig` never lets a deployed Worker use a test secret.
 */
import { TURNSTILE_TEST_SECRET_FAIL, TURNSTILE_TEST_SECRET_PASS } from './config.ts';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
  development: boolean,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (development && secret === TURNSTILE_TEST_SECRET_PASS) return token.length > 0;
  if (development && secret === TURNSTILE_TEST_SECRET_FAIL) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);
  form.append('idempotency_key', crypto.randomUUID());
  try {
    const res = await fetcher(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  }
}
