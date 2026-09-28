/** Shared tessellation for curved/banked decks: renderer and collider consume identical surfaces. */
import { LEVEL_HEIGHT_M, PX_PER_METER } from './constants.ts';
import type { Vec3 } from './space.ts';
import type { Bridge, Vec2 } from './types.ts';

export interface BridgeSection {
  pos: Vec2;
  tangent: Vec2;
  /** Normalized horizontal arc distance, used for elevation and bank. */
  progress: number;
  y: number;
  bank: number;
}

export function bridgeSections(br: Bridge): BridgeSection[] {
  const control = br.control ?? [(br.a[0] + br.b[0]) / 2, (br.a[1] + br.b[1]) / 2];
  const bound =
    Math.hypot(control[0] - br.a[0], control[1] - br.a[1]) +
    Math.hypot(br.b[0] - control[0], br.b[1] - control[1]);
  const count = Math.max(16, Math.min(512, Math.ceil(bound / (PX_PER_METER * 0.6))));
  const result: BridgeSection[] = [];
  let distance = 0;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    const pos: Vec2 = [
      u * u * br.a[0] + 2 * u * t * control[0] + t * t * br.b[0],
      u * u * br.a[1] + 2 * u * t * control[1] + t * t * br.b[1],
    ];
    let dx = u * (control[0] - br.a[0]) + t * (br.b[0] - control[0]);
    let dz = u * (control[1] - br.a[1]) + t * (br.b[1] - control[1]);
    if (Math.hypot(dx, dz) < 1e-8) {
      dx = br.b[0] - br.a[0];
      dz = br.b[1] - br.a[1];
    }
    const length = Math.hypot(dx, dz) || 1;
    const previous = result.at(-1);
    if (previous) distance += Math.hypot(pos[0] - previous.pos[0], pos[1] - previous.pos[1]);
    result.push({ pos, tangent: [dx / length, dz / length], progress: distance, y: 0, bank: 0 });
  }
  for (const section of result) {
    section.progress /= distance || 1;
    const u = section.progress;
    const heightProgress = br.elevationProfile === 'smoothstep' ? u * u * (3 - 2 * u) : u;
    section.y = (br.levelA + (br.levelB - br.levelA) * heightProgress) * LEVEL_HEIGHT_M;
    section.bank = (br.bank ?? 0) * Math.sin(Math.PI * section.progress);
  }
  return result;
}

export function bridgeArcLength(br: Bridge): number {
  const sections = bridgeSections(br);
  return sections.slice(1).reduce((sum, section, i) => {
    const previous = sections[i] as BridgeSection;
    return sum + Math.hypot(section.pos[0] - previous.pos[0], section.pos[1] - previous.pos[1]);
  }, 0);
}

/** Point offset laterally from a section center, offset measured in world metres. */
export function bridgeSectionPoint(section: BridgeSection, offset: number, lift = 0): Vec3 {
  return [
    section.pos[0] / PX_PER_METER - section.tangent[1] * offset * Math.cos(section.bank),
    section.y + offset * Math.sin(section.bank) + lift,
    section.pos[1] / PX_PER_METER + section.tangent[0] * offset * Math.cos(section.bank),
  ];
}

/** Closed ribbon prism with vertical slab thickness; side selects an optional outer rail. */
export function bridgeSurfaceMesh(br: Bridge, thickness: number, side = 0, railThickness = 0.1) {
  const sections = bridgeSections(br);
  const half = br.width / PX_PER_METER / 2;
  const lo = side === 0 ? -half : side > 0 ? half : -half - railThickness;
  const hi = side === 0 ? half : side > 0 ? half + railThickness : -half;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const section of sections) {
    // Left/right top, left/right bottom. Rails extrude upward from the deck.
    const top = side === 0 ? 0 : thickness;
    const bottom = side === 0 ? -thickness : 0;
    for (const [offset, lift] of [
      [hi, top],
      [lo, top],
      [hi, bottom],
      [lo, bottom],
    ]) {
      vertices.push(...bridgeSectionPoint(section, offset as number, lift));
    }
  }
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d);
  for (let i = 0; i + 1 < sections.length; i++) {
    const a = i * 4;
    const b = a + 4;
    quad(a, b, b + 1, a + 1); // top, upward
    quad(a + 2, a + 3, b + 3, b + 2); // bottom
    quad(a, a + 2, b + 2, b); // left
    quad(a + 1, b + 1, b + 3, a + 3); // right
  }
  quad(0, 1, 3, 2);
  const end = (sections.length - 1) * 4;
  quad(end, end + 2, end + 3, end + 1);
  return { vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices) };
}

/** Grade of the actual top triangles, plus the analytic vertical-profile maximum.
 * Includes bank/corner effects: a safe centerline must not hide a steep inner edge.
 * A folded or degenerate deck fails closed rather than passing an absolute-normal check.
 */
export function bridgeGradeMetrics(br: Bridge): {
  runMeters: number;
  meanGrade: number;
  maxGrade: number;
  maxColliderGrade: number;
} {
  const sections = bridgeSections(br);
  const runMeters = bridgeArcLength(br) / PX_PER_METER;
  const rise = Math.abs(br.levelB - br.levelA) * LEVEL_HEIGHT_M;
  const meanGrade = rise === 0 ? 0 : rise / (runMeters || 1e-12);
  let maxGrade = meanGrade * (br.elevationProfile === 'smoothstep' ? 1.5 : 1);
  let maxColliderGrade = 0;
  const halfWidth = br.width / PX_PER_METER / 2;
  const grade = (a: Vec3, b: Vec3, c: Vec3): number => {
    const u = b.map((v, i) => v - (a[i] as number));
    const v = c.map((v, i) => v - (a[i] as number));
    const nx = (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number);
    const ny = (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number);
    const nz = (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number);
    return ny > 1e-12 ? Math.hypot(nx, nz) / ny : Infinity;
  };
  for (let i = 1; i < sections.length; i++) {
    const before = sections[i - 1] as BridgeSection;
    const after = sections[i] as BridgeSection;
    const a = bridgeSectionPoint(before, halfWidth);
    const b = bridgeSectionPoint(after, halfWidth);
    const c = bridgeSectionPoint(after, -halfWidth);
    const d = bridgeSectionPoint(before, -halfWidth);
    maxGrade = Math.max(maxGrade, grade(a, b, c), grade(a, c, d));
    const quantized = [a, b, c, d].map((p) => p.map(Math.fround) as Vec3);
    const [qa, qb, qc, qd] = quantized as [Vec3, Vec3, Vec3, Vec3];
    maxColliderGrade = Math.max(maxColliderGrade, grade(qa, qb, qc), grade(qa, qc, qd));
  }
  return { runMeters, meanGrade, maxGrade, maxColliderGrade };
}
