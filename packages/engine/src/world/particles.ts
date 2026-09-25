/**
 * One GPU particle pool for every effect (item pops, large-item explosions, fireworks, landing dust).
 * Each particle's whole life is analytic in the vertex shader (origin, velocity, drag, gravity, birth time),
 * so emitting only writes a small range of instanced attributes and the pool costs a single draw call.
 *
 * Every particle is drawn as a camera-facing **streak** from its position `trail` seconds ago to its
 * position now (both evaluated analytically, so trails curve with gravity and drag). The fragment shader
 * treats the streak as a capsule: soft tail, optional white-hot head and an optional darker rim, which is
 * what makes coloured sparks read on the near-white 2013 sky (additive light would vanish there).
 *
 * The pool is hidden when nothing is alive, and only the used prefix of the ring is instanced.
 * E: fireworks, item explosions ("GLSL for everything", RESEARCH 1.3). Look and tuning are new.
 */
import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  exp,
  float,
  instancedDynamicBufferAttribute,
  max,
  mix,
  positionGeometry,
  select,
  sin,
  smoothstep,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  Vector3,
} from 'three/webgpu';
import type { Bin } from './bin.ts';
import { type N, type SharedUniforms, setEmissive } from './shared.ts';

/** One particle, fully described (see `Particles.spawn`). */
export interface ParticleInit {
  origin: Vector3;
  velocity: Vector3;
  /** absolute engine time (s); may be in the future (scheduled bursts) */
  birth: number;
  life: number;
  color: number | string;
  /** streak half-width (m) */
  size: number;
  gravity?: number;
  drag?: number;
  /** bloom weight */
  glow?: number;
  /** 0..1 sparkle flicker */
  twinkle?: number;
  /** streak length, in seconds of travel */
  trail?: number;
  /** 0..1 white-hot head */
  core?: number;
  /** 0..1 darker rim (reads on a white sky) */
  outline?: number;
}

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
  trail?: number;
  core?: number;
  outline?: number;
  /** seconds from `now` until the particles are born */
  delay?: number;
}

const EPS = 1e-4;

export class Particles {
  readonly object: Mesh;
  private readonly a: InstancedBufferAttribute; // origin xyz, birth
  private readonly b: InstancedBufferAttribute; // velocity xyz, life
  private readonly c: InstancedBufferAttribute; // colour rgb, size
  private readonly d: InstancedBufferAttribute; // gravity, drag, glow, twinkle
  private readonly e: InstancedBufferAttribute; // trail, core, outline, -
  private readonly attrs: InstancedBufferAttribute[];
  private cursor = 0;
  /** instances [0, highWater) may hold live particles */
  private highWater = 0;
  /** engine time after which every particle is dead */
  private aliveUntil = Number.NEGATIVE_INFINITY;
  private dirtyLo = Number.POSITIVE_INFINITY;
  private dirtyHi = -1;
  private readonly color = new Color();
  private readonly tmpDir = new Vector3();

