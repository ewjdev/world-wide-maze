/** HTTP helpers for the room endpoints (contracts §7). */
import type { CreateRoomResponse, RoomRole } from '@wwm/schema';

export const ROOM_CODE_RE = /^\d{6}$/;

export function isRoomCode(code: string): boolean {
  return ROOM_CODE_RE.test(code);
}

/** `POST /api/rooms` → the new 6-digit code. `base` is the page origin (e.g. `location.origin`). */
export async function createRoom(base: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(new URL('/api/rooms', base), { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/rooms failed: ${res.status}`);
  const body = (await res.json()) as CreateRoomResponse;
  if (!isRoomCode(body.code)) throw new Error('POST /api/rooms returned a malformed code');
  return body.code;
}

/** `ws(s)://<host>/api/rooms/:code/ws?role=…` for a page origin like `https://example.com`. */
export function roomWsUrl(base: string, code: string, role: RoomRole): string {
  const u = new URL(`/api/rooms/${code}/ws`, base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('role', role);
  return u.toString();
}

/** The phone pairing link `https://<host>/c/<code>` (contracts §6). */
export function pairingUrl(base: string, code: string): string {
  return new URL(`/c/${code}`, base).toString();
}
