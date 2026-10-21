/**
 * Link portals (Phase 13, N; contracts §10.1). Each portal is an upright gate standing on its island: a swirling
 * vortex disc framed by a bright rim and a soft halo, a pulsing ring on the ground (the sensor footprint), and a
 * floating label card with the link text and the target host behind a monogram "favicon". In the map view a thin
 * light beam marks each portal and the labels grow so they read from far away.
 *
 * Everything is ONE InstancedMesh (one draw call): the gate geometry carries a `part` attribute, per-portal data
 * lives in instanced attributes, and each instance faces the camera (yaw billboard) in the vertex shader. Labels
 * come from one canvas atlas (a row per portal). The vortex, rim, halo, ground ring and beam are emissive, so the
 * selective bloom makes them glow; the label card is not, so its text stays crisp.
 *
 * Colours reuse the 2013 colour roles (blue, teal, red, yellow, green) plus a violet, picked from the host.
 *
 * Portal windows (N; plans/portal-windows-execution.md): a portal given a picture of its destination
 * (`setPreview`) shows that page through a ragged, glowing tear instead of the vortex; a portal without one can
 * show a "postcard" instead (host colour, monogram, a slow vortex) behind the same tear. Pictures live in a second
 * per-stage atlas (one cell per portal, same slot as its label row), so it is still one draw call. The picture has
 * no emissive (it stays crisp like the label card); only the tear glows. Without a picture nothing changes.
 */
import { LEVEL_HEIGHT_M, PORTAL_RADIUS_M, PX_PER_METER, type StageData } from '@wwm/schema';
import {
  abs,
  atan,
  attribute,
  cameraPosition,
  clamp,
  cos,
  exp,
  float,
  instancedDynamicBufferAttribute,
  length,
  log,
  max,
  min,
  mix,
  mod,
  positionLocal,
  select,
  sin,
  smoothstep,
  texture,
  vec2,
  vec3,
} from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicNodeMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three/webgpu';
import type { Bin } from './bin.ts';
import { type N, type SharedUniforms, setEmissive } from './shared.ts';

/** Gate (vortex) radius and centre height above the island top, metres. */
export const GATE_R = 0.78;
export const GATE_Y = GATE_R + 0.14;
const RIM_W = 0.09;
const HALO_W = 0.34;
/** Label card: width × height (m) and centre height. */
const LABEL_W = 3.2;
const LABEL_H = 0.8;
const LABEL_Y = GATE_Y + GATE_R + 0.75;
const BEAM_H = 38;
const ATLAS_W = 1024;
const ROW_H = 256;
/** Preview atlas: square cells of PREVIEW_CELL px, PREVIEW_COLS per row. The shader samples only the inner
 * PREVIEW_CELL − 2 × PREVIEW_PAD px, so the mip chain doesn't bleed a neighbouring picture into the disc edge. */
export const PREVIEW_CELL = 320;
export const PREVIEW_PAD = 8;
export const PREVIEW_COLS = 3;

/** Colour roles (2013) + a violet (N). */
export const PORTAL_COLORS = ['#4f9fd6', '#31a4ae', '#e0524f', '#e5a810', '#3f9a4c', '#8e6fd8'] as const;

export type PortalState = 'open' | 'offline' | 'used';
const STATE_CODE: Record<PortalState, number> = { open: 0, offline: 1, used: 2 };

export interface Portals {
  mesh: InstancedMesh;
  /** portal id → world position of the gate centre */
  centers: Map<number, Vector3>;
  colors: Map<number, number>;
  /** Mark a trigger (pulse) at engine time `now`. */
  pulse(id: number, now: number): void;
  /** Travel: the gate surges from `now`. */
  surge(id: number, now: number): void;
  setState(id: number, s: PortalState): void;
  /**
   * Portal windows: show `image` (its top square, centred) inside the gate, or the `'postcard'` (host colour and
   * monogram); `null` restores the Phase 13 vortex.
   */
  setPreview(id: number, image: PortalPreview): void;
  triangles: number;
}

/** Anything `drawImage` takes (the engine's `StageImage` union). */
export type PreviewImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;
/** What a portal window shows: a picture of the destination, the postcard, or nothing (the Phase 13 vortex). */
export type PortalPreview = PreviewImage | 'postcard' | null;
/** `state.w` codes: 0 = vortex, 1 = picture, 2 = postcard. */
export const PREVIEW_CODE = { none: 0, picture: 1, postcard: 2 } as const;

