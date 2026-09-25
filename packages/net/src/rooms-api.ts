/** HTTP helpers for the room endpoints (contracts §7) and the v0.2.7 pairing secret (contracts §9, CCR-12-2). */
import type { CreateRoomResponse, RoomRole } from '@wwm/schema';
import { CreateRoomResponseSchema } from '@wwm/schema/zod';

export const ROOM_CODE_RE = /^\d{6}$/;
/** Room tokens are 128 random bits, base64url (contracts v0.2.7). */
export const ROOM_TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

export function isRoomCode(code: string): boolean {
  return ROOM_CODE_RE.test(code);
}

export function isRoomToken(token: unknown): token is string {
  return typeof token === 'string' && ROOM_TOKEN_RE.test(token);
}

/**
 * `POST /api/rooms` → `{code, hostToken, pairToken}`. `base` is the page origin (e.g. `location.origin`).
 * The host connects with `hostToken`; `pairToken` goes into the phone's pairing URL (fragment).
 */
export async function createRoom(base: string, fetchFn: typeof fetch = fetch): Promise<CreateRoomResponse> {
  const res = await fetchFn(new URL('/api/rooms', base), { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/rooms failed: ${res.status}`);
  const parsed = CreateRoomResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error('POST /api/rooms returned a malformed room');
  return parsed.data;
}

/** `ws(s)://<host>/api/rooms/:code/ws?role=…[&token=…]` for a page origin like `https://example.com`. */
export function roomWsUrl(base: string, code: string, role: RoomRole, token?: string | null): string {
  const u = new URL(`/api/rooms/${code}/ws`, base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('role', role);
  if (token) u.searchParams.set('token', token);
  return u.toString();
}

/**
 * The phone pairing link (contracts §6 + v0.2.7): `https://<host>/c/<code>#p=<pairToken>`. The token rides in
 * the **fragment**, so it never reaches server logs or a Referer header. Without a token: the typed-code URL.
 */
export function pairingUrl(base: string, code: string, pairToken?: string | null): string {
  const u = new URL(`/c/${code}`, base);
  if (pairToken) u.hash = `p=${pairToken}`;
  return u.toString();
}

/** Read one key from a `#a=1&b=2` fragment (with or without the leading `#`). */
function fragmentParam(hash: string, key: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get(key);
}

/** The pair token from a pairing URL's fragment (`#p=…`), or null if absent or malformed. */
export function pairTokenFromFragment(hash: string): string | null {
  const t = fragmentParam(hash, 'p');
  return isRoomToken(t) ? t : null;
}

/** Just the storage calls we need (`sessionStorage` in the browser). */
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PAIR_KEY = (code: string) => `wwm.pair.${code}`;
const HOST_KEY = (code: string) => `wwm.room.${code}`;

function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback; // private mode / storage disabled: tokens just won't persist
  }
}

/**
 * Phone side: the pair token for `code`. A token in the URL fragment wins and is remembered in `storage`
 * (sessionStorage: survives reloads and reconnects, dies with the tab); otherwise the remembered one; otherwise
 * null (the typed-code path).
 */
export function resolvePairToken(code: string, hash: string, storage?: TokenStorage | null): string | null {
  const fromUrl = pairTokenFromFragment(hash);
  if (fromUrl) {
    if (storage) safe(() => storage.setItem(PAIR_KEY(code), fromUrl), undefined);
    return fromUrl;
  }
  const stored = storage ? safe(() => storage.getItem(PAIR_KEY(code)), null) : null;
  return isRoomToken(stored) ? stored : null;
}

/** Phone side: drop a remembered pair token (e.g. after the relay refused it with 4401). */
export function forgetPairToken(code: string, storage?: TokenStorage | null): void {
  if (storage) safe(() => storage.removeItem(PAIR_KEY(code)), undefined);
}

export interface HostRoomTokens {
  hostToken: string;
  pairToken: string | null;
}

/** Host side: remember a room's tokens so a reload of `/p/<code>` can rejoin as host. */
export function rememberHostRoom(code: string, tokens: HostRoomTokens, storage?: TokenStorage | null): void {
  if (storage) safe(() => storage.setItem(HOST_KEY(code), JSON.stringify(tokens)), undefined);
}

/**
 * Host side: tokens for rejoining room `code`. The fragment `#h=<hostToken>&p=<pairToken>` wins (e.g. a link
 * the host copied to another tab); otherwise what `rememberHostRoom` stored; otherwise null.
 */
export function recallHostRoom(
  code: string,
  hash = '',
  storage?: TokenStorage | null,
): HostRoomTokens | null {
  const h = fragmentParam(hash, 'h');
  if (isRoomToken(h)) {
    const p = fragmentParam(hash, 'p');
    return { hostToken: h, pairToken: isRoomToken(p) ? p : null };
  }
  const raw = storage ? safe(() => storage.getItem(HOST_KEY(code)), null) : null;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<HostRoomTokens>;
    if (!isRoomToken(v.hostToken)) return null;
    return { hostToken: v.hostToken, pairToken: isRoomToken(v.pairToken) ? v.pairToken : null };
  } catch {
    return null;
  }
}
