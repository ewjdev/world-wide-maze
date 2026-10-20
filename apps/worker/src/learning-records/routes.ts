/**
 * `/api/learning/*` (Phase 31 M3, contracts §10.5 CCR-31-3): parent accounts, child devices and progress sync.
 *
 * Rules every handler here follows:
 * - Gate: `LEARNING_ACCOUNTS` off (or missing bindings) → every path is `404 LEARNING_UNAVAILABLE`.
 * - Privacy: no request body, email, nickname, token or id is ever logged; nothing here sends telemetry; every
 *   response is `Cache-Control: no-store`.
 * - CSRF: a mutating request that carries the session cookie, or that would set one, must come from an allowed
 *   origin (the `Origin` header). Device requests authenticate with a bearer token, which a browser never
 *   attaches on its own.
 * - Isolation: every family-scoped read or write goes to the `FamilyRecords` object named by the family id that
 *   the session or device token resolved to; ids from the request never pick the family.
 */
import {
  CONSENT_VERSION,
  type EventBatchResponse,
  emailSignInSchema,
  emailVerifySchema,
  evidenceSchema,
  type FamilyExport,
  type LearningErrorCode,
  type LearningEvidence,
  MAX_EVENTS_PER_BATCH,
  type PairClaimResponse,
  pairClaimSchema,
  profileIdSchema,
  profileSchema,
  type SessionResponse,
} from '@wwm/learning';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env.ts';
import { BodyTooLargeError, readJsonCapped } from '../security.ts';
import { Accounts, type DeviceRow } from './accounts.ts';
import { emailAllowed, hasBindings, type LearningConfig, learningConfig } from './config.ts';
import { consentNeededMessage, mockMailbox, sendMail, signInMessage } from './mailer.ts';
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from './passkeys.ts';
import { sha256Hex } from './tokens.ts';
import { verifyTurnstile } from './turnstile.ts';

export const SESSION_COOKIE = 'wwm_learning_session';
const SMALL_BODY = 16 * 1024;
const EVENTS_BODY = 256 * 1024;
/** Sign-in emails per address per hour (on top of the per-IP limit), so nobody can flood a mailbox. */
const EMAILS_PER_HOUR = 5;

type Auth =
  | { as: 'parent'; familyId: string; sessionToken: string }
  | { as: 'device'; familyId: string; device: DeviceRow };

interface LearningVars {
  learning: { config: LearningConfig; accounts: Accounts };
}
type LearningEnv = { Bindings: Env; Variables: AppEnv['Variables'] & LearningVars };
type C = Context<LearningEnv>;

const STATUS: Record<LearningErrorCode, 400 | 401 | 403 | 404 | 413 | 429 | 503> = {
  LEARNING_UNAVAILABLE: 404,
  LEARNING_AUTH_REQUIRED: 401,
  LEARNING_FORBIDDEN: 403,
  LEARNING_NOT_FOUND: 404,
  LEARNING_INVALID: 400,
  LEARNING_RATE_LIMITED: 429,
};

function fail(
  code: LearningErrorCode,
  message: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return Response.json(
    { code, message },
    { status: init.status ?? STATUS[code], headers: { 'cache-control': 'no-store', ...init.headers } },
  );
}

// ── cookies, origins, bodies ────────────────────────────────────────────────────────────────────────────────

function cookieToken(c: C): string | null {
  const header = c.req.header('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = rest.join('=');
      return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
    }
  }
  return null;
}

