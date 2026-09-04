import { forgettingCurve, nextMemoryState, scheduledInterval } from './formulas'
import { DEFAULT_FSRS_W } from './parameters'
import { mulberry32 } from './prng'
import type { Grade, MemoryState } from './types'

/**
 * The workload simulator of `docs/spec/02-memory-system.md` §6: given a set of parameters
 * and a desired retention, how many reviews a day, how many minutes a day, and how much
 * knowledge is retained over a span.
 *
 * It exists to answer one product question before the user commits to it — §7's "Urgente
 * costará ≈ 2.5× repasos" — and it also feeds 4.2's reschedule preview and the statistics
 * screen's workload projection.
 *
 * **Why this is ours and not `fsrs-rs`'s.** The optimizer binding
 * (`@open-spaced-repetition/binding`) ships no simulator, and `packages/core` may take no
 * native dependency (CLAUDE.md). Everything the simulation needs is already here as closed
 * forms in `formulas.ts`, and keeping it in TypeScript is what lets the retention slider
 * recompute on every drag without an IPC round trip. `SimulationResult` therefore mirrors
 * `fsrs-rs`'s field names one for one, so swapping in the Rust simulator later is a
 * rename-free change.
 *
 * **Where it deliberately diverges.** `fsrs-rs` models same-day learning steps with
 * `learningStepTransitions` / `relearningStepTransitions` matrices and a per-state,
 * per-rating cost matrix. This models the three costs §6 actually names — learn, review and
 * relearn — and no step matrix. That keeps every number here traceable to a formula in
 * §3.2 rather than to an assumption about a matrix's semantics, at the price of a coarser
 * estimate of same-day time. Treat the output as a projection, not a promise.
 */

/** Again, Hard, Good, Easy. */
export type FirstRatingProbabilities = readonly [number, number, number, number]
/** Hard, Good, Easy — the three a recalled card can be graded (§10: Again is never a
 *  recall). */
export type ReviewRatingProbabilities = readonly [number, number, number]

export interface SimulatorConfig {
  /** How many cards exist to be introduced over the span. */
  deckSize: number
  /** Days to simulate. */
  learnSpan: number
  /** Seconds a day the user is willing to spend — §12's budget. */
  maxCostPerday: number
  /** The interval cap in days, as the importance level sets it (§7). */
  maxIvl: number
  firstRatingProb: FirstRatingProbabilities
  reviewRatingProb: ReviewRatingProbabilities
  /** New cards a day (§7's `new_per_day`). */
  learnLimit: number
  /** Reviews a day (`review.dailyReviewLimit`). */
  reviewLimit: number
  /** Whether new cards are introduced even once `reviewLimit` is spent (Anki's option). */
  newCardsIgnoreReviewLimit: boolean
  /** Seconds to introduce one new card. */
  learnCost: number
  /** Seconds for one successful review. */
  reviewCost: number
  /** Seconds for one lapse, which costs more than a success. */
  relearnCost: number
  /** Suspend a card at this many lapses, as §4's leech threshold does. `null` never
   *  suspends. */
  suspendAfterLapses: number | null
}

export interface SimulationResult {
  /** `Σ R` over introduced cards at the end of each day — §13's "memorized knowledge". */
  memorizedCntPerDay: number[]
  reviewCntPerDay: number[]
  learnCntPerDay: number[]
  /** Seconds spent each day. */
  costPerDay: number[]
  correctCntPerDay: number[]
  introducedCntPerDay: number[]
}

/**
 * A day's worth of reviewing for a deck of 10,000 with §12's defaults.
 *
 * The rating distributions are the shape a healthy FSRS collection settles into — most
 * first answers Good, most reviews recalled — and the costs are §13's "time per card"
 * order of magnitude. A caller that has the user's own numbers should pass them.
 */
export const DEFAULT_SIMULATOR_CONFIG: Readonly<SimulatorConfig> = Object.freeze({
  deckSize: 10_000,
  learnSpan: 365,
  maxCostPerday: 1_200,
  maxIvl: 36_500,
  firstRatingProb: Object.freeze([0.26, 0.1, 0.56, 0.08]) as FirstRatingProbabilities,
  reviewRatingProb: Object.freeze([0.24, 0.71, 0.05]) as ReviewRatingProbabilities,
  learnLimit: 15,
  reviewLimit: 200,
  newCardsIgnoreReviewLimit: false,
  learnCost: 25,
  reviewCost: 9,
  relearnCost: 18,
  suspendAfterLapses: 8,
})

export const SIMULATOR_MAX_SPAN_DAYS = 3_650
export const SIMULATOR_MAX_DECK_SIZE = 100_000

interface SimulatedCard extends MemoryState {
  /** Day index the card is next due on. */
  due: number
  /** Day index of its last review. */
  lastReview: number
  lapses: number
  suspended: boolean
}

