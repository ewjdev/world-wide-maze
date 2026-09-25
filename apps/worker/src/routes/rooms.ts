/**
 * Room routes (Phase 06, contracts §7):
 * - `POST /api/rooms` → `{code}`: a random unused 6-digit code (retries on collision).
 * - `GET /api/rooms/:code/ws?role=host|controller` → WebSocket upgrade, forwarded to the Room DO.
 * - `GET /api/rooms/:code/stats` → relay diagnostics (dev / device verification; additive, see CCR).
 *
 * No `cloudflare:*` imports, so this runs under plain Vitest with a fake `ROOM` namespace.
 */
import type { CreateRoomResponse } from '@wwm/schema';

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

export async function handleRooms(
  request: Request,
  env: { ROOM: unknown },
  opts: RoomsRouteOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/rooms')) return null;
  const ns = env.ROOM as RoomNamespaceLike;
  const stub = (code: string) => ns.get(ns.idFromName(code) as never);

  if (url.pathname === '/api/rooms' || url.pathname === '/api/rooms/') {
    if (request.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405 });
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
  if (action === 'ws' && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected a WebSocket upgrade', { status: 426 });
  }
  return stub(code).fetch(request);
}
