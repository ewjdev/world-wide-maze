/**
 * The trusted renderer: turns a validated theme and round into SVG markup. Every value it writes is a number,
 * a palette colour validated as hex, or escaped text it generates itself, so a document can't inject markup.
 *
 * The scene is static; consumers animate it by toggling classes on the marked elements:
 *   `[data-gem="a-2"]` → `is-lit` / `is-leftover` · `[data-pair="1"]` → `is-shown`
 *   `[data-choice-mark="b"]` → `is-correct` / `is-retry` / `is-glow` / `is-pulse` · `.pip` → `is-happy`
 * and position answer buttons over `SceneLayout.choices` boxes (viewBox units).
 */
import { type GemLayout, layoutGroup, pairUp } from './layout.ts';
import { choiceKeys } from './present.ts';
import {
  choiceIds,
  type PaletteKey,
  type Round,
  type SpriteName,
  type SpritePart,
  type Theme,
  type Token,
} from './schema.ts';
import { numberWord } from './script.ts';

export type Orientation = 'wide' | 'tall';
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SceneChoice {
  id: string;
  box: Box;
  /** Visible label drawn in the scene (also the start of the accessible name). */
  label: string;
  /** Full accessible name: the visible label plus what a listener needs to take part. */
  ariaLabel: string;
}
export interface SceneLayout {
  width: number;
  height: number;
  choices: SceneChoice[];
  islands: { box: Box; inner: Box; layout: GemLayout; points: [number, number][]; r: number }[];
  stimulus: Box | null;
  planks: Box[];
  home: Box;
  goal: Box;
  gate: Box;
  /** Pip's box after `built` planks. */
  pipAt(built: number): Box;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const n = (value: number) => String(Math.round(value * 100) / 100);

// ── sprites ───────────────────────────────────────────────────────────────────────────────────────────────

function paintAttrs(part: SpritePart, palette: Theme['palette'], stretched: boolean): string {
  const fill = part.fill ? palette[part.fill] : 'none';
  const stroke = part.stroke
    ? ` stroke="${palette[part.stroke]}" stroke-width="${n(part.width ?? 2)}" stroke-linecap="round" stroke-linejoin="round"`
    : '';
  const opacity = part.opacity === undefined ? '' : ` opacity="${n(part.opacity)}"`;
  const scaling = stretched && part.stroke ? ' vector-effect="non-scaling-stroke"' : '';
  return `fill="${fill}"${stroke}${opacity}${scaling}`;
}

function partSvg(part: SpritePart, palette: Theme['palette'], stretched: boolean): string {
  const paint = paintAttrs(part, palette, stretched);
  switch (part.type) {
    case 'circle':
      return `<circle cx="${n(part.cx)}" cy="${n(part.cy)}" r="${n(part.r)}" ${paint}/>`;
    case 'ellipse':
      return `<ellipse cx="${n(part.cx)}" cy="${n(part.cy)}" rx="${n(part.rx)}" ry="${n(part.ry)}" ${paint}/>`;
    case 'rect':
      return `<rect x="${n(part.x)}" y="${n(part.y)}" width="${n(part.w)}" height="${n(part.h)}" rx="${n(part.rx ?? 0)}" ${paint}/>`;
    case 'polygon':
      return `<polygon points="${part.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" ${paint}/>`;
    case 'path':
      // validated to commands and numbers only
      return `<path d="${part.d}" ${paint}/>`;
  }
}

/** A sprite placed in `box`. `stretch` fills the box exactly (islands); otherwise it keeps its proportions. */
export function spriteSvg(
  theme: Theme,
  name: SpriteName,
  box: Box,
  options: { stretch?: boolean } = {},
): string {
  const stretch = options.stretch ?? false;
  const parts = theme.sprites[name].parts.map((part) => partSvg(part, theme.palette, stretch)).join('');
  return `<svg x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" viewBox="0 0 100 100" preserveAspectRatio="${stretch ? 'none' : 'xMidYMid meet'}" overflow="visible">${parts}</svg>`;
}

/** A standalone sprite (e.g. Pip on a button). Decorative: the caller labels the control. */
export function spriteMarkup(theme: Theme, name: SpriteName, size: number, className = ''): string {
  return `<svg class="${escapeXml(className)}" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${theme.sprites[name].parts.map((part) => partSvg(part, theme.palette, false)).join('')}</svg>`;
}

// ── layout ────────────────────────────────────────────────────────────────────────────────────────────────

const LETTERS = ['A', 'B', 'C', 'D'];

function describeGroup(count: number, arrangement: string, size: string): string {
  const where = arrangement === 'spread' ? ', spread out' : arrangement === 'tight' ? ', bunched up' : '';
  const big = size === 'small' ? ' small' : size === 'large' ? ' big' : '';
  return `${count}${big} ${count === 1 ? 'gem' : 'gems'}${where}`;
}

function describeTokens(tokens: Token[]): string {
  return tokens.map((token) => (token.shape === 'gem' ? 'gem' : `${token.color} ${token.shape}`)).join(', ');
}

export function sceneLayout(
  round: Round,
  orientation: Orientation,
  planks: number,
  neutral = true,
): SceneLayout {
  const wide = orientation === 'wide';
  const width = wide ? 1000 : 600;
  const height = wide ? 640 : 1000;
  const choices: SceneChoice[] = [];
  const islands: SceneLayout['islands'] = [];
  let stimulus: Box | null = null;

  if (round.kind !== 'choose') {
    const boxes: Box[] = wide
      ? [
          { x: 30, y: 36, w: 430, h: 330 },
          { x: 540, y: 36, w: 430, h: 330 },
        ]
      : [
          { x: 30, y: 26, w: 540, h: 300 },
          { x: 30, y: 380, w: 540, h: 300 },
        ];
    round.islands.forEach((group, i) => {
      const box = boxes[i] as Box;
      const top = box.h * 0.8;
      const inner = { x: box.x + 34, y: box.y + 26, w: box.w - 68, h: top - 52 };
      const layout = layoutGroup(group, inner.w / inner.h);
      const points = layout.points.map(
        ([x, y]) => [inner.x + x * inner.h, inner.y + y * inner.h] as [number, number],
      );
      islands.push({ box, inner, layout, points, r: layout.r * inner.h });
      const letter = LETTERS[i] as string;
      if (round.kind === 'compare')
        choices.push({
          id: i === 0 ? 'a' : 'b',
          box,
          label: `Island ${letter}`,
          ariaLabel: `Island ${letter}: ${describeGroup(group.count, group.arrangement, group.size)}`,
        });
    });
    const stoneY = wide ? 392 : 712;
    if (round.kind === 'compare' && round.allowSame)
      choices.splice(1, 0, {
        id: 'same',
        box: { x: width / 2 - 85, y: stoneY, w: 170, h: 88 },
        label: 'Same',
        ariaLabel: 'Same: both islands have the same number of gems',
      });
    if (round.kind === 'difference') {
      const count = round.choices.length;
      const w = 118;
      const gap = 30;
      const x0 = width / 2 - (count * w + (count - 1) * gap) / 2;
      round.choices.forEach((value, i) => {
        choices.push({
          id: String(value),
          box: { x: x0 + i * (w + gap), y: stoneY, w, h: 88 },
          label: String(value),
          ariaLabel: `${numberWord(value)} more`,
        });
      });
    }
  } else {
    const hasStimulus = round.stimulus.length > 0;
    if (hasStimulus) stimulus = wide ? { x: 150, y: 24, w: 700, h: 130 } : { x: 30, y: 24, w: 540, h: 130 };
    const count = round.options.length;
    const top = hasStimulus ? (wide ? 190 : 184) : wide ? 40 : 30;
    const perRow = wide ? count : Math.min(2, count);
    const rows = Math.ceil(count / perRow);
    const gap = 24;
    const cardW = Math.min(wide ? 280 : 260, (width - 60 - (perRow - 1) * gap) / perRow);
    const areaH = (wide ? 400 : 650) - top;
    const cardH = Math.min(wide ? 300 : 280, (areaH - (rows - 1) * gap) / rows + (hasStimulus ? 40 : 60));
    round.options.forEach((option, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, count - row * perRow);
      const col = i % perRow;
      const x0 = width / 2 - (inRow * cardW + (inRow - 1) * gap) / 2;
      const letter = LETTERS[i] as string;
      const label = neutral ? `Group ${letter}` : option.label;
      choices.push({
        id: option.id,
        box: { x: x0 + col * (cardW + gap), y: top + row * (cardH + gap), w: cardW, h: cardH },
        label,
        ariaLabel: neutral
          ? `${label}: ${option.tokens.length} ${describeTokens(option.tokens.slice(0, 1))}${option.tokens.length === 1 ? '' : 's'}`
          : `${option.label}`,
      });
    });
  }

