/** Random secrets and their stored form. Only SHA-256 digests of tokens and pair codes are ever written. */

/** Pair codes: 6 characters from A–H, J–N, P–Z and 2–9 (no I, O, 0 or 1 to misread). */
export const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256 random bits as 43 base64url characters (matches `emailVerifySchema`'s token pattern). */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** A short random id for families and devices (128 bits). */
export function randomId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

export function pairCode(): string {
  // 32 symbols divide 256 evenly, so `byte % 32` is unbiased.
  return [...crypto.getRandomValues(new Uint8Array(6))]
    .map((byte) => PAIR_ALPHABET[byte % PAIR_ALPHABET.length])
    .join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const iso = (ms: number) => new Date(ms).toISOString();