/** Pick an index from a probability vector; the last entry absorbs any rounding shortfall. */
function sampleIndex(probabilities: readonly number[], draw: number): number {
  let cumulative = 0
  for (let index = 0; index < probabilities.length - 1; index += 1) {
    cumulative += probabilities[index] as number
    if (draw < cumulative) return index
  }
  return probabilities.length - 1
}

function assertPositive(name: string, value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new RangeError(`simulate: ${name} must be in [0, ${max}], got ${value}`)
  }
  return value
}

/**
 * Project the workload of `desiredRetention` under `config`.
 *
 * Deterministic: the same `seed` always yields the same result, so the retention slider
 * does not jitter as the user drags it and the tests can assert exact numbers.
 */
export function simulate(
  w: readonly number[] = DEFAULT_FSRS_W,
  desiredRetention = 0.9,
  config: Partial<SimulatorConfig> = {},
  seed = 0x5eed,
): SimulationResult {
  const cfg: SimulatorConfig = { ...DEFAULT_SIMULATOR_CONFIG, ...config }
  if (!Number.isFinite(desiredRetention) || desiredRetention <= 0 || desiredRetention >= 1) {
    throw new RangeError(`simulate: desiredRetention must be in (0, 1), got ${desiredRetention}`)
  }
  const span = Math.floor(assertPositive('learnSpan', cfg.learnSpan, SIMULATOR_MAX_SPAN_DAYS))
  const deckSize = Math.floor(assertPositive('deckSize', cfg.deckSize, SIMULATOR_MAX_DECK_SIZE))
  const w20 = w[20] as number
  const draw = mulberry32(seed)

  const cards: SimulatedCard[] = []
  const result: SimulationResult = {
    memorizedCntPerDay: [],
    reviewCntPerDay: [],
    learnCntPerDay: [],
    costPerDay: [],
    correctCntPerDay: [],
    introducedCntPerDay: [],
  }

  const book = (card: SimulatedCard, day: number, state: MemoryState): void => {
    card.stability = state.stability
    card.difficulty = state.difficulty
    card.lastReview = day
    card.due = day + scheduledInterval(desiredRetention, state.stability, cfg.maxIvl, w20)
  }

  for (let day = 0; day < span; day += 1) {
    let cost = 0
    let reviews = 0
    let correct = 0
    let learned = 0

    // 1. Due reviews first, oldest due first — §12's queue order in miniature.
    const due = cards
      .filter((card) => !card.suspended && card.due <= day)
      .sort((a, b) => a.due - b.due)
    for (const card of due) {
      if (reviews >= cfg.reviewLimit) break
      if (cost + cfg.reviewCost > cfg.maxCostPerday) break
      const elapsed = Math.max(0, day - card.lastReview)
      const retrievability = forgettingCurve(elapsed, card.stability, w20)
      const recalled = draw() < retrievability
      const grade = (recalled ? sampleIndex(cfg.reviewRatingProb, draw()) + 2 : 1) as Grade
      reviews += 1
      cost += recalled ? cfg.reviewCost : cfg.relearnCost
      if (recalled) correct += 1
      else card.lapses += 1
      // Same-day steps are not modelled, so a review always advances a day (`shortTerm`
      // off): `elapsed` of 0 would otherwise take the same-day branch of (g).
      book(
        card,
        day,
        nextMemoryState(w, card, elapsed, grade, { shortTerm: false, retrievability }),
      )
      if (cfg.suspendAfterLapses !== null && card.lapses >= cfg.suspendAfterLapses) {
        card.suspended = true
      }
    }

    // 2. Then new cards, on whatever budget is left (§12 step 4).
    while (learned < cfg.learnLimit && cards.length < deckSize) {
      if (!cfg.newCardsIgnoreReviewLimit && reviews + learned >= cfg.reviewLimit) break
      if (cost + cfg.learnCost > cfg.maxCostPerday) break
      const grade = (sampleIndex(cfg.firstRatingProb, draw()) + 1) as Grade
      const card: SimulatedCard = {
        stability: 0,
        difficulty: 0,
        due: day,
        lastReview: day,
        lapses: grade === 1 ? 1 : 0,
        suspended: false,
      }
      book(card, day, nextMemoryState(w, null, 0, grade))
      cards.push(card)
      learned += 1
      cost += cfg.learnCost
    }

    let memorized = 0
    for (const card of cards) {
      memorized += forgettingCurve(day - card.lastReview, card.stability, w20)
    }

    result.reviewCntPerDay.push(reviews)
    result.learnCntPerDay.push(learned)
    result.correctCntPerDay.push(correct)
    result.costPerDay.push(cost)
    result.introducedCntPerDay.push(cards.length)
    result.memorizedCntPerDay.push(memorized)
  }

  return result
}

