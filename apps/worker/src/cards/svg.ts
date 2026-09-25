/**
 * Share cards (Phase 18): the drawings. `cardSvg(data, fonts, assets)` → a 1200×630 SVG that resvg rasterises.
 * Pure: no I/O, no Worker types; everything that varies comes in through `CardData` (+ art loaded by the caller).
 *
 * Visual language (from apps/web/src/ui/game.css): #F8F8F8 fog-white sky over the COLOR_TRIANGLE pastel facets,
 * the WORLD WIDE MAZE wordmark with each letter in a 2013 colour role, white chamfered (cut-corner) plates, ink
 * #20262D, Unbounded for display and Figtree for text. The stage art is the maze itself: islands raised to their
 * levels with blue sides, the page screenshot on their tops, green bridges, yellow rails, teal items, the ball
 * and the goal beam. Sized for the smallest unfurl (≈ 550 px wide on LinkedIn/X): nothing important under 26 px.
 */
import { LARGE_SCORE, SMALL_SCORE, TIME_SCORE } from '@wwm/schema';
import { CARD_H, CARD_W, type CardData, DIFFICULTY_LABEL, type StageArt, type StageInfo } from './data.ts';
import type { FontMetrics } from './font.ts';
import { hostColor, monogram } from './journey.ts';
import { ellipsize, escapeXml, fit, fmtInt, measure } from './text.ts';

export interface CardFonts {
  /** Unbounded Black (900): wordmark, big numbers. */
  display: FontMetrics;
  /** Unbounded Bold (700): headlines. */
  bold: FontMetrics;
  /** Figtree SemiBold (600): text. */
  ui: FontMetrics;
  /** Figtree ExtraBold (800): emphasis. */
  uiBold: FontMetrics;
}

export interface CardArt {
  /** Stage geometry for the island drawing. */
  stage?: StageArt;
  /** Page picture covering exactly `stage.size` (PNG data URI) for the island tops. */
  texture?: { href: string; width: number; height: number };
  /** Curated hero shot (PNG data URI, 1200×630 engine render); wins over the island drawing. */
  hero?: string;
}

export const ROLE = {
  red: '#e0524f',
  green: '#3f9a4c',
  go: '#2e7a3a',
  blue: '#4f9fd6',
  blueDeep: '#2d6fa3',
  yellow: '#f2c230',
  teal: '#31a4ae',
  ink: '#20262d',
  ink2: '#4b555f',
  sky: '#f8f8f8',
} as const;
const LOGO_COLORS = [ROLE.blue, ROLE.red, ROLE.yellow, ROLE.green];
/** E: COLOR_TRIANGLE. */
const FACETS = ['#c2e1bf', '#8ac487', '#a5ccb0', '#acc4d0', '#cabcc3', '#dcaeb0', '#edc9b4', '#f7e29c'];

const WEIGHT = new WeakMap<FontMetrics, number>();

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** Small deterministic PRNG so the same card always gets the same facets. */
function rng(seedText: string): () => number {
  let s = 2166136261;
  for (let i = 0; i < seedText.length; i++) s = Math.imul(s ^ seedText.charCodeAt(i), 16777619) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── text ────────────────────────────────────────────────────────────────────────────────────────────

interface TextOpts {
  font: FontMetrics;
  size: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  tracking?: number;
  opacity?: number;
}

function text(x: number, y: number, s: string, o: TextOpts): string {
  const attrs = [
    `x="${n1(x)}"`,
    `y="${n1(y)}"`,
    `font-family="${escapeXml(o.font.family)}"`,
    `font-weight="${WEIGHT.get(o.font) ?? 400}"`,
    `font-size="${n1(o.size)}"`,
    `fill="${o.fill ?? ROLE.ink}"`,
  ];
  if (o.anchor && o.anchor !== 'start') attrs.push(`text-anchor="${o.anchor}"`);
  if (o.tracking) attrs.push(`letter-spacing="${n1(o.tracking * o.size)}"`);
  if (o.opacity !== undefined) attrs.push(`opacity="${o.opacity}"`);
  return `<text ${attrs.join(' ')}>${escapeXml(s)}</text>`;
}

/** A line made of runs in different faces/colours, laid out left to right from `x`. Returns svg + width. */
function runs(
  x: number,
  y: number,
  parts: { s: string; font: FontMetrics; size: number; fill?: string }[],
): { svg: string; width: number } {
  let cx = x;
  let svg = '';
  for (const p of parts) {
    // XML collapses leading/trailing spaces inside <text>: turn them into positioning
    const lead = p.s.length - p.s.trimStart().length;
    const s = p.s.trim();
    cx += lead * p.size * 0.26;
    svg += text(cx, y, s, { font: p.font, size: p.size, fill: p.fill ?? ROLE.ink });
    cx += measure(p.font, s, p.size);
  }
  return { svg, width: cx - x };
}

// ── shapes ──────────────────────────────────────────────────────────────────────────────────────────

/** Chamfered rectangle (top-left and bottom-right corners cut), the game's plate shape. */
function chamfer(x: number, y: number, w: number, h: number, c: number): string {
  return `M${n1(x + c)} ${n1(y)}H${n1(x + w)}V${n1(y + h - c)}L${n1(x + w - c)} ${n1(y + h)}H${n1(x)}V${n1(y + c)}Z`;
}

function plate(x: number, y: number, w: number, h: number, c = 22): string {
  const d = chamfer(x, y, w, h, c);
  return `<path d="${d}" fill="${ROLE.ink}" opacity="0.10" transform="translate(0 10)" filter="url(#soft)"/>
<path d="${d}" fill="#ffffff"/>`;
}

/** Low-poly field of COLOR_TRIANGLE facets (the 2013 "ocean"), faded toward the sky colour. */
function facets(seed: string, fade = 0.45): string {
  const r = rng(seed);
  const cols = 11;
  const rows = 7;
  const cw = CARD_W / (cols - 1);
  const rh = CARD_H / (rows - 1);
  const pts: [number, number][][] = [];
  for (let j = 0; j < rows; j++) {
    const row: [number, number][] = [];
    for (let i = 0; i < cols; i++) {
      const edgeX = i === 0 || i === cols - 1;
      const edgeY = j === 0 || j === rows - 1;
      row.push([
        i * cw + (edgeX ? 0 : (r() - 0.5) * cw * 0.7),
        j * rh + (edgeY ? 0 : (r() - 0.5) * rh * 0.7),
      ]);
    }
    pts.push(row);
  }
  let out = '';
  const tri = (a: [number, number], b: [number, number], c: [number, number]) => {
    const f = FACETS[Math.floor(r() * FACETS.length)] as string;
    out += `<path d="M${n1(a[0])} ${n1(a[1])}L${n1(b[0])} ${n1(b[1])}L${n1(c[0])} ${n1(c[1])}Z" fill="${f}" stroke="${f}" stroke-width="1"/>`;
  };
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const p = (pts[j] as [number, number][])[i] as [number, number];
      const q = (pts[j] as [number, number][])[i + 1] as [number, number];
      const s = (pts[j + 1] as [number, number][])[i] as [number, number];
      const t = (pts[j + 1] as [number, number][])[i + 1] as [number, number];
      if ((i + j) % 2 === 0) {
        tri(p, q, t);
        tri(p, t, s);
      } else {
        tri(p, q, s);
        tri(q, t, s);
      }
    }
  return `<g>${out}</g><rect width="${CARD_W}" height="${CARD_H}" fill="${ROLE.sky}" opacity="${fade}"/>`;
}

