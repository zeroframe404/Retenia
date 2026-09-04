import { DEFAULT_DECAY_PARAMETER, forgettingCurve } from '../memory/formulas'
import { DAY_MS, type DayBoundary, studyDay, studyDayStart } from '../memory/study-day'
import { CARD_STATE } from '../memory/types'
import type { CardMemoryState, ReviewEvent } from '../ports/stats-repository'

/**
 * "Mean retention today" and "memorized knowledge" — `docs/spec/02-memory-system.md` §13,
 * rows 3 and 4:
 *
 * > `mean(Rᵢ(today))` over Review: "today you would recall X % of all your cards"
 * > `Σ Rᵢ(today)` and its time series, per topic/path
 *
 * The mean is the number §6 contrasts with desired retention — *"with DR 0.90 you recall
 * ≈ 94.7 % of all cards today (most are not due). The app shows both."* The sum is the one
 * that means something over time: `Σ R` is, literally, the expected number of things the
 * user could recall right now, so its series is the graph of whether studying is adding up.
 */

/** How far back the series may reach. A year of daily points is what §13's windows ask for. */
export const MEMORIZED_MAX_DAYS = 365

export interface MemorizedDay {
  /** ISO `YYYY-MM-DD` of the study day. */
  day: string
  /** Days before today; `0` is today. */
  offset: number
  /** `Σ Rᵢ` over the cards that were in `Review` on that day. */
  memorized: number
  /** How many cards that sum is over. */
  cards: number
}

export interface Memorized {
  /** `Σ Rᵢ(today)` — the expected number of items recallable right now. */
  today: number
  /** `mean(Rᵢ(today))` over `Review` cards, or `null` when there are none yet. */
  meanRetrievability: number | null
  /** Cards in `Review` today — the denominator of `meanRetrievability`. */
  reviewCards: number
  /** Every live card, `New` and `Learning` included, for context next to `reviewCards`. */
  totalCards: number
  /** Oldest first, ending with today. Empty when `days` is 0. */
  series: readonly MemorizedDay[]
  generatedAt: Date
}

/**
 * The memory state one card was in during one past segment of the window.
 *
 * S and D only change when a card is reviewed, so a card's history over a window is a step
 * function whose steps are exactly its reviews. That is what makes an honest historical
 * `Σ R` computable without storing a daily snapshot: walk the window's reviews backwards
 * from the card's *current* state, and each `review_logs` row hands over the state that
 * preceded it — which is precisely what the row's `stability`, `difficulty` and `due` are
 * (`packages/db/src/schema/sessions.ts`: the values *before* the review, and the card's
 * previous `lastReview`).
 */
interface Segment {
  /** The segment covers `[from, until)` in wall-clock time. */
  from: number
  until: number
  stability: number
  /** When the card was last reviewed at that point — what `R`'s elapsed time counts from. */
  lastReview: number | null
}

/**
 * Builds the step function for one card over `[windowStart, now]`.
 *
 * Newest segment first: the card's current state holds from its last in-window review (or
 * from the beginning of the window, if it was not reviewed in it) up to now. Each earlier
 * review then contributes the state that preceded *it*.
 */
function segmentsFor(
  card: CardMemoryState,
  events: readonly ReviewEvent[],
  windowStart: number,
  now: number,
): Segment[] {
  const segments: Segment[] = []
  let until = now
  let stability = card.stability
  let lastReview = card.lastReview?.getTime() ?? null

  // Newest first: `events` arrive oldest first, so walk them in reverse.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as ReviewEvent
    const at = event.review.getTime()
    if (at > now) continue
    segments.push({ from: Math.max(at, windowStart), until, stability, lastReview })
    if (at <= windowStart) return segments
    until = at
    // The row carries the card's state as it was *before* this review.
    stability = event.stability
    lastReview = event.due.getTime()
  }

  segments.push({ from: windowStart, until, stability, lastReview })
  return segments
}

