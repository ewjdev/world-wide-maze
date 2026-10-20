/**
 * Child profiles on this device (Phase 31 M2): Pip avatars a child can pick without reading, the progress store
 * opened so that a browser without IndexedDB (private browsing, storage off) simply saves nothing, and the one
 * place a nickname is ever spoken, through the browser's own voice (never a studio or cloud voice).
 */
import { createBrowserStore, type Profile, type ProgressStore } from '@wwm/learning';

// The avatars are shared with the maze (`@wwm/learning` avatars.ts, CCR-31-5).
export { AVATAR_LOOKS, type Avatar, avatarSvg } from '@wwm/learning';

// ── the store, failing soft ───────────────────────────────────────────────────────────────────────────────

export interface DeviceProgress {
  store: ProgressStore;
  profiles: Profile[];
}

const OPEN_TIMEOUT_MS = 2500;

/**
 * The device's progress store and its profiles, or null when this browser can't keep them (no IndexedDB, a
 * private window that refuses it, or a store that doesn't answer). Lessons then play exactly as without profiles.
 */
export async function openProgress(): Promise<DeviceProgress | null> {
  try {
    const store = createBrowserStore();
    const profiles = await Promise.race([
      store.listProfiles(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('The progress store did not answer.')), OPEN_TIMEOUT_MS),
      ),
    ]);
    return { store, profiles };
  } catch {
    return null;
  }
}

/** Remembered for this tab: the child picked at the start of this visit (the picker isn't shown again). */
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
