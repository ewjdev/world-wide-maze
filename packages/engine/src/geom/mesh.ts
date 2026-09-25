/**
 * Minimal non-indexed mesh accumulator (pure, no three.js). Every triangle carries a flat face normal and a
 * per-face random `seed` (drives the 2013 "fragmented" facet colour variation in the shader), plus the intro
 * animation attributes:
 * - `anim` = (delay 0..1, group) where group 0 extrudes with its island and group 1 rises with the bridges;
 * - `base` = the world Y of the surface the vertex belongs to (rails and posts grow up from it).
 */

export type V2 = readonly [number, number];
export type V3 = readonly [number, number, number];

export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  seed: Float32Array;
  anim: Float32Array;
  base: Float32Array;
  /** Per-vertex glow weight (0 = none). Only used by some meshes. */
  glow: Float32Array;
  /** Per-vertex base colour as HSV (the "fragmented" material adds the animated per-face variation). */
  hsv: Float32Array;
  triangles: number;
}

export interface FaceAttrs {
  seed: number;
  delay: number;
  group: number;
  base: number;
  glow: number;
  hsv: V3;
}

const ZERO_UV: V2 = [0, 0];

export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uvs: number[] = [];
  private seeds: number[] = [];
  private anims: number[] = [];
  private bases: number[] = [];
  private glows: number[] = [];
  private hsvs: number[] = [];
  /** Attributes applied to the next faces. */
  readonly face: FaceAttrs = { seed: 0, delay: 0, group: 0, base: 0, glow: 0, hsv: [0, 0, 1] };

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  /**
   * Add a triangle. If `facing` is given, the winding is flipped when needed so the face normal points
   * along it (front face = counter-clockwise seen from the normal side, three.js default).
   */
  tri(a: V3, b: V3, c: V3, ua: V2 = ZERO_UV, ub: V2 = ZERO_UV, uc: V2 = ZERO_UV, facing?: V3): void {
    let n = faceNormal(a, b, c);
    if (n === null) return; // degenerate
    if (facing && n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
      n = [-n[0], -n[1], -n[2]];
    }
    const f = this.face;
    for (const [p, u] of [
      [a, ua],
      [b, ub],
      [c, uc],
    ] as const) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uvs.push(u[0], u[1]);
      this.seeds.push(f.seed);
      this.anims.push(f.delay, f.group);
      this.bases.push(f.base);
      this.glows.push(f.glow);
      this.hsvs.push(f.hsv[0], f.hsv[1], f.hsv[2]);
    }
  }

  /** Quad a-b-c-d (in order around the perimeter) as two triangles. */
  quad(a: V3, b: V3, c: V3, d: V3, ua?: V2, ub?: V2, uc?: V2, ud?: V2, facing?: V3): void {
    this.tri(a, b, c, ua, ub, uc, facing);
    this.tri(a, c, d, ua, uc, ud, facing);
  }

  /**
   * Axis-free box: a prism with the given 4-point bottom ring (x, z) extruded from y0 to y1 (per corner),
   * so ramps can have sloped boxes. `ring` must be in perimeter order.
   */
  prism(ring: readonly V2[], y0: readonly number[], y1: readonly number[], caps = true): void {
    const n = ring.length;
    let cx = 0;
    let cz = 0;
    for (const p of ring) {
      cx += p[0] / n;
      cz += p[1] / n;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = ring[i] as V2;
      const b = ring[j] as V2;
      const mx = (a[0] + b[0]) / 2 - cx;
      const mz = (a[1] + b[1]) / 2 - cz;
      this.quad(
        [a[0], y1[i] as number, a[1]],
        [b[0], y1[j] as number, b[1]],
        [b[0], y0[j] as number, b[1]],
        [a[0], y0[i] as number, a[1]],
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [mx, 0, mz],
      );
    }
    if (caps && n >= 3) {
      for (let i = 1; i + 1 < n; i++) {
        const a = ring[0] as V2;
        const b = ring[i] as V2;
        const c = ring[i + 1] as V2;
        this.tri([a[0], y1[0] as number, a[1]], [b[0], y1[i] as number, b[1]], [c[0], y1[i + 1] as number, c[1]], undefined, undefined, undefined, [0, 1, 0]);
        this.tri([a[0], y0[0] as number, a[1]], [b[0], y0[i] as number, b[1]], [c[0], y0[i + 1] as number, c[1]], undefined, undefined, undefined, [0, -1, 0]);
      }
    }
  }

  build(): MeshData {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nor),
      uv: new Float32Array(this.uvs),
      seed: new Float32Array(this.seeds),
      anim: new Float32Array(this.anims),
      base: new Float32Array(this.bases),
      glow: new Float32Array(this.glows),
      hsv: new Float32Array(this.hsvs),
      triangles: this.pos.length / 9,
    };
  }
}

export function faceNormal(a: V3, b: V3, c: V3): [number, number, number] | null {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;
  return [nx / len, ny / len, nz / len];
}

/** Merge several MeshData into one (used to count/verify merges and to combine per-type buffers). */
export function mergeMeshData(parts: readonly MeshData[]): MeshData {
  const total = parts.reduce((s, p) => s + p.triangles, 0);
  const v = total * 3;
  const out: MeshData = {
    position: new Float32Array(v * 3),
    normal: new Float32Array(v * 3),
    uv: new Float32Array(v * 2),
    seed: new Float32Array(v),
    anim: new Float32Array(v * 2),
    base: new Float32Array(v),
    glow: new Float32Array(v),
    hsv: new Float32Array(v * 3),
    triangles: total,
  };
  let o = 0;
  for (const p of parts) {
    const n = p.triangles * 3;
    out.position.set(p.position, o * 3);
    out.normal.set(p.normal, o * 3);
    out.uv.set(p.uv, o * 2);
    out.seed.set(p.seed, o);
    out.anim.set(p.anim, o * 2);
    out.base.set(p.base, o);
    out.glow.set(p.glow, o);
    out.hsv.set(p.hsv, o * 3);
    o += n;
  }
  return out;
}