/** The monogram "favicon" letter for a host (shared by the label card and the postcard). */
export function monogramLetter(host: string): string {
  return (host.replace(/^(en|ja|de|fr|m|mobile|blog|news|www\d?)\./, '')[0] ?? '?').toUpperCase();
}

/** Atlas size for `n` portals: PREVIEW_COLS cells per row. */
export function previewAtlasSize(n: number): { width: number; height: number } {
  return {
    width: PREVIEW_CELL * Math.min(PREVIEW_COLS, Math.max(1, n)),
    height: PREVIEW_CELL * Math.max(1, Math.ceil(n / PREVIEW_COLS)),
  };
}

/** Where portal slot `i` draws in the preview atlas (px): the whole cell, and the inner region the shader samples. */
export function previewCell(i: number): { x: number; y: number; size: number; inner: number } {
  return {
    x: (i % PREVIEW_COLS) * PREVIEW_CELL,
    y: Math.floor(i / PREVIEW_COLS) * PREVIEW_CELL,
    size: PREVIEW_CELL,
    inner: PREVIEW_CELL - 2 * PREVIEW_PAD,
  };
}

/** The source rectangle shown in a window: the top square of the page (above the fold), centred horizontally. */
export function previewCrop(
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const side = Math.min(width, height);
  return { sx: (width - side) / 2, sy: 0, sw: side, sh: side };
}

export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Phase 20 (N): a "Pip gate" (a learning checkpoint, apps/web/src/learning) rides the portal pipeline with a
 * `wwm-learning:<activity>/<n>#<rrggbb>` href: it is drawn in the lesson theme's gate colour, with Pip's face for
 * a monogram and no host line. The web app keeps the same prefix (apps/web/src/learning/href.ts, parity-tested).
 */
export const LEARNING_HREF = 'wwm-learning:';

export function isLearningHref(href: string): boolean {
  return href.startsWith(LEARNING_HREF);
}

/** The portal colour for a target host (stable across stages, so a site keeps its colour). */
export function portalColor(href: string): string {
  if (isLearningHref(href)) {
    const m = /#([0-9a-f]{6})$/i.exec(href);
    return m ? `#${(m[1] as string).toLowerCase()}` : (PORTAL_COLORS[0] as string);
  }
  return PORTAL_COLORS[hash(hostOf(href)) % PORTAL_COLORS.length] as string;
}

const hexNum = (h: string) => Number.parseInt(h.slice(1), 16);