  // the bridge along the bottom: home island, planks, the goal island with its gate
  const stripY = wide ? 520 : 872;
  const home = wide ? { x: 16, y: stripY + 22, w: 120, h: 76 } : { x: 10, y: stripY + 30, w: 96, h: 70 };
  const goal = wide ? { x: 864, y: stripY + 22, w: 120, h: 76 } : { x: 494, y: stripY + 30, w: 96, h: 70 };
  const gate = wide ? { x: 880, y: stripY - 70, w: 88, h: 88 } : { x: 506, y: stripY - 46, w: 72, h: 72 };
  const plankCount = Math.max(1, planks);
  const x0 = home.x + home.w + 8;
  const span = goal.x - 8 - x0;
  const plankW = span / plankCount;
  const plankBoxes = Array.from({ length: plankCount }, (_, i) => ({
    x: x0 + i * plankW + 3,
    y: home.y + 6,
    w: plankW - 6,
    h: wide ? 56 : 48,
  }));
  const pipSize = wide ? 78 : 66;
  const pipAt = (built: number): Box => {
    const k = Math.max(0, Math.min(built, plankCount));
    const cx =
      k === 0
        ? home.x + home.w / 2
        : k >= plankCount
          ? goal.x + goal.w / 2 - 6
          : (plankBoxes[k - 1] as Box).x + plankW / 2;
    return { x: cx - pipSize / 2, y: home.y - pipSize + 10, w: pipSize, h: pipSize };
  };
  return { width, height, choices, islands, stimulus, planks: plankBoxes, home, goal, gate, pipAt };
}

