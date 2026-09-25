/**
 * Room routes (Phase 06, contracts §7):
 * - `POST /api/rooms` → `{code}`: a random unused 6-digit code (retries on collision).
 * - `GET /api/rooms/:code/ws?role=host|controller` → WebSocket upgrade, forwarded to the Room DO.
 * - `GET /api/rooms/:code/stats` → relay diagnostics (dev / device verification; additive, see CCR).
 *   Phase 12 (contracts v0.2.3): only when the `ROOM_STATS` var is "1" (local dev and tests); 404 otherwise,
 *   so staging and production never expose it.
 * - Phase 12 abuse caps: room creation and WebSocket upgrades are rate limited per client IP through the
 *   `ROOM_CREATE_LIMITER` / `ROOM_WS_LIMITER` Rate Limiting bindings (when bound; the unit tests omit them).
 *
 * No `cloudflare:*` imports, so this runs under plain Vitest with a fake `ROOM` namespace.
 */
import type { CreateRoomResponse } from '@wwm/schema';
import { clientIp, crossSiteRefused, isCrossSite } from '../security.ts';

export const ROOM_CODE_ATTEMPTS = 12;
const CODE_RE = /^\d{6}$/;

/** What we need from the ROOM binding (`DurableObjectNamespace<Room>` in production). */
export interface RoomNamespaceLike {
  idFromName(name: string): unknown;
  get(id: never): { claim(code: string): Promise<boolean>; fetch(req: Request): Promise<Response> };
}

/** 6 digits, 100000–999999 (no leading zero, so it reads and types unambiguously). */
export function randomRoomCode(random: () => number = cryptoRandom): string {
  return String(100000 + Math.floor(random() * 900000));
}

function cryptoRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] ?? 0) / 0x1_0000_0000;
}

export interface RoomsRouteOptions {
  random?: () => number;
}

/** The subset of the Rate Limiting binding we use. */
export interface RateLimiterLike {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface RoomsEnv {
  ROOM: unknown;
  /** "1" enables `GET /api/rooms/:code/stats` (dev/test only). */
  ROOM_STATS?: string;
  ROOM_CREATE_LIMITER?: RateLimiterLike;
  ROOM_WS_LIMITER?: RateLimiterLike;
}

const rateLimited = () =>
  Response.json(
    { code: 'RATE_LIMITED', message: 'too many requests, try again in a minute' },
    { status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store' } },
  );

async function allowed(limiter: RateLimiterLike | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  return (await limiter.limit({ key })).success;
}

export async function handleRooms(
  request: Request,
  env: RoomsEnv,
  opts: RoomsRouteOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/rooms')) return null;
  const ns = env.ROOM as RoomNamespaceLike;
  const stub = (code: string) => ns.get(ns.idFromName(code) as never);
  const ip = clientIp(request);

  if (url.pathname === '/api/rooms' || url.pathname === '/api/rooms/') {
    if (request.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405 });
    if (isCrossSite(request)) return crossSiteRefused();
    if (!(await allowed(env.ROOM_CREATE_LIMITER, `room-create:${ip}`))) return rateLimited();
    for (let i = 0; i < ROOM_CODE_ATTEMPTS; i++) {
      const code = randomRoomCode(opts.random);
      if (await stub(code).claim(code)) {
        return Response.json({ code } satisfies CreateRoomResponse);
      }
    }
    return Response.json({ error: 'no free room code, try again' }, { status: 503 });
  }

  const m = /^\/api\/rooms\/([^/]+)\/(ws|stats)$/.exec(url.pathname);
  if (!m) return Response.json({ error: 'not found' }, { status: 404 });
  const [, code = '', action] = m;
  if (!CODE_RE.test(code)) return Response.json({ error: 'room code must be 6 digits' }, { status: 400 });
  if (request.method !== 'GET') return Response.json({ error: 'method not allowed' }, { status: 405 });
  if (action === 'stats' && env.ROOM_STATS !== '1')
    return Response.json({ error: 'not found' }, { status: 404 });
  if (action === 'ws') {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('expected a WebSocket upgrade', { status: 426 });
    if (!(await allowed(env.ROOM_WS_LIMITER, `room-ws:${ip}`))) return rateLimited();
  }
  return stub(code).fetch(request);
}
