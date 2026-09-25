/**
 * Room pairing secrets (contracts v0.2.7, CCR-12-2). Pure Web Crypto, so it runs in workerd and plain Node.
 *
 * - `POST /api/rooms` issues two 128-bit random tokens: `hostToken` (desktop) and `pairToken` (phone, carried in
 *   the pairing URL's fragment `#p=`).
 * - The Room DO stores only their SHA-256 digests and compares digests in constant time, so neither a storage
 *   read nor response timing reveals a token.
 */
import { ROOM_TOKEN_BYTES } from '@wwm/schema';

export const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh token: `ROOM_TOKEN_BYTES` (16) random bytes, base64url without padding (22 chars). */
export function newRoomToken(): string {
  const b = new Uint8Array(ROOM_TOKEN_BYTES);
  crypto.getRandomValues(b);
  return base64url(b);
}

/** SHA-256 of the token's UTF-8 bytes, base64url. What the Room DO stores instead of the token. */
export async function hashRoomToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return base64url(new Uint8Array(d));
}

/** Constant-time equality for equal-length inputs (length itself is not secret: digests are always 32 bytes). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Does `token` match the stored digest? A malformed or missing token never matches, but it is still hashed and
 * compared so the time taken doesn't depend on how the token is wrong.
 */
export async function roomTokenMatches(
  token: string | null | undefined,
  storedHash: string,
): Promise<boolean> {
  const wellFormed = typeof token === 'string' && TOKEN_RE.test(token);
  const h = await hashRoomToken(wellFormed ? token : '');
  return timingSafeEqual(h, storedHash) && wellFormed;
}