/** `R` for one segment, evaluated at `at`. A card never reviewed has nothing to retrieve. */
function retrievabilityAt(segment: Segment, at: number, w20: number): number {
  if (segment.lastReview === null || segment.stability <= 0) return 0
  const elapsedDays = (at - segment.lastReview) / DAY_MS
  if (elapsedDays < 0) return 0
  return forgettingCurve(elapsedDays, segment.stability, w20)
}

export interface MemorizedInput {
  cards: readonly CardMemoryState[]
  /**
   * Every review in the window, oldest first. Only used to reconstruct the past; today's
   * figures come from `cards` alone.
   */
  events: readonly ReviewEvent[]
  now: Date
  /** How many days of series to produce, today included. `1` is today only. */
  days: number
  boundary: DayBoundary
  /** `w20`, the decay of the forgetting curve — the user's, once the optimizer has run. */
  w20?: number
}

/**
 * `Σ R` and `mean R` today, plus the daily series behind them.
 *
 * Each day's figure is taken at the **end** of that study day (its last instant), so today's
 * point is `Σ R(now)` and matches the headline number rather than sitting a few hours off it.
 * Only cards in `Review` count toward the mean, as §13 says; the sum counts every card that
 * had a memory to retrieve at that point, which for a `New` card is none and so contributes
 * exactly 0 either way.
 */
export function computeMemorized(input: MemorizedInput): Memorized {
  const { cards, events, now, boundary } = input
  const w20 = input.w20 ?? DEFAULT_DECAY_PARAMETER
  const span = Math.max(0, Math.min(MEMORIZED_MAX_DAYS, Math.floor(input.days)))
  const nowMs = now.getTime()

  const todayStart = studyDayStart(now, boundary.dayStartHour, boundary.timeZone)
  // `span - 1` days before today, so the series ends on today.
  const windowStart = span === 0 ? nowMs : todayStart.getTime() - Math.max(0, span - 1) * DAY_MS

  const byCard = new Map<string, ReviewEvent[]>()
  for (const event of events) {
    const list = byCard.get(event.cardId)
    if (list === undefined) byCard.set(event.cardId, [event])
    else list.push(event)
  }

  // The instant each day's figure is taken at: the day's last millisecond, except today,
  // which is taken now.
  const sampleAt: number[] = []
  for (let offset = span - 1; offset >= 0; offset--) {
    const dayStart = todayStart.getTime() - offset * DAY_MS
    sampleAt.push(offset === 0 ? nowMs : dayStart + DAY_MS - 1)
  }

  const sums = new Array<number>(sampleAt.length).fill(0)
  const counts = new Array<number>(sampleAt.length).fill(0)

  let today = 0
  let reviewSum = 0
  let reviewCards = 0

  for (const card of cards) {
    const r = retrievabilityAt(
      {
        from: windowStart,
        until: nowMs,
        stability: card.stability,
        lastReview: card.lastReview?.getTime() ?? null,
      },
      nowMs,
      w20,
    )
    today += r
    if (card.state === CARD_STATE.Review) {
      reviewSum += r
      reviewCards += 1
    }

    if (sampleAt.length === 0) continue
    const segments = segmentsFor(card, byCard.get(card.cardId) ?? [], windowStart, nowMs)
    for (let i = 0; i < sampleAt.length; i++) {
      const at = sampleAt[i] as number
      const segment = segments.find((candidate) => at >= candidate.from && at < candidate.until)
      // The newest segment ends exactly at `now`, so today's sample needs the closed end.
      const resolved = segment ?? (at === nowMs ? segments[0] : undefined)
      if (resolved === undefined) continue
      const value = retrievabilityAt(resolved, at, w20)
      sums[i] = (sums[i] as number) + value
      if (value > 0) counts[i] = (counts[i] as number) + 1
    }
  }

  const series: MemorizedDay[] = sampleAt.map((at, index) => ({
    day: studyDay(new Date(at), boundary.dayStartHour, boundary.timeZone),
    offset: sampleAt.length - 1 - index,
    memorized: sums[index] as number,
    cards: counts[index] as number,
  }))

  return {
    today,
    meanRetrievability: reviewCards === 0 ? null : reviewSum / reviewCards,
    reviewCards,
    totalCards: cards.length,
    series,
    generatedAt: now,
  }
}
