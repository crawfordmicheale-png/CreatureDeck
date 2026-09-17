/**
 * Deterministic pseudo-random number generation.
 *
 * Every random decision in a battle flows through one of these, so a battle
 * replayed with the same seed and the same inputs produces an identical log.
 * That keeps balance work and regression tests honest.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number;
  /** True with the given probability (0..1). */
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Returns a shuffled copy; the input is left untouched. */
  shuffle<T>(items: readonly T[]): T[];
  /** A new independent stream derived from this one, for sub-systems. */
  fork(salt: number): Rng;
}

/** mulberry32 — small, fast, and good enough for game logic. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (maxExclusive) => (maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive)),
    range: (min, max) => (max <= min ? min : min + Math.floor(next() * (max - min + 1))),
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new Error('Rng.pick called on an empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i] as (typeof copy)[number];
        const b = copy[j] as (typeof copy)[number];
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },
    fork: (salt) => createRng((state ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0),
  };

  return rng;
}

/** Turns an arbitrary string into a seed, so seeds can be human-readable. */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