export function buildPortals(
  stage: StageData,
  u: SharedUniforms,
  bin: Bin,
  opts: { reducedMotion?: boolean } = {},
): Portals | null {
  const list = stage.portals ?? [];
  if (list.length === 0) return null;
  const levelOf = new Map(stage.islands.map((i) => [i.id, i.level]));
  const n = list.length;
  const data = new Float32Array(n * 4); // xyz (island top) + atlas row
  const style = new Float32Array(n * 4); // rgb + phase
  const state = new Float32Array(n * 4); // x = pulse time, y = state, z = surge time, w = has a preview picture
  const centers = new Map<number, Vector3>();
  const colors = new Map<number, number>();
  const slot = new Map<number, number>();
  for (const [i, p] of list.entries()) {
    const x = p.pos[0] / PX_PER_METER;
    const z = p.pos[1] / PX_PER_METER;
    const y = (levelOf.get(p.islandId) ?? 0) * LEVEL_HEIGHT_M;
    data.set([x, y, z, i], i * 4);
    const hex = portalColor(p.href);
    const c = hexNum(hex);
    style.set(
      [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, (p.id * 0.618034) % 1],
      i * 4,
    );
    state.set([-100, 0, -100, 0], i * 4);
    centers.set(p.id, new Vector3(x, y + GATE_Y, z));
    colors.set(p.id, c);
    slot.set(p.id, i);
  }
  const dataAttr = new InstancedBufferAttribute(data, 4);
  const styleAttr = new InstancedBufferAttribute(style, 4);
  const stateAttr = new InstancedBufferAttribute(state, 4);

  const atlas = bin.add(makeAtlas(list.map((p) => ({ label: p.label, href: p.href }))));
  const preview = makePreviewAtlas(n);
  bin.add(preview.tex);
  const geo = bin.add(gateGeometry());
  const mat = bin.add(
    portalMaterial(u, dataAttr, styleAttr, stateAttr, atlas, n, preview.tex, opts.reducedMotion ?? false),
  );
  const hrefOf = new Map(list.map((p) => [p.id, p.href]));
  const mesh = new InstancedMesh(geo, mat, n);
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.name = 'portals';
  mesh.renderOrder = 4;

  const write = (id: number, k: number, v: number) => {
    const i = slot.get(id);
    if (i === undefined) return;
    stateAttr.array[i * 4 + k] = v;
    stateAttr.addUpdateRange(i * 4, 4);
    stateAttr.needsUpdate = true;
  };
  return {
    mesh,
    centers,
    colors,
    pulse: (id, now) => write(id, 0, now),
    surge: (id, now) => write(id, 2, now),
    setState: (id, s) => write(id, 1, STATE_CODE[s]),
    setPreview: (id, image) => {
      const i = slot.get(id);
      if (i === undefined) return;
      const c = previewCell(i);
      const ctx = preview.ctx;
      ctx.clearRect(c.x, c.y, c.size, c.size);
      let code: number = PREVIEW_CODE.none;
      if (image === 'postcard') {
        drawPostcard(ctx, c.x, c.y, c.size, hrefOf.get(id) ?? '');
        code = PREVIEW_CODE.postcard;
      } else if (image) {
        const { sx, sy, sw, sh } = previewCrop(image.width, image.height);
        if (sw > 0 && sh > 0) {
          ctx.drawImage(image as CanvasImageSource, sx, sy, sw, sh, c.x, c.y, c.size, c.size);
          code = PREVIEW_CODE.picture;
        }
      }
      preview.tex.needsUpdate = true;
      write(id, 3, code);
    },
    triangles: n * ((geo.attributes.position as BufferAttribute).count / 3),
  };
}

// ── geometry ──────────────────────────────────────────────────────────────────────────────────────────

/** Parts: 0 vortex disc, 1 rim, 2 halo, 3 ground ring, 4 label card, 5 map beam. Local metres, facing +Z. */
function gateGeometry(): BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const part: number[] = [];
  const tri = (
    a: number[],
    b: number[],
    c: number[],
    ua: number[],
    ub: number[],
    uc: number[],
    k: number,
  ) => {
    pos.push(...a, ...b, ...c);
    uvs.push(...ua, ...ub, ...uc);
    part.push(k, k, k);
  };
  const SEG = 64;
  // 0: vortex disc (uv = position relative to the centre / R, in [-1, 1])
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2;
    const a1 = ((i + 1) / SEG) * Math.PI * 2;
    tri(
      [0, GATE_Y, 0],
      [Math.cos(a0) * GATE_R, GATE_Y + Math.sin(a0) * GATE_R, 0],
      [Math.cos(a1) * GATE_R, GATE_Y + Math.sin(a1) * GATE_R, 0],
      [0, 0],
      [Math.cos(a0), Math.sin(a0)],
      [Math.cos(a1), Math.sin(a1)],
      0,
    );
  }
  // 1 rim, 2 halo: vertical annuli (uv.x = angle 0..1, uv.y = 0 inner → 1 outer)
  const ring = (r0: number, r1: number, k: number, lift = 0.002) => {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2;
      const a1 = ((i + 1) / SEG) * Math.PI * 2;
      const p = (r: number, a: number) => [Math.cos(a) * r, GATE_Y + Math.sin(a) * r, lift];
      const u0 = i / SEG;
      const u1 = (i + 1) / SEG;
      tri(p(r0, a0), p(r1, a0), p(r1, a1), [u0, 0], [u0, 1], [u1, 1], k);
      tri(p(r0, a0), p(r1, a1), p(r0, a1), [u0, 0], [u1, 1], [u1, 0], k);
    }
  };
  ring(GATE_R - 0.01, GATE_R + RIM_W, 1, 0.004);
  ring(GATE_R + RIM_W, GATE_R + RIM_W + HALO_W, 2, -0.004);
  // 3: ground ring (horizontal) at the sensor radius
  {
    const r0 = PORTAL_RADIUS_M * 0.8;
    const r1 = PORTAL_RADIUS_M;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2;
      const a1 = ((i + 1) / SEG) * Math.PI * 2;
      const p = (r: number, a: number) => [Math.cos(a) * r, 0.03, Math.sin(a) * r];
      const u0 = i / SEG;
      const u1 = (i + 1) / SEG;
      tri(p(r0, a0), p(r1, a1), p(r1, a0), [u0, 0], [u1, 1], [u0, 1], 3);
      tri(p(r0, a0), p(r0, a1), p(r1, a1), [u0, 0], [u1, 0], [u1, 1], 3);
    }
  }
  // 4: label card, 5: beam (quads in the gate plane)
  const quad = (x0: number, y0: number, x1: number, y1: number, k: number) => {
    tri([x0, y0, 0.01], [x1, y0, 0.01], [x1, y1, 0.01], [0, 1], [1, 1], [1, 0], k);
    tri([x0, y0, 0.01], [x1, y1, 0.01], [x0, y1, 0.01], [0, 1], [1, 0], [0, 0], k);
  };
  quad(-LABEL_W / 2, LABEL_Y - LABEL_H / 2, LABEL_W / 2, LABEL_Y + LABEL_H / 2, 4);
  quad(-0.16, 0, 0.16, BEAM_H, 5);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('part', new BufferAttribute(new Float32Array(part), 1));
  g.computeBoundingSphere();
  return g;
}

