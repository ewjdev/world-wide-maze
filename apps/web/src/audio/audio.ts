/**
 * WebAudio manager. Every sound is synthesized in code at start-up (no sample files, no original 2013 audio);
 * see apps/web/public/audio/CREDITS.md.
 *
 * Cue list (E: `sound/soundeffect`, bundle-notes §11): BGM opening / game / timeup (last 30 s) / result /
 * over; SEs small_item, large item, jump, point (result tick), get_goal, goup (elevator), caution, connected,
 * fall, firework, goal jingle, hit_ground (volume ∝ vertical impact²), hit_guardrail (throttled to 500 ms),
 * oneup, click, plus a rolling loop pitched by speed.
 *
 * Autoplay: nothing sounds until `unlock()` runs inside a user gesture. Mute persists in localStorage.
 */

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

export type Bgm = 'opening' | 'game' | 'timeup' | 'result' | 'over';

const MUTE_KEY = 'wwm.muted';
const SR = 44100;

type Synth = (t: number, i: number, n: number) => number;

function render(sec: number, fn: Synth): Float32Array {
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
function sweep(sec: number, f0: number, f1: number, a: number, d: number, shape = 1): Float32Array {
  let ph = 0;
  return render(sec, (t) => {
    const k = t / sec;
    const f = f0 + (f1 - f0) * k ** shape;
    ph += (TAU * f) / SR;
    return Math.sin(ph) * env(t, a, d);
  });
}

function bell(sec: number, notes: number[], gap: number, decay: number, bright = 2): Float32Array {
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

function noiseBurst(sec: number, a: number, d: number, lp: number, seed: number): Float32Array {
  const rnd = noiseGen(seed);
  let y = 0;
  return render(sec, (t) => {
    y += lp * (rnd() - y);
    return y * env(t, a, d) * 2.2;
  });
}

function mix(...parts: [Float32Array, number][]): Float32Array {
  const n = Math.max(...parts.map(([p]) => p.length));
  const out = new Float32Array(n);
  for (const [p, g] of parts)
    for (let i = 0; i < p.length; i++) out[i] = (out[i] as number) + (p[i] as number) * g;
  return out;
}

function buildSfx(): Record<Sfx, Float32Array> {
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

// ── music ────────────────────────────────────────────────────────────────────────────────────────────────

interface Track {
  bpm: number;
  /** 16th-note steps per bar and loop length in bars. */
  bars: number;
  /** Chord roots (MIDI) per bar and the chord quality. */
  chords: [number, number[]][];
  /** Arpeggio pattern: chord-tone index per 16th (null = rest). */
  arp: (number | null)[];
  bass: boolean;
  loop: boolean;
  gain: number;
  wave: OscillatorType;
}

const MAJ7 = [0, 4, 7, 11];
const MIN7 = [0, 3, 7, 10];
const ADD9 = [0, 4, 7, 14];
const SUS = [0, 5, 7, 12];

export const TRACKS: Record<Bgm, Track> = {
  opening: {
    bpm: 84,
    bars: 4,
    chords: [
      [60, MAJ7],
      [57, MIN7],
      [65, MAJ7],
      [67, SUS],
    ],
    arp: [0, null, 2, null, 1, null, 3, null, 2, null, 1, null, 3, null, 2, null],
    bass: false,
    loop: true,
    gain: 0.16,
    wave: 'sine',
  },
  game: {
    bpm: 118,
    bars: 4,
    chords: [
      [62, ADD9],
      [59, MIN7],
      [67, ADD9],
      [69, SUS],
    ],
    arp: [0, 2, 1, 3, 2, 1, 0, 2, 3, 1, 2, 0, 1, 3, 2, 1],
    bass: true,
    loop: true,
    gain: 0.12,
    wave: 'triangle',
  },
  timeup: {
    bpm: 152,
    bars: 2,
    chords: [
      [62, MIN7],
      [60, MIN7],
    ],
    arp: [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 0, 3, 2, 1],
    bass: true,
    loop: true,
    gain: 0.12,
    wave: 'triangle',
  },
  result: {
    bpm: 100,
    bars: 2,
    chords: [
      [65, ADD9],
      [67, MAJ7],
    ],
    arp: [0, null, 1, 2, null, 3, 2, null, 1, null, 2, 3, null, 2, 1, null],
    bass: true,
    loop: true,
    gain: 0.13,
    wave: 'sine',
  },
  over: {
    bpm: 72,
    bars: 2,
    chords: [
      [57, MIN7],
      [52, MIN7],
    ],
    arp: [3, null, null, 2, null, null, 1, null, 0, null, null, null, null, null, null, null],
    bass: true,
    loop: false,
    gain: 0.16,
    wave: 'sine',
  },
};

export interface AudioManagerOptions {
  muted?: boolean;
}

export class AudioManager {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #musicBus: GainNode | null = null;
  #buffers: Partial<Record<Sfx, AudioBuffer>> = {};
  #muted: boolean;
  #lastBump = 0;
  #roll: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  #music: { track: Bgm; timer: ReturnType<typeof setInterval>; nextAt: number; step: number } | null = null;
  #wantMusic: Bgm | null = null;
  #listeners = new Set<() => void>();

  constructor(opts: AudioManagerOptions = {}) {
    let saved = false;
    try {
      saved = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      saved = false;
    }
    this.#muted = opts.muted ?? saved;
  }

  get muted(): boolean {
    return this.#muted;
  }

  get unlocked(): boolean {
    return this.#ctx?.state === 'running';
  }

  onChange(cb: () => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  /** Call from a user gesture (click / key). Creates the context and the sound set on first use. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.#ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.#ctx = ctx;
      this.#master = ctx.createGain();
      this.#master.gain.value = this.#muted ? 0 : 0.8;
      this.#master.connect(ctx.destination);
      this.#musicBus = ctx.createGain();
      this.#musicBus.gain.value = 1;
      this.#musicBus.connect(this.#master);
      const raw = buildSfx();
      for (const [k, data] of Object.entries(raw) as [Sfx, Float32Array][]) {
        const b = ctx.createBuffer(1, data.length, SR);
        b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
        this.#buffers[k] = b;
      }
    }
    if (this.#ctx.state === 'suspended') void this.#ctx.resume();
    if (this.#wantMusic && !this.#music) this.setMusic(this.#wantMusic);
    for (const l of this.#listeners) l();
  }

  setMuted(m: boolean): void {
    this.#muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      // ignore
    }
    if (this.#master && this.#ctx)
      this.#master.gain.setTargetAtTime(m ? 0 : 0.8, this.#ctx.currentTime, 0.03);
    for (const l of this.#listeners) l();
  }

  play(s: Sfx, opts: { gain?: number; rate?: number } = {}): void {
    const ctx = this.#ctx;
    const buf = this.#buffers[s];
    if (!ctx || !buf || !this.#master || ctx.state !== 'running') return;
    if (s === 'bump') {
      // E: hit_guardrail is throttled to 500 ms
      if (ctx.currentTime - this.#lastBump < 0.5) return;
      this.#lastBump = ctx.currentTime;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1.5, opts.gain ?? 1)) * 0.6;
    src.connect(g).connect(this.#master);
    src.start();
  }

  /** E: impact volume ∝ vertical speed². `impact` in m/s. */
  impact(kind: 'land' | 'bump', impact: number): void {
    const g = Math.min(1.2, (impact / 12) ** 2);
    if (g < 0.02) return;
    this.play(kind, { gain: g, rate: 0.9 + Math.min(0.3, impact / 60) });
  }

  /** Rolling loop: pitch and volume by speed, silent in the air (E). */
  setRoll(speed: number, grounded: boolean): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#master || ctx.state !== 'running') return;
    if (!this.#roll) {
      const rnd = noiseGen(99);
      const data = new Float32Array(SR);
      let y = 0;
      for (let i = 0; i < data.length; i++) {
        y += 0.08 * (rnd() - y);
        data[i] = y * 3 + Math.sin((TAU * 55 * i) / SR) * 0.15;
      }
      const b = ctx.createBuffer(1, data.length, SR);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.#master);
      src.start();
      this.#roll = { src, gain, filter };
    }
    const k = grounded ? Math.min(1, speed / 14) : 0;
    const now = ctx.currentTime;
    this.#roll.gain.gain.setTargetAtTime(k * 0.5, now, 0.06);
    this.#roll.src.playbackRate.setTargetAtTime(0.6 + k * 1.1, now, 0.08);
    this.#roll.filter.frequency.setTargetAtTime(250 + k * 1600, now, 0.08);
  }

  /** Switch the background music (null = silence). Remembered until unlock. */
  setMusic(track: Bgm | null): void {
    this.#wantMusic = track;
    if (this.#music?.track === track) return;
    this.#stopMusic();
    const ctx = this.#ctx;
    if (!track || !ctx || !this.#musicBus || ctx.state === 'closed') return;
    const tr = TRACKS[track];
    const stepSec = 60 / tr.bpm / 4;
    const state = {
      track,
      timer: 0 as unknown as ReturnType<typeof setInterval>,
      nextAt: ctx.currentTime + 0.08,
      step: 0,
    };
    const total = tr.bars * 16;
    const scheduler = () => {
      if (!this.#musicBus) return;
      while (state.nextAt < ctx.currentTime + 0.25) {
        if (!tr.loop && state.step >= total) {
          clearInterval(state.timer);
          return;
        }
        const s = state.step % total;
        const [root, chord] = tr.chords[Math.floor(s / 16)] as [number, number[]];
        const a = tr.arp[s % 16];
        if (a !== null && a !== undefined) {
          const m = root + (chord[a % chord.length] as number) + 12;
          this.#note(midi(m), state.nextAt, stepSec * 1.8, tr.gain, tr.wave);
        }
        if (tr.bass && s % 8 === 0)
          this.#note(midi(root - 12), state.nextAt, stepSec * 7, tr.gain * 1.1, 'sine');
        state.nextAt += stepSec;
        state.step++;
      }
    };
    state.timer = setInterval(scheduler, 60);
    this.#music = state;
    scheduler();
  }

  #note(freq: number, at: number, dur: number, gain: number, wave: OscillatorType): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#musicBus) return;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    o.connect(g).connect(this.#musicBus);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  #stopMusic(): void {
    if (this.#music) clearInterval(this.#music.timer);
    this.#music = null;
  }

  dispose(): void {
    this.#stopMusic();
    this.#roll?.src.stop();
    this.#roll = null;
    void this.#ctx?.close();
    this.#ctx = null;
    this.#listeners.clear();
  }
}
