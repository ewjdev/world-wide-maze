/**
 * Shared UI atoms, drawn in the world's own grammar: faceted (chamfered) shapes, the four 2013 colour roles
 * (red elevators, green bridges, blue island sides, yellow rails) and the teal item colour.
 */
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PRACTICE } from '../game/catalog.ts';
import type { Game } from '../game/game.ts';

/** Site titles as shown to players: the built-in practice stage uses the localized E name. */
export function useSiteTitle(): (title: string | undefined) => string {
  const { t } = useTranslation();
  return (title) => (title === PRACTICE.title ? t('select.practice') : (title ?? ''));
}

export const ROLE = {
  red: '#e0524f',
  green: '#3f9a4c',
  blue: '#4f9fd6',
  yellow: '#f2c230',
  teal: '#31a4ae',
  ink: '#20262d',
} as const;

const LOGO_COLORS = [ROLE.blue, ROLE.red, ROLE.yellow, ROLE.green];

/** The wordmark: three words, each letter a colour role, set in Unbounded. */
export function Logo({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const words = ['WORLD', 'WIDE', 'MAZE'];
  let k = 0;
  return (
    <h1 className={`wwm-logo wwm-logo--${size}`} aria-label="World Wide Maze">
      {words.map((w) => (
        <span className="wwm-logo__word" key={w} aria-hidden="true">
          {[...w].map((ch, i) => {
            const c = LOGO_COLORS[k++ % LOGO_COLORS.length];
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static wordmark letters
              <span key={i} className="wwm-logo__ch" style={{ color: c, animationDelay: `${k * 45}ms` }}>
                {ch}
              </span>
            );
          })}
        </span>
      ))}
    </h1>
  );
}

type IconName =
  | 'phone'
  | 'keyboard'
  | 'sound'
  | 'mute'
  | 'globe'
  | 'map'
  | 'retry'
  | 'search'
  | 'exit'
  | 'play'
  | 'share'
  | 'arrow'
  | 'back'
  | 'close'
  | 'link'
  | 'trophy'
  | 'sliders';

const PATHS: Record<IconName, ReactNode> = {
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7 14h10" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.8 3.5 5.8 3.5 9s-1 6.2-3.5 9c-2.5-2.8-3.5-5.8-3.5-9s1-6.2 3.5-9z" />
    </>
  ),
  map: <path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20" />,
  retry: <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5.5 5.5" />
    </>
  ),
  exit: <path d="M14 4.5H6.5v15H14M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" />,
  play: <path d="M8 5l11 7-11 7z" />,
  share: (
    <>
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="M8.7 10.8l6.6-3.6M8.7 13.2l6.6 3.6" />
    </>
  ),
  arrow: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  back: <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  link: (
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  ),
  trophy: (
    <path d="M7.5 4h9v4.5a4.5 4.5 0 0 1-9 0zM7.5 6H4v1.5A3.5 3.5 0 0 0 7.5 11M16.5 6H20v1.5a3.5 3.5 0 0 1-3.5 3.5M12 13v4M8 20h8M9.5 17h5" />
  ),
  sliders: <path d="M5 4v16M12 4v16M19 4v16M3 15h4M10 8h4M17 13h4" />,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="wwm-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The ball as a life icon (chrome shell with the blue core seam). */
