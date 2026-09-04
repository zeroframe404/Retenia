import type { ImportanceLevel, ReviewContext } from '../entities'
import { CARD_STATE, RATING } from '../memory/types'
import type { ReviewEvent } from '../ports/stats-repository'

/**
 * True retention — `docs/spec/02-memory-system.md` §13, row 1:
 *
 * > % correct on the first review of the day for cards in Review with interval ≥ 1 d;
 * > young (< 21 d) vs mature; day/week/month/year windows
 *
 * Every clause of that sentence is a filter, and each one is there to stop the number
 * flattering the user, which is what makes this the one metric worth trusting about
 * whether the scheduler is working:
 *
 * - **first review of the day** — a card answered `Again` comes back within minutes and is
 *   then usually right. Counting the second answer would measure short-term memory, not
 *   retention, and would drag the figure toward 100 % exactly when things are going worst.
 * - **cards in Review** — a `New` or `Learning` card is being *taught*; it was never
 *   predicted to be recalled, so a failure says nothing about the forgetting curve.
 * - **interval ≥ 1 day** — a same-day step is not a retention test either.
 * - **young vs mature** — the two behave differently enough that one blended number hides
 *   both. Anki draws the same line at 21 days.
 *
 * One filter beyond the sentence, from the same precedent: `cram` and `import` reviews are
 * left out — see `EXCLUDED_CONTEXTS`.
 *
 * "Correct" is `rating ≥ Hard`: `Again` is the only failure (`fsrs-rules`, and the session
 * summary's accuracy uses the same definition). `Manual` rows are not answers at all.
 */

/** §13's four windows, in days. `day` is today only. */
export const RETENTION_WINDOWS = Object.freeze({
  day: 1,
  week: 7,
  month: 30,
  year: 365,
})

export type RetentionWindow = keyof typeof RETENTION_WINDOWS

export const RETENTION_WINDOW_NAMES = Object.freeze(
  Object.keys(RETENTION_WINDOWS) as RetentionWindow[],
)

/** Anki's boundary, and §13's: an interval under three weeks is "young". */
export const MATURE_INTERVAL_DAYS = 21

/**
 * Contexts whose answers are not evidence about *this* user's forgetting curve.
 *
 * `cram` is Anki's filtered-deck answer — the row's cited precedent excludes those, because
 * cramming is deliberately massed practice and counting it would flatter the number exactly
 * when spacing has been abandoned. `import` rows are somebody else's history replayed out of
 * an `.apkg`: real reviews, but not ones this scheduler predicted, so folding them in would
 * make an import move a number that is supposed to measure the app.
 *
 * `manual_postpone` needs no entry: it carries rating `Manual`, which is filtered anyway.
 * `diagnostic` needs none either — a prior-knowledge test runs on `New` cards, and the
 * `Review`-state filter has already dropped them.
 */
const EXCLUDED_CONTEXTS: ReadonlySet<ReviewContext> = new Set<ReviewContext>(['cram', 'import'])

export interface RetentionCount {
  reviewed: number
  correct: number
  /** `correct / reviewed`, or `null` when nothing qualified — never a misleading 0 or 1. */
  retention: number | null
}

export interface TrueRetention {
  window: RetentionWindow
  /** The study day the window starts on, ISO `YYYY-MM-DD`. */
  from: string
  /** Cards whose scheduled interval was under 21 days. */
  young: RetentionCount
  mature: RetentionCount
  /** Both together — what the headline figure shows. */
  all: RetentionCount
}

export const EMPTY_COUNT: RetentionCount = Object.freeze({
  reviewed: 0,
  correct: 0,
  retention: null,
})

function counted(reviewed: number, correct: number): RetentionCount {
  return { reviewed, correct, retention: reviewed === 0 ? null : correct / reviewed }
}

/**
 * Whether one review is evidence about retention at all — the four clauses above, minus
 * "first of the day", which needs the other reviews to decide.
 */
