import { expectedMotion, type MotionRound } from './motion.ts';
import type { Box, Orientation, SceneLayout, SceneView } from './scene.ts';
import type { Theme } from './schema.ts';

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
export function motionLayout(round: MotionRound, orientation: Orientation): SceneLayout {
  const wide = orientation === 'wide';
  const width = wide ? 1000 : 600;
  const height = wide ? 620 : 540;
  const count = round.options.length;
  const gap = 16;
  const w = (width - 48 - gap * (count - 1)) / count;
  const choices = round.options.map((o, i) => ({
    id: o.id,
    label: o.label,
    ariaLabel: o.label,
    box: { x: 24 + i * (w + gap), y: wide ? 460 : 385, w, h: wide ? 112 : 128 },
  }));
  const blank: Box = { x: 0, y: 0, w: 0, h: 0 };
  return {
    width,
    height,
    choices,
    islands: [],
    stimulus: null,
    planks: [],
    home: blank,
    goal: blank,
    gate: blank,
    pipAt: () => blank,
  };
}
function marker(id: string, x: number, y: number, p: Theme['palette'], size = 34): string {
  if (id === 'circle')
    return `<circle cx="${x}" cy="${y}" r="${size}" fill="${p.shapeBlue}" stroke="${p.ink}" stroke-width="3"/>`;
  if (id === 'triangle')
    return `<path d="M${x} ${y - size} L${x + size} ${y + size} L${x - size} ${y + size} Z" fill="${p.glow}" stroke="${p.ink}" stroke-width="3"/>`;
  if (id === 'star')
    return `<path d="M${x} ${y - 30} l9 20 23 3 -17 15 5 23 -20 -12 -20 12 5 -23 -17 -15 23 -3Z" fill="${p.glow}" stroke="${p.ink}" stroke-width="3"/>`;
  if (id === 'flower')
    return `<g fill="${p.shapeRed}" stroke="${p.ink}" stroke-width="2"><circle cx="${x - 13}" cy="${y}" r="15"/><circle cx="${x + 13}" cy="${y}" r="15"/><circle cx="${x}" cy="${y - 13}" r="15"/><circle cx="${x}" cy="${y + 13}" r="15"/><circle cx="${x}" cy="${y}" r="8" fill="${p.glow}"/></g>`;
  if (id === 'cannot-move')
    return `<circle cx="${x}" cy="${y}" r="25" fill="${p.paper}" stroke="${p.ballSeam}" stroke-width="5"/><path d="M${x - 16} ${y - 16} l32 32" stroke="${p.ballSeam}" stroke-width="5"/>`;
  if (id === 'stay')
    return `<circle cx="${x}" cy="${y}" r="25" fill="${p.paper}" stroke="${p.shapeBlue}" stroke-width="6"/><circle cx="${x}" cy="${y}" r="7" fill="${p.shapeBlue}"/>`;
  return `<path d="M${x - 25} ${y} H${x + 20} m-12 -14 14 14 -14 14" fill="none" stroke="${p.ballSeam}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function choiceLabel(label: string, x: number, y: number, tall: boolean, ink: string): string {
  const words = label.split(' ');
  const rows: string[] = [];
  for (const word of words) {
    const last = rows.at(-1);
    if (last && (last.length + word.length < 13 || !tall)) rows[rows.length - 1] = `${last} ${word}`;
    else rows.push(word);
  }
  return `<text x="${x}" text-anchor="middle" fill="${ink}" font-size="${tall ? 30 : 25}" font-weight="700">${rows.map((row, i) => `<tspan x="${x}" y="${y + i * 31}">${xml(row)}</tspan>`).join('')}</text>`;
}
export function motionSvg(theme: Theme, round: MotionRound, view: SceneView): string {
  const p = theme.palette;
  const layout = motionLayout(round, view.orientation);
  const { width, height } = layout;
  const scale = width / 1000;
  const { scene } = round;
  const direction = scene.exhaust === 'left' ? -1 : 1;
  const launch = scene.apparatus === 'rocket' && scene.setting === 'launch';
  const tied = scene.exhaust === 'none';
  const space = scene.setting === 'space';
  const body =
    scene.apparatus === 'balloon'
      ? `<g transform="translate(500 230) scale(${direction} 1)"><rect x="-55" y="-120" width="100" height="16" rx="8" fill="${p.paper}" stroke="${p.ink}" stroke-width="4"/><path d="M-35 -103 L-35 -76 M25 -103 L25 -72" stroke="${p.ballSeam}" stroke-width="9"/><ellipse cx="-10" cy="0" rx="112" ry="76" fill="${p.gem}" stroke="${p.gemEdge}" stroke-width="5"/><path d="M-67 -39 Q-38 -60 -6 -58" fill="none" stroke="${p.paper}" stroke-width="9" stroke-linecap="round"/><path d="M98 -10 L125 -20 L125 20 L98 10 Z" fill="${p.gem}" stroke="${p.gemEdge}" stroke-width="4"/>${tied ? `<path d="M105 -24 L124 24 M106 24 L124 -24" stroke="${p.ink}" stroke-width="9" stroke-linecap="round"/>` : ''}</g>`
      : `<g transform="translate(500 230) rotate(${launch ? 0 : direction === -1 ? 90 : -90})"><path d="M-55 50 L-55 -50 Q-48 -95 0 -130 Q48 -95 55 -50 V50 Z" fill="${p.ballShell}" stroke="${p.ink}" stroke-width="5"/><path d="M-55 20 L-90 85 L-34 62 M55 20 L90 85 L34 62" fill="${p.shapeBlue}" stroke="${p.ink}" stroke-width="5"/><circle cy="-43" r="27" fill="${p.shapeBlue}" stroke="${p.ink}" stroke-width="5"/><circle cy="-43" r="12" fill="${p.paper}"/><path d="M-28 51 L-35 80 H35 L28 51Z" fill="${p.ballSeam}" stroke="${p.ink}" stroke-width="4"/></g>`;
  const gas = tied
    ? ''
    : launch
      ? `<path d="M478 317 Q465 347 477 390 L500 414 L523 390 Q535 347 522 317Z" fill="${p.glow}" stroke="${p.shapeYellow}" stroke-width="3"/>`
      : [0, 1, 2]
          .map(
            (i) =>
              `<ellipse cx="${500 + direction * (155 + i * 47)}" cy="${230 + (i % 2 ? 18 : -8)}" rx="${19 + i * 6}" ry="${13 + i * 5}" fill="${p.paper}" stroke="${p.ballSeam}" stroke-width="3"/>`,
          )
          .join('');
  const move = expectedMotion(scene);
  const arrows =
    move === 'still'
      ? ''
      : launch
        ? `<path d="M630 250 v-105 m-16 20 16 -20 16 20 M365 225 v150 m-16 -20 16 20 16 -20"/>`
        : `<path d="M${move === 'left' ? 410 : 590} 350 h${move === 'left' ? -125 : 125} m${move === 'left' ? 20 : -20} -16 l${move === 'left' ? -20 : 20} 16 ${move === 'left' ? 20 : -20} 16 M${move === 'left' ? 590 : 410} 350 h${move === 'left' ? 125 : -125} m${move === 'left' ? -20 : 20} -16 l${move === 'left' ? 20 : -20} 16 ${move === 'left' ? -20 : 20} 16"/>`;
  const comparison = tied
    ? `<g class="motion-comparison" transform="translate(270 350)"><ellipse rx="60" ry="38" fill="${p.gem}" stroke="${p.gemEdge}" stroke-width="3"/><path d="M58 -8 L73 -13 V13 L58 8Z" fill="${p.gem}"/><ellipse cx="98" rx="12" ry="9" fill="${p.paper}" stroke="${p.ballSeam}" stroke-width="2"/><path d="M-85 0 h-55 m15 -12 -15 12 15 12" fill="none" stroke="${p.shapeBlue}" stroke-width="5"/><text y="65" text-anchor="middle" font-size="26" fill="${p.ink}">Open: air escapes</text><text x="370" y="65" text-anchor="middle" font-size="26" fill="${p.ink}">Tied: air stays inside</text></g>`
    : '';
  const questionMarkers = launch
    ? marker('star', 500, 45, p) + marker('flower', 800, 395, p)
    : marker('circle', 90, 230, p) + marker('triangle', 910, 230, p);
  const progress = Array.from(
    { length: view.planks },
    (_, i) =>
      `<circle cx="${width / 2 + (i - (view.planks - 1) / 2) * 24}" cy="${height - 19}" r="6" fill="${i < view.built ? p.bridge : p.islandEdge}"/>`,
  ).join('');
  const after = view.experiment === 'after';
  const dx = after ? (move === 'left' ? -150 : move === 'right' ? 150 : 0) : 0;
  const dy = after && move === 'up' ? -90 : 0;
  return `<svg ${after ? 'data-experiment-frame="after"' : ''} class="wwm-scene rocket-scene" viewBox="0 0 ${width} ${height}" width="100%" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="24" fill="${p.sky}"/><g transform="translate(0 ${view.orientation === 'tall' ? 54 : 0}) scale(${scale})">${space ? `<g fill="${p.islandEdge}">${[80, 250, 730, 930].map((x, i) => `<circle cx="${x}" cy="${50 + (i % 2) * 50}" r="4"/>`).join('')}</g>` : ''}${scene.apparatus === 'balloon' ? `<path d="M75 117 H925 M75 85 v310 M925 85 v310" fill="none" stroke="${p.ballSeam}" stroke-width="5"/>` : ''}${questionMarkers}${comparison}<g data-motion-body transform="translate(${dx} ${dy})">${body}</g><g data-motion-gas transform="translate(${-dx * 0.55} ${-dy * 0.55})">${gas}</g><g class="motion-arrows" fill="none" stroke="${p.shapeBlue}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${arrows}</g></g>${layout.choices.map((c) => `<g class="mark" data-choice-mark="${xml(c.id)}"><rect class="halo" x="${c.box.x - 4}" y="${c.box.y - 4}" width="${c.box.w + 8}" height="${c.box.h + 8}" rx="18" fill="none" stroke="${p.glow}" stroke-width="6"/><rect x="${c.box.x}" y="${c.box.y}" width="${c.box.w}" height="${c.box.h}" rx="16" fill="${p.paper}" stroke="${p.islandEdge}" stroke-width="3"/>${marker(c.id, c.box.x + c.box.w / 2, c.box.y + 34, p, 20)}${choiceLabel(c.label, c.box.x + c.box.w / 2, c.box.y + 83, view.orientation === 'tall', p.ink)}</g>`).join('')}${progress}</svg>`;
}