export function BallIcon({ lost = false, size = 26 }: { lost?: boolean; size?: number }) {
  return (
    <svg
      className={`wwm-ball${lost ? ' is-lost' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="wwm-ball-shell" cx="38%" cy="32%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#d9dde1" />
          <stop offset="1" stopColor="#6d7680" />
        </radialGradient>
      </defs>
      <circle
        cx="16"
        cy="16"
        r="13"
        fill={lost ? 'none' : 'url(#wwm-ball-shell)'}
        stroke={lost ? '#b9c0c6' : '#20262d'}
        strokeWidth={lost ? 2 : 1.4}
        strokeDasharray={lost ? '3 3' : undefined}
      />
      {!lost && (
        <path
          d="M4.5 18.5c5 3 18 3 23 0"
          fill="none"
          stroke="#5aa8e8"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** Large item: a faceted icosahedron silhouette (shape cue, not only colour). */
export function GemIcon({ size = 18, dim = false }: { size?: number; dim?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={dim ? 'wwm-gem is-dim' : 'wwm-gem'}
    >
      <path
        d="M12 2l8.7 5v10L12 22l-8.7-5V7z"
        fill={dim ? 'none' : '#3bc6d2'}
        stroke="#206a71"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {!dim && (
        <path
          d="M12 2l3.3 7.5H8.7zM3.3 7l5.4 2.5L12 22M20.7 7l-5.4 2.5L12 22"
          fill="none"
          stroke="#e8fbfd"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function SmallItemIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"
        fill="#31a4ae"
        stroke="#1e6c73"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Stars({ n, label }: { n: number; label: string }) {
  return (
    <span className="wwm-stars" role="img" aria-label={label}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 .8l5.2 5.2L6 11.2.8 6z" className={i < n ? 'on' : 'off'} />
        </svg>
      ))}
    </span>
  );
}

/** Replaces the 2013 `__POWER__` / `__JUMP__` / `__MENU__` / key placeholders with drawn key caps. */
export function Glyphs({ text }: { text: string }) {
  const parts = text.split(/(__[A-Z_]+__)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^__([A-Z_]+)__$/.exec(p);
        if (!m) return p;
        const k = m[1];
        // biome-ignore lint/suspicious/noArrayIndexKey: stable split of a static string
        if (k === 'ARROW_KEY') return <ArrowKeys key={i} />;
        const label = k === 'SPACE_KEY' ? 'SPACE' : k === 'M_KEY' ? 'M' : k;
        const role = k === 'POWER' ? 'power' : k === 'JUMP' ? 'jump' : k === 'MENU' ? 'menu' : 'key';
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable split of a static string
          <kbd key={i} className={`wwm-cap wwm-cap--${role}`}>
            {label}
          </kbd>
        );
      })}
    </>
  );
}

const ARROW_ROT = { up: 0, left: 270, down: 180, right: 90 } as const;
function ArrowCap({ dir }: { dir: keyof typeof ARROW_ROT }) {
  return (
    <kbd className="wwm-cap wwm-cap--key">
      <svg width="0.8em" height="0.8em" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M6 2v8M2.5 5.5L6 2l3.5 3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={`rotate(${ARROW_ROT[dir]} 6 6)`}
        />
      </svg>
    </kbd>
  );
}

function ArrowKeys() {
  return (
    <span className="wwm-arrows" role="img" aria-label="arrow keys">
      <ArrowCap dir="up" />
      <span>
        <ArrowCap dir="left" />
        <ArrowCap dir="down" />
        <ArrowCap dir="right" />
      </span>
    </span>
  );
}

/**
 * The 2013 orientation indicator (E: a ring with three coloured dots at bottom-left). Driven from the
 * game's tilt readout every animation frame, outside React's render path.
 */
export function TiltRing({ game, size = 112, big = false }: { game: Game; size?: number; big?: boolean }) {
  const marker = useRef<SVGGElement>(null);
  const ring = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = game.tilt();
      const clampR = (v: number) => Math.max(-1.6, Math.min(1.6, v));
      const x = clampR(t.x) * 40;
      const y = -clampR(t.z) * 40;
      marker.current?.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      if (ring.current) {
        ring.current.dataset.power = t.power ? '1' : '0';
        ring.current.dataset.warn = t.tooTilted ? '1' : '0';
        ring.current.dataset.x = t.x.toFixed(3);
        ring.current.dataset.z = t.z.toFixed(3);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game]);
  return (
    <svg
      ref={ring}
      className={`wwm-tiltring${big ? ' is-big' : ''}`}
      width={size}
      height={size}
      viewBox="-60 -60 120 120"
      role="img"
      aria-label="tilt"
      data-testid="tilt-ring"
    >
      <circle r="52" className="wwm-tiltring__disc" />
      <circle r="40" className="wwm-tiltring__limit" />
      <path d="M-52 0H52M0 -52V52" className="wwm-tiltring__cross" />
      <g className="wwm-tiltring__dots">
        <circle cx="0" cy="-4.5" r="3.6" fill={ROLE.red} />
        <circle cx="-4" cy="2.4" r="3.6" fill={ROLE.blue} />
        <circle cx="4" cy="2.4" r="3.6" fill={ROLE.yellow} />
      </g>
      <g ref={marker}>
        <circle r="11" className="wwm-tiltring__marker" />
      </g>
    </svg>
  );
}

/** A triangle-tile field in the COLOR_TRIANGLE pastels (E palette), used as the panel "material". */
export function Facets({ seed = 1, className = '' }: { seed?: number; className?: string }) {
  const cols = ['#c2e1bf', '#8ac487', '#a5ccb0', '#acc4d0', '#cabcc3', '#dcaeb0', '#edc9b4', '#f7e29c'];
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const tris: ReactNode[] = [];
  const W = 12;
  const H = 4;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const x = c * 10;
      const y = r * 10;
      const a = cols[Math.floor(rnd() * cols.length)];
      const b = cols[Math.floor(rnd() * cols.length)];
      const flip = (r + c) % 2 === 0;
      tris.push(
        <path
          key={`${r}-${c}-a`}
          d={flip ? `M${x} ${y}h10L${x} ${y + 10}z` : `M${x} ${y}h10v10z`}
          fill={a}
        />,
        <path key={`${r}-${c}-b`} d={flip ? `M${x + 10} ${y}v10H${x}z` : `M${x} ${y}v10h10z`} fill={b} />,
      );
    }
  }
  return (
    <svg
      className={`wwm-facets ${className}`}
      viewBox={`0 0 ${W * 10} ${H * 10}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {tris}
    </svg>
  );
}
