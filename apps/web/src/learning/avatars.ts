/**
 * Phase 31 M5 (N): a child's Pip avatar, drawn exactly as the lesson page draws it, so a child finds the same
 * picture in the maze. Ported from apps/education/src/profiles.ts (`AVATAR_LOOKS`, `avatarSvg`), which the game
 * can't import. CCR-31-5 (docs/build-log/phase-31-m5.md) proposes moving both into `@wwm/learning` so there is one
 * copy; until then test/learning-evidence.test.ts checks this port draws the same markup as the original.
 *
 * Trusted output: numbers, fixed colours and `spriteSvg` (validated theme colours). No document text is written,
 * so the markup is safe for `dangerouslySetInnerHTML`.
 */
import { type AVATARS, spriteSvg, type Theme } from '@wwm/learning';

export type Avatar = (typeof AVATARS)[number];
type Mark = 'circle' | 'triangle' | 'square' | 'diamond' | 'star' | 'hexagon';

/** Pip in a light shell with a darker seam, wearing a shape on an antenna: the shape tells avatars apart. */
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

/** Class names are fixed strings in the game; anything else is dropped rather than escaped. */
const safeClass = (value: string) => (/^[a-z0-9 _-]*$/i.test(value) ? value : '');

/** A Pip avatar as inline SVG. Decorative: the control around it carries the name. */
export function avatarSvg(theme: Theme, avatar: Avatar, size: number, className = ''): string {
  const look = AVATAR_LOOKS[avatar];
  const tinted: Theme = {
    ...theme,
    palette: { ...theme.palette, ballShell: look.shell, ballSeam: look.seam },
  };
  const height = Math.round(size * 1.26);
  return `<svg class="avatar ${safeClass(className)}" data-avatar="${avatar}" width="${size}" height="${height}" viewBox="0 -26 100 126" aria-hidden="true" focusable="false"><path d="M50 9V-4" stroke="#20262d" stroke-width="3" stroke-linecap="round"/>${markSvg(look.mark, look.seam)}${spriteSvg(tinted, 'pip', { x: 0, y: 0, w: 100, h: 100 })}</svg>`;
}
