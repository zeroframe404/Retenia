/**
 * The deterministic shuffle of `docs/spec/03-activities.md` §9 ("deterministic shuffling, seed per
 * session"). Two runs of the same session seed over the same activity present the options in the
 * same order — which is what makes a Storybook snapshot, a Playwright run and a resumed exam agree,
 * and what lets §7's `grading.shuffle` be a presentation concern the graders never see: the ids
 * travel with the items, so a shuffled render grades exactly like an unshuffled one.
 */

/** FNV-1a over the seed string: fast, stable across platforms, and enough for a PRNG seed. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: 32 bits of state, uniform enough for shuffling and trivially reproducible. */
export function createRng(seed: string): () => number {
  let state = hashSeed(seed)
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates over a copy; the input is never mutated. */
export function shuffleWithRng<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const a = out[index] as T
    const b = out[swap] as T
    out[index] = b
    out[swap] = a
  }
  return out
}

export function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  return shuffleWithRng(items, createRng(seed))
}

/**
 * The seed of one list inside one activity. Namespacing by `key` is what keeps a pairs activity's
 * right column from being permuted identically to its left one, while both stay reproducible.
 */
export function listSeed(sessionSeed: string, activityId: string, key: string): string {
  return `${sessionSeed}:${activityId}:${key}`
}