function setSessionCookie(c: C, token: string, expiresAt: number): void {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  c.header(
    'set-cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api/learning; Max-Age=${maxAge}`,
    { append: true },
  );
}
function clearSessionCookie(c: C): void {
  c.header(
    'set-cookie',
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/learning; Max-Age=0`,
    {
      append: true,
    },
  );
}

/** Same-origin check for cookie-bearing (or cookie-setting) requests. */
function originAllowed(c: C, config: LearningConfig): boolean {
  const origin = c.req.header('origin');
  if (!origin) return false;
  const self = new URL(c.req.url);
  if (origin === self.origin || config.origins.includes(origin)) return true;
  // `pnpm dev`: Vite proxies /api from its own loopback port.
  return (
    config.development &&
    /^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(origin) &&
    ['localhost', '127.0.0.1'].includes(self.hostname)
  );
}

class InvalidBody extends Error {}

async function body(c: C, max = SMALL_BODY): Promise<unknown> {
  try {
    const value = await readJsonCapped(c.req.raw, max);
    if (value === null) throw new InvalidBody();
    return value;
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw new InvalidBody();
    throw e;
  }
}

async function limited(limiter: RateLimit, key: string): Promise<boolean> {
  const r = await limiter.limit({ key }).catch(() => ({ success: false }));
  return !r.success;
}
const rateLimited = () =>
  fail('LEARNING_RATE_LIMITED', 'Too many tries. Wait a minute and try again.', {
    headers: { 'retry-after': '60' },
  });

// ── auth ────────────────────────────────────────────────────────────────────────────────────────────────────

async function parent(c: C): Promise<Extract<Auth, { as: 'parent' }> | null> {
  const token = cookieToken(c);
  if (!token) return null;
  const session = await c.get('learning').accounts.session(token);
  if (!session) {
    clearSessionCookie(c);
    return null;
  }
  if (session.rolled) setSessionCookie(c, token, session.expiresAt);
  return { as: 'parent', familyId: session.familyId, sessionToken: token };
}

async function device(c: C): Promise<Extract<Auth, { as: 'device' }> | null> {
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(c.req.header('authorization') ?? '');
  if (!match?.[1]) return null;
  const row = await c.get('learning').accounts.device(match[1]);
  return row ? { as: 'device', familyId: row.family_id, device: row } : null;
}

/** Parent session first (it can do everything a device can), then a device token. */
async function anyAuth(c: C): Promise<Auth | null> {
  return (await parent(c)) ?? (await device(c));
}

const records = (c: C, familyId: string) => c.env.FAMILY_RECORDS.getByName(familyId);

async function sessionResponse(c: C, auth: Auth | null): Promise<SessionResponse> {
  if (!auth) return { signedIn: false };
  const { accounts } = c.get('learning');
  const family = await accounts.parent(auth.familyId);
  if (!family) return { signedIn: false };
  const [profiles, passkeys] = await Promise.all([
    records(c, auth.familyId).listProfiles(),
    accounts.passkeyCount(auth.familyId),
  ]);
  return {
    signedIn: true,
    as: auth.as,
    family: { id: family.id, profiles, passkeys, consentVersion: family.consent_version },
    ...(auth.as === 'device' ? { device: { id: auth.device.id, label: auth.device.label } } : {}),
  };
}

async function startSession(c: C, familyId: string): Promise<Response> {
  const { accounts } = c.get('learning');
  const session = await accounts.createSession(familyId);
  setSessionCookie(c, session.token, session.expiresAt);
  return c.json(await sessionResponse(c, { as: 'parent', familyId, sessionToken: session.token }), 200);
}

// ── the sub-app ─────────────────────────────────────────────────────────────────────────────────────────────

export const learningRoutes = new Hono<LearningEnv>();

learningRoutes.onError((err, c) => {
  if (err instanceof InvalidBody) return fail('LEARNING_INVALID', 'That request was not valid.');
  // Never the message: it could echo request data. The route pattern has no ids in it.
  console.error(
    JSON.stringify({
      level: 'error',
      svc: 'wwm-learning',
      msg: 'unhandled',
      route: c.req.routePath,
      method: c.req.method,
      error: err instanceof Error ? err.name : 'unknown',
    }),
  );
  return fail('LEARNING_UNAVAILABLE', 'Something went wrong. Try again in a moment.', { status: 500 });
});

learningRoutes.use('*', async (c, next) => {
  const config = learningConfig(c.env);
  if (config.gate === 'off' || !hasBindings(c.env))
    return fail('LEARNING_UNAVAILABLE', 'Family accounts are not available here yet.');
  c.set('learning', { config, accounts: new Accounts(c.env.LEARNING_DB) });
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
  // CSRF: the cookie rides along on any same-site request, so cookie requests must come from our own pages.
  // Sign-in endpoints set the cookie, so they are held to the same rule (no login CSRF).
  const setsSession = /\/auth\/(email\/verify|passkey\/login\/verify)$/.test(c.req.path);
  if (mutating && (cookieToken(c) || setsSession) && !originAllowed(c, config))
    return fail('LEARNING_FORBIDDEN', 'This request must come from the World Wide Maze Learning pages.');
  // Per-IP limits on sign-in and pairing.
  if (
    mutating &&
    (c.req.path.startsWith('/api/learning/auth/') || c.req.path === '/api/learning/devices/claim') &&
    (await limited(c.env.LEARNING_AUTH_LIMITER, `learning-auth:${c.get('ip')}`))
  )
    return rateLimited();
  await next();
  c.res.headers.set('cache-control', 'no-store');
});

learningRoutes.get('/session', async (c) => c.json(await sessionResponse(c, await anyAuth(c))));

// ── email sign-in ───────────────────────────────────────────────────────────────────────────────────────────

learningRoutes.post('/auth/email', async (c) => {
  const { config, accounts } = c.get('learning');
  const parsed = emailSignInSchema.safeParse(await body(c));
  if (!parsed.success) return fail('LEARNING_INVALID', 'Enter a valid email address.');
  if (!config.turnstileSecret)
    return fail('LEARNING_UNAVAILABLE', 'Sign-in by email is not set up here yet.', { status: 503 });
  const human = await verifyTurnstile(
    config.turnstileSecret,
    parsed.data.turnstile,
    c.req.header('cf-connecting-ip') ?? null,
    config.development,
  );
  if (!human) return fail('LEARNING_FORBIDDEN', 'The “are you human” check didn’t pass. Try again.');
  const { email, consent } = parsed.data;
  const origin = config.linkOrigin ?? new URL(c.req.url).origin;
  // Everything that depends on whether the account exists happens after the response, so the answer and its
  // timing are the same for every address (no account enumeration).
  c.executionCtx.waitUntil(
    (async () => {
      if (!emailAllowed(config, email)) return;
      const hit = await c.env.LIMITER.getByName(`learning-mail:${await sha256Hex(email)}`).hit(
        EMAILS_PER_HOUR,
        3600_000,
      );
      if (!hit.ok) return;
      const existing = await accounts.parentByEmail(email);
      if (!existing && !consent) {
        await sendMail(c.env, config, consentNeededMessage(email, `${origin}/learn/account/`));
        return;
      }
      const token = await accounts.createLink(email, Boolean(consent));
      await sendMail(
        c.env,
        config,
        signInMessage(email, `${origin}/learn/account/verify#token=${token}`, !existing),
      );
    })().catch((err: unknown) =>
      console.error(
        JSON.stringify({
          level: 'error',
          svc: 'wwm-learning',
          msg: 'sign-in email failed',
          error: err instanceof Error ? err.name : 'unknown',
        }),
      ),
    ),
  );
  return c.json({}, 202);
});

