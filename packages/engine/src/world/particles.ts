/**
 * One GPU particle pool for every effect (item pops, large-item explosions, fireworks, landing dust).
 * Each particle's whole life is analytic in the vertex shader (origin, velocity, drag, gravity, birth time),
 * so emitting only writes a small range of instanced attributes and the pool costs a single draw call.
 * E: fireworks, item explosions ("GLSL for everything", RESEARCH 1.3). Look and tuning are new.
 */
import {
  exp,
  float,
  instancedDynamicBufferAttribute,
  max,
  mix,
  select,
  sin,
  smoothstep,
  uv,
  vec3,
} from 'three/tsl';
import { Color, InstancedBufferAttribute, Sprite, SpriteNodeMaterial, type Vector3 } from 'three/webgpu';
import type { Bin } from './bin.ts';
import { type N, type SharedUniforms, setEmissive } from './shared.ts';

export interface EmitSpec {
  origin: Vector3;
  count: number;
  /** speed range (m/s) */
  speed: [number, number];
  /** life range (s) */
  life: [number, number];
  /** size range (m) */
  size: [number, number];
  colors: readonly (number | string)[];
  gravity?: number;
  drag?: number;
  /** emission cone: undefined = sphere, otherwise a mostly-upward hemisphere */
  up?: boolean;
  /** extra glow (bloom) weight */
  glow?: number;
  /** sparkle flicker */
  twinkle?: number;
}

export class Particles {
  readonly sprite: Sprite;
  private readonly a: InstancedBufferAttribute; // origin xyz, birth
  private readonly b: InstancedBufferAttribute; // velocity xyz, life
  private readonly c: InstancedBufferAttribute; // colour rgb, size
  private readonly d: InstancedBufferAttribute; // gravity, drag, glow, twinkle
  private cursor = 0;
  private readonly color = new Color();

  constructor(
    readonly capacity: number,
    u: SharedUniforms,
    bin: Bin,
    private readonly rng: () => number,
  ) {
    this.a = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-1e4), 4);
    this.b = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.c = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.d = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const A: N = instancedDynamicBufferAttribute(this.a);
    const B: N = instancedDynamicBufferAttribute(this.b);
    const C: N = instancedDynamicBufferAttribute(this.c);
    const D: N = instancedDynamicBufferAttribute(this.d);
    const m = bin.add(new SpriteNodeMaterial({ transparent: true, depthWrite: false }));
    m.name = 'particles';
    const age = u.time.sub(A.w);
    const life = B.w;
    const alive = age.greaterThanEqual(0).and(age.lessThan(life));
    const k = max(D.y, 0.001);
    // x(t) = x0 + v (1 − e^{−kt}) / k − ½ g t²
    const travel = float(1).sub(exp(k.negate().mul(age))).div(k);
    const pos = A.xyz.add(B.xyz.mul(travel)).sub(vec3(0, D.x.mul(0.5).mul(age).mul(age), 0));
    m.positionNode = pos;
    const t = age.div(max(life, 0.001));
    const twinkle = mix(float(1), sin(age.mul(38).add(A.w.mul(91))).mul(0.5).add(0.5), D.w);
    m.scaleNode = select(alive, C.w.mul(float(1).sub(t.mul(0.6))), float(0));
    const r = uv().sub(0.5).length().mul(2);
    const disc = float(1).sub(smoothstep(0.35, 1, r));
    const fade = float(1).sub(smoothstep(0.55, 1, t)).mul(twinkle);
    m.colorNode = C.xyz.mul(disc).mul(fade);
    setEmissive(m, C.xyz.mul(disc).mul(fade).mul(D.z));
    m.opacityNode = disc.mul(fade);
    this.sprite = new Sprite(m);
    this.sprite.count = capacity;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 20;
    this.sprite.name = 'particles';
  }

  emit(spec: EmitSpec, now: number): void {
    const n = Math.min(spec.count, this.capacity);
    const start = this.cursor;
    const rnd = (r: [number, number]) => r[0] + (r[1] - r[0]) * this.rng();
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    const C = this.c.array as Float32Array;
    const D = this.d.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const j = ((start + i) % this.capacity) * 4;
      // direction: uniform on the sphere (or upper hemisphere biased up)
      const z = spec.up ? 0.2 + this.rng() * 0.8 : this.rng() * 2 - 1;
      const th = this.rng() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - z * z));
      const sp = rnd(spec.speed);
      A[j] = spec.origin.x;
      A[j + 1] = spec.origin.y;
      A[j + 2] = spec.origin.z;
      A[j + 3] = now;
      B[j] = Math.cos(th) * rr * sp;
      B[j + 1] = z * sp;
      B[j + 2] = Math.sin(th) * rr * sp;
      B[j + 3] = rnd(spec.life);
      this.color.set(spec.colors[Math.floor(this.rng() * spec.colors.length)] as number);
      C[j] = this.color.r;
      C[j + 1] = this.color.g;
      C[j + 2] = this.color.b;
      C[j + 3] = rnd(spec.size);
      D[j] = spec.gravity ?? 0;
      D[j + 1] = spec.drag ?? 1.5;
      D[j + 2] = spec.glow ?? 1;
      D[j + 3] = spec.twinkle ?? 0;
    }
    this.cursor = (start + n) % this.capacity;
    const wrap = start + n > this.capacity;
    for (const attr of [this.a, this.b, this.c, this.d]) {
      if (wrap) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, this.capacity * 4);
      } else attr.addUpdateRange(start * 4, n * 4);
      attr.needsUpdate = true;
    }
  }

  /** Kill every particle (stage change). */
  clear(): void {
    (this.a.array as Float32Array).fill(-1e4);
    this.a.clearUpdateRanges();
    this.a.needsUpdate = true;
  }
}
