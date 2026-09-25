/**
 * Goal fireworks choreography (pure: produces particle descriptions for the shared GPU pool).
 *
 * E: the count is the remaining whole seconds mod 10, launched 300–800 ms apart (`onUpdate_FLY_AWAY`).
 * N: each firework is an ascending rocket (a golden streak shedding sparks) that bursts where it arrives,
 * in one of several shapes. The sky is near-white `#F8F8F8`, so the sparks carry saturated colour, a darker
 * rim and a white-hot head instead of relying on additive light.
 */
import { Vector3 } from 'three/webgpu';
import { GOAL_LETTERS } from '../palette.ts';
import type { ParticleInit } from './particles.ts';

export type BurstKind = 'peony' | 'chrysanthemum' | 'ring' | 'willow' | 'double';
export const BURST_KINDS: readonly BurstKind[] = ['peony', 'chrysanthemum', 'ring', 'willow', 'double'];

/** Deep, saturated pairs that hold up against a white sky. */
export const FIREWORK_PALETTES: readonly (readonly [string, string])[] = [
  [GOAL_LETTERS[0], '#ff8a1f'],
  ['#ff2d8a', '#8a3cff'],
  ['#1e6bff', '#00b3d6'],
  [GOAL_LETTERS[2], '#0fb88c'],
  ['#ff5a1f', GOAL_LETTERS[1]],
  ['#7a3cff', '#1e6bff'],
];
const GOLD = ['#ffb000', '#ff8c00'] as const;
/** Global burst tuning: shells are sized for a burst ~25–35 m from the goal vantage camera. */
const BURST_SPEED = 1.5;
const BURST_LIFE = 1.2;
const BURST_SIZE = 1.25;

export interface FireworkPlan {
  kind: BurstKind;
  /** seconds from launch to burst */
  flight: number;
  particles: ParticleInit[];
}

/** Rocket drag (1/s) and gravity (m/s²): a slightly decelerating climb. */
const ROCKET_K = 0.6;
const ROCKET_G = 3;

/** Initial velocity so that `x(T) = to` under the pool's motion law (see particles.ts). */
export function rocketVelocity(from: Vector3, to: Vector3, T: number, k = ROCKET_K, g = ROCKET_G): Vector3 {
  const f = (1 - Math.exp(-k * T)) / k;
  return to
    .clone()
    .sub(from)
    .add(new Vector3(0, 0.5 * g * T * T, 0))
    .divideScalar(f);
}

/** Position under the pool's motion law after `t` seconds. */
export function travel(from: Vector3, v: Vector3, t: number, k: number, g: number): Vector3 {
  const f = (1 - Math.exp(-Math.max(k, 0.001) * t)) / Math.max(k, 0.001);
  return from
    .clone()
    .addScaledVector(v, f)
    .add(new Vector3(0, -0.5 * g * t * t, 0));
}

export interface FireworkInput {
  /** where it bursts (world) */
  burst: Vector3;
  /** where the rocket leaves from (world) */
  launch: Vector3;
  /** engine time of the launch */
  now: number;
  /** unit vector from the camera towards the burst (orients rings to face the viewer) */
  viewDir: Vector3;
  kind?: BurstKind;
  palette?: readonly [string, string];
  rng: () => number;
}

