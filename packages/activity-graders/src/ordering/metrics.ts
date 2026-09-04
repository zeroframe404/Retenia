/**
 * The four `scoring` modes of the `ordering` family (`docs/spec/03-activities.md` §7):
 * exact, adjacent pairs (what `docs/spec/02-memory-system.md` §10's "Order steps" row grades
 * on), Kendall τ and exact position. Every metric is computed against a key and treats an item
 * missing from the answer, or a distractor in it, as wrong.
 */

export function exactScore(order: readonly string[], keys: readonly (readonly string[])[]): 0 | 1 {
  return keys.some((key) => key.length === order.length && key.every((id, i) => id === order[i]))
    ? 1
    : 0
}

export interface AdjacentPairsScore {
  /** Correctly ordered consecutive pairs over the key's `n − 1` pairs. */
  score: number
  /** The pair count §10 grades on: `n − 1` minus the correct ones. */
  outOfOrder: number
}

export function adjacentPairsScore(
  order: readonly string[],
  key: readonly string[],
): AdjacentPairsScore {
  const pairs = key.length - 1
  if (pairs < 1) return { score: 1, outOfOrder: 0 }
  const rank = new Map(key.map((id, i) => [id, i]))
  let correct = 0
  for (let i = 1; i < order.length; i++) {
    const before = rank.get(order[i - 1] as string)
    const after = rank.get(order[i] as string)
    if (before !== undefined && after !== undefined && before < after) correct += 1
  }
  return { score: correct / pairs, outOfOrder: pairs - correct }
}

export interface KendallTau {
  /** In `[−1, 1]`: 1 for the key's order, −1 for its reverse. */
  tau: number
  concordant: number
  discordant: number
}

/** Over every pair of key items; a pair with an item missing from the answer counts as discordant. */
export function kendallTau(order: readonly string[], key: readonly string[]): KendallTau {
  const position = new Map(order.map((id, i) => [id, i]))
  let concordant = 0
  let discordant = 0
  for (let i = 0; i < key.length; i++) {
    for (let j = i + 1; j < key.length; j++) {
      const a = position.get(key[i] as string)
      const b = position.get(key[j] as string)
      if (a !== undefined && b !== undefined && a < b) concordant += 1
      else discordant += 1
    }
  }
  const total = concordant + discordant
  return { tau: total === 0 ? 1 : (concordant - discordant) / total, concordant, discordant }
}

/** The fraction of key positions holding the right item. */
export function positionScore(order: readonly string[], key: readonly string[]): number {
  if (key.length === 0) return 1
  let inPlace = 0
  key.forEach((id, i) => {
    if (order[i] === id) inPlace += 1
  })
  return inPlace / key.length
}