// ── the scene ─────────────────────────────────────────────────────────────────────────────────────────────

const TOKEN_FILL: Record<Token['color'], PaletteKey> = {
  blue: 'shapeBlue',
  green: 'shapeGreen',
  yellow: 'shapeYellow',
  red: 'shapeRed',
  teal: 'gem',
};

function tokenSvg(theme: Theme, token: Token, cx: number, cy: number, size: number): string {
  const half = size / 2;
  const fill = theme.palette[TOKEN_FILL[token.color]];
  switch (token.shape) {
    case 'gem':
      return spriteSvg(theme, 'gem', { x: cx - half, y: cy - half, w: size, h: size });
    case 'circle':
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(half)}" fill="${fill}"/>`;
    case 'square':
      return `<rect x="${n(cx - half * 0.9)}" y="${n(cy - half * 0.9)}" width="${n(size * 0.9)}" height="${n(size * 0.9)}" fill="${fill}"/>`;
    case 'triangle':
      return `<polygon points="${n(cx)},${n(cy - half)} ${n(cx + half)},${n(cy + half * 0.8)} ${n(cx - half)},${n(cy + half * 0.8)}" fill="${fill}"/>`;
  }
}

function tokenRow(theme: Theme, tokens: Token[], box: Box, maxSize: number): string {
  const perRow = Math.min(tokens.length, 5);
  const rows = Math.ceil(tokens.length / perRow);
  const size = Math.min(maxSize, (box.w - 20) / (perRow * 1.35), (box.h - 10) / (rows * 1.35));
  const step = size * 1.35;
  return tokens
    .map((token, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, tokens.length - row * perRow);
      const col = i % perRow;
      const cx = box.x + box.w / 2 + (col - (inRow - 1) / 2) * step;
      const cy = box.y + box.h / 2 + (row - (rows - 1) / 2) * step;
      return tokenSvg(theme, token, cx, cy, size);
    })
    .join('');
}

