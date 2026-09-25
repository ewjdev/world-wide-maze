/**
 * Canvas 2D drawing of a stage and the builder's debug layers. Exported for reuse (Phase 10's
 * "how it's made" view). Works with a CanvasRenderingContext2D or an OffscreenCanvasRenderingContext2D.
 * Coordinates: the context is scaled so that 1 unit = 1 stage px.
 */
import type { StageData, Vec2 } from '@wwm/schema';
import type { DebugLayersEx } from '@wwm/stage-builder';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface LayerToggles {
  screenshot: boolean;
  dim: boolean;
  background: boolean;
  semantic: boolean;
  land: boolean;
  lost: boolean;
  islands: boolean;
  levels: boolean;
  contours: boolean;
  candidates: boolean;
  bridges: boolean;
  rails: boolean;
  restarts: boolean;
  items: boolean;
  startGoal: boolean;
  ids: boolean;
}

export const DEFAULT_LAYERS: LayerToggles = {
  screenshot: true,
  dim: true,
  background: false,
  semantic: false,
  land: false,
  lost: true,
  islands: true,
  levels: false,
  contours: true,
  candidates: false,
  bridges: true,
  rails: true,
  restarts: false,
  items: true,
  startGoal: true,
  ids: false,
};

/** Layer order and labels for UIs. */
export const LAYER_LABELS: [keyof LayerToggles, string][] = [
  ['screenshot', 'screenshot'],
  ['dim', 'dim screenshot'],
  ['background', 'background mask'],
  ['semantic', 'semantic fill'],
  ['land', 'land (pre-filter)'],
  ['lost', 'dropped land'],
  ['islands', 'islands (by label)'],
  ['levels', 'levels (heat)'],
  ['contours', 'contours'],
  ['candidates', 'candidate bridges'],
  ['bridges', 'bridges / elevators'],
  ['rails', 'guardrails'],
  ['restarts', 'restart points'],
  ['items', 'items'],
  ['startGoal', 'start / goal'],
  ['ids', 'island ids'],
];

/** Deterministic distinct hue per island id. */
export function islandHue(id: number): number {
  return (id * 137.508) % 360;
}

/** Heat color for a level (D) in [lo, hi]: blue (low) → red (high). */
export function levelColor(level: number, lo = 9, hi = 24, alpha = 0.55): string {
  const t = Math.max(0, Math.min(1, (level - lo) / (hi - lo)));
  return `hsla(${Math.round(240 - 240 * t)}, 85%, 50%, ${alpha})`;
}