learningRoutes.post('/auth/email/verify', async (c) => {
  const { config, accounts } = c.get('learning');
  const parsed = emailVerifySchema.safeParse(await body(c));
  const used = parsed.success ? await accounts.consumeLink(parsed.data.token) : null;
  if (!used) return fail('LEARNING_INVALID', 'This link has expired or was already used. Ask for a new one.');
  if (!emailAllowed(config, used.email))
    return fail('LEARNING_FORBIDDEN', 'Family accounts are open to invited families only for now.');
  let family = await accounts.parentByEmail(used.email);
  if (!family) {
    if (used.consent_version !== CONSENT_VERSION)
      return fail('LEARNING_INVALID', 'Agree to the privacy notice to create a family account.');
    family = await accounts.createParent(used.email, CONSENT_VERSION);
  } else if (used.consent_version === CONSENT_VERSION && family.consent_version !== CONSENT_VERSION) {
    await accounts.recordConsent(family.id, CONSENT_VERSION);
  }
  return startSession(c, family.id);
});

// ── passkeys ────────────────────────────────────────────────────────────────────────────────────────────────

const passkeysOff = () =>
  fail('LEARNING_UNAVAILABLE', 'Passkeys are not set up here yet. Sign in by email instead.', {
    status: 503,
  });

learningRoutes.post('/auth/passkey/register/options', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  const { config, accounts } = c.get('learning');
  const family = await accounts.parent(auth.familyId);
  if (!family) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  if ((await accounts.passkeyCount(family.id)) >= 10)
    return fail('LEARNING_INVALID', 'This family already has the most passkeys allowed.');
  const options = await registrationOptions({ config, accounts }, family);
  return options ? c.json(options) : passkeysOff();
});

learningRoutes.post('/auth/passkey/register/verify', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  const { config, accounts } = c.get('learning');
  if (!config.rpId || !config.origins.length) return passkeysOff();
  const ok = await verifyRegistration({ config, accounts }, auth.familyId, await body(c));
  if (!ok) return fail('LEARNING_INVALID', 'That passkey could not be added. Try again.');
  return c.json(await sessionResponse(c, auth));
});