const STYLE = `.wwm-scene{font-family:"Figtree Variable",Figtree,system-ui,sans-serif}
.wwm-scene .gem,.wwm-scene .pip,.wwm-scene .mark{transform-box:fill-box;transform-origin:center}
.wwm-scene .gem{transition:transform .22s ease}
.wwm-scene .gem.is-lit{transform:scale(1.28)}
.wwm-scene .ring{opacity:0;transition:opacity .2s}
.wwm-scene .gem.is-lit .ring,.wwm-scene .gem.is-leftover .ring{opacity:1}
.wwm-scene .gem.is-leftover{animation:wwm-bob 1s ease-in-out infinite}
.wwm-scene .pair{opacity:0;stroke-dasharray:var(--len);stroke-dashoffset:var(--len);transition:stroke-dashoffset .35s ease,opacity .1s}
.wwm-scene .pair.is-shown{opacity:1;stroke-dashoffset:0}
.wwm-scene .mark .halo{opacity:0;transition:opacity .2s}
.wwm-scene .mark.is-correct .halo,.wwm-scene .mark.is-retry .halo,.wwm-scene .mark.is-glow .halo,.wwm-scene .mark.is-focus .halo{opacity:1}
.wwm-scene .mark.is-retry .halo{stroke-dasharray:14 10}
.wwm-scene .mark.is-focus:not(.is-correct):not(.is-retry):not(.is-glow) .halo{stroke:var(--wwm-focus);stroke-dasharray:2 16;stroke-width:12}
.wwm-scene .mark.is-glow .halo{animation:wwm-glow 1s ease-in-out infinite}
.wwm-scene .mark.is-pulse{animation:wwm-pulse .7s ease-in-out 2}
.wwm-scene .mark.is-correct .check{opacity:1}
.wwm-scene .check{opacity:0;transition:opacity .2s}
.wwm-scene .mark.is-callout .halo{opacity:1;stroke:var(--wwm-focus);stroke-dasharray:none}
.wwm-scene .mark.is-callout{animation:wwm-pulse .45s ease-in-out 1}
.wwm-scene .key-badge{opacity:0;transition:opacity .2s,transform .2s;transform-box:fill-box;transform-origin:center}
.wwm-scene.show-keys .key-badge{opacity:1}
.wwm-scene .key-badge.is-callout{transform:scale(1.25)}
.wwm-scene .pip{transition:transform .9s cubic-bezier(.3,.8,.3,1)}
.wwm-scene .pip.is-happy{animation:wwm-hop .5s ease-in-out 2}
.wwm-scene .plank.is-new{animation:wwm-drop .5s ease-out}
@keyframes wwm-pulse{50%{transform:scale(1.035)}}
@keyframes wwm-glow{50%{opacity:.35}}
@keyframes wwm-bob{50%{transform:translateY(-6px)}}
@keyframes wwm-hop{50%{transform:translateY(-22px)}}
@keyframes wwm-drop{from{transform:translateY(-30px);opacity:0}}
@media (prefers-reduced-motion:reduce){.wwm-scene *{animation:none!important;transition:none!important}}`;

export interface SceneView {
  orientation: Orientation;
  /** Planks on the bridge (required rounds) and how many are built. */
  planks: number;
  built: number;
  /** Neutral "Group A" labels (counting/comparison). */
  neutral?: boolean;
}