/** WORLD WIDE MAZE, every letter in a colour role, one line. Returns svg + width. */
function wordmark(x: number, y: number, size: number, font: FontMetrics): { svg: string; width: number } {
  const words = ['WORLD', 'WIDE', 'MAZE'];
  let k = 0;
  let cx = x;
  let fg = '';
  let shadow = '';
  const gap = size * 0.34;
  for (const w of words) {
    for (const ch of w) {
      const c = LOGO_COLORS[k++ % LOGO_COLORS.length] as string;
      fg += text(cx, y, ch, { font, size, fill: c });
      shadow += text(cx, y + size * 0.05, ch, { font, size, fill: ROLE.ink, opacity: 0.18 });
      cx += measure(font, ch, size) - size * 0.03;
    }
    cx += gap;
  }
  return { svg: shadow + fg, width: cx - gap - x };
}

/** The same wordmark stacked on three lines (the title screen lockup). */
function wordmarkStack(x: number, y: number, size: number, font: FontMetrics): string {
  let k = 0;
  let out = '';
  let sh = '';
  ['WORLD', 'WIDE', 'MAZE'].forEach((w, line) => {
    let cx = x;
    const by = y + line * size * 0.9;
    for (const ch of w) {
      const c = LOGO_COLORS[k++ % LOGO_COLORS.length] as string;
      out += text(cx, by, ch, { font, size, fill: c });
      sh += text(cx, by + size * 0.045, ch, { font, size, fill: ROLE.ink, opacity: 0.18 });
      cx += measure(font, ch, size) - size * 0.045;
    }
  });
  return sh + out;
}

