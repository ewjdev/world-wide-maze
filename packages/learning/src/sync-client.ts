/**
 * Phase 31 M3: a typed browser client for every `/api/learning/*` endpoint (contracts §10.5, CCR-31-3), and the
 * outbox sync that moves a device's evidence to the family's records.
 *
 * - The parent's session is an HttpOnly cookie the browser sends by itself (`credentials: 'same-origin'`).
 * - A paired child device sends its bearer token (from `ProgressStore.deviceToken()`, or `deviceToken`).
 * - Errors are `LearningApiError` with the server's `LEARNING_*` code, or `NETWORK` when the request never
 *   got an answer (offline).
 *
 * No analytics, no logging: this module only talks to the family's own records.
 */
import type { LearningEvidence } from './evidence.ts';
import {
  type DeviceSummary,
  type EmailSignIn,
  type EventBatchResponse,
  type EventPage,
  type FamilyExport,
  LEARNING_ERROR_CODES,
  type LearningErrorCode,
  MAX_EVENTS_PER_BATCH,
  type PairClaimResponse,
  type PairCodeResponse,
  type Profile,
  type ProgressStore,
  type SessionResponse,
} from './sync.ts';

/** (No parameter properties: this package runs under Node's strip-only TypeScript too.) */
export class LearningApiError extends Error {
  readonly status: number;
  readonly code: LearningErrorCode | 'NETWORK';
  /** From `Retry-After`, when the server sent one. */
  readonly retryAfterMs: number | undefined;
  constructor(status: number, code: LearningErrorCode | 'NETWORK', message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'LearningApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** WebAuthn option/response JSON, passed straight to and from `@simplewebauthn/browser`. */
export type WebAuthnJSON = Record<string, unknown>;

/** Changes for `PATCH /profiles/:id`; `ageBand: null` clears the age band. */
export type ProfileChanges = Partial<Omit<Profile, 'id' | 'ageBand'>> & {
  ageBand?: Profile['ageBand'] | null;
};

export interface LearningApi {
  session(): Promise<SessionResponse>;
  /** Always resolves for a well-formed request (the server answers 202 whether or not the account exists). */
  requestEmailLink(request: EmailSignIn): Promise<void>;
  verifyEmailLink(token: string): Promise<SessionResponse>;
  passkeyRegisterOptions(): Promise<WebAuthnJSON>;
  passkeyRegisterVerify(response: WebAuthnJSON): Promise<SessionResponse>;
  passkeyLoginOptions(): Promise<WebAuthnJSON>;
  passkeyLoginVerify(response: WebAuthnJSON): Promise<SessionResponse>;
  signOut(): Promise<void>;
  listProfiles(): Promise<Profile[]>;
  /** POST with the device-made id, so local evidence keeps its profile. Idempotent. */
  saveProfile(profile: Profile): Promise<Profile>;
  updateProfile(id: string, changes: ProfileChanges): Promise<Profile>;
  /** Also deletes that child's events. */
  deleteProfile(id: string): Promise<void>;
  createPairCode(): Promise<PairCodeResponse>;
  claimDevice(code: string, label?: string): Promise<PairClaimResponse>;
  listDevices(): Promise<DeviceSummary[]>;
  revokeDevice(id: string): Promise<void>;
  sendEvents(events: readonly LearningEvidence[]): Promise<EventBatchResponse>;
  eventPage(options?: { profile?: string; cursor?: string }): Promise<EventPage>;
  /** Every page, oldest first (parent only). */
  allEvents(profile?: string): Promise<LearningEvidence[]>;
  exportFamily(): Promise<FamilyExport>;
  /** Deletes the account and everything in it, then the session ends. */
  deleteFamily(): Promise<void>;
}

export interface SyncClientOptions {
  /** Default `/api/learning` (same origin as the pages). */
  base?: string;
  fetch?: typeof fetch;
  /** A paired device's token; called per request. Omit on a parent-only page. */
  deviceToken?: () => Promise<string | null> | string | null;
}

function retryAfter(res: Response): number | undefined {
  const value = res.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export function createSyncClient(options: SyncClientOptions = {}): LearningApi {
  const base = (options.base ?? '/api/learning').replace(/\/+$/, '');
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = options.deviceToken ? await options.deviceToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new LearningApiError(0, 'NETWORK', e instanceof Error ? e.message : 'Network error');
    }
    if (res.status === 204 || res.status === 202) return undefined as T;
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const error = data as { code?: unknown; message?: unknown } | null;
      const code = LEARNING_ERROR_CODES.includes(error?.code as LearningErrorCode)
        ? (error?.code as LearningErrorCode)
        : res.status === 429
          ? 'LEARNING_RATE_LIMITED'
          : res.status === 401
            ? 'LEARNING_AUTH_REQUIRED'
            : 'LEARNING_UNAVAILABLE';
      throw new LearningApiError(
        res.status,
        code,
        typeof error?.message === 'string' ? error.message : `Request failed (${res.status})`,
        retryAfter(res),
      );
    }
    return data as T;
  }