/** The whole round as one SVG (decorative for assistive tech: the answer buttons carry the names). */
export function sceneSvg(theme: Theme, round: Round, view: SceneView): string {
  const p = theme.palette;
  const layout = sceneLayout(round, view.orientation, view.planks, view.neutral ?? true);
  const { width, height } = layout;
  const out: string[] = [];
  out.push(
    `<svg class="wwm-scene" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><style>${STYLE}</style>`,
    `<style>.wwm-scene{--wwm-focus:${p.ballSeam}}</style>`,
  );
  out.push(`<rect width="${width}" height="${height}" rx="28" fill="${p.sky}"/>`);
  // scenery stays faint and still
  const clouds: Box[] =
    view.orientation === 'wide'
      ? [
          { x: 420, y: 410, w: 160, h: 90 },
          { x: 250, y: 440, w: 110, h: 62 },
          { x: 640, y: 432, w: 120, h: 68 },
        ]
      : [
          { x: 60, y: 740, w: 120, h: 70 },
          { x: 420, y: 760, w: 110, h: 64 },
        ];
  const hasStones = layout.choices.some((choice) => choice.id === 'same') || round.kind === 'difference';
  for (const cloud of clouds.slice(hasStones ? 1 : 0)) out.push(spriteSvg(theme, 'cloud', cloud));

  // choice halos (behind islands/cards)
  const halo = (choice: SceneChoice, rx: number) =>
    `<rect class="halo" x="${n(choice.box.x - 10)}" y="${n(choice.box.y - 10)}" width="${n(choice.box.w + 20)}" height="${n(choice.box.h + 20)}" rx="${rx}" fill="none" stroke="${p.glow}" stroke-width="9"/>`;
  const check = (choice: SceneChoice) => {
    const cx = choice.box.x + choice.box.w - 18;
    const cy = choice.box.y + 18;
    return `<g class="check"><circle cx="${n(cx)}" cy="${n(cy)}" r="24" fill="${p.bridge}" stroke="${p.paper}" stroke-width="4"/><path d="M${n(cx - 11)} ${n(cy)} L${n(cx - 3)} ${n(cy + 8)} L${n(cx + 12)} ${n(cy - 9)}" fill="none" stroke="${p.paper}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  };

  if (round.kind !== 'choose') {
    layout.islands.forEach((island, i) => {
      const id = i === 0 ? 'a' : 'b';
      const choice = layout.choices.find((c) => c.id === id);
      out.push(`<g class="mark" data-choice-mark="${id}">`);
      if (choice) out.push(halo(choice, 24));
      out.push(spriteSvg(theme, 'island', island.box, { stretch: true }));
      if (choice) out.push(check(choice));
      out.push('</g>');
    });
    // match lines sit between the islands and the gems
    const [a, b] = layout.islands;
    if (a && b) {
      const pairing = pairUp(a.layout, b.layout);
      pairing.pairs.forEach(([ia, ib], k) => {
        const [x1, y1] = a.points[ia] as [number, number];
        const [x2, y2] = b.points[ib] as [number, number];
        const len = Math.hypot(x2 - x1, y2 - y1);
        out.push(
          `<line class="pair" data-pair="${k}" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${p.glow}" stroke-width="8" stroke-linecap="round" style="--len:${n(len)}"/>`,
        );
      });
    }
    layout.islands.forEach((island, i) => {
      const id = i === 0 ? 'a' : 'b';
      island.points.forEach(([x, y], k) => {
        const r = island.r;
        out.push(
          `<g class="gem" data-gem="${id}-${k}"><circle class="ring" cx="${n(x)}" cy="${n(y)}" r="${n(r * 1.45)}" fill="none" stroke="${p.glow}" stroke-width="6"/>${spriteSvg(theme, 'gem', { x: x - r, y: y - r, w: r * 2, h: r * 2 })}</g>`,
        );
      });
    });
    // island names go above the match lines so a line never strikes through them
    layout.islands.forEach((island, i) => {
      out.push(
        `<text x="${n(island.box.x + island.box.w / 2)}" y="${n(island.box.y + island.box.h - 14)}" text-anchor="middle" font-size="30" font-weight="700" fill="${p.paper}" paint-order="stroke" stroke="${p.islandSide}" stroke-width="10" stroke-linejoin="round">Island ${LETTERS[i]}</text>`,
      );
    });
    // stones: "Same" or numbers
    for (const choice of layout.choices.filter((c) => c.id !== 'a' && c.id !== 'b')) {
      const { x, y, w, h } = choice.box;
      out.push(
        `<g class="mark" data-choice-mark="${escapeXml(choice.id)}">${halo(choice, 26)}<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="22" fill="${p.paper}" stroke="${p.islandSide}" stroke-width="5"/><text x="${n(x + w / 2)}" y="${n(y + h / 2 + 13)}" text-anchor="middle" font-size="${choice.id === 'same' ? 36 : 44}" font-weight="800" fill="${p.ink}">${escapeXml(choice.label)}</text>${check(choice)}</g>`,
      );
    }
  } else {
    if (layout.stimulus) {
      const s = layout.stimulus;
      out.push(
        `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="22" fill="${p.paper}" stroke="${p.islandEdge}" stroke-width="3"/>`,
      );
      const tokensBox = { x: s.x + 20, y: s.y + 10, w: s.w - 120, h: s.h - 20 };
      out.push(tokenRow(theme, round.stimulus, tokensBox, 70));
      out.push(
        `<text x="${n(s.x + s.w - 55)}" y="${n(s.y + s.h / 2 + 22)}" text-anchor="middle" font-size="64" font-weight="800" fill="${p.ballSeam}">?</text>`,
      );
    }
    for (const choice of layout.choices) {
      const option = round.options.find((o) => o.id === choice.id);
      if (!option) continue;
      const { x, y, w, h } = choice.box;
      out.push(
        `<g class="mark" data-choice-mark="${escapeXml(choice.id)}">${halo(choice, 26)}<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="22" fill="${p.paper}" stroke="${p.islandEdge}" stroke-width="3"/>${tokenRow(theme, option.tokens, { x: x + 12, y: y + 16, w: w - 24, h: h - 76 }, 72)}<text x="${n(x + w / 2)}" y="${n(y + h - 24)}" text-anchor="middle" font-size="30" font-weight="700" fill="${p.ink}">${escapeXml(choice.label)}</text>${check(choice)}</g>`,
      );
    }
  }

  // key badges (shown when the round invites letter or number keys: add `show-keys` to the svg)
  const keys = choiceKeys(round);
  for (const choice of layout.choices) {
    const key = keys[choice.id];
    if (!key) continue;
    const cx = choice.box.x + 10;
    const cy = choice.box.y + 10;
    out.push(
      `<g class="key-badge" data-key-badge="${escapeXml(choice.id)}"><rect x="${n(cx - 22)}" y="${n(cy - 22)}" width="44" height="44" rx="10" fill="${p.ink}"/><text x="${n(cx)}" y="${n(cy + 11)}" text-anchor="middle" font-size="32" font-weight="800" fill="${p.paper}">${escapeXml(key)}</text></g>`,
    );
  }

  // the bridge
  out.push(spriteSvg(theme, 'island', layout.home, { stretch: true }));
  out.push(spriteSvg(theme, 'island', layout.goal, { stretch: true }));
  out.push(spriteSvg(theme, 'gate', layout.gate));
  layout.planks.forEach((plank, i) => {
    out.push(
      i < view.built
        ? `<g class="plank" data-plank="${i}">${spriteSvg(theme, 'plank', plank, { stretch: true })}</g>`
        : `<rect class="plank-slot" data-plank-slot="${i}" x="${n(plank.x)}" y="${n(plank.y + plank.h * 0.22)}" width="${n(plank.w)}" height="${n(plank.h * 0.56)}" rx="8" fill="none" stroke="${p.islandEdge}" stroke-width="3" stroke-dasharray="8 8"/>`,
    );
  });
  const pip = layout.pipAt(view.built);
  out.push(`<g class="pip" data-pip>${spriteSvg(theme, 'pip', pip)}</g>`);
  out.push('</svg>');
  return out.join('');
}

/** Choice ids in on-screen order (left to right, then top to bottom), for tilt and arrow-key selection. */
export function choicesInOrder(round: Round, orientation: Orientation = 'wide'): string[] {
  const layout = sceneLayout(round, orientation, 1);
  const ids = choiceIds(round);
  return layout.choices
    .filter((choice) => ids.includes(choice.id))
    .sort((p, q) =>
      Math.abs(p.box.y - q.box.y) > 40 && orientation === 'tall' ? p.box.y - q.box.y : p.box.x - q.box.x,
    )
    .map((choice) => choice.id);
}