export interface WorkloadSummary {
  /** Mean reviews a day over the span (new cards excluded — they are not reviews). */
  reviewsPerDay: number
  /** Mean minutes a day over the span, reviews and new cards together. */
  minutesPerDay: number
  /** `Σ R` on the last simulated day. */
  memorized: number
  /** Share of reviews recalled, over the whole span — the simulation's true retention. */
  trueRetention: number
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length

/** The three numbers §6 asks the app to show, out of a full simulation. */
export function workloadSummary(result: SimulationResult): WorkloadSummary {
  const reviews = result.reviewCntPerDay.reduce((total, value) => total + value, 0)
  const correct = result.correctCntPerDay.reduce((total, value) => total + value, 0)
  return {
    reviewsPerDay: mean(result.reviewCntPerDay),
    minutesPerDay: mean(result.costPerDay) / 60,
    memorized: result.memorizedCntPerDay.at(-1) ?? 0,
    trueRetention: reviews === 0 ? 0 : correct / reviews,
  }
}

/**
 * How much more reviewing `to` costs than `from` — what §7's "Urgente costará ≈ 2.5×
 * repasos" is asking.
 *
 * **This does not reproduce §7's table, and should not.** That table divides two intervals
 * at a *fixed* stability, so it answers "if nothing else changed, how much more often would
 * this card come up": 2.48× going from 0.90 to 0.95. A simulation answers a different
 * question — how much more reviewing over a real horizon — and comes out **compressed
 * toward 1** (measured on the default deck: 1.8× for the same move, 2.9× rather than 4.5×
 * for 0.90 → 0.97). Both corrections §7 names are visible in that gap, pulling opposite
 * ways: a lower retention lapses more, so it saves less than the table promises, and a
 * higher one lapses less *and* accumulates stability across all those extra reviews, so it
 * costs less than the table threatens. A budget (`maxCostPerday`) compresses it further,
 * because a day that runs out of time simply defers the work.
 *
 * The simulated figure is the one to show a user: it is the cost *they* will pay, on their
 * deck and their budget, rather than a per-card ratio in the abstract.
 *
 * Returns `Infinity` when the baseline schedules no reviews at all.
 */
export function relativeWorkload(
  from: number,
  to: number,
  w: readonly number[] = DEFAULT_FSRS_W,
  config: Partial<SimulatorConfig> = {},
  seed = 0x5eed,
): number {
  const baseline = workloadSummary(simulate(w, from, config, seed)).reviewsPerDay
  const target = workloadSummary(simulate(w, to, config, seed)).reviewsPerDay
  if (baseline === 0) return target === 0 ? 1 : Number.POSITIVE_INFINITY
  return target / baseline
}

/**
 * The rating distributions, measured from the user's own reviews.
 *
 * §6 makes the simulator's absolute numbers ("≈ 18 minutes a day") only as good as these
 * two vectors, and a made-up distribution makes them fiction. Anki derives them from the
 * collection; so do we, falling back to `DEFAULT_SIMULATOR_CONFIG`'s figures until there
 * is enough history to measure.
 *
 * `New`/`Learning` reviews feed `firstRatingProb`, `Review`/`Relearning` ones feed
 * `reviewRatingProb`. Rating 0 (`Manual`) is not an answer and is dropped, and an Again on
 * a review is a lapse rather than a grade choice, so `reviewRatingProb` is conditioned on
 * recall — the shape §10's table implies.
 *
 * Returns `null` when either sample is too small to be worth trusting, and the caller keeps
 * the defaults.
 */
export const RATING_PROBABILITY_MIN_SAMPLE = 100

export function ratingProbabilitiesFrom(
  events: readonly { rating: number; state: number }[],
): Pick<SimulatorConfig, 'firstRatingProb' | 'reviewRatingProb'> | null {
  const first = [0, 0, 0, 0]
  const review = [0, 0, 0]
  let firstTotal = 0
  let reviewTotal = 0
  for (const { rating, state } of events) {
    if (rating < 1 || rating > 4) continue
    if (state === 0 || state === 1) {
      first[rating - 1] = (first[rating - 1] as number) + 1
      firstTotal += 1
    } else if (rating >= 2) {
      review[rating - 2] = (review[rating - 2] as number) + 1
      reviewTotal += 1
    }
  }
  if (firstTotal < RATING_PROBABILITY_MIN_SAMPLE || reviewTotal < RATING_PROBABILITY_MIN_SAMPLE) {
    return null
  }
  return {
    firstRatingProb: first.map(
      (count) => count / firstTotal,
    ) as unknown as FirstRatingProbabilities,
    reviewRatingProb: review.map(
      (count) => count / reviewTotal,
    ) as unknown as ReviewRatingProbabilities,
  }
}
