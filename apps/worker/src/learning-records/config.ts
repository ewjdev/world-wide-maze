/**
 * Phase 31 M3 configuration: the one place that reads the learning-records vars and secrets. Everything fails
 * closed: a missing binding, an unknown gate value or a deployed environment without its secrets turns the
 * feature (or the affected step) off rather than on.
 */

export type GateMode = 'off' | 'allowlist' | 'on';

/** Cloudflare's documented Turnstile test secrets (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). */
export const TURNSTILE_TEST_SECRET_PASS = '1x0000000000000000000000000000000AA';
export const TURNSTILE_TEST_SECRET_FAIL = '2x0000000000000000000000000000000AA';
/** The token the always-pass test site key produces. */
export const TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** Secrets are not in the generated `Env` (they live in .dev.vars / `wrangler secret put`). */
export interface LearningSecrets {
  TURNSTILE_SECRET?: string;
  LEARNING_ALLOWED_EMAILS?: string;
}

export interface LearningConfig {
  gate: GateMode;
  development: boolean;
  /** Normalized emails allowed to sign in when `gate` is `allowlist`. */
  allowed: Set<string>;
  /** Origins allowed to make cookie-authenticated changes and to complete WebAuthn ceremonies. */
  origins: string[];
  /** The origin used in emailed links (the first configured origin). */
  linkOrigin: string | null;
  rpId: string | null;
  turnstileSecret: string | null;
  email: { mode: 'mock' | 'send' | 'none'; from: string };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Has the bindings this feature needs (M4 and others share the Env; a stripped config must not crash). */
export function hasBindings(env: Partial<Env>): boolean {
  return Boolean(env.LEARNING_DB && env.FAMILY_RECORDS);
}

export function learningConfig(env: Env): LearningConfig {
  const secrets: LearningSecrets = env as Env & LearningSecrets;
  const development = env.WWM_ENV === 'development';
  const raw = (env.LEARNING_ACCOUNTS ?? 'off').trim();
  const gate: GateMode = raw === 'on' || raw === 'allowlist' ? raw : 'off';
  const allowed = new Set(
    (secrets.LEARNING_ALLOWED_EMAILS ?? '')
      .split(',')
      .map(normalizeEmail)
      .filter((e) => e.includes('@')),
  );
  const origins = (env.LEARNING_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => /^https?:\/\/[^/\s]+$/.test(o))
    // Deployed environments only ever trust HTTPS origins.
    .filter((o) => development || o.startsWith('https://'));
  const rpId = (env.LEARNING_RP_ID ?? '').trim() || null;
  let turnstileSecret = secrets.TURNSTILE_SECRET?.trim() || null;
  if (!turnstileSecret && development) turnstileSecret = TURNSTILE_TEST_SECRET_PASS;
  // A deployed Worker must never run on a test secret (it would accept every request).
  if (
    !development &&
    (turnstileSecret === TURNSTILE_TEST_SECRET_PASS || turnstileSecret === TURNSTILE_TEST_SECRET_FAIL)
  )
    turnstileSecret = null;
  const modeRaw = env.LEARNING_EMAIL_MODE;
  const mode: LearningConfig['email']['mode'] =
    modeRaw === 'mock' && development ? 'mock' : modeRaw === 'send' && env.LEARNING_MAIL ? 'send' : 'none';
  return {
    gate,
    development,
    allowed,
    origins,
    linkOrigin: origins[0] ?? null,
    rpId,
    turnstileSecret,
    email: { mode, from: env.LEARNING_EMAIL_FROM || 'learn@wwm.ewj.dev' },
  };
}

/** May this (normalized) email sign in under the current gate? */
export function emailAllowed(config: LearningConfig, email: string): boolean {
  if (config.gate === 'on') return true;
  if (config.gate === 'allowlist') return config.allowed.has(email);
  return false;
}
