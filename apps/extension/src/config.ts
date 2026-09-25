/**
 * Where the game lives. The build bakes in a default (`WWM_GAME_ORIGIN`, else the local dev server); the popup
 * can switch to another origin, which Chrome then asks the player to allow (optional host permission).
 */
declare const __WWM_GAME_ORIGIN__: string | undefined;

export const DEV_ORIGIN = 'http://localhost:5173';
export const DEFAULT_ORIGIN: string =
  typeof __WWM_GAME_ORIGIN__ === 'string' && __WWM_GAME_ORIGIN__ ? __WWM_GAME_ORIGIN__ : DEV_ORIGIN;

/** localStorage key in the popup (the extension needs no `storage` permission). */
export const ORIGIN_KEY = 'wwm.gameOrigin';

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

/**
 * Parse what the player typed into a game origin. https is required, except on loopback (the dev server).
 * Returns null for anything else.
 */
export function parseOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && LOOPBACK.test(u.hostname)) return u.origin;
  return null;
}

/** The host-permission match pattern for an origin (patterns carry no port). */
export function originPattern(origin: string): string {
  const u = new URL(origin);
  return `${u.protocol}//${u.hostname}/*`;
}

/** The receiver page for a capture. */
export function receiverUrl(origin: string): string {
  return `${origin}/play/local?via=extension`;
}