function ringPath(ctx: Ctx, ring: readonly Vec2[]): void {
  ring.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function linePath(ctx: Ctx, line: readonly Vec2[]): void {
  line.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

/** Paint a per-cell mask as translucent color (nearest-neighbor upscaled). */
export function drawMask(
  ctx: Ctx,
  mask: ArrayLike<number>,
  cols: number,
  rows: number,
  cellPx: number,
  color: (v: number) => [number, number, number, number] | null,
): void {
  const data = new Uint8ClampedArray(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) {
    const c = color(mask[i] as number);
    if (!c) continue;
    data.set(c, i * 4);
  }
  const img = new ImageData(data, cols, rows);
  const off = new OffscreenCanvas(cols, rows);
  const octx = off.getContext('2d');
  if (!octx) return;
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, cols * cellPx, rows * cellPx);
  ctx.restore();
}

export interface DrawOptions {
  /** Image covering the stage (already cropped to the slice), drawn at stage size. */
  image?: CanvasImageSource | null;
  debug?: Partial<DebugLayersEx> | null;
  layers?: Partial<LayerToggles>;
  /** Island to highlight (hover). */
  highlight?: number | null;
}

export function drawStage(ctx: Ctx, stage: StageData, opts: DrawOptions = {}): void {
  const L = { ...DEFAULT_LAYERS, ...(opts.layers ?? {}) };
  const dbg = opts.debug ?? null;
  const W = stage.size.width;
  const H = stage.size.height;
  ctx.save();
  ctx.fillStyle = '#0d2a3a';
  ctx.fillRect(0, 0, W, H);
  if (L.screenshot && opts.image) {
    ctx.drawImage(opts.image, 0, 0, W, H);
    if (L.dim) {
      ctx.fillStyle = 'rgba(8, 30, 45, 0.55)';
      ctx.fillRect(0, 0, W, H);
    }
  }
  const cols = dbg?.cols ?? 0;
  const rows = dbg?.rows ?? 0;
  const cell = dbg?.gridCellPx ?? 0;
  if (dbg && cols > 0) {
    if (L.background && dbg.backgroundMask)
      drawMask(ctx, dbg.backgroundMask, cols, rows, cell, (v) => (v ? [30, 90, 200, 110] : null));
    if (L.semantic && dbg.semanticMask)
      drawMask(ctx, dbg.semanticMask, cols, rows, cell, (v) => (v ? [255, 200, 0, 110] : null));
    if (L.land && dbg.landMask)
      drawMask(ctx, dbg.landMask, cols, rows, cell, (v) => (v ? [255, 255, 255, 90] : null));
    if (L.lost && dbg.lostMask)
      drawMask(ctx, dbg.lostMask, cols, rows, cell, (v) =>
        v === 1 ? [255, 40, 40, 120] : v === 2 ? [255, 120, 0, 140] : null,
      );
  }

  // islands
  for (const isl of stage.islands) {
    ctx.beginPath();
    ringPath(ctx, isl.contour);
    for (const h of isl.holes) ringPath(ctx, h);
    if (L.levels) {
      ctx.fillStyle = levelColor(isl.level);
      ctx.fill('evenodd');
    } else if (L.islands) {
      ctx.fillStyle = `hsla(${islandHue(isl.id)}, 80%, 60%, ${opts.image && L.screenshot ? 0.28 : 0.6})`;
      ctx.fill('evenodd');
    }
    if (opts.highlight === isl.id) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fill('evenodd');
    }
    if (L.contours) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `hsl(${islandHue(isl.id)}, 90%, 70%)`;
      ctx.stroke();
    }
  }
  if (L.rails) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineCap = 'round';
    for (const isl of stage.islands)
      for (const g of isl.guardrails) {
        ctx.beginPath();
        linePath(ctx, g);
        ctx.stroke();
      }
  }
  if (L.candidates && dbg?.candidateBridges) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(190,190,190,0.8)';
    ctx.setLineDash([4, 3]);
    for (const c of dbg.candidateBridges) {
      ctx.beginPath();
      ctx.moveTo(c.a[0], c.a[1]);
      ctx.lineTo(c.b[0], c.b[1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (L.bridges) {
    for (const b of stage.bridges)
      drawDeck(ctx, b.a, b.b, b.width, b.type === 'flat' ? '#35d05a' : '#b6f03c');
    for (const e of stage.elevators) drawDeck(ctx, e.a, e.b, e.width, '#ff9a1f');
  }
  if (L.restarts) {
    ctx.fillStyle = 'rgba(200,200,200,0.9)';
    for (const isl of stage.islands)
      for (const [x, y] of isl.restartPoints) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  if (L.items) {
    for (const it of stage.items) {
      ctx.beginPath();
      if (it.kind === 'small') {
        ctx.fillStyle = '#28f0ff';
        ctx.arc(it.pos[0], it.pos[1], 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#c04dff';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.arc(it.pos[0], it.pos[1], 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  if (L.startGoal) {
    marker(ctx, stage.start.pos, '#ffffff', 'S');
    marker(ctx, stage.goal.pos, '#ffd400', 'G');
  }
  if (L.ids) {
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    stage.islands.forEach((isl) => {
      const p = dbg?.safeSpots?.[isl.id] ?? isl.contour[0];
      if (!p) return;
      const label = `${isl.id} · ${isl.level.toFixed(1)}`;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      const w = ctx.measureText(label).width + 6;
      ctx.fillRect(p[0] - w / 2, p[1] - 8, w, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, p[0], p[1]);
    });
  }
  ctx.restore();
}

function drawDeck(ctx: Ctx, a: Vec2, b: Vec2, width: number, color: string): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  ctx.beginPath();
  ctx.moveTo(a[0] + nx, a[1] + ny);
  ctx.lineTo(b[0] + nx, b[1] + ny);
  ctx.lineTo(b[0] - nx, b[1] - ny);
  ctx.lineTo(a[0] - nx, a[1] - ny);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
}

function marker(ctx: Ctx, p: Vec2, color: string, label: string): void {
  ctx.beginPath();
  ctx.arc(p[0], p[1], 11, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, p[0], p[1] + 0.5);
}

/** Island under a stage-px point (topmost by id), or null. */
export function islandAt(stage: StageData, p: Vec2): number | null {
  for (let k = stage.islands.length - 1; k >= 0; k--) {
    const isl = stage.islands[k];
    if (!isl) continue;
    let inside = false;
    const ring = isl.contour;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as Vec2;
      const [xj, yj] = ring[j] as Vec2;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return isl.id;
  }
  return null;
}
