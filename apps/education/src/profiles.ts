/**
 * Child profiles on this device (Phase 31 M2): Pip avatars a child can pick without reading, the progress store
 * opened so that a browser without IndexedDB (private browsing, storage off) simply saves nothing, and the one
 * place a nickname is ever spoken, through the browser's own voice (never a studio or cloud voice).
 */
import {
  type AVATARS,
  createBrowserStore,
  type Profile,
  type ProgressStore,
  spriteSvg,
  type Theme,
} from '@wwm/learning';
import { escapeHtml } from './render.ts';

export type Avatar = (typeof AVATARS)[number];
type Mark = 'circle' | 'triangle' | 'square' | 'diamond' | 'star' | 'hexagon';

/**
 * Each avatar is Pip in a light shell with a darker seam, wearing a small shape on an antenna: the shape keeps
 * every avatar distinct without relying on colour. Shell and seam come from the WWM shape and brand colours.
 */
export const AVATAR_LOOKS: Record<Avatar, { name: string; shell: string; seam: string; mark: Mark }> = {
  'pip-blue': { name: 'Blue', shell: '#c4e1f4', seam: '#2f7fbd', mark: 'circle' },
  'pip-green': { name: 'Green', shell: '#c8e6c7', seam: '#318545', mark: 'triangle' },
  'pip-yellow': { name: 'Yellow', shell: '#f9e39a', seam: '#a47b00', mark: 'square' },
  'pip-red': { name: 'Red', shell: '#f6c9c6', seam: '#c74946', mark: 'diamond' },
  'pip-teal': { name: 'Teal', shell: '#c2eaed', seam: '#206a71', mark: 'star' },
  'pip-orange': { name: 'Orange', shell: '#f9d5ad', seam: '#b0581a', mark: 'hexagon' },
};

const ring = (count: number, radius: (i: number) => number, turn = -Math.PI / 2) =>
  Array.from({ length: count }, (_, i) => {
    const angle = turn + (i * 2 * Math.PI) / count;
    return `${(50 + radius(i) * Math.cos(angle)).toFixed(1)},${(-13 + radius(i) * Math.sin(angle)).toFixed(1)}`;
  }).join(' ');

function markSvg(mark: Mark, fill: string): string {
  const paint = `fill="${fill}" stroke="#20262d" stroke-width="2" stroke-linejoin="round"`;
  switch (mark) {
    case 'circle':
      return `<circle cx="50" cy="-13" r="9" ${paint}/>`;
    case 'triangle':
      return `<polygon points="50,-25 61,-4 39,-4" ${paint}/>`;
    case 'square':
      return `<rect x="41" y="-22" width="18" height="18" ${paint}/>`;
    case 'diamond':
      return `<polygon points="50,-25 61,-13 50,-1 39,-13" ${paint}/>`;
    case 'star':
      return `<polygon points="${ring(10, (i) => (i % 2 ? 5 : 12))}" ${paint}/>`;
    case 'hexagon':
      return `<polygon points="${ring(6, () => 11, 0)}" ${paint}/>`;
  }
}

/** A Pip avatar as inline SVG. Decorative: the control around it carries the name. */
export function avatarSvg(theme: Theme, avatar: Avatar, size: number, className = ''): string {
  const look = AVATAR_LOOKS[avatar];
  const tinted: Theme = {
    ...theme,
    palette: { ...theme.palette, ballShell: look.shell, ballSeam: look.seam },
  };
  const height = Math.round(size * 1.26);
  return `<svg class="avatar ${escapeHtml(className)}" data-avatar="${avatar}" width="${size}" height="${height}" viewBox="0 -26 100 126" aria-hidden="true" focusable="false"><path d="M50 9V-4" stroke="#20262d" stroke-width="3" stroke-linecap="round"/>${markSvg(look.mark, look.seam)}${spriteSvg(tinted, 'pip', { x: 0, y: 0, w: 100, h: 100 })}</svg>`;
}

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