  constructor(
    readonly capacity: number,
    u: SharedUniforms,
    bin: Bin,
    private readonly rng: () => number,
  ) {
    const mk = () => new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.a = mk();
    (this.a.array as Float32Array).fill(-1e4);
    this.b = mk();
    this.c = mk();
    this.d = mk();
    this.e = mk();
    this.attrs = [this.a, this.b, this.c, this.d, this.e];
    const A: N = instancedDynamicBufferAttribute(this.a);
    const B: N = instancedDynamicBufferAttribute(this.b);
    const C: N = instancedDynamicBufferAttribute(this.c);
    const D: N = instancedDynamicBufferAttribute(this.d);
    const E: N = instancedDynamicBufferAttribute(this.e);

    // quad: x = along (0 tail … 1 head), y = side (−1 … 1)
    const geo = bin.add(new BufferGeometry());
    geo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3),
    );
    geo.setIndex([0, 1, 2, 2, 1, 3]);

    const m = bin.add(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false }));
    m.name = 'particles';
    const age = u.time.sub(A.w);
    const life = max(B.w, EPS);
    const alive = age.greaterThanEqual(0).and(age.lessThan(life));
    const k = max(D.y, 0.001);
    // x(t) = x0 + v (1 − e^{−kt}) / k − ½ g t²
    const posAt = (tau: N): N =>
      A.xyz
        .add(
          B.xyz.mul(
            float(1)
              .sub(exp(k.negate().mul(tau)))
              .div(k),
          ),
        )
        .sub(vec3(0, D.x.mul(0.5).mul(tau).mul(tau), 0));
    const tNorm = clamp(age.div(life), 0, 1);
    const ageC = max(age, 0);
    const head: N = cameraViewMatrix.mul(vec4(posAt(ageC), 1)).xyz;
    const tail: N = cameraViewMatrix.mul(vec4(posAt(max(ageC.sub(E.x), 0)), 1)).xyz;
    const width = select(alive, C.w.mul(mix(float(1), float(0.4), tNorm)), float(0));
    const dxy = head.xy.sub(tail.xy);
    const len = dxy.length();
    const dir = select(len.greaterThan(EPS), dxy.div(max(len, EPS)), vec2(0, 1));
    const perp = vec2(dir.y.negate(), dir.x);
    const along = positionGeometry.x;
    const side = positionGeometry.y;
    const xy = mix(tail.xy, head.xy, along)
      .add(dir.mul(along.mul(2).sub(1).mul(width)))
      .add(perp.mul(side.mul(width)));
    m.vertexNode = cameraProjectionMatrix.mul(vec4(xy, mix(tail.z, head.z, along), 1));

    // capsule coordinates, in widths: segment [0, L], caps of radius 1 on both ends
    const L: N = vertexStage(len.div(max(width, EPS)));
    const xl: N = vertexStage(along.mul(L.add(2)).sub(1));
    const sideF: N = vertexStage(side);
    const dx = max(max(xl.negate(), 0), xl.sub(L));
    const dist = vec2(dx, sideF).length();
    const f = clamp(xl.div(max(L, EPS)), 0, 1); // 0 tail … 1 head
    const tailAlpha = mix(float(1), f.pow(1.3), smoothstep(0.3, 1.5, L));
    const disc = float(1).sub(smoothstep(0.72, 1, dist));
    const tv: N = vertexStage(tNorm);
    const ageV: N = vertexStage(age);
    const twinkle = mix(
      float(1),
      sin(ageV.mul(38).add(A.w.mul(91)))
        .mul(0.5)
        .add(0.5),
      D.w,
    );
    const lifeFade = float(1)
      .sub(smoothstep(0.6, 1, tv))
      .mul(twinkle);
    const body = C.xyz.mul(mix(float(0.78), float(1), f));
    const rim = smoothstep(0.4, 0.8, dist).mul(E.z);
    const withRim = mix(body, body.mul(0.42), rim);
    const coreK = float(1)
      .sub(smoothstep(0.05, 0.55, dist))
      .mul(smoothstep(0.55, 1, f))
      .mul(E.y)
      .mul(float(1).sub(tv.mul(0.7)));
    const col = mix(withRim, vec3(1, 0.98, 0.9), coreK);
    const alpha = disc.mul(tailAlpha).mul(lifeFade);
    m.colorNode = col;
    m.opacityNode = alpha;
    setEmissive(m, col.mul(alpha).mul(D.z));

    this.object = new Mesh(geo, m);
    this.object.count = 2;
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.renderOrder = 20;
    this.object.name = 'particles';
  }

  /** Write one particle into the ring. Call `update(now)` once per frame to upload. */
  spawn(p: ParticleInit): void {
    const i = this.cursor;
    const j = i * 4;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    const C = this.c.array as Float32Array;
    const D = this.d.array as Float32Array;
    const E = this.e.array as Float32Array;
    A[j] = p.origin.x;
    A[j + 1] = p.origin.y;
    A[j + 2] = p.origin.z;
    A[j + 3] = p.birth;
    B[j] = p.velocity.x;
    B[j + 1] = p.velocity.y;
    B[j + 2] = p.velocity.z;
    B[j + 3] = p.life;
    this.color.set(p.color);
    C[j] = this.color.r;
    C[j + 1] = this.color.g;
    C[j + 2] = this.color.b;
    C[j + 3] = p.size;
    D[j] = p.gravity ?? 0;
    D[j + 1] = p.drag ?? 1.5;
    D[j + 2] = p.glow ?? 1;
    D[j + 3] = p.twinkle ?? 0;
    E[j] = p.trail ?? 0.05;
    E[j + 1] = p.core ?? 0.5;
    E[j + 2] = p.outline ?? 0;
    E[j + 3] = 0;
    this.dirtyLo = Math.min(this.dirtyLo, i);
    this.dirtyHi = Math.max(this.dirtyHi, i + 1);
    this.aliveUntil = Math.max(this.aliveUntil, p.birth + p.life);
    this.cursor = (i + 1) % this.capacity;
    this.highWater = Math.max(this.highWater, i + 1);
  }

  /** A burst from one point (sphere, upward hemisphere or planar ring). */
  emit(spec: EmitSpec, now: number): void {
    const n = Math.min(spec.count, this.capacity);
    const rnd = (r: [number, number]) => r[0] + (r[1] - r[0]) * this.rng();
    const dir = this.tmpDir;
    for (let i = 0; i < n; i++) {
      // uniform on the sphere (or the upper hemisphere biased up)
      const z = spec.up ? 0.2 + this.rng() * 0.8 : this.rng() * 2 - 1;
      const th = this.rng() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - z * z));
      dir.set(Math.cos(th) * rr, z, Math.sin(th) * rr);
      this.spawn({
        origin: spec.origin,
        velocity: dir.multiplyScalar(rnd(spec.speed)),
        birth: now + (spec.delay ?? 0),
        life: rnd(spec.life),
        color: spec.colors[Math.floor(this.rng() * spec.colors.length)] as number | string,
        size: rnd(spec.size),
        gravity: spec.gravity,
        drag: spec.drag,
        glow: spec.glow,
        twinkle: spec.twinkle,
        trail: spec.trail,
        core: spec.core,
        outline: spec.outline,
      });
    }
  }

  /** Upload what changed and skip the draw entirely while nothing is alive. Call once per frame. */
  update(now: number): void {
    if (this.dirtyHi > this.dirtyLo) {
      for (const attr of this.attrs) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(this.dirtyLo * 4, (this.dirtyHi - this.dirtyLo) * 4);
        attr.needsUpdate = true;
      }
      this.dirtyLo = Number.POSITIVE_INFINITY;
      this.dirtyHi = -1;
    }
    const idle = now >= this.aliveUntil;
    if (idle && this.highWater > 0) {
      // everything is dead: restart the ring so the next burst only instances what it uses
      this.cursor = 0;
      this.highWater = 0;
    }
    this.object.visible = !idle;
    // stay above 1 so the render-object cache key (instanced vs not) never flips
    this.object.count = Math.max(2, this.highWater);
  }

  /** Kill every particle (stage change). */
  clear(): void {
    (this.a.array as Float32Array).fill(-1e4);
    this.dirtyLo = 0;
    this.dirtyHi = this.capacity;
    this.cursor = 0;
    this.highWater = 0;
    this.aliveUntil = Number.NEGATIVE_INFINITY;
  }

  /** Live-instance bookkeeping (tests / stats). */
  get state(): { visible: boolean; instances: number; aliveUntil: number } {
    return { visible: this.object.visible, instances: this.object.count, aliveUntil: this.aliveUntil };
  }
}