/** Five diamonds (the game's difficulty stars). */
function diamonds(x: number, cy: number, n: number, size = 22): string {
  let out = '';
  for (let i = 0; i < 5; i++) {
    const cx = x + i * (size + 6) + size / 2;
    const h = size / 2;
    out += `<path d="M${n1(cx)} ${n1(cy - h)}L${n1(cx + h)} ${n1(cy)}L${n1(cx)} ${n1(cy + h)}L${n1(cx - h)} ${n1(cy)}Z" fill="${i < n ? ROLE.yellow : 'none'}" stroke="${i < n ? '#b98c12' : '#b9c0c6'}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  return out;
}

/** A chip: chamfered pill with optional coloured icon. Returns svg + width. */
function chip(
  x: number,
  y: number,
  label: string,
  fonts: CardFonts,
  o: {
    fill?: string;
    color?: string;
    icon?: 'check' | 'globe' | 'layers' | 'clock' | 'gem';
    size?: number;
  } = {},
): { svg: string; width: number } {
  const size = o.size ?? 26;
  const h = size * 1.7;
  const padX = size * 0.62;
  const iconW = o.icon ? size * 1.05 : 0;
  const w = padX * 2 + iconW + measure(fonts.uiBold, label, size);
  const fill = o.fill ?? '#eef1f3';
  const color = o.color ?? ROLE.ink;
  let icon = '';
  const ix = x + padX + size * 0.42;
  const iy = y + h / 2;
  const s = size / 24;
  if (o.icon === 'check')
    icon = `<path d="M${n1(ix - 8 * s)} ${n1(iy)}l${n1(5.5 * s)} ${n1(5.5 * s)}l${n1(10.5 * s)} ${n1(-11 * s)}" fill="none" stroke="${color}" stroke-width="${n1(3.4 * s)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  else if (o.icon === 'globe')
    icon = `<g fill="none" stroke="${color}" stroke-width="${n1(2.2 * s)}" transform="translate(${n1(ix - 12 * s)} ${n1(iy - 12 * s)}) scale(${n1(s)})"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.8 3.5 5.8 3.5 9s-1 6.2-3.5 9c-2.5-2.8-3.5-5.8-3.5-9s1-6.2 3.5-9z"/></g>`;
  else if (o.icon === 'layers')
    icon = `<g fill="none" stroke="${color}" stroke-width="${n1(2.2 * s)}" stroke-linejoin="round" transform="translate(${n1(ix - 12 * s)} ${n1(iy - 12 * s)}) scale(${n1(s)})"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></g>`;
  else if (o.icon === 'clock')
    icon = `<g fill="none" stroke="${color}" stroke-width="${n1(2.2 * s)}" stroke-linecap="round" transform="translate(${n1(ix - 12 * s)} ${n1(iy - 12 * s)}) scale(${n1(s)})"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></g>`;
  else if (o.icon === 'gem')
    icon = `<g transform="translate(${n1(ix - 11 * s)} ${n1(iy - 12 * s)}) scale(${n1(s)})"><path d="M12 2l8.7 5v10L12 22l-8.7-5V7z" fill="#3bc6d2" stroke="#206a71" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 2l3.3 7.5H8.7zM3.3 7l5.4 2.5L12 22M20.7 7l-5.4 2.5L12 22" fill="none" stroke="#e8fbfd" stroke-width="1.1"/></g>`;
  const svg = `<path d="${chamfer(x, y, w, h, size * 0.34)}" fill="${fill}"/>${icon}${text(x + padX + iconW, y + h / 2 + size * 0.36, label, { font: fonts.uiBold, size, fill: color })}`;
  return { svg, width: w };
}

// ── the maze drawing ────────────────────────────────────────────────────────────────────────────────

const LEVEL_PX = 13.5; // LEVEL_HEIGHT_M × PX_PER_METER
const SLAB_PX = 26; // island slab thickness (stage px)

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The stage as the game shows it from the map camera, simplified: a fixed oblique view (page rotated, then
 * foreshortened), islands raised to their levels. Fills `box` horizontally; tall pages run off the bottom.
 */
function mazeArt(stage: StageArt, texture: CardArt['texture'], box: Box, idp: string): string {
  const th = (-28 * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const q = 0.62;
  const W = stage.size.width;
  const H = stage.size.height;
  // unit projection, then fit
  const pr = (x: number, y: number): [number, number] => [x * cos - y * sin, q * (x * sin + y * cos)];
  const corners = [pr(0, 0), pr(W, 0), pr(0, H), pr(W, H)];
  const minX = Math.min(...corners.map((c) => c[0]));
  const maxX = Math.max(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  const maxY = Math.max(...corners.map((c) => c[1]));
  const S = Math.min((box.w * 1.08) / (maxX - minX), (box.h * 1.5) / (maxY - minY));
  const ox = box.x + box.w / 2 - (S * (minX + maxX)) / 2;
  const oy = box.y + Math.max(24, (box.h - S * (maxY - minY)) / 2) - S * minY;
  const levels = stage.islands.map((i) => i.level);
  const base = Math.min(...levels, stage.start.level);
  const lift = (level: number) => (level - base) * LEVEL_PX * S * 1.6;
  const P = (x: number, y: number, level: number): [number, number] => {
    const [px, py] = pr(x, y);
    return [ox + S * px, oy + S * py - lift(level)];
  };
  const pathOf = (ring: [number, number][], level: number) =>
    `M${ring.map(([x, y]) => P(x, y, level).map(n1).join(' ')).join('L')}Z`;
  const drop = SLAB_PX * S;

  // Depth: farther = smaller screen y at the island's centroid.
  const order = stage.islands
    .map((isl, i) => {
      const c = isl.contour.reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
      const n = Math.max(1, isl.contour.length);
      return { isl, i, depth: pr(c[0] / n, c[1] / n)[1] };
    })
    .sort((a, b) => a.isl.level - b.isl.level || a.depth - b.depth);
  const byLevel = new Map<number, typeof order>();
  for (const o of order) {
    const k = Math.round(o.isl.level * 100) / 100;
    byLevel.set(k, [...(byLevel.get(k) ?? []), o]);
  }

  // Texture: image px → stage px → screen (the lift is added per level with a translate).
  let defs = '';
  if (texture) {
    const a = (cos * S * W) / texture.width;
    const b = (q * sin * S * W) / texture.width;
    const c = (-sin * S * H) / texture.height;
    const d = (q * cos * S * H) / texture.height;
    defs += `<image id="${idp}tex" href="${texture.href}" width="${texture.width}" height="${texture.height}" preserveAspectRatio="none" transform="matrix(${[a, b, c, d, ox, oy].map((v) => v.toFixed(5)).join(' ')})"/>`;
  }

  let body = '';
  // soft shadow of the whole maze on the facets
  const shadowPts = stage.islands.map((i) => pathOf(i.contour, base)).join('');
  body += `<path d="${shadowPts}" fill="${ROLE.ink}" opacity="0.16" transform="translate(${n1(drop * 0.9)} ${n1(drop * 2.4)})" filter="url(#${idp}blur)"/>`;

  let li = 0;
  for (const [level, group] of byLevel) {
    // sides: every edge extruded straight down
    let sides = '';
    let rims = '';
    for (const { isl } of group) {
      const ring = isl.contour;
      const depth = drop;
      for (let k = 0; k < ring.length; k++) {
        const [ax, ay] = P(...(ring[k] as [number, number]), isl.level);
        const [bx, by] = P(...(ring[(k + 1) % ring.length] as [number, number]), isl.level);
        if (bx <= ax && Math.abs(by - ay) < 0.01) continue;
        sides += `M${n1(ax)} ${n1(ay)}L${n1(bx)} ${n1(by)}L${n1(bx)} ${n1(by + depth)}L${n1(ax)} ${n1(ay + depth)}Z`;
      }
      rims += pathOf(ring, isl.level) + isl.holes.map((h) => pathOf(h, isl.level)).join('');
    }
    body += `<path d="${sides}" fill="#4a97cf" stroke="#3a86be" stroke-width="0.6"/>`;
    // tops: one clip per level, the texture (or white) inside it
    const clipId = `${idp}c${li++}`;
    defs += `<clipPath id="${clipId}"><path d="${rims}" clip-rule="evenodd"/></clipPath>`;
    const rise = group[0] ? lift(group[0].isl.level) : 0;
    body += `<g clip-path="url(#${clipId})"><rect x="${box.x - 200}" y="${box.y - 400}" width="${box.w + 400}" height="${box.h + 800}" fill="#ffffff"/>${
      texture ? `<use href="#${idp}tex" transform="translate(0 ${n1(-rise)})"/>` : ''
    }</g>`;
    body += `<path d="${rims}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.2" fill-rule="evenodd"/>`;
    // rails (E: yellow)
    let rails = '';
    for (const { isl } of group)
      for (const g of isl.guardrails)
        if (g.length > 1) rails += `M${g.map(([x, y]) => P(x, y, isl.level).map(n1).join(' ')).join('L')}`;
    if (rails)
      body += `<path d="${rails}" fill="none" stroke="${ROLE.yellow}" stroke-width="${n1(Math.max(1.2, 3.2 * S))}" stroke-linecap="round" stroke-linejoin="round"/>`;
    // bridges that end on this level (E: green decks) and elevators (E: red)
    for (const br of stage.bridges) {
      if (Math.round(Math.max(br.levelA, br.levelB) * 100) / 100 !== level) continue;
      const dx = br.b[0] - br.a[0];
      const dy = br.b[1] - br.a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (br.width / 2);
      const ny = (dx / len) * (br.width / 2);
      const a1 = P(br.a[0] + nx, br.a[1] + ny, br.levelA);
      const a2 = P(br.a[0] - nx, br.a[1] - ny, br.levelA);
      const b1 = P(br.b[0] + nx, br.b[1] + ny, br.levelB);
      const b2 = P(br.b[0] - nx, br.b[1] - ny, br.levelB);
      const t = Math.max(2, 7 * S);
      const lo = (p: [number, number]) => [p[0], p[1] + t] as [number, number];
      const quad = (p: [number, number][]) => `M${p.map((v) => v.map(n1).join(' ')).join('L')}Z`;
      body += `<path d="${quad([a1, b1, lo(b1), lo(a1)])}${quad([a2, b2, lo(b2), lo(a2)])}" fill="${ROLE.go}"/>`;
      body += `<path d="${quad([a1, b1, b2, a2])}" fill="${ROLE.green}"/>`;
    }
    for (const el of stage.elevators) {
      if (Math.round(el.levelLow * 100) / 100 !== level) continue;
      const dx = el.b[0] - el.a[0];
      const dy = el.b[1] - el.a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (el.width / 2);
      const ny = (dx / len) * (el.width / 2);
      const pts = [
        P(el.a[0] + nx, el.a[1] + ny, el.levelLow),
        P(el.b[0] + nx, el.b[1] + ny, el.levelLow),
        P(el.b[0] - nx, el.b[1] - ny, el.levelLow),
        P(el.a[0] - nx, el.a[1] - ny, el.levelLow),
      ];
      body += `<path d="M${pts.map((v) => v.map(n1).join(' ')).join('L')}Z" fill="${ROLE.red}"/>`;
    }
  }

  // items (E: small teal, large energy gems)
  let small = '';
  let large = '';
  for (const it of stage.items) {
    const [x, y] = P(it.pos[0], it.pos[1], it.level);
    if (it.kind === 'small') {
      const r = Math.max(2.2, 6 * S);
      small += `M${n1(x)} ${n1(y - r * 1.9)}l${n1(r)} ${n1(r * 0.6)}v${n1(r * 1.1)}l${n1(-r)} ${n1(r * 0.6)}l${n1(-r)} ${n1(-r * 0.6)}v${n1(-r * 1.1)}Z`;
    } else {
      const r = Math.max(5, 13 * S);
      large += `<path d="M${n1(x)} ${n1(y - r * 2.4)}l${n1(r)} ${n1(r * 0.7)}v${n1(r * 1.3)}l${n1(-r)} ${n1(r * 0.7)}l${n1(-r)} ${n1(-r * 0.7)}v${n1(-r * 1.3)}Z" fill="#3bc6d2" stroke="#206a71" stroke-width="1.4" stroke-linejoin="round"/>`;
    }
  }
  if (small) body += `<path d="${small}" fill="${ROLE.teal}" stroke="#1e6c73" stroke-width="0.8"/>`;
  body += large;

  // goal beam (E: the cyan "fountain") and the ball at the start
  {
    const [gx, gy] = P(stage.goal.pos[0], stage.goal.pos[1], stage.goal.level);
    const r = Math.max(9, 26 * S);
    const hgt = Math.max(70, 320 * S);
    body += `<ellipse cx="${n1(gx)}" cy="${n1(gy)}" rx="${n1(r)}" ry="${n1(r * q)}" fill="#7fe3ee" stroke="${ROLE.teal}" stroke-width="2"/>`;
    body += `<path d="M${n1(gx - r)} ${n1(gy)}L${n1(gx - r * 0.35)} ${n1(gy - hgt)}H${n1(gx + r * 0.35)}L${n1(gx + r)} ${n1(gy)}Z" fill="url(#${idp}beam)"/>`;
  }
  {
    const [sx, sy] = P(stage.start.pos[0], stage.start.pos[1], stage.start.level);
    const r = Math.max(8, 16 * S);
    body += `<ellipse cx="${n1(sx + r * 0.3)}" cy="${n1(sy + r * 0.25)}" rx="${n1(r)}" ry="${n1(r * 0.45)}" fill="${ROLE.ink}" opacity="0.25"/>`;
    body += `<circle cx="${n1(sx)}" cy="${n1(sy - r)}" r="${n1(r)}" fill="url(#${idp}ball)" stroke="${ROLE.ink}" stroke-width="1.4"/>`;
    body += `<path d="M${n1(sx - r * 0.8)} ${n1(sy - r * 0.8)}q${n1(r * 0.8)} ${n1(r * 0.55)} ${n1(r * 1.6)} 0" fill="none" stroke="#5aa8e8" stroke-width="${n1(Math.max(1.6, r * 0.18))}" stroke-linecap="round"/>`;
  }

  defs += `<linearGradient id="${idp}side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fb4e6"/><stop offset="0.35" stop-color="#4f9fd6" stop-opacity="0.6"/><stop offset="1" stop-color="#2d6fa3" stop-opacity="0.9"/></linearGradient>`;
  defs += `<linearGradient id="${idp}beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5fe0ee" stop-opacity="0.85"/><stop offset="1" stop-color="#5fe0ee" stop-opacity="0"/></linearGradient>`;
  defs += `<radialGradient id="${idp}ball" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#d9dde1"/><stop offset="1" stop-color="#6d7680"/></radialGradient>`;
  defs += `<filter id="${idp}blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${n1(Math.max(4, 10 * S))}"/></filter>`;
  return `<defs>${defs}</defs>${body}`;
}

/**
 * Stops as a path of floating island tiles joined by green bridges, top to bottom (journeys and runs): the ball
 * waits on the first, the goal ring sits on the last, each host is written beside its island.
 */
function chainArt(hosts: string[], box: Box, fonts: CardFonts, more: number): string {
  const n = hosts.length;
  if (n === 0) return '';
  const tileW = n <= 2 ? 176 : 132;
  const hw = tileW / 2;
  const hd = tileW / 4;
  const thick = 20;
  const step = n === 1 ? 0 : Math.min(118, (box.h - 2 * hd - thick) / (n - 1 + (more > 0 ? 0.3 : 0)));
  const y0 = box.y + (box.h - (step * (n - 1) + 2 * hd + thick)) / 2 + hd;
  const pos: [number, number][] = hosts.map((_, i) => [box.x + hw + 8 + (i % 2) * 54, y0 + i * step]);
  let out = '';
  // bridges behind the tiles
  for (let i = 0; i + 1 < n; i++) {
    if (more > 0 && i === n - 2) {
      // the stops in between aren't drawn: step the last one down and leave a gap in the path
      (pos[n - 1] as [number, number])[1] += step * 0.3;
    }
    const [ax, ay] = pos[i] as [number, number];
    const [bx, by] = pos[i + 1] as [number, number];
    const w = 13;
    if (more > 0 && i === n - 2) {
      out += `<path d="M${n1(ax)} ${n1(ay)}L${n1(bx)} ${n1(by)}" stroke="${ROLE.green}" stroke-width="10" stroke-dasharray="4 12" stroke-linecap="round"/>`;
      out += text((ax + bx) / 2 - 36, (ay + by) / 2 + 8, `+${more}`, {
        font: fonts.bold,
        size: 24,
        fill: ROLE.ink2,
        anchor: 'end',
      });
      continue;
    }
    out += `<path d="M${n1(ax - w)} ${n1(ay)}L${n1(bx - w)} ${n1(by)}L${n1(bx + w)} ${n1(by)}L${n1(ax + w)} ${n1(ay)}Z" fill="${ROLE.green}"/>`;
    out += `<path d="M${n1(ax + w)} ${n1(ay)}L${n1(bx + w)} ${n1(by)}l5 3L${n1(ax + w + 5)} ${n1(ay + 3)}Z" fill="${ROLE.go}"/>`;
  }
  hosts.forEach((host, i) => {
    const [x, y] = pos[i] as [number, number];
    out += `<ellipse cx="${n1(x + 14)}" cy="${n1(y + hd + thick + 16)}" rx="${n1(hw * 0.85)}" ry="${n1(hd * 0.55)}" fill="${ROLE.ink}" opacity="0.13" filter="url(#soft)"/>`;
    out += `<path d="M${n1(x - hw)} ${n1(y)}L${n1(x)} ${n1(y + hd)}V${n1(y + hd + thick)}L${n1(x - hw)} ${n1(y + thick)}Z" fill="#5aa6dc"/>`;
    out += `<path d="M${n1(x + hw)} ${n1(y)}L${n1(x)} ${n1(y + hd)}V${n1(y + hd + thick)}L${n1(x + hw)} ${n1(y + thick)}Z" fill="${ROLE.blueDeep}"/>`;
    out += `<path d="M${n1(x)} ${n1(y - hd)}L${n1(x + hw)} ${n1(y)}L${n1(x)} ${n1(y + hd)}L${n1(x - hw)} ${n1(y)}Z" fill="#ffffff" stroke="${ROLE.yellow}" stroke-width="3" stroke-linejoin="round"/>`;
    // monogram "favicon" (as on the portal gates)
    const c = hostColor(host);
    const letter = monogram(host);
    if (i === 0) {
      const r = 17;
      out += `<ellipse cx="${n1(x + 4)}" cy="${n1(y + 3)}" rx="${r}" ry="${n1(r * 0.4)}" fill="${ROLE.ink}" opacity="0.25"/>`;
      out += `<circle cx="${n1(x)}" cy="${n1(y - r + 2)}" r="${r}" fill="url(#ballg)" stroke="${ROLE.ink}" stroke-width="1.4"/>`;
      out += `<path d="M${n1(x - r * 0.8)} ${n1(y - r * 0.8)}q${n1(r * 0.8)} ${n1(r * 0.55)} ${n1(r * 1.6)} 0" fill="none" stroke="#5aa8e8" stroke-width="3" stroke-linecap="round"/>`;
    } else if (i === n - 1 && n > 1) {
      out += `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="30" ry="15" fill="#7fe3ee" stroke="${ROLE.teal}" stroke-width="2.5"/>`;
      out += `<path d="M${n1(x - 30)} ${n1(y)}L${n1(x - 11)} ${n1(y - 70)}H${n1(x + 11)}L${n1(x + 30)} ${n1(y)}Z" fill="url(#beamg)"/>`;
    } else {
      out += `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="26" ry="13" fill="${c}"/>`;
      out += text(x, y + 7, letter, { font: fonts.display, size: 19, fill: '#ffffff', anchor: 'middle' });
    }
    // host beside the island
    const lx = x + hw + 16;
    const room = box.x + box.w - lx - 24;
    const fitted = fit(fonts.uiBold, host, { sizes: [27, 25, 23, 21], maxW: room, maxLines: 1 });
    const size = fitted.size;
    const label = ellipsize(fonts.uiBold, host, size, room);
    const lw = measure(fonts.uiBold, label, size) + 28;
    out += `<path d="${chamfer(lx, y - 22, lw, 46, 9)}" fill="#ffffff"/>`;
    out += text(lx + 14, y + 10, label, { font: fonts.uiBold, size, fill: ROLE.ink });
  });
  return out;
}

// ── cards ───────────────────────────────────────────────────────────────────────────────────────────

const PLATE = { x: 44, y: 44, w: 620, h: 542 };
const PAD = 44;
const INNER_W = PLATE.w - PAD * 2;

function frame(seed: string, inner: string, extraDefs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
<defs><filter id="soft" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="12"/></filter>
<radialGradient id="ballg" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#d9dde1"/><stop offset="1" stop-color="#6d7680"/></radialGradient>
<linearGradient id="beamg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5fe0ee" stop-opacity="0.85"/><stop offset="1" stop-color="#5fe0ee" stop-opacity="0"/></linearGradient>${extraDefs}</defs>
<rect width="${CARD_W}" height="${CARD_H}" fill="${ROLE.sky}"/>
${facets(seed)}
${inner}
</svg>`;
}

/** The art panel of a stage/score card: the hero shot, or the maze drawn from the stage. */
function stageArt(art: CardArt, box: Box): string {
  if (art.hero)
    return `<defs><clipPath id="heroclip"><path d="${chamfer(box.x, box.y, box.w, box.h, 26)}"/></clipPath></defs>
<path d="${chamfer(box.x, box.y, box.w, box.h, 26)}" fill="${ROLE.ink}" opacity="0.12" transform="translate(0 10)" filter="url(#soft)"/>
<image href="${art.hero}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroclip)"/>`;
  if (art.stage) return mazeArt(art.stage, art.texture, box, 'm');
  return '';
}

function siteLine(stage: StageInfo): string {
  return stage.title || stage.host;
}

function footer(fonts: CardFonts, site: string, y = PLATE.y + PLATE.h - PAD + 4): string {
  return text(PLATE.x + PAD, y, site, { font: fonts.uiBold, size: 24, fill: ROLE.ink2 });
}

function metaChips(stage: StageInfo, fonts: CardFonts, y: number): string {
  let x = PLATE.x + PAD;
  let out = '';
  if (stage.stars !== null && stage.stars > 0) {
    out += diamonds(x, y + 22, stage.stars, 24);
    x += 5 * 30 + 18;
  } else {
    const c = chip(x, y, DIFFICULTY_LABEL[stage.difficulty], fonts, { size: 24 });
    out += c.svg;
    x += c.width + 12;
  }
  if (stage.slice.count > 1) {
    const c = chip(x, y, `Stage ${stage.slice.index + 1} of ${stage.slice.count}`, fonts, {
      icon: 'layers',
      size: 24,
    });
    out += c.svg;
  }
  return out;
}

function stageCard(stage: StageInfo, fonts: CardFonts, art: CardArt, site: string): string {
  const artBox: Box = art.hero ? { x: 600, y: 70, w: 560, h: 490 } : { x: 672, y: 0, w: 528, h: CARD_H };
  let inner = stageArt(art, artBox);
  inner += plate(PLATE.x, PLATE.y, PLATE.w, PLATE.h);
  const x = PLATE.x + PAD;
  inner += wordmark(x, PLATE.y + PAD + 24, 30, fonts.display).svg;
  // headline: Play “<title>” as a maze
  const name = siteLine(stage);
  const quoted = stage.title ? `“${name}”` : name;
  const head = fit(fonts.bold, `Play ${quoted} as a maze`, {
    sizes: [62, 56, 50, 46, 42, 38],
    maxW: INNER_W,
    maxLines: 3,
  });
  const lh = head.size * 1.14;
  // headline, host and chips as one group, centred between the wordmark and the footer
  // the host chip only when the headline is the title (else it would repeat the headline)
  const showHost = Boolean(stage.host && stage.title);
  const hostH = showHost ? 44 + 18 : 0;
  const groupH = lh * head.lines.length - (lh - head.size) + 30 + hostH + 41;
  const regionTop = PLATE.y + 104;
  const regionBottom = PLATE.y + PLATE.h - PAD - 44;
  const top = regionTop + Math.max(0, (regionBottom - regionTop - groupH) / 2);
  head.lines.forEach((l, i) => {
    inner += text(x, top + head.size * 0.8 + i * lh, l, {
      font: fonts.bold,
      size: head.size,
      fill: ROLE.ink,
      tracking: -0.02,
    });
  });
  const hostY = top + lh * head.lines.length - (lh - head.size) + 30;
  if (showHost)
    inner += chip(x - 2, hostY, ellipsize(fonts.uiBold, stage.host, 26, INNER_W - 60), fonts, {
      icon: 'globe',
      size: 26,
      fill: '#e6f2fb',
      color: ROLE.blueDeep,
    }).svg;
  inner += metaChips(stage, fonts, hostY + hostH);
  inner += footer(fonts, `Tilt your phone to roll · ${site}`);
  return frame(stage.stageId, inner);
}

function scoreCard(
  d: Extract<CardData, { kind: 'score' }>,
  fonts: CardFonts,
  art: CardArt,
  site: string,
): string {
  const artBox: Box = art.hero ? { x: 600, y: 70, w: 560, h: 490 } : { x: 672, y: 0, w: 528, h: CARD_H };
  let inner = stageArt(art, artBox);
  inner += plate(PLATE.x, PLATE.y, PLATE.w, PLATE.h);
  const x = PLATE.x + PAD;
  inner += wordmark(x, PLATE.y + PAD + 24, 30, fonts.display).svg;
  // "<name> scored"
  const nameSize = 34;
  const name = ellipsize(fonts.bold, d.name, nameSize, INNER_W - measure(fonts.uiBold, ' scored', 32));
  const who = runs(x, PLATE.y + 142, [
    { s: name, font: fonts.bold, size: nameSize },
    { s: ' scored', font: fonts.uiBold, size: 32, fill: ROLE.ink2 },
  ]);
  inner += who.svg;
  // the number
  const num = fmtInt(d.score);
  const big = fit(fonts.display, num, {
    sizes: [150, 136, 124, 112, 100],
    maxW: INNER_W,
    maxLines: 1,
    tracking: -0.03,
  });
  inner += text(x - 4, PLATE.y + 142 + 20 + big.size * 0.78, big.lines[0] ?? num, {
    font: fonts.display,
    size: big.size,
    fill: ROLE.go,
    tracking: -0.03,
  });
  const afterNum = PLATE.y + 142 + 20 + big.size * 0.78;
  // "on <site> — can you beat it?"
  const where = d.stage.title ? `“${d.stage.title}”` : d.stage.host;
  const part = d.stage.slice.count > 1 ? `, stage ${d.stage.slice.index + 1} of ${d.stage.slice.count}` : '';
  const on = fit(fonts.uiBold, `on ${where}${part}. Can you beat it?`, {
    sizes: [32, 30, 28],
    maxW: INNER_W,
    maxLines: 2,
  });
  on.lines.forEach((l, i) => {
    inner += text(x, afterNum + 50 + i * on.size * 1.2, l, {
      font: fonts.uiBold,
      size: on.size,
      fill: ROLE.ink,
    });
  });
  // badges
  let bx = x - 2;
  const by = PLATE.y + PLATE.h - PAD - 100;
  const rank = chip(bx, by, `#${fmtInt(d.rank)} on this stage`, fonts, {
    size: 26,
    fill: ROLE.ink,
    color: '#ffffff',
  });
  inner += rank.svg;
  bx += rank.width + 12;
  if (d.verified) {
    const v = chip(bx, by, 'Replay verified', fonts, {
      size: 26,
      fill: '#dff3f5',
      color: '#1e6c73',
      icon: 'check',
    });
    if (bx + v.width <= PLATE.x + PLATE.w - PAD + 6) inner += v.svg;
  }
  // Verified: the items are the re-simulation's own (they must match exactly); the accepted score may differ from
  // the simulated time bonus by the server's ±3 s tolerance, so the seconds shown are the ones that make up the
  // score on the card.
  let detail = `Finished in ${fmtClock(d.timeMs)}`;
  if (d.detail) {
    const items = d.detail.small * SMALL_SCORE + d.detail.large * LARGE_SCORE;
    const secs = Math.max(0, Math.round((d.score - items) / TIME_SCORE));
    detail = `${d.detail.large} large · ${d.detail.small} small · ${secs} s left`;
  }
  inner += text(x, by + 84, `${detail} · ${site}`, { font: fonts.uiBold, size: 24, fill: ROLE.ink2 });
  return frame(`${d.stage.stageId}${d.scoreId}`, inner);
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function runCard(d: Extract<CardData, { kind: 'run' }>, fonts: CardFonts, site: string): string {
  let inner = chainArt(
    d.hosts.slice(0, 4),
    { x: 686, y: 40, w: 500, h: 550 },
    fonts,
    Math.max(0, d.sites - 4),
  );
  inner += plate(PLATE.x, PLATE.y, PLATE.w, PLATE.h);
  const x = PLATE.x + PAD;
  inner += wordmark(x, PLATE.y + PAD + 24, 30, fonts.display).svg;
  const name = ellipsize(fonts.bold, d.name, 34, INNER_W);
  inner += text(x, PLATE.y + 142, name, { font: fonts.bold, size: 34 });
  // "#3" big, the # in a colour role
  const rank = fmtInt(d.rank);
  const big = fit(fonts.display, `#${rank}`, {
    sizes: [170, 150, 130, 110],
    maxW: INNER_W * 0.62,
    maxLines: 1,
  });
  const by = PLATE.y + 150 + big.size * 0.8;
  const hashW = measure(fonts.display, '#', big.size);
  inner += text(x - 4, by, '#', { font: fonts.display, size: big.size, fill: ROLE.yellow });
  inner += text(x - 4 + hashW, by, rank, {
    font: fonts.display,
    size: big.size,
    fill: ROLE.ink,
    tracking: -0.02,
  });
  const rx = x - 4 + measure(fonts.display, `#${rank}`, big.size) + 18;
  const label = fit(fonts.bold, 'on the World Wide Maze leaderboard', {
    sizes: [30, 26, 24],
    maxW: PLATE.x + PLATE.w - PAD - rx,
    maxLines: 3,
  });
  const ly = by - big.size * 0.62 + label.size * 0.5;
  label.lines.forEach((l, i) => {
    inner += text(rx, ly + i * label.size * 1.2, l, { font: fonts.bold, size: label.size, fill: ROLE.ink2 });
  });
  const pts = runs(x, by + 76, [
    { s: fmtInt(d.total), font: fonts.display, size: 44, fill: ROLE.go },
    { s: ' points', font: fonts.uiBold, size: 34 },
  ]);
  inner += pts.svg;
  const across = `across ${d.sites} ${d.sites === 1 ? 'site' : 'sites'}${d.stages > d.sites ? `, ${d.stages} stages` : ''}`;
  inner += text(x, by + 124, across, { font: fonts.uiBold, size: 30, fill: ROLE.ink2 });
  inner += footer(fonts, `Can you beat it? · ${site}`);
  return frame(`run${d.scoreId}`, inner);
}

function journeyCard(d: Extract<CardData, { kind: 'journey' }>, fonts: CardFonts, site: string): string {
  let inner = chainArt(d.hosts, { x: 640, y: 40, w: 540, h: 550 }, fonts, d.more);
  inner += plate(PLATE.x, PLATE.y, 560, PLATE.h);
  const x = PLATE.x + PAD;
  const w = 560 - PAD * 2;
  inner += wordmark(x, PLATE.y + PAD + 24, 28, fonts.display).svg;
  const title = d.name ? `${d.name}’s web journey` : 'A web journey';
  const head = fit(fonts.bold, title, { sizes: [56, 50, 44, 40, 36], maxW: w, maxLines: 2 });
  head.lines.forEach((l, i) => {
    inner += text(x, PLATE.y + 168 + i * head.size * 1.14, l, {
      font: fonts.bold,
      size: head.size,
      tracking: -0.02,
    });
  });
  const y0 = PLATE.y + 168 + head.lines.length * head.size * 1.14 + 20;
  const stops = d.hosts.length + d.more;
  const first = d.hosts[0] ?? '';
  const last = d.hosts[d.hosts.length - 1] ?? '';
  const line = stops > 1 ? `${stops} sites, link by link, from ${first} to ${last}` : `Started at ${first}`;
  const c = fit(fonts.uiBold, line, { sizes: [30, 28, 26], maxW: w, maxLines: 3 });
  c.lines.forEach((l, i) => {
    inner += text(x, y0 + i * c.size * 1.25, l, { font: fonts.uiBold, size: c.size, fill: ROLE.ink2 });
  });
  if (d.total !== null) {
    const p = runs(x, PLATE.y + PLATE.h - PAD - 50, [
      { s: fmtInt(d.total), font: fonts.display, size: 44, fill: ROLE.go },
      { s: ' points', font: fonts.uiBold, size: 32 },
    ]);
    inner += p.svg;
  }
  inner += footer(fonts, `Roll across the web · ${site}`);
  return frame(`j${d.hosts.join('|')}`, inner);
}

function siteCard(fonts: CardFonts, art: CardArt, site: string): string {
  let inner = art.stage ? mazeArt(art.stage, art.texture, { x: 660, y: 0, w: 540, h: CARD_H }, 's') : '';
  inner += `<rect x="0" y="0" width="720" height="${CARD_H}" fill="url(#fadeL)"/>`;
  inner += wordmarkStack(56, 170, 112, fonts.display);
  inner += plate(56, 402, 590, 150, 18);
  inner += text(84, 462, 'Turn any website into a 3D maze.', { font: fonts.uiBold, size: 32 });
  inner += text(84, 504, 'Steer the ball with your phone.', {
    font: fonts.uiBold,
    size: 32,
    fill: ROLE.ink2,
  });
  inner += text(56, 596, `A tribute to the 2013 Chrome Experiment · ${site}`, {
    font: fonts.uiBold,
    size: 22,
    fill: ROLE.ink2,
  });
  return frame(
    'site',
    inner,
    `<linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="${ROLE.sky}" stop-opacity="0.7"/><stop offset="0.8" stop-color="${ROLE.sky}" stop-opacity="0.35"/><stop offset="1" stop-color="${ROLE.sky}" stop-opacity="0"/></linearGradient>`,
  );
}

/**
 * The SVG for a card. `site` is the host the card advertises (e.g. `wwm.ewj.dev`); it is part of the data the
 * caller hashes, so previews and production never share a cached card.
 */
export function cardSvg(data: CardData, fonts: CardFonts, art: CardArt, site: string): string {
  WEIGHT.set(fonts.display, 900);
  WEIGHT.set(fonts.bold, 700);
  WEIGHT.set(fonts.ui, 600);
  WEIGHT.set(fonts.uiBold, 800);
  switch (data.kind) {
    case 'stage':
      return stageCard(data.stage, fonts, art, site);
    case 'score':
      return scoreCard(data, fonts, art, site);
    case 'run':
      return runCard(data, fonts, site);
    case 'journey':
      return journeyCard(data, fonts, site);
    case 'site':
      return siteCard(fonts, art, site);
  }
}