// ── material ──────────────────────────────────────────────────────────────────────────────────────────

function portalMaterial(
  u: SharedUniforms,
  dataAttr: InstancedBufferAttribute,
  styleAttr: InstancedBufferAttribute,
  stateAttr: InstancedBufferAttribute,
  atlas: CanvasTexture,
  rows: number,
  preview: CanvasTexture,
  reducedMotion: boolean,
): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  m.name = 'portals';
  const d: N = instancedDynamicBufferAttribute(dataAttr);
  const st: N = instancedDynamicBufferAttribute(styleAttr);
  const s: N = instancedDynamicBufferAttribute(stateAttr);
  const part: N = attribute('part', 'float');
  const t: N = attribute('uv', 'vec2');
  const isPart = (k: number): N => abs(part.sub(k)).lessThan(0.5);

  const offline = s.y.greaterThan(0.5).and(s.y.lessThan(1.5));
  const used = s.y.greaterThan(1.5);
  const hot = exp(clamp(u.time.sub(s.x), 0, 10).mul(-2.2)); // entry pulse, decays in ~1 s
  const surgeK = clamp(u.time.sub(s.z).div(1.2), 0, 1).mul(select(s.z.greaterThan(-50), float(1), float(0)));
  const mapK = clamp(u.mapScale.sub(1).div(2.2), 0, 1);

  // ── vertex: grow in with the intro, surge on travel, face the camera (yaw) ──
  const grow = u.appear.mul(float(1).add(hot.mul(0.12)).add(surgeK.mul(0.45)));
  const p0: N = positionLocal;
  const labelScale = float(1).add(mapK.mul(3.2));
  // gate parts scale about the ground point; the label scales about its own centre and rises in the map view
  const labelLocal = vec3(
    p0.x.mul(labelScale),
    p0.y.sub(LABEL_Y).mul(labelScale).add(LABEL_Y).add(mapK.mul(4)),
    p0.z,
  ).mul(u.appear);
  const beamLocal = vec3(p0.x.mul(float(1).add(mapK.mul(4))), p0.y, p0.z);
  const local = select(isPart(4), labelLocal, select(isPart(5), beamLocal, p0.mul(grow)));
  const toCam = cameraPosition.xz.sub(d.xz);
  const yaw = atan(toCam.x, toCam.y);
  const c = cos(yaw);
  const sn = sin(yaw);
  m.positionNode = vec3(
    local.x.mul(c).add(local.z.mul(sn)),
    local.y,
    local.z.mul(c).sub(local.x.mul(sn)),
  ).add(d.xyz);

  // ── colour ──
  const base0: N = st.xyz.pow(2.2); // sRGB → linear
  const grey = vec3(base0.dot(vec3(0.3, 0.59, 0.11)))
    .mul(0.8)
    .add(0.12);
  const base = select(offline.or(used), grey, base0);
  const speed = select(offline.or(used), float(0.25), float(1).add(surgeK.mul(4)));
  const time = u.time.mul(speed).add(st.w.mul(20));

  // vortex: a log spiral that turns inward, white-hot centre
  const r = length(t);
  const ang = atan(t.y, t.x);
  const arms = sin(
    ang
      .mul(3)
      .add(log(r.add(0.04)).mul(5.5))
      .sub(time.mul(2.4)),
  )
    .mul(0.5)
    .add(0.5);
  const fine = sin(
    ang
      .mul(7)
      .sub(log(r.add(0.04)).mul(9))
      .add(time.mul(1.3)),
  )
    .mul(0.5)
    .add(0.5);
  const core = float(1)
    .sub(smoothstep(0, 0.55, r))
    .pow(1.5);
  // deep portal colour between the arms, pale bright arms, a white-hot eye
  const armsCol = mix(base.mul(0.42), mix(base, vec3(1, 1, 1), 0.6), arms.mul(0.85).add(fine.mul(0.15)));
  const vortexCol = mix(armsCol, vec3(1, 1, 1), clamp(core.pow(1.6).add(surgeK.mul(0.6)), 0, 1));
  const vortexA = smoothstep(1.0, 0.93, r).mul(float(0.8).add(arms.mul(0.2)));

  // rim: bright band with travelling highlights
  const dash = sin(t.x.mul(Math.PI * 2 * 6).sub(time.mul(3)))
    .mul(0.5)
    .add(0.5);
  const rimCol = mix(base, vec3(1, 1, 1), dash.mul(0.55).add(0.25));
  // halo: soft falloff
  const haloA = float(1).sub(t.y).pow(2).mul(0.42);
  // ground ring: breathing like the goal pad
  const breathe = sin(time.mul(3)).mul(0.25).add(0.75);
  // beam (map markers)
  const beamA = mapK
    .mul(float(1).sub(t.y).pow(1.5))
    .mul(0.9)
    .mul(float(1).sub(abs(t.x.sub(0.5)).mul(2)));

  // ── window (portal windows): the destination behind a ragged tear; state.w 1 = picture, 2 = postcard ──
  const hasPic = s.w.greaterThan(0.5);
  const isCard = s.w.greaterThan(1.5);
  const cols = Math.min(PREVIEW_COLS, Math.max(1, rows));
  const prows = Math.max(1, Math.ceil(rows / PREVIEW_COLS));
  const cellX = mod(d.w, PREVIEW_COLS);
  const cellY = d.w.div(PREVIEW_COLS).floor();
  // parallax: the picture drifts against the tear as the camera walks round and rises, so it reads as a window
  const toCamW = cameraPosition.sub(d.xyz);
  const parX = sin(atan(toCamW.x, toCamW.z)).mul(0.045);
  const parY = clamp(toCamW.y.sub(GATE_Y).div(8), -1, 1).mul(0.045);
  const inner = (PREVIEW_CELL - 2 * PREVIEW_PAD) / PREVIEW_CELL;
  const winUv = clamp(
    vec2(t.x.mul(0.45).add(0.5).add(parX), float(0.5).sub(t.y.mul(0.45)).add(parY)),
    0.01,
    0.99,
  );
  const cellUv = vec2(
    cellX.add(winUv.x.mul(inner).add(PREVIEW_PAD / PREVIEW_CELL)).div(cols),
    cellY.add(winUv.y.mul(inner).add(PREVIEW_PAD / PREVIEW_CELL)).div(prows),
  );
  const pic: N = texture(preview, cellUv).rgb;
  const ang0 = atan(t.y, t.x);
  // the tear: a radius wobbling with three harmonics (integer multiples of the angle, so no seam at ±π).
  // Reduced motion freezes it (still ragged, never moving).
  const tearT = reducedMotion ? st.w.mul(20) : time;
  const edge = float(0.9)
    .add(sin(ang0.mul(5).add(tearT.mul(1.7))).mul(0.035))
    .add(sin(ang0.mul(11).sub(tearT.mul(2.3))).mul(0.022))
    .add(sin(ang0.mul(23).add(tearT.mul(3.4))).mul(0.012));
  // the postcard: the drawn card under a slow vortex, so it still reads as a way through (static if reduced)
  const slowT = reducedMotion ? float(0) : u.time.mul(0.5).add(st.w.mul(20));
  const slowArms = sin(
    ang0
      .mul(3)
      .add(log(r.add(0.04)).mul(5.5))
      .sub(slowT),
  )
    .mul(0.5)
    .add(0.5);
  const card = mix(pic, mix(pic, vec3(1, 1, 1), 0.55), slowArms.mul(0.45));
  const winIn = smoothstep(edge.add(0.025), edge.sub(0.015), r);
  const band = float(1).sub(smoothstep(0, 0.06, abs(r.sub(edge))));
  // a saturated tear, and the page sinking into the host colour towards it, so the edge reads on a white page too
  const tearCol = mix(base, vec3(1, 1, 1), 0.12);
  const vign = smoothstep(0.42, 0.9, r.div(edge)).mul(0.6);
  const shownPic = select(isCard, card, pic);
  const winPic = mix(
    select(
      offline.or(used),
      vec3(shownPic.dot(vec3(0.3, 0.59, 0.11)))
        .mul(0.8)
        .add(0.12),
      shownPic,
    ),
    base.mul(0.55),
    vign,
  );
  const winCol = mix(mix(winPic, vec3(1, 1, 1), surgeK.mul(0.75).add(hot.mul(0.12))), tearCol, band);
  const winA = max(winIn, band.mul(0.9));
  const discCol = select(hasPic, winCol, vortexCol);
  const discA = select(hasPic, winA, vortexA);

  // label: atlas row (v = 0 at the top of the atlas: flipY off)
  const row = d.w;
  const lab: N = texture(atlas, vec2(t.x, t.y.add(row).div(rows)));

  const color = select(
    isPart(0),
    discCol,
    select(isPart(1), rimCol, select(isPart(4), lab.rgb, base.mul(0.6).add(0.4))),
  );
  const labelA = lab.a.mul(select(offline, float(0.8), float(1))).mul(u.appear);
  const alpha = select(
    isPart(0),
    discA,
    select(
      isPart(1),
      select(hasPic, float(0), float(0.95)), // the tear replaces the hard rim
      select(isPart(2), haloA, select(isPart(3), breathe.mul(0.9), select(isPart(4), labelA, beamA))),
    ),
  );
  const shown = clamp(color, 0, 1);
  m.opacityNode = clamp(alpha.mul(max(u.appear, float(0))).mul(select(used, float(0.24), float(1))), 0, 1);
  const glow = float(1)
    .add(hot.mul(1.4))
    .add(surgeK.mul(1.5))
    .mul(select(offline, float(0.25), select(used, float(0.15), float(1))));
  const em = select(
    isPart(0),
    select(
      hasPic,
      tearCol.mul(band).mul(1.6), // the picture itself never glows
      vortexCol.mul(arms.mul(0.55).add(core.mul(0.6)).add(0.1)).mul(vortexA),
    ),
    select(
      isPart(1),
      rimCol.mul(1.1),
      select(
        isPart(2),
        base.mul(haloA).mul(1.2),
        select(
          isPart(3),
          base.mul(breathe).mul(1.2),
          select(isPart(4), vec3(0, 0, 0), base.mul(beamA).mul(1.5)),
        ),
      ),
    ),
  );
  // NodeMaterial adds the emissive to the output colour, and the composite screen-blends the bloom
  // (colour + bloom × (1 − colour)): an over-white channel would subtract glow and tint the gate. So the glow is
  // carved out of the shown colour (emissive ≤ colour, colour − emissive + emissive = colour ≤ 1).
  const glowC = min(clamp(em.mul(glow), 0, 1), shown);
  m.colorNode = shown.sub(glowC);
  setEmissive(m, glowC);
  m.alphaTest = 0.003;
  return m;
}