learningRoutes.post('/auth/passkey/login/options', async (c) => {
  const { config, accounts } = c.get('learning');
  const options = await authenticationOptions({ config, accounts });
  return options ? c.json(options) : passkeysOff();
});

learningRoutes.post('/auth/passkey/login/verify', async (c) => {
  const { config, accounts } = c.get('learning');
  if (!config.rpId || !config.origins.length) return passkeysOff();
  const familyId = await verifyAuthentication({ config, accounts }, await body(c));
  const family = familyId ? await accounts.parent(familyId) : null;
  if (!family) return fail('LEARNING_AUTH_REQUIRED', 'That passkey didn’t work. Sign in by email instead.');
  if (!emailAllowed(config, family.email))
    return fail('LEARNING_FORBIDDEN', 'Family accounts are open to invited families only for now.');
  return startSession(c, family.id);
});

learningRoutes.post('/auth/signout', async (c) => {
  const token = cookieToken(c);
  if (token) await c.get('learning').accounts.deleteSession(token);
  clearSessionCookie(c);
  return c.body(null, 204);
});

// ── profiles ────────────────────────────────────────────────────────────────────────────────────────────────

learningRoutes.get('/profiles', async (c) => {
  const auth = await anyAuth(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  return c.json({ profiles: await records(c, auth.familyId).listProfiles() });
});

learningRoutes.post('/profiles', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  const parsed = profileSchema.safeParse(await body(c));
  if (!parsed.success) return fail('LEARNING_INVALID', 'Check the nickname and avatar.');
  const r = await records(c, auth.familyId).putProfile(parsed.data, 'upsert');
  if (!r.ok) return fail('LEARNING_INVALID', 'A family can have up to 12 children here.');
  return c.json(parsed.data, r.created ? 201 : 200);
});

learningRoutes.patch('/profiles/:id', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  const id = c.req.param('id');
  if (!profileIdSchema.safeParse(id).success) return fail('LEARNING_NOT_FOUND', 'No such profile.');
  const changes = await body(c);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes))
    return fail('LEARNING_INVALID', 'Check the nickname and avatar.');
  const stub = records(c, auth.familyId);
  const current = await stub.getProfile(id);
  if (!current) return fail('LEARNING_NOT_FOUND', 'No such profile.');
  const merged: Record<string, unknown> = { ...current, ...changes, id };
  if (merged.ageBand === null) delete merged.ageBand; // `null` clears the optional age band
  const parsed = profileSchema.safeParse(merged);
  if (!parsed.success) return fail('LEARNING_INVALID', 'Check the nickname and avatar.');
  await stub.putProfile(parsed.data, 'update');
  return c.json(parsed.data);
});

learningRoutes.delete('/profiles/:id', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  const id = c.req.param('id');
  if (!profileIdSchema.safeParse(id).success) return fail('LEARNING_NOT_FOUND', 'No such profile.');
  const r = await records(c, auth.familyId).deleteProfile(id);
  return r.deleted ? c.body(null, 204) : fail('LEARNING_NOT_FOUND', 'No such profile.');
});

// ── devices ─────────────────────────────────────────────────────────────────────────────────────────────────

learningRoutes.post('/devices/pair-code', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  return c.json(await c.get('learning').accounts.createPairCode(auth.familyId), 201);
});

learningRoutes.post('/devices/claim', async (c) => {
  const parsed = pairClaimSchema.safeParse(await body(c));
  if (!parsed.success)
    return fail('LEARNING_INVALID', 'Enter the 6-character code shown on the grown-up’s screen.');
  const claimed = await c
    .get('learning')
    .accounts.claimPairCode(parsed.data.code, parsed.data.label ?? 'Child’s device');
  if (claimed === 'full')
    return fail('LEARNING_INVALID', 'This family already has the most devices allowed.');
  if (!claimed)
    return fail('LEARNING_INVALID', 'That code didn’t work. Codes last 10 minutes and work once.');
  const response: PairClaimResponse = { token: claimed.token, device: claimed.device };
  return c.json(response, 201);
});

learningRoutes.get('/devices', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  return c.json({ devices: await c.get('learning').accounts.devices(auth.familyId) });
});

