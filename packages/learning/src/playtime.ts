/** Same-origin, opt-in family playtime. This is a local prototype, not device parental control. */
export const PLAYTIME_KEY = 'wwm.playtime.v1';
export interface PlaytimeRecord {
  version: 1;
  pinHash: string;
  salt: string;
  minutes: number;
  startedAt: number;
  endsAt: number;
  stopped: boolean;
  lastSeen: number;
  accomplishments: string[];
}
export type PlaytimePhase = 'off' | 'playing' | 'closing' | 'finished' | 'unavailable';
export interface PlaytimeView {
  phase: PlaytimePhase;
  record: PlaytimeRecord | null;
}
export function decodePlaytime(raw: string | null, now: number): PlaytimeView {
  if (raw === null) return { phase: 'off', record: null };
  try {
    const r = JSON.parse(raw) as PlaytimeRecord;
    if (
      r.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(r.pinHash) ||
      !/^[a-f0-9]{32}$/.test(r.salt) ||
      ![5, 10, 15].includes(r.minutes) ||
      !Number.isFinite(r.startedAt) ||
      !Number.isFinite(r.endsAt) ||
      r.endsAt - r.startedAt !== r.minutes * 60000 ||
      !Number.isFinite(r.lastSeen) ||
      typeof r.stopped !== 'boolean' ||
      !Array.isArray(r.accomplishments) ||
      r.accomplishments.length > 20 ||
      r.accomplishments.some((x) => typeof x !== 'string' || x.length > 120)
    )
      throw Error('Invalid playtime');
    const time = Math.max(now, r.lastSeen);
    return {
      record: r,
      phase: r.stopped || time >= r.endsAt ? 'finished' : time >= r.endsAt - 60000 ? 'closing' : 'playing',
    };
  } catch {
    return { phase: 'unavailable', record: null };
  }
}
export function playtimeView(): PlaytimeView {
  if (typeof window === 'undefined') return { phase: 'off', record: null };
  try {
    return decodePlaytime(localStorage.getItem(PLAYTIME_KEY), Date.now());
  } catch {
    return { phase: 'unavailable', record: null };
  }
}
export const playtimeBlocked = () =>
  (typeof document !== 'undefined' && document.documentElement.dataset.playtimeSetup === 'true') ||
  ['finished', 'unavailable'].includes(playtimeView().phase);
export const playtimeClosing = () => playtimeView().phase === 'closing';
function write(r: PlaytimeRecord): void {
  localStorage.setItem(PLAYTIME_KEY, JSON.stringify(r));
  window.dispatchEvent(new Event('wwm-playtime'));
}
export function stopPlaytime(): void {
  const { record } = playtimeView();
  if (record) write({ ...record, stopped: true });
}
export function notePlaytime(text: string): void {
  const { record, phase } = playtimeView();
  if (!record || !['playing', 'closing'].includes(phase)) return;
  const accomplishments = [...new Set([...record.accomplishments, text.slice(0, 120)])].slice(0, 20);
  write({ ...record, accomplishments });
}
export function checkpointPlaytime(): void {
  const { record, phase } = playtimeView();
  if (record && !record.stopped)
    write({ ...record, lastSeen: Math.max(Date.now(), record.lastSeen), stopped: phase === 'finished' });
}
async function digest(pin: string, salt: string): Promise<string> {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return Array.from(new Uint8Array(data), (x) => x.toString(16).padStart(2, '0')).join('');
}
/** Existing settings require their PIN. Storage errors and corrupt settings never grant new play. */
export async function authorizePlaytime(pin: string, minutes: number): Promise<void> {
  if (!/^\d{4,8}$/.test(pin) || ![5, 10, 15].includes(minutes))
    throw Error('Use a 4–8 digit PIN and choose a playtime.');
  const before = localStorage.getItem(PLAYTIME_KEY);
  const { record, phase } = decodePlaytime(before, Date.now());
  if (phase === 'unavailable')
    throw Error('Playtime settings could not be read. Ask your grown-up to check this browser.');
  const salt =
    record?.salt ??
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
  const pinHash = await digest(pin, salt);
  if (record && pinHash !== record.pinHash) throw Error('That PIN did not match.');
  if (localStorage.getItem(PLAYTIME_KEY) !== before)
    throw Error('Settings changed in another tab. Please try again.');
  const now = Date.now();
  write({
    version: 1,
    pinHash,
    salt,
    minutes,
    startedAt: now,
    endsAt: now + minutes * 60000,
    lastSeen: now,
    stopped: false,
    accomplishments: [],
  });
}