// ── label atlas ───────────────────────────────────────────────────────────────────────────────────────

function mk(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  return typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Up to two lines, word-wrapped; the second ends in an ellipsis if the text is longer. */
function wrap2(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ');
  let first = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = first ? `${first} ${words[i]}` : (words[i] as string);
    if (ctx.measureText(next).width > max && first) break;
    first = next;
  }
  const rest = words.slice(i).join(' ');
  return rest ? [fit(ctx, first, max), fit(ctx, rest, max)] : [fit(ctx, first, max)];
}

/** Pip for a Pip gate's monogram: the chrome ball with its blue seam and two eyes. */
export function drawPip(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const b = r * 0.78;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, b, 0, Math.PI * 2);
  ctx.fillStyle = '#dfe3e6';
  ctx.fill();
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = '#20262d';
  ctx.stroke();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(cx - b, cy + b * 0.28);
  ctx.bezierCurveTo(cx - b * 0.4, cy + b * 0.05, cx + b * 0.4, cy + b * 0.05, cx + b, cy + b * 0.28);
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = '#456e93';
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#20262d';
  for (const dx of [-0.3, 0.3]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * b, cy - b * 0.22, b * 0.11, b * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export const SANS = '"Figtree Variable", Figtree, "Helvetica Neue", Helvetica, Arial, sans-serif';
const DISPLAY = '"Unbounded Variable", Unbounded, "Helvetica Neue", Helvetica, Arial, sans-serif';

/** One 1024 × 256 row per portal: a rounded card with a monogram tile, the link text and the target host. */
function makeAtlas(items: { label: string; href: string }[]): CanvasTexture {
  const cv = mk(ATLAS_W, ROW_H * items.length);
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, cv.width, cv.height);
  for (const [i, it] of items.entries()) {
    const y0 = i * ROW_H;
    const col = portalColor(it.href);
    const host = hostOf(it.href);
    const pad = 14;
    const h = ROW_H - pad * 2;
    const x = pad;
    const y = y0 + pad;
    const w = ATLAS_W - pad * 2;
    const rad = h / 2;
    // card
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.restore();
    // monogram "favicon": the host's first letter on the portal colour
    const cx = x + rad;
    const cy = y + h / 2;
    const mr = h / 2 - 22;
    ctx.beginPath();
    ctx.arc(cx, cy, mr, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    const learning = isLearningHref(it.href);
    if (learning) drawPip(ctx, cx, cy, mr);
    else {
      ctx.fillStyle = col === '#e5a810' ? '#20262d' : '#ffffff';
      ctx.font = `700 ${Math.round(mr * 1.15)}px ${DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const letter = monogramLetter(host);
      ctx.fillText(letter, cx, cy + 4);
    }
    // text
    const tx = cx + mr + 30;
    const tw = x + w - tx - 44;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#20262d';
    // the link text on one line if it fits at 72 px, else two lines at 58 px; the host underneath
    ctx.font = `700 72px ${SANS}`;
    let lines = [it.label];
    let lh = 72;
    if (ctx.measureText(it.label).width > tw) {
      ctx.font = `700 58px ${SANS}`;
      lh = 60;
      lines = wrap2(ctx, it.label, tw);
    }
    // a Pip gate has no host line: its label stands alone, centred
    const hostSize = learning ? 0 : 44;
    const block = lines.length * lh + (learning ? 0 : 12) + hostSize;
    let by = cy - block / 2 + lh * 0.8;
    for (const l of lines) {
      ctx.fillText(l, tx, by);
      by += lh;
    }
    if (!learning) {
      ctx.fillStyle = '#5b6570';
      ctx.font = `600 ${hostSize}px ${SANS}`;
      ctx.fillText(fit(ctx, `${host}  ↗`, tw), tx, by + 4);
    }
  }
  const tex = new CanvasTexture(cv as never);
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}

/**
 * The postcard: a portal whose destination has no picture yet. The host colour as a soft radial field, the
 * monogram large in the middle and the host underneath, drawn into the portal's atlas cell.
 */
function drawPostcard(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, href: string): void {
  const col = portalColor(href);
  const host = hostOf(href);
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  const g = ctx.createRadialGradient(cx, cy - size * 0.08, size * 0.05, cx, cy, size * 0.62);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, col);
  g.addColorStop(1, '#20262d');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = col === '#e5a810' ? '#20262d' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(size * 0.36)}px ${DISPLAY}`;
  ctx.fillText(monogramLetter(host), cx, cy - size * 0.04);
  ctx.font = `600 ${Math.round(size * 0.075)}px ${SANS}`;
  ctx.fillText(fit(ctx, host, size * 0.62), cx, cy + size * 0.22);
  ctx.restore();
}

/** The per-stage preview atlas, allocated at full size up front (a texture can't change size once uploaded). */
function makePreviewAtlas(n: number): { tex: CanvasTexture; ctx: CanvasRenderingContext2D } {
  const { width, height } = previewAtlasSize(n);
  const cv = mk(width, height);
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  const tex = new CanvasTexture(cv as never);
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = true;
  return { tex, ctx };
}
