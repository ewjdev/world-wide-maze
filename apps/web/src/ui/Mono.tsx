/** The monogram "favicon" tile of a site (Phase 13): its first letter on the site's portal colour. */
import type { CSSProperties } from 'react';
import { hostColor, monogram } from '../game/journey.ts';

type Style = CSSProperties & Record<`--${string}`, string>;

/** A monogram tile standing in for the site's favicon (no third-party request). */
export function Mono({ host, size = 'md' }: { host: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <span
      className={`wwm-mono wwm-mono--${size}`}
      style={{ '--pc': hostColor(host), '--pf': inkOn(hostColor(host)) } as Style}
      aria-hidden="true"
    >
      {monogram(host)}
    </span>
  );
}

/** Letter colour on a portal colour: ink on the light yellow, white elsewhere. */
function inkOn(hex: string): string {
  return hex === '#e5a810' ? '#20262d' : '#ffffff';
}
