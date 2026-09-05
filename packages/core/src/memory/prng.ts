/**
 * Deterministic randomness for the scheduler.
 *
 * Fuzz has to be reproducible: the same card reviewed the same way must land on the same
 * day on every device and in every test run, or a synced collection would drift and a
 * regression fixture would flap (`docs/spec/02-memory-system.md` §3.2 (i), "PRNG seeded per
 * card"). So instead of `Math.random`, each review draws from mulberry32 seeded with a hash
 * of the card id and its review count.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** FNV-1a over the UTF-16 code units of `input`, as an unsigned 32-bit integer. */
export function hashString(input: string, seed: number = FNV_OFFSET_BASIS): number {
  let hash = seed >>> 0
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/**
 * mulberry32 (Tommy Ettinger): a 32-bit generator with a period of 2^32 that passes
 * gjrand's tests — plenty for choosing a day inside a fuzz window. Returns numbers in
 * `[0, 1)`.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The fuzz seed of one review: the card's id and how many reviews it has had, so every
 *  review of a card draws differently but the same review always draws the same. */
export function fuzzSeed(cardId: string, reps: number): number {
  return hashString(`${cardId}:${reps}`)
}

/**
 * Fisher-Yates over a copy, drawing from `rng`.
 *
 * `packages/activities/src/host/shuffle.ts` has the same function for shuffling an
 * activity's options on screen, and this is deliberately not shared: `core` may import no
 * internal package (`tooling/scripts/check-deps.mjs`), and the two generators are seeded
 * differently on purpose — the host's seed is per *list within one activity*, this one's is
 * per *session*. Keeping them apart means changing how options are shuffled on screen can
 * never silently reorder a review queue.
 */
export function shuffleWithRng<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1))
    const held = copy[index] as T
    copy[index] = copy[swap] as T
    copy[swap] = held
  }
  return copy
}

/**
 * Pick one of `items` deterministically from `seed`, or `undefined` when there is nothing
 * to pick. The tie-break of the session generator: given the same seed and the same
 * candidates, the same activity is chosen on every device and in every test run.
 */
export function pickWithSeed<T>(items: readonly T[], seed: string): T | undefined {
  if (items.length === 0) return undefined
  const index = hashString(seed) % items.length
  return items[index]
}
