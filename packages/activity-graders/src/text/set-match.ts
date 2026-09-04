import { type MatchOptions, matchText } from './match'

/** `list_recall`'s "FUZ set-match" (`docs/spec/03-activities.md` §4 row 7): order-free matching of two lists. */

export interface SetMatchPair {
  got: string
  expected: string
  similarity: number
}

export interface SetMatchResult {
  precision: number
  recall: number
  f1: number
  pairs: SetMatchPair[]
  unmatchedGot: string[]
  unmatchedExpected: string[]
}

/** Greedy best-first: the most similar matching pair is taken, both sides retired, repeat. */
export function setMatch(
  got: readonly string[],
  expected: readonly string[],
  options: MatchOptions = {},
): SetMatchResult {
  const candidates: { i: number; j: number; similarity: number }[] = []
  got.forEach((answer, i) => {
    expected.forEach((target, j) => {
      const match = matchText(answer, [target], options)
      if (match.matched) candidates.push({ i, j, similarity: match.similarity })
    })
  })
  candidates.sort((a, b) => b.similarity - a.similarity || a.i - b.i || a.j - b.j)

  const usedGot = new Set<number>()
  const usedExpected = new Set<number>()
  const pairs: SetMatchPair[] = []
  for (const { i, j, similarity } of candidates) {
    if (usedGot.has(i) || usedExpected.has(j)) continue
    usedGot.add(i)
    usedExpected.add(j)
    pairs.push({ got: got[i] as string, expected: expected[j] as string, similarity })
  }

  const precision = got.length === 0 ? 0 : pairs.length / got.length
  const recall = expected.length === 0 ? 0 : pairs.length / expected.length
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return {
    precision,
    recall,
    f1,
    pairs,
    unmatchedGot: got.filter((_, i) => !usedGot.has(i)),
    unmatchedExpected: expected.filter((_, j) => !usedExpected.has(j)),
  }
}
