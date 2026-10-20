/** Phase 31 M3: learning-records configuration fails closed, and Turnstile siteverify handling. */
import { describe, expect, it, vi } from 'vitest';
import {
  emailAllowed,
  learningConfig,
  TURNSTILE_TEST_SECRET_FAIL,
  TURNSTILE_TEST_SECRET_PASS,
} from '../src/learning-records/config.ts';
import { verifyTurnstile } from '../src/learning-records/turnstile.ts';

const env = (vars: Record<string, string | undefined>, bindings: Record<string, unknown> = {}) =>
  ({ LEARNING_MAIL: {}, ...bindings, ...vars }) as unknown as Env;

describe('learningConfig', () => {
  it('defaults to off, and anything but on/allowlist is off', () => {
    expect(learningConfig(env({})).gate).toBe('off');
    expect(learningConfig(env({ LEARNING_ACCOUNTS: 'ON ' })).gate).toBe('off');
    expect(learningConfig(env({ LEARNING_ACCOUNTS: 'allowlist' })).gate).toBe('allowlist');
    expect(learningConfig(env({ LEARNING_ACCOUNTS: ' on ' })).gate).toBe('on');
  });
  it('allowlist reads the secret, normalized; off allows nobody', () => {
    const config = learningConfig(
      env({
        LEARNING_ACCOUNTS: 'allowlist',
        LEARNING_ALLOWED_EMAILS: ' A@Example.org,, b@example.org ,junk',
      }),
    );
    expect([...config.allowed]).toEqual(['a@example.org', 'b@example.org']);
    expect(emailAllowed(config, 'a@example.org')).toBe(true);
    expect(emailAllowed(config, 'c@example.org')).toBe(false);
    expect(emailAllowed({ ...config, gate: 'off' }, 'a@example.org')).toBe(false);
    expect(emailAllowed({ ...config, gate: 'on' }, 'c@example.org')).toBe(true);
  });
  it('development may use the always-pass Turnstile test secret, the mock mailbox and http origins', () => {
    const config = learningConfig(
      env({ WWM_ENV: 'development', LEARNING_EMAIL_MODE: 'mock', LEARNING_ORIGIN: 'http://localhost:5174/' }),
    );
    expect(config.turnstileSecret).toBe(TURNSTILE_TEST_SECRET_PASS);
    expect(config.email.mode).toBe('mock');
    expect(config.origins).toEqual(['http://localhost:5174']);
  });
  it('a deployed Worker never uses test secrets, mock mail or plain-HTTP origins', () => {
    for (const secret of [undefined, TURNSTILE_TEST_SECRET_PASS, TURNSTILE_TEST_SECRET_FAIL]) {
      const config = learningConfig(
        env({
          WWM_ENV: 'preview',
          TURNSTILE_SECRET: secret,
          LEARNING_EMAIL_MODE: 'mock',
          LEARNING_ORIGIN: 'http://localhost:5174,https://wwm.example',
          LEARNING_RP_ID: '',
        }),
      );
      expect(config.turnstileSecret).toBeNull();
      expect(config.email.mode).toBe('none');
      expect(config.origins).toEqual(['https://wwm.example']);
      expect(config.rpId).toBeNull();
    }
    const prod = learningConfig(
      env({ WWM_ENV: 'production', TURNSTILE_SECRET: '0x-real', LEARNING_EMAIL_MODE: 'send' }),
    );
    expect(prod.turnstileSecret).toBe('0x-real');
    expect(prod.email.mode).toBe('send');
    // `send` without the binding is no mail at all
    expect(
      learningConfig(
        env({ WWM_ENV: 'production', LEARNING_EMAIL_MODE: 'send' }, { LEARNING_MAIL: undefined }),
      ).email.mode,
    ).toBe('none');
  });
});

describe('verifyTurnstile', () => {
  it('answers the documented test secrets locally in development only', async () => {
    const fetcher = vi.fn();
    expect(
      await verifyTurnstile(TURNSTILE_TEST_SECRET_PASS, 'XXXX.DUMMY.TOKEN.XXXX', null, true, fetcher),
    ).toBe(true);
    expect(await verifyTurnstile(TURNSTILE_TEST_SECRET_FAIL, 'anything', null, true, fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('posts to siteverify and accepts only success: true; errors fail closed', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get('secret')).toBe('real-secret');
      expect(form.get('response')).toBe('tok');
      expect(form.get('remoteip')).toBe('203.0.113.9');
      return Response.json({ success: true });
    });
    expect(await verifyTurnstile('real-secret', 'tok', '203.0.113.9', false, fetcher as typeof fetch)).toBe(
      true,
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const no = vi.fn(async () => Response.json({ success: false }));
    expect(await verifyTurnstile('real-secret', 'tok', null, false, no as typeof fetch)).toBe(false);
    const down = vi.fn(async () => new Response('err', { status: 500 }));
    expect(await verifyTurnstile('real-secret', 'tok', null, false, down as typeof fetch)).toBe(false);
    const offline = vi.fn(async () => {
      throw new TypeError('network');
    });
    expect(await verifyTurnstile('real-secret', 'tok', null, false, offline as typeof fetch)).toBe(false);
  });
});