export function planFirework(inp: FireworkInput): FireworkPlan {
  const { rng, now } = inp;
  const r = (a: number, b: number) => a + (b - a) * rng();
  const kind = inp.kind ?? (BURST_KINDS[Math.floor(rng() * BURST_KINDS.length)] as BurstKind);
  const pal =
    inp.palette ?? (FIREWORK_PALETTES[Math.floor(rng() * FIREWORK_PALETTES.length)] as [string, string]);
  const out: ParticleInit[] = [];

  // ── rocket: a golden streak that decelerates up to the burst point, shedding sparks ──
  const flight = r(0.95, 1.2);
  const v0 = rocketVelocity(inp.launch, inp.burst, flight);
  out.push({
    origin: inp.launch.clone(),
    velocity: v0,
    birth: now,
    life: flight,
    color: '#ff9d00',
    size: 0.13,
    gravity: ROCKET_G,
    drag: ROCKET_K,
    glow: 1.6,
    trail: 0.22,
    core: 1,
    outline: 0.7,
  });
  const sparks = 16;
  for (let i = 0; i < sparks; i++) {
    const t = (flight * (i + rng() * 0.8)) / sparks;
    out.push({
      origin: travel(inp.launch, v0, t, ROCKET_K, ROCKET_G),
      velocity: new Vector3(r(-0.8, 0.8), r(-1.5, -0.3), r(-0.8, 0.8)),
      birth: now + t,
      life: r(0.35, 0.65),
      color: GOLD[i % 2] as string,
      size: r(0.04, 0.07),
      gravity: 5,
      drag: 2,
      glow: 1.2,
      trail: 0.12,
      core: 0.6,
      outline: 0.5,
      twinkle: 0.5,
    });
  }

  // ── burst ──
  const born = now + flight;
  const dir = new Vector3();
  const sphere = (
    n: number,
    speed: [number, number],
    colors: readonly string[],
    extra: Omit<Partial<ParticleInit>, 'size' | 'life'> & { size: [number, number]; life: [number, number] },
  ) => {
    for (let i = 0; i < n; i++) {
      // stratified directions (golden spiral + jitter) so the shell reads as a clean sphere
      const y = 1 - (2 * (i + 0.5)) / n + r(-0.5, 0.5) / n;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * 2.399963 + r(-0.15, 0.15);
      dir.set(Math.cos(th) * rr, y, Math.sin(th) * rr);
      out.push({
        drag: 1.5,
        gravity: 3,
        glow: 1.3,
        core: 0.8,
        outline: 0.6,
        ...extra,
        origin: inp.burst.clone(),
        velocity: dir.clone().multiplyScalar(r(speed[0], speed[1]) * BURST_SPEED),
        birth: born,
        life: r(extra.life[0], extra.life[1]) * BURST_LIFE,
        size: r(extra.size[0], extra.size[1]) * BURST_SIZE,
        color: colors[i % colors.length] as string,
      });
    }
  };

  switch (kind) {
    case 'peony':
      sphere(150, [10, 11.5], pal, { size: [0.2, 0.27], life: [1.5, 2.1], trail: 0.2, twinkle: 0.15 });
      break;
    case 'chrysanthemum':
      sphere(130, [10.5, 12], [pal[0]], {
        size: [0.15, 0.2],
        life: [1.7, 2.3],
        trail: 0.55,
        core: 1,
        drag: 1.7,
        gravity: 2.4,
      });
      break;
    case 'ring': {
      // a ring roughly facing the camera, plus a small contrasting core
      const n = inp.viewDir
        .clone()
        .multiplyScalar(0.85)
        .add(new Vector3(r(-0.4, 0.4), r(-0.4, 0.4), r(-0.4, 0.4)))
        .normalize();
      const e1 = new Vector3(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0)
        .cross(n)
        .normalize();
      const e2 = n.clone().cross(e1).normalize();
      const count = 90;
      for (let i = 0; i < count; i++) {
        const th = ((i + r(0, 0.3)) / count) * Math.PI * 2;
        dir.copy(e1).multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
        out.push({
          origin: inp.burst.clone(),
          velocity: dir.clone().multiplyScalar(r(11, 11.6) * BURST_SPEED),
          birth: born,
          life: r(1.5, 1.9) * BURST_LIFE,
          color: pal[0],
          size: r(0.2, 0.25) * BURST_SIZE,
          gravity: 2.5,
          drag: 1.5,
          glow: 1.3,
          trail: 0.28,
          core: 0.9,
          outline: 0.6,
        });
      }
      sphere(40, [3.5, 4.5], [pal[1]], { size: [0.16, 0.22], life: [1.1, 1.5], trail: 0.15, twinkle: 0.6 });
      break;
    }
    case 'willow':
      sphere(110, [7, 8.5], GOLD, {
        size: [0.13, 0.18],
        life: [2.6, 3.2],
        trail: 0.7,
        drag: 1.1,
        gravity: 6.5,
        core: 0.7,
        twinkle: 0.25,
      });
      break;
    case 'double':
      sphere(110, [10.5, 11.5], [pal[0]], { size: [0.2, 0.26], life: [1.5, 2.0], trail: 0.25 });
      sphere(60, [5, 6], [pal[1]], { size: [0.18, 0.24], life: [1.3, 1.7], trail: 0.2, twinkle: 0.3 });
      break;
  }
  return { kind, flight, particles: out };
}