learningRoutes.delete('/devices/:id', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  const ok = await c.get('learning').accounts.revokeDevice(auth.familyId, c.req.param('id'));
  return ok ? c.body(null, 204) : fail('LEARNING_NOT_FOUND', 'No such device.');
});

// ── events ──────────────────────────────────────────────────────────────────────────────────────────────────

learningRoutes.post('/events', async (c) => {
  const auth = await anyAuth(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  if (await limited(c.env.LEARNING_EVENTS_LIMITER, `learning-events:${auth.familyId}`)) return rateLimited();
  const raw = await body(c, EVENTS_BODY);
  const list = raw && typeof raw === 'object' && 'events' in raw ? raw.events : undefined;
  if (
    !Array.isArray(list) ||
    list.length < 1 ||
    list.length > MAX_EVENTS_PER_BATCH ||
    Object.keys(raw as object).length !== 1
  )
    return fail('LEARNING_INVALID', `Send between 1 and ${MAX_EVENTS_PER_BATCH} events.`);
  const valid: LearningEvidence[] = [];
  const invalid: EventBatchResponse['rejected'] = [];
  for (const item of list) {
    const parsed = evidenceSchema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
    else {
      const id =
        item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' ? item.id : '';
      invalid.push({ id: id.slice(0, 64), code: 'INVALID' });
    }
  }
  const result: EventBatchResponse = valid.length
    ? await records(c, auth.familyId).appendEvents(valid)
    : { accepted: 0, duplicate: 0, rejected: [] };
  result.rejected.push(...invalid);
  return c.json(result);
});

learningRoutes.get('/events', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in as the grown-up to see progress.');
  const profile = c.req.query('profile') || undefined;
  const cursor = c.req.query('cursor') || undefined;
  if (profile && !/^[A-Za-z0-9_-]{8,64}$/.test(profile)) return fail('LEARNING_INVALID', 'Unknown profile.');
  if (cursor && !/^[A-Za-z0-9_-]{1,256}$/.test(cursor)) return fail('LEARNING_INVALID', 'Invalid cursor.');
  return c.json(
    await records(c, auth.familyId).eventPage({
      ...(profile ? { profile } : {}),
      ...(cursor ? { cursor } : {}),
    }),
  );
});

// ── export and delete ───────────────────────────────────────────────────────────────────────────────────────

learningRoutes.get('/export', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  const { accounts } = c.get('learning');
  const family = await accounts.parent(auth.familyId);
  if (!family) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  const [{ profiles, events }, devices] = await Promise.all([
    records(c, family.id).exportAll(),
    accounts.devices(family.id),
  ]);
  const exported: FamilyExport = {
    format: 'wwm-learning-family-export/1',
    exportedAt: new Date().toISOString(),
    family: {
      id: family.id,
      createdAt: family.created_at,
      consentVersion: family.consent_version,
      consentAt: family.consent_at,
      email: family.email,
    },
    profiles,
    devices,
    events,
  };
  c.header('content-disposition', 'attachment; filename="wwm-learning-family-export.json"');
  return c.json(exported);
});

/** Deletes everything a family has: records first (so a failure leaves the account to retry), then D1. */
export async function deleteFamily(env: Env, family: { id: string; email: string }): Promise<void> {
  await env.FAMILY_RECORDS.getByName(family.id).destroy();
  await new Accounts(env.LEARNING_DB).deleteFamily(family);
}

learningRoutes.delete('/family', async (c) => {
  const auth = await parent(c);
  if (!auth) return fail('LEARNING_AUTH_REQUIRED', 'Sign in first.');
  const family = await c.get('learning').accounts.parent(auth.familyId);
  if (family) await deleteFamily(c.env, family);
  clearSessionCookie(c);
  return c.body(null, 204);
});

// ── development only ────────────────────────────────────────────────────────────────────────────────────────

/** The mock mailbox (LEARNING_EMAIL_MODE=mock, WWM_ENV=development): what the e2e test signs in with. */
learningRoutes.get('/dev/mailbox', async (c) => {
  const { config } = c.get('learning');
  if (!config.development || config.email.mode !== 'mock') return fail('LEARNING_NOT_FOUND', 'Not found.');
  const to = (c.req.query('to') ?? '').trim().toLowerCase();
  return c.json({ messages: to ? await mockMailbox(c.env, to) : [] });
});

learningRoutes.all('*', () => fail('LEARNING_NOT_FOUND', 'Not found.'));