export function isRetentionEvidence(
  event: Pick<ReviewEvent, 'rating' | 'state' | 'scheduledDays' | 'context'>,
): boolean {
  return (
    event.rating !== RATING.Manual &&
    event.state === CARD_STATE.Review &&
    event.scheduledDays >= 1 &&
    !EXCLUDED_CONTEXTS.has(event.context)
  )
}

/** `Again` is the only wrong answer; Hard was still a recall (`fsrs-rules`). */
export function isRecalled(rating: number): boolean {
  return rating >= RATING.Hard
}

/**
 * Keeps only each card's **first** qualifying review of each study day.
 *
 * `studyDayOf` maps an instant to the day it belongs to — the caller passes the user's
 * `dayStartHour`/`timeZone` in, so "today" here is the same "today" the scheduler uses.
 * Events must arrive oldest first, which `StatsRepository.listReviewEvents` guarantees;
 * the first one seen for a (card, day) pair is therefore the first of that day.
 */
export function firstOfDay(
  events: readonly ReviewEvent[],
  studyDayOf: (at: Date) => number,
): ReviewEvent[] {
  const seen = new Set<string>()
  const kept: ReviewEvent[] = []
  for (const event of events) {
    if (!isRetentionEvidence(event)) continue
    const key = `${event.cardId}:${studyDayOf(event.review)}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(event)
  }
  return kept
}

/** Splits a set of qualifying reviews into young, mature and the total. */
export function tallyRetention(events: readonly ReviewEvent[]): {
  young: RetentionCount
  mature: RetentionCount
  all: RetentionCount
} {
  let youngReviewed = 0
  let youngCorrect = 0
  let matureReviewed = 0
  let matureCorrect = 0

  for (const event of events) {
    const correct = isRecalled(event.rating) ? 1 : 0
    if (event.scheduledDays < MATURE_INTERVAL_DAYS) {
      youngReviewed += 1
      youngCorrect += correct
    } else {
      matureReviewed += 1
      matureCorrect += correct
    }
  }

  return {
    young: counted(youngReviewed, youngCorrect),
    mature: counted(matureReviewed, matureCorrect),
    all: counted(youngReviewed + matureReviewed, youngCorrect + matureCorrect),
  }
}

/**
 * Desired vs true retention per importance level — §13 row 2, *"Comparison per level;
 * alert if they differ by > 5 pp (re-optimize or adjust DR)"*.
 *
 * The gap is `true − desired`: negative means the scheduler is over-reaching (the intervals
 * are longer than the level can sustain), positive means it is being too cautious and the
 * user is paying for reviews they did not need. Both are worth an alert, so the threshold
 * is on the absolute difference — which is also why the sign is kept rather than an
 * `Math.abs` being stored.
 */
export const RETENTION_ALERT_POINTS = 0.05

export interface LevelRetention {
  level: ImportanceLevel
  desiredRetention: number | null
  trueRetention: number | null
  reviewed: number
  /** `true − desired`, in the same 0–1 units. `null` when either half is unknown. */
  gap: number | null
  /** `|gap| > 5 pp` on a level that has both numbers. */
  alert: boolean
}

export function retentionByLevel(
  events: readonly ReviewEvent[],
  desiredFor: (level: ImportanceLevel) => number | null,
  levels: readonly ImportanceLevel[],
): LevelRetention[] {
  const counts = new Map<ImportanceLevel, { reviewed: number; correct: number }>()
  for (const event of events) {
    const bucket = counts.get(event.level) ?? { reviewed: 0, correct: 0 }
    bucket.reviewed += 1
    if (isRecalled(event.rating)) bucket.correct += 1
    counts.set(event.level, bucket)
  }

  return levels.map((level) => {
    const bucket = counts.get(level) ?? { reviewed: 0, correct: 0 }
    const trueRetention = bucket.reviewed === 0 ? null : bucket.correct / bucket.reviewed
    const desiredRetention = desiredFor(level)
    const gap =
      trueRetention === null || desiredRetention === null ? null : trueRetention - desiredRetention
    return {
      level,
      desiredRetention,
      trueRetention,
      reviewed: bucket.reviewed,
      gap,
      alert: gap !== null && Math.abs(gap) > RETENTION_ALERT_POINTS,
    }
  })
}
