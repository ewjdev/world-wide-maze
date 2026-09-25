/**
 * Seeded PRNG (mulberry32) for all deterministic code (overview §7). No Math.random in builder/physics/solver.
 *
 * `fork(label)` derives an independent child stream from the ROOT seed and the label, not from the parent's
 * current position. Forks are therefore stable no matter how many numbers the parent has consumed, and
 * forking the same label twice yields the same stream (use distinct labels, e.g. `items:${islandId}`).
 */

/** Raw mulberry32 generator: returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a hash of a string (UTF-16 code units). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix two uint32 values into one (murmur3 finalizer over a combined word). */
function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Rng {
  /** The uint32 seed this stream was created from. */
  readonly seed: number;
  /** Float in [0, 1). */
  next(): number;
  /** Uint32 in [0, 2^32). */
  nextUint32(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates shuffle IN PLACE; returns the same array. */
  shuffle<T>(items: T[]): T[];
  /** Independent child stream derived from (root seed, label). */
  fork(label: string): Rng;
}

/** Create a seeded RNG. `seed` is coerced to uint32. */
export function createRng(seed: number): Rng {
  const s = seed >>> 0;
  const gen = mulberry32(s);
  const rng: Rng = {
    seed: s,
    next: gen,
    nextUint32: () => Math.floor(gen() * 4294967296) >>> 0,
    range: (min, max) => min + gen() * (max - min),
    int: (min, max) => {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi < lo) throw new RangeError(`rng.int: empty range [${min}, ${max}]`);
      return lo + Math.floor(gen() * (hi - lo + 1));
    },
    chance: (p) => gen() < p,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError('rng.pick: empty array');
      return items[Math.floor(gen() * items.length)] as T;
    },
    shuffle: <T>(items: T[]): T[] => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(gen() * (i + 1));
        const tmp = items[i] as T;
        items[i] = items[j] as T;
        items[j] = tmp;
      }
      return items;
    },
    fork: (label) => createRng(mix(s, hashString(label))),
  };
  return rng;
}
