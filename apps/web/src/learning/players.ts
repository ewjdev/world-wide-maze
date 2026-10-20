/**
 * Phase 31 M5 (N): who's playing a lesson in the maze, by the lesson page's rules (apps/education/src/profiles.ts
 * and lesson.ts, Phase 31 M2), against the same device store. The game is served on the lessons' origin, so this
 * is the same IndexedDB (`wwm-learning-progress`) and, in the same tab, the same remembered pick.
 *
 * - No store (no IndexedDB, a private window that refuses it, a store that doesn't answer) or no children: nobody
 *   is playing, nothing is asked and nothing is recorded.
 * - One child: chosen silently.
 * - Two or more: the child picked earlier in this tab (sessionStorage `wwm-learning.picked`, matched against the
 *   store's active profile), else the picture-only picker.
 *
 * A nickname is only ever spoken by the browser's own speech synthesis (`speakNickname`), never by the studio
 * voice, and never leaves the device.
 */
import type { Profile, ProgressStore } from '@wwm/learning';

/** How long the store may take to list profiles before the lesson plays without saving. */
export const OPEN_TIMEOUT_MS = 2500;

/** The device's profiles, in the picker's order (by nickname), or null when this browser can't keep progress. */
export async function listPlayers(
  store: ProgressStore | null,
  timeoutMs = OPEN_TIMEOUT_MS,
): Promise<Profile[] | null> {
  if (!store) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const profiles = await Promise.race([
      store.listProfiles(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The progress store did not answer.')), timeoutMs);
      }),
    ]);
    return [...profiles].sort(byName);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const byName = (x: Profile, y: Profile) =>
  x.nickname.localeCompare(y.nickname) || x.id.localeCompare(y.id);

/** Remembered for this tab: the child picked at the start of this visit (shared with the lesson page). */
export const PICKED_KEY = 'wwm-learning.picked';

export function pickedThisVisit(): string | null {
  try {
    return sessionStorage.getItem(PICKED_KEY);
  } catch {
    return null;
  }
}

export function rememberPick(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(PICKED_KEY, id);
    else sessionStorage.removeItem(PICKED_KEY);
  } catch {
    // storage unavailable: the picker shows again next time
  }
}

export type PlayerChoice =
  /** Nobody: no store or no children. Nothing is recorded. */
  | { kind: 'none' }
  /** This child plays (the only one, or the one picked earlier in this tab). */
  | { kind: 'player'; player: Profile; profiles: Profile[] }
  /** Two or more children and none picked in this tab: ask with the picker. */
  | { kind: 'ask'; profiles: Profile[] };

/**
 * Who plays, without asking. `again`: a grown-up asked to switch, so a remembered pick doesn't count. The only
 * child is also made the store's active profile, as the lesson page does.
 */
export async function choosePlayer(
  store: ProgressStore | null,
  options: { again?: boolean; timeoutMs?: number } = {},
): Promise<PlayerChoice> {
  const profiles = await listPlayers(store, options.timeoutMs);
  if (!store || !profiles?.length) return { kind: 'none' };
  const only = profiles.length === 1 ? profiles[0] : undefined;
  if (only) {
    void store.setActiveProfile(only.id).catch(() => {});
    return { kind: 'player', player: only, profiles };
  }
  if (!options.again) {
    const active = await store.activeProfile().catch(() => null);
    const picked = pickedThisVisit();
    const player = profiles.find((profile) => profile.id === active && profile.id === picked);
    if (player) return { kind: 'player', player, profiles };
  }
  return { kind: 'ask', profiles };
}

/** The child tapped their Pip: remember them for this tab and as the store's active profile. */
export function confirmPick(store: ProgressStore | null, player: Profile): void {
  rememberPick(player.id);
  void store?.setActiveProfile(player.id).catch(() => {});
}

/**
 * Say a nickname with the browser's own speech synthesis. This is the only path a nickname is spoken by: it never
 * goes through the studio-voice player, so it can't reach a voice provider.
 */
export function speakNickname(text: string): void {
  const speech = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!speech || typeof SpeechSynthesisUtterance === 'undefined') return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  speech.cancel();
  speech.speak(utterance);
}