  const api: LearningApi = {
    session: () => request('GET', '/session'),
    requestEmailLink: (body) => request('POST', '/auth/email', body),
    verifyEmailLink: (token) => request('POST', '/auth/email/verify', { token }),
    passkeyRegisterOptions: () => request('POST', '/auth/passkey/register/options'),
    passkeyRegisterVerify: (response) => request('POST', '/auth/passkey/register/verify', response),
    passkeyLoginOptions: () => request('POST', '/auth/passkey/login/options'),
    passkeyLoginVerify: (response) => request('POST', '/auth/passkey/login/verify', response),
    signOut: () => request('POST', '/auth/signout'),
    listProfiles: async () => (await request<{ profiles: Profile[] }>('GET', '/profiles')).profiles,
    saveProfile: (profile) => request('POST', '/profiles', profile),
    updateProfile: (id, changes) => request('PATCH', `/profiles/${encodeURIComponent(id)}`, changes),
    deleteProfile: (id) => request('DELETE', `/profiles/${encodeURIComponent(id)}`),
    createPairCode: () => request('POST', '/devices/pair-code'),
    claimDevice: (code, label) =>
      request('POST', '/devices/claim', { code: code.trim().toUpperCase(), ...(label ? { label } : {}) }),
    listDevices: async () => (await request<{ devices: DeviceSummary[] }>('GET', '/devices')).devices,
    revokeDevice: (id) => request('DELETE', `/devices/${encodeURIComponent(id)}`),
    sendEvents: (events) => request('POST', '/events', { events }),
    eventPage: (opts = {}) => {
      const query = new URLSearchParams();
      if (opts.profile) query.set('profile', opts.profile);
      if (opts.cursor) query.set('cursor', opts.cursor);
      const qs = query.toString();
      return request('GET', `/events${qs ? `?${qs}` : ''}`);
    },
    allEvents: async (profile) => {
      const out: LearningEvidence[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 1000; page++) {
        const result = await api.eventPage({
          ...(profile ? { profile } : {}),
          ...(cursor ? { cursor } : {}),
        });
        out.push(...result.events);
        if (!result.next) break;
        cursor = result.next;
      }
      return out;
    },
    exportFamily: () => request('GET', '/export'),
    deleteFamily: () => request('DELETE', '/family'),
  };
  return api;
}

// ── outbox sync ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SyncResult {
  /**
   * `done`: the outbox holds nothing more that the server will take. `offline` / `rate-limited` / `error`:
   * stopped early; try again after `retryAfterMs`. `signed-out`: the device token or session is no longer valid.
   */
  status: 'done' | 'offline' | 'rate-limited' | 'error' | 'signed-out';
  accepted: number;
  duplicate: number;
  /** Kept in the outbox (an unknown profile may sync once its profile is uploaded). */
  rejected: EventBatchResponse['rejected'];
  retryAfterMs?: number;
}

export interface SyncOptions {
  /** Retries per stop reason before giving up for now (default 3). */
  maxRetries?: number;
  /** Backoff base (default 1 s, doubling, at most 60 s). */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Default: `navigator.onLine` when there is a navigator. */
  isOnline?: () => boolean;
}

const MAX_DELAY_MS = 60_000;

/**
 * Send the device's outbox in batches of at most `MAX_EVENTS_PER_BATCH`. Accepted and duplicate ids are
 * `markSynced`; rejected ones stay in the outbox (and are skipped for the rest of this run). Backs off on 429
 * (honouring `Retry-After`), on network failure and on server errors.
 */
export async function syncOutbox(
  store: ProgressStore,
  api: Pick<LearningApi, 'sendEvents'>,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const maxRetries = options.maxRetries ?? 3;
  const base = options.baseDelayMs ?? 1000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const online =
    options.isOnline ??
    (() =>
      typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine);
  const result: SyncResult = { status: 'done', accepted: 0, duplicate: 0, rejected: [] };
  const skip = new Set<string>();
  let attempt = 0;
  const backoff = (hint?: number) => Math.min(MAX_DELAY_MS, hint ?? base * 2 ** attempt);

  for (let round = 0; round < 10_000; round++) {
    if (!online()) return { ...result, status: 'offline', retryAfterMs: backoff() };
    const batch = (await store.outbox(MAX_EVENTS_PER_BATCH + skip.size))
      .filter((event) => !skip.has(event.id))
      .slice(0, MAX_EVENTS_PER_BATCH);
    if (!batch.length) return result;
    let response: EventBatchResponse;
    try {
      response = await api.sendEvents(batch);
    } catch (e) {
      const error = e instanceof LearningApiError ? e : new LearningApiError(0, 'NETWORK', String(e));
      if (error.status === 401 || error.status === 403) return { ...result, status: 'signed-out' };
      const status: SyncResult['status'] =
        error.status === 429 ? 'rate-limited' : error.code === 'NETWORK' ? 'offline' : 'error';
      if (error.status === 400 || error.status === 404) return { ...result, status: 'error' };
      const delay = backoff(error.retryAfterMs);
      if (attempt >= maxRetries) return { ...result, status, retryAfterMs: delay };
      attempt++;
      await sleep(delay);
      continue;
    }
    attempt = 0;
    const rejected = new Set(response.rejected.map((r) => r.id));
    const synced = batch.filter((event) => !rejected.has(event.id)).map((event) => event.id);
    if (synced.length) await store.markSynced(synced);
    for (const r of response.rejected) {
      skip.add(r.id);
      result.rejected.push(r);
    }
    result.accepted += response.accepted;
    result.duplicate += response.duplicate;
  }
  return result;
}

/**
 * After a grown-up signs in on a device with local progress: upload each local child profile with its own id
 * (so its evidence keeps pointing at it), then send the outbox. Safe to repeat (both steps are idempotent).
 */
export async function uploadLocalProgress(
  store: ProgressStore,
  api: Pick<LearningApi, 'saveProfile' | 'sendEvents'>,
  options: SyncOptions = {},
): Promise<{ profiles: number; sync: SyncResult }> {
  const profiles = await store.listProfiles();
  for (const profile of profiles) await api.saveProfile(profile);
  return { profiles: profiles.length, sync: await syncOutbox(store, api, options) };
}
