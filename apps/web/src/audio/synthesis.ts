/** Deterministic original synthesized PCM; shared only by the worker and parity tests. */
export type Sfx =
  | 'item'
  | 'large'
  | 'jump'
  | 'land'
  | 'bump'
  | 'fall'
  | 'splash'
  | 'elevator'
  | 'getGoal'
  | 'goal'
  | 'firework'
  | 'caution'
  | 'click'
  | 'point'
  | 'oneup'
  | 'connected'
  | 'tick'
  | 'go';

export const SR = 44100;

type Synth = (t: number, i: number, n: number) => number;

function render(sec: number, fn: Synth): Float32Array<ArrayBuffer> {
  const n = Math.max(1, Math.floor(sec * SR));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i, n);
  return out;
}

/** Deterministic noise so every build of the sound set is identical. */
function noiseGen(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

const TAU = Math.PI * 2;
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));
const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Sine with a frequency sweep; phase integrated so sweeps stay clean. */
function sweep(
  sec: number,
  f0: number,
  f1: number,
  a: number,
  d: number,
  shape = 1,
): Float32Array<ArrayBuffer> {
  let ph = 0;
  return render(sec, (t) => {
    const k = t / sec;
    const f = f0 + (f1 - f0) * k ** shape;
    ph += (TAU * f) / SR;
    return Math.sin(ph) * env(t, a, d);
  });
}

function bell(
  sec: number,
  notes: number[],
  gap: number,
  decay: number,
  bright = 2,
): Float32Array<ArrayBuffer> {
  return render(sec, (t) => {
    let v = 0;
    notes.forEach((m, k) => {
      const t0 = t - k * gap;
      if (t0 < 0) return;
      const f = midi(m);
      const e = env(t0, 0.004, decay);
      v += (Math.sin(TAU * f * t0 + bright * Math.sin(TAU * f * 2 * t0) * e) * e) / notes.length ** 0.5;
    });
    return v * 0.7;
  });
}

function noiseBurst(sec: number, a: number, d: number, lp: number, seed: number): Float32Array<ArrayBuffer> {
  const rnd = noiseGen(seed);
  let y = 0;
  return render(sec, (t) => {
    y += lp * (rnd() - y);
    return y * env(t, a, d) * 2.2;
  });
}

function mix(...parts: [Float32Array<ArrayBuffer>, number][]): Float32Array<ArrayBuffer> {
  const n = Math.max(...parts.map(([p]) => p.length));
  const out = new Float32Array(n);
  for (const [p, g] of parts)
    for (let i = 0; i < p.length; i++) out[i] = (out[i] as number) + (p[i] as number) * g;
  return out;
}

export function buildSfx(): Record<Sfx, Float32Array<ArrayBuffer>> {
  return {
    // small item: a bright two-tone blip (teal energy)
    item: bell(0.25, [88, 95], 0.045, 0.06, 1.2),
    // large item: a sparkling rising triad
    large: mix(
      [bell(0.9, [76, 83, 88, 95], 0.06, 0.25, 2.5), 0.9],
      [noiseBurst(0.5, 0.01, 0.12, 0.6, 3), 0.08],
    ),
    jump: sweep(0.22, 320, 820, 0.005, 0.08, 0.6),
    land: mix([sweep(0.18, 140, 60, 0.002, 0.05), 1], [noiseBurst(0.12, 0.001, 0.03, 0.25, 5), 0.5]),
    bump: mix([sweep(0.1, 900, 500, 0.001, 0.025), 0.6], [noiseBurst(0.08, 0.001, 0.015, 0.7, 7), 0.4]),
    fall: sweep(1.4, 700, 90, 0.01, 0.6, 0.8),
    splash: mix([noiseBurst(1.2, 0.01, 0.35, 0.12, 11), 1], [sweep(0.5, 220, 110, 0.005, 0.15), 0.4]),
    elevator: render(1.2, (t) => Math.sin(TAU * (180 + 120 * t) * t) * env(t, 0.15, 0.5) * 0.5),
    getGoal: mix([sweep(0.9, 300, 1400, 0.01, 0.5, 1.6), 0.7], [bell(0.9, [84, 91], 0.2, 0.3), 0.5]),
    goal: bell(2.2, [72, 76, 79, 84, 88, 91, 96], 0.11, 0.55, 1.5),
    firework: mix([noiseBurst(1.1, 0.002, 0.28, 0.35, 13), 0.9], [sweep(0.25, 1200, 400, 0.001, 0.06), 0.3]),
    caution: render(0.9, (t) => {
      const on = t % 0.3 < 0.18 ? 1 : 0;
      return Math.sign(Math.sin(TAU * 880 * t)) * 0.18 * on * env(t, 0.005, 0.6);
    }),
    click: bell(0.08, [96], 0, 0.018, 0.5),
    point: bell(0.06, [100], 0, 0.02, 0.3),
    oneup: bell(0.8, [79, 84, 88, 91, 96, 100], 0.05, 0.2, 1.8),
    connected: bell(0.7, [76, 83, 88], 0.09, 0.22, 1),
    tick: bell(0.2, [81], 0, 0.08, 0.6),
    go: bell(0.5, [93], 0, 0.25, 1.4),
  };
}

export function buildRoll(): Float32Array<ArrayBuffer> {
  const rnd = noiseGen(99);
  const data = new Float32Array(SR);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += 0.08 * (rnd() - y);
    data[i] = y * 3 + Math.sin((TAU * 55 * i) / SR) * 0.15;
  }
  return data;
}

export interface PreparedAudio {
  sfx: Record<Sfx, Float32Array<ArrayBuffer>>;
  roll: Float32Array<ArrayBuffer>;
}
