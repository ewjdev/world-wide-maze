/**
 * Debugger-style stage thumbnail: the slice screenshot (dimmed) under island outlines, bridges, elevators,
 * start/goal, the solver's route and ball trace, fall points and the failure spot. Optional nav-grid overlay
 * (walkable = green, too narrow for the ball = red).
 */
import type { RGBAImage, StageData, Vec2 } from '@wwm/schema';
import type { NavGrid, SolveResult } from '@wwm/solver';
import { Raster, type RGBA } from './raster.ts';

export interface ThumbOptions {
  /** Output width (px). */
  width?: number;
  /** Full-page analysis image (capture screenshot) and its scale (image px per page px). */
  image?: RGBAImage;
  imageScale?: number;
  grid?: NavGrid;
  route?: Vec2[][];
  solve?: SolveResult;
}

const LEVEL_LO = 9;
const LEVEL_HI = 24;

function levelColor(level: number): RGBA {
  const t = Math.max(0, Math.min(1, (level - LEVEL_LO) / (LEVEL_HI - LEVEL_LO)));
  // low = deep blue, high = warm white
  return [Math.round(60 + 190 * t), Math.round(110 + 120 * t), Math.round(210 - 60 * t), 255];
}

export function renderThumb(stage: StageData, opts: ThumbOptions = {}): Raster {
  const W = opts.width ?? 320;
  const k = W / stage.size.width;
  const H = Math.max(1, Math.round(stage.size.height * k));
  const r = new Raster(W, H);
  r.fill([18, 22, 30, 255]);
  // Screenshot, box-sampled and dimmed.
  const img = opts.image;
  if (img) {
    const s = opts.imageScale ?? 1;
    const y0 = stage.source.slice.y;
    const step = Math.max(1, Math.floor(s / k / 2));
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        const px0 = Math.floor((x / k) * s);
        const py0 = Math.floor((y / k + y0) * s);
        const px1 = Math.min(img.width - 1, Math.floor(((x + 1) / k) * s) - 1);
        const py1 = Math.min(img.height - 1, Math.floor(((y + 1) / k + y0) * s) - 1);
        for (let py = py0; py <= Math.max(py0, py1); py += step)
          for (let px = px0; px <= Math.max(px0, px1); px += step) {
            if (px >= img.width || py >= img.height) continue;
            const i = (py * img.width + px) * 4;
            sr += img.data[i] as number;
            sg += img.data[i + 1] as number;
            sb += img.data[i + 2] as number;
            n++;
          }
        if (n) r.blend(x, y, [sr / n, sg / n, sb / n, 150]);
      }
  }
  const P = (p: Vec2): [number, number] => [p[0] * k, p[1] * k];
  // Nav grid overlay.
  const g = opts.grid;
  if (g) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const gx = Math.floor(x / k / g.cell);
        const gy = Math.floor(y / k / g.cell);
        if (gx >= g.w || gy >= g.h) continue;
        const i = gy * g.w + gx;
        if (g.label[i] === 0) continue;
        const ok = (g.clear[i] as number) >= g.minClear && g.lift[i] === 0;
        r.blend(x, y, ok ? [40, 200, 90, 70] : [230, 40, 40, 110]);
      }
  }
  // Islands (outline colored by level), bridges, elevators.
  for (const isl of stage.islands) {
    const c = levelColor(isl.level);
    r.polyline(isl.contour.map(P), 1.2, c, true);
    for (const h of isl.holes) r.polyline(h.map(P), 1, c, true);
  }
  for (const b of stage.bridges) {
    const [ax, ay] = P(b.a);
    const [bx, by] = P(b.b);
    r.line(
      ax,
      ay,
      bx,
      by,
      Math.max(1.5, b.width * k * 0.6),
      b.type === 'ramp' ? [255, 170, 60, 200] : [120, 200, 255, 200],
    );
  }
  for (const e of stage.elevators) {
    const [ax, ay] = P(e.a);
    const [bx, by] = P(e.b);
    r.line(ax, ay, bx, by, Math.max(2, e.width * k * 0.6), [0, 240, 240, 230]);
  }
  // Route and trace.
  for (const leg of opts.route ?? []) r.polyline(leg.map(P), 1.5, [255, 230, 0, 230]);
  const sv = opts.solve;
  if (sv) {
    r.polyline(sv.trace.map(P), 1.5, sv.success ? [255, 60, 220, 230] : [255, 90, 90, 230]);
    for (const f of sv.fallsAt) {
      const [x, y] = P(f);
      r.cross(x, y, 4, 2, [255, 40, 40, 255]);
    }
    if (sv.failure) {
      const [x, y] = P(sv.failure.at);
      r.ring(x, y, 7, 2.5, [255, 30, 30, 255]);
    }
  }
  const [sx, sy] = P(stage.start.pos);
  r.disc(sx, sy, 4, [40, 255, 120, 255]);
  const [gx, gy] = P(stage.goal.pos);
  r.ring(gx, gy, 5, 2.5, [255, 215, 0, 255]);
  return r;
}
