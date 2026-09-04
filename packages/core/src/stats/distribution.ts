import { CARD_STATE } from '../memory/types'
import type { CardMemoryState } from '../ports/stats-repository'

/**
 * The stability and difficulty histograms — `docs/spec/02-memory-system.md` §13, row 5:
 *
 * > Histograms; % with S > 21 d and > 365 d; average D per topic
 *
 * The two percentages are the point of the S histogram: S is *the interval at which recall
 * falls to 90 %*, so "% with S > 365 d" is the share of the collection the user would still
 * remember a year from now without touching it. That is the closest thing the app has to a
 * one-number answer to "is any of this sticking".
 *
 * Only cards in `Review` or `Relearning` are counted. A `New` card has S = 0 by
 * construction, and a bar of those at the left of the histogram would say nothing about
 * memory and everything about how many cards were added last week.
 */

/** Upper bound of each stability bin, in days; the last is open-ended. */
export const STABILITY_BINS: readonly { readonly max: number; readonly label: string }[] =
  Object.freeze([
    Object.freeze({ max: 1, label: '<1d' }),
    Object.freeze({ max: 7, label: '1–7d' }),
    Object.freeze({ max: 21, label: '7–21d' }),
    Object.freeze({ max: 90, label: '21–90d' }),
    Object.freeze({ max: 365, label: '90d–1y' }),
    Object.freeze({ max: Number.POSITIVE_INFINITY, label: '>1y' }),
  ])

/** FSRS difficulty runs 1–10; one bin per whole point. */
export const DIFFICULTY_BIN_COUNT = 10

export interface HistogramBin {
  label: string
  /** Inclusive lower bound of the bin. */
  from: number
  /** Exclusive upper bound; `Infinity` on the last stability bin. */
  to: number
  count: number
  /** Share of the histogram's total, in `[0, 1]`. `0` when the histogram is empty. */
  share: number
}

export interface MemoryDistribution {
  stability: readonly HistogramBin[]
  difficulty: readonly HistogramBin[]
  /** Cards the histograms are over: `Review` and `Relearning` only. */
  cards: number
  /** §13's two headline shares, in `[0, 1]`. `0` when there are no cards yet. */
  shareOver21Days: number
  shareOver365Days: number
  /** Mean S and D over the same cards, or `null` when there are none. */
  meanStability: number | null
  meanDifficulty: number | null
}

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total
}

const EMPTY: MemoryDistribution = Object.freeze({
  stability: Object.freeze(
    STABILITY_BINS.map((bin, index) => ({
      label: bin.label,
      from: index === 0 ? 0 : (STABILITY_BINS[index - 1] as { max: number }).max,
      to: bin.max,
      count: 0,
      share: 0,
    })),
  ),
  difficulty: Object.freeze(
    Array.from({ length: DIFFICULTY_BIN_COUNT }, (_, index) => ({
      label: `${index + 1}`,
      from: index + 1,
      to: index + 2,
      count: 0,
      share: 0,
    })),
  ),
  cards: 0,
  shareOver21Days: 0,
  shareOver365Days: 0,
  meanStability: null,
  meanDifficulty: null,
})

/** The empty histograms, bins and all — so a screen with no data still renders its axes. */
export function emptyDistribution(): MemoryDistribution {
  return EMPTY
}

export function computeDistribution(cards: readonly CardMemoryState[]): MemoryDistribution {
  const measured = cards.filter(
    (card) =>
      (card.state === CARD_STATE.Review || card.state === CARD_STATE.Relearning) &&
      card.stability > 0,
  )
  if (measured.length === 0) return EMPTY

  const stabilityCounts = new Array<number>(STABILITY_BINS.length).fill(0)
  const difficultyCounts = new Array<number>(DIFFICULTY_BIN_COUNT).fill(0)
  let stabilitySum = 0
  let difficultySum = 0
  let over21 = 0
  let over365 = 0

  for (const card of measured) {
    stabilitySum += card.stability
    difficultySum += card.difficulty
    if (card.stability > 21) over21 += 1
    if (card.stability > 365) over365 += 1

    // The last bin's `max` is +Infinity, so this always matches.
    const bin = STABILITY_BINS.findIndex((candidate) => card.stability < candidate.max)
    stabilityCounts[bin] = (stabilityCounts[bin] as number) + 1

    // D is clamped to [1, 10] by the scheduler; bin 9 therefore holds exactly D = 10.
    const level = Math.min(DIFFICULTY_BIN_COUNT - 1, Math.max(0, Math.floor(card.difficulty) - 1))
    difficultyCounts[level] = (difficultyCounts[level] as number) + 1
  }

  const total = measured.length
  return {
    stability: STABILITY_BINS.map((bin, index) => ({
      label: bin.label,
      from: index === 0 ? 0 : (STABILITY_BINS[index - 1] as { max: number }).max,
      to: bin.max,
      count: stabilityCounts[index] as number,
      share: share(stabilityCounts[index] as number, total),
    })),
    difficulty: difficultyCounts.map((count, index) => ({
      label: `${index + 1}`,
      from: index + 1,
      to: index + 2,
      count,
      share: share(count, total),
    })),
    cards: total,
    shareOver21Days: share(over21, total),
    shareOver365Days: share(over365, total),
    meanStability: stabilitySum / total,
    meanDifficulty: difficultySum / total,
  }
}
