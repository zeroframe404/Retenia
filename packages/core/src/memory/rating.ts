import type { ConfidenceLevel, ReviewContext } from '../entities'
import { type Grade, RATING } from './types'

/**
 * Exercise result → FSRS rating (`docs/spec/02-memory-system.md` §10, and the M-* rating
 * strategies of `docs/spec/03-activities.md` §3).
 *
 * The scheduler only speaks Again/Hard/Good/Easy, but §3 of `01-decisions.md` insists the
 * same skill be reviewed in varied formats: a matching grid, a code test and a spoken word
 * all have to arrive at that 1–4 scale. This module is the whole of that translation, and
 * it is deliberately **pure** — "the AI proposes, the code validates"
 * (`docs/spec/01-decisions.md` §7 rule 7). Every activity type points at one `RatingRule`
 * and hands over the same `GradeResult`; nothing here knows what a renderer looks like.
 *
 * Two invariants govern every row and are enforced after the row has spoken:
 *
 * - **Hard is never assigned to an incorrect answer** (§10): "if you press Hard when you
 *   failed, the intervals will be unreasonably high". Only the score-driven rules can lift
 *   an answer the grader called incorrect off Again, and only into their own partial-credit
 *   band — a *wrong* answer, one below that band, is Again under every rule.
 * - **Easy only with strong signals** (§10): `w16` accelerates stability a lot, so Easy
 *   additionally requires a clean answer — first try, no hints — everywhere it is offered.
 *
 * §17 risk 3 is explicit that these thresholds are heuristic and are to be re-tuned against
 * measured true retention per type, which is why they live in one exported frozen object
 * rather than scattered through the branches.
 */

/**
 * The minimal grade every activity produces (`docs/spec/03-activities.md` §7).
 *
 * Sub-phase 5.1 extends this with the presentation half — `perItem`, `feedback`, `engine`,
 * the resolved `rating` — and re-exports it; the scheduler only ever needs these three.
 */
export interface GradeResult {
  /** Partial credit in `[0, 1]`: similarity, fraction of pairs, rubric score, ASR score. */
  score: number
  /** What the grader concluded. Drives the rules that have no meaningful partial credit. */
  correct: boolean
  meta: GradeMeta
}

/**
 * The learner's correction of a rating the grader proposed (§3's M-ai: *"the rubric returns
 * a rating and the user can correct it"*).
 *
 * Recorded on the grade rather than swallowed, because it is the only evidence we will ever
 * have that the rubric was wrong: §17 risk 3 asks for the thresholds to be re-tuned against
 * measured behaviour, and a systematic override is exactly that measurement.
 */
export interface RatingOverride {
  /** What the grader proposed, or `null` when it declined to rate (`uncertain`). */
  from: Grade | null
  /** What the learner chose instead. */
  to: Grade
  /** Free text from the learner, when they gave one. */
  reason?: string
  /** ISO-8601 instant of the correction. */
  at?: string
}

/** The raw signals §13 of `docs/spec/03-activities.md` requires every attempt to record
 *  "in order to recalibrate". */
export interface GradeMeta {
  /** Time on the activity, in milliseconds. `0` or absent means "not measured". */
  timeMs: number
  /** Tries used, `1` for a first-try answer. */
  attempts: number
  hintsUsed: number
  /** Certainty-based marking, when the type asked for it (`confidence_mcq`, diagnostics,
   *  mock exams). Absent means it was never asked — which is not the same as `unsure`. */
  confidence?: ConfidenceLevel
  /**
   * The AI grader declined to commit to a score (`docs/spec/04-path-generation.md` §12:
   * *"when in doubt it declares `uncertain`"*), which *"affects neither Elo nor FSRS"*.
   *
   * `toRating` therefore returns `null` for it under **every** rule, and no review log is
   * written — the UI asks the learner to self-rate instead, and their press arrives as an
   * explicit rating rather than as a derived one.
   */
  uncertain?: boolean
  /** Set when the learner corrected the rating the grader proposed. */
  ratingOverride?: RatingOverride
}

/**
 * Which row of §10 (equivalently, which M-* strategy of `docs/spec/03-activities.md` §3)
 * an activity type grades by. Declared per type in the registry's `review.strategy`.
 */
export const RATING_RULES = [
  /** M-self — flashcards and self-assessed cloze: the user presses the button themselves. */
  'self',
  /** M-bin — §10's "Multiple choice" row, and every clean pass/fail type. */
  'binary',
  /** M-pct — the generic partial-credit strategy of §3, `p < 0.5 / 0.5–0.8 / 0.8–1 / 1`. */
  'partial',
  /** §10's "Type the answer (fuzzy)" row: the score is a similarity. */
  'fuzzy',
  /** §10's "Order steps" row, graded on adjacent pairs out of order. */
  'ordering',
  /** §10's "Matching (n pairs)" row: the score is the fraction of pairs matched. */
  'matching',
  /** §10's "Numeric / code problem with tests" row. */
  'objective',
  /** M-ai — §10's "Short answer with an AI rubric" row. */
  'ai',
  /** M-speech — §10's "Pronunciation (score API)" row. */
  'speech',
  /** M-none — games with chance or no reliable recall signal; they never feed memory. */
  'none',
] as const

export type RatingRule = (typeof RATING_RULES)[number]

/**
 * The activity's `review` block (`docs/spec/03-activities.md` §7), plus the one fact the
 * session that served it contributes: which `context` the answer is being logged under.
 * A mock exam changes the mapping (§9), and only the session knows it is one.
 */
export interface ReviewSpec {
  /** `false` for the nine lesson-only types of §4. Nothing is scheduled and nothing logged. */
  eligible: boolean
  rule: RatingRule
  /**
   * The generator's estimate of how long the activity takes, in seconds. Used for "fast"
   * and "slow" only until the user has a measured median of their own.
   */
  expectedSeconds?: number
  /** Defaults to `daily`. `exam_sim` applies §9's mock-exam rule instead of the row's. */
  context?: ReviewContext
}

/**
 * The user's own pace, from `activity_stats` (the rolling per-type median) with
 * `review_logs`' overall median as the fallback.
 *
 * `null` means "not enough history yet": speed then decides nothing at all, rather than
 * being compared against a guess. §10 speaks of the *personal* median throughout, and a
 * fabricated one would hand out Easy on the user's very first activity.
 */
export interface PersonalPace {
  medianMs: number | null
}

/**
 * The thresholds of §10, in one place because §17 risk 3 says they will move: *"The
 * Hard/Easy thresholds of the automatic exercises are heuristic: measure true retention per
 * type and adjust."*
 *
 * Each band is read as "at least this, and below the next" — `again` is the floor of Hard,
 * `good` the floor of Good, `easy` the floor of Easy.
 */
export const RATING_THRESHOLDS = Object.freeze({
  /** §10: `< 0.6` → Again, `0.6–0.85` → Hard, `≥ 0.85` → Good. */
  fuzzy: Object.freeze({ again: 0.6, good: 0.85 }),
  /** §10: `< 0.5` → Again, `0.5–0.79` → Hard, `0.8–0.94` → Good, `≥ 0.95` → Easy. */
  ai: Object.freeze({ again: 0.5, good: 0.8, easy: 0.95 }),
  /** §10 and M-speech: `< 0.5` → Again, `< 0.75` → Hard, `< 0.9` → Good, `≥ 0.9` → Easy. */
  speech: Object.freeze({ again: 0.5, good: 0.75, easy: 0.9 }),
  /** §10: `< 70 %` → Again, `70–99 %` → Hard, `100 %` → Good. */
  matching: Object.freeze({ again: 0.7, good: 1 }),
  /** M-pct: `p < 0.5` → Again, `0.5–0.8` → Hard, `0.8–1` → Good, `1` with no hints → Easy. */
  partial: Object.freeze({ again: 0.5, good: 0.8, easy: 1 }),
  /**
   * "Fast" is below this fraction of the personal median. §10 states it once, on the fuzzy
   * row ("time < personal median × 0.6"), and says only "and fast" on the others; that one
   * number is therefore used for all of them. M-bin's own wording ("< 50 % of the time")
   * is the same idea with a different constant, and §10 is the more specific source.
   */
  fastFactor: 0.6,
  /** "Slow" is above this multiple of the personal median (§10's MCQ row, and §9). */
  slowFactor: 2,
  /** §10: the boundary between a "young" and a "mature" interval is elsewhere; this is the
   *  number of tries past which §10's numeric/code row calls an answer Hard. */
  objectiveAttempts: 2,
})

/**
 * The rules whose bands are defined by the grader's own *measurement* — a similarity, a
 * fraction of pairs, a rubric score, a count of pairs out of order — rather than by its
 * boolean verdict.
 *
 * For these, `correct` is derivative and the measurement is the verdict: §10 puts a
 * 0.7-similarity typed answer at Hard even though a fuzzy grader with a 0.8 threshold
 * would not call it a match. They are therefore the only rules allowed to rate an answer
 * the grader called incorrect above Again, and only inside their own partial-credit band —
 * below it they land on Again like everything else.
 *
 * Every other rule goes straight to Again the moment `correct` is false, which is what
 * makes "Hard is never assigned to an incorrect answer" structural rather than something
 * each branch has to remember.
 */
const PARTIAL_CREDIT_RULES: ReadonlySet<RatingRule> = new Set<RatingRule>([
  'fuzzy',
  'matching',
  'ai',
  'speech',
  'partial',
  'ordering',
])

function assertScore(score: number): number {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError(`toRating: score must be a number in [0, 1], got ${String(score)}`)
  }
  return score
}

function assertCount(name: string, value: number, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new RangeError(
      `toRating: ${name} must be a number of at least ${min}, got ${String(value)}`,
    )
  }
  return value
}

/**
 * How long this answer took, measured against the user's own pace.
 *
 * Both flags are false when either half is missing: an unmeasured time or an unknown median
 * is not evidence of speed, and treating it as such would hand out Easy on a first review.
 */
interface Pace {
  fast: boolean
  slow: boolean
}

function pace(meta: GradeMeta, spec: ReviewSpec, personal: PersonalPace): Pace {
  const timeMs = meta.timeMs
  if (!Number.isFinite(timeMs) || timeMs <= 0) return { fast: false, slow: false }

  const median = personal.medianMs !== null && personal.medianMs > 0 ? personal.medianMs : null
  const estimate =
    spec.expectedSeconds !== undefined && spec.expectedSeconds > 0
      ? spec.expectedSeconds * 1000
      : null

  return {
    // §10 names the *personal* median every time it says "fast", and `PersonalPace`'s own
    // doc says why: with no history there is nothing to be fast against, and a generated
    // estimate stood in for one would hand out Easy on the very first answer of a type.
    fast: median !== null && timeMs < median * RATING_THRESHOLDS.fastFactor,
    // "Slow" may fall back to the estimate, because §3's M-bin asks for exactly that —
    // "in > 2× the **expected** time" — and because the two errors are not symmetric: a
    // wrong guess here can only *demote* an answer to Hard, which costs a shorter interval,
    // while the same guess on `fast` would lengthen one on no evidence.
    slow: timeMs > (median ?? estimate ?? Number.POSITIVE_INFINITY) * RATING_THRESHOLDS.slowFactor,
  }
}

/** First try, no hints — the "clean" of §3's M-bin and the precondition for every Easy. */
function isClean(meta: GradeMeta): boolean {
  return meta.attempts <= 1 && meta.hintsUsed === 0
}

/**
 * Easy needs a clean, fast answer, and — when the type asked for certainty at all — a
 * declared "sure".
 *
 * The two sources disagree here and this is the reconciliation. §10's multiple-choice row
 * makes Easy "correct, fast **and with high declared confidence**"; M-bin, in
 * `docs/spec/03-activities.md` §3, makes it "clean in < 50 % of the time or marked 'easy'"
 * with no mention of certainty. Reading §10 literally for every type would put Easy out of
 * reach of all of them, since `confidence_mcq` is the only type in the whole catalogue that
 * asks — which cannot be what a row about multiple choice in general meant.
 *
 * So: certainty is honoured wherever it exists. A declared `unsure` or `guessed` that
 * happened to be right and quick is exactly the weak signal §10 refuses to reward, and it
 * blocks Easy; a type that never asked falls back to M-bin's speed-and-cleanliness test.
 */
function earnsEasy(meta: GradeMeta, paced: Pace): boolean {
  if (!isClean(meta) || !paced.fast) return false
  return meta.confidence === undefined || meta.confidence === 'sure'
}

function fuzzyRating(result: GradeResult, paced: Pace): Grade {
  const { fuzzy } = RATING_THRESHOLDS
  if (result.score < fuzzy.again) return RATING.Again
  if (result.score < fuzzy.good) return RATING.Hard
  // "0.6–0.85 **or with a hint** → 2": a hint caps a high-similarity answer at Hard.
  if (result.meta.hintsUsed > 0) return RATING.Hard
  return earnsEasy(result.meta, paced) ? RATING.Easy : RATING.Good
}

function binaryRating(result: GradeResult, paced: Pace): Grade {
  if (!result.correct) return RATING.Again
  // §10: "correct on the 2nd attempt or time > 2× median"; M-bin adds "after a hint".
  if (result.meta.attempts > 1 || result.meta.hintsUsed > 0 || paced.slow) return RATING.Hard
  return earnsEasy(result.meta, paced) ? RATING.Easy : RATING.Good
}

function partialRating(result: GradeResult, paced: Pace): Grade {
  const { partial } = RATING_THRESHOLDS
  if (result.score < partial.again) return RATING.Again
  if (result.score < partial.good) return RATING.Hard
  if (result.score < partial.easy) return RATING.Good
  // M-pct: "1 with no hints → 4". Easy's own precondition still applies.
  return earnsEasy(result.meta, paced) ? RATING.Easy : RATING.Good
}

function matchingRating(result: GradeResult, paced: Pace): Grade {
  const { matching } = RATING_THRESHOLDS
  if (result.score < matching.again) return RATING.Again
  if (result.score < matching.good) return RATING.Hard
  // "100 % with no previous errors and fast".
  return earnsEasy(result.meta, paced) ? RATING.Easy : RATING.Good
}

/**
 * §10's "Order steps" row, which grades on *adjacent pairs out of order* rather than on a
 * score. When the grader did not report the pair count — the `exact`, `kendall` and
 * `position` scorings of `docs/spec/03-activities.md` §7 do not — the type falls back to
 * M-pct, which is what the master table assigns `ordering_sequence` anyway (`S · M-pct`).
 */
function orderingRating(result: GradeResult, paced: Pace, outOfOrder: number | undefined): Grade {
  if (outOfOrder === undefined) return partialRating(result, paced)
  if (outOfOrder > 1) return RATING.Again
  if (outOfOrder === 1) return RATING.Hard
  return earnsEasy(result.meta, paced) ? RATING.Easy : RATING.Good
}

function objectiveRating(result: GradeResult, paced: Pace): Grade {
  if (!result.correct) return RATING.Again
  // "passes with a hint or > 2 attempts".
  if (result.meta.hintsUsed > 0 || result.meta.attempts > RATING_THRESHOLDS.objectiveAttempts) {
    return RATING.Hard
  }
  // "passes on the first try and fast".
  return earnsEasy(result.meta, paced) ? RATING.Easy : RATING.Good
}

function bandRating(score: number, band: { again: number; good: number; easy: number }): Grade {
  if (score < band.again) return RATING.Again
  if (score < band.good) return RATING.Hard
  if (score < band.easy) return RATING.Good
  return RATING.Easy
}

/**
 * §9: *"every answer is a review with `context = 'exam_sim'`: correct → Good (Hard if it
 * took > 2× its median); incorrect → Again"* — and §10's last row: **no Easy in an exam**.
 *
 * The row's own verdict still decides *whether* the answer counted, so a half-right typed
 * answer stays Hard rather than being promoted to Good; the exam only removes the top of
 * the scale and adds the slowness demotion.
 */
function examRating(base: Grade, paced: Pace): Grade {
  if (base === RATING.Again) return RATING.Again
  if (paced.slow) return RATING.Hard
  return base > RATING.Good ? RATING.Good : base
}

/**
 * How many adjacent pairs an ordering answer got out of order, when the grader counted
 * them. Passed alongside the result because §10's ordering row is the one place the table
 * grades on something the minimal `GradeResult` does not carry.
 */
export interface RatingSignals {
  pairsOutOfOrder?: number
}

/**
 * The deterministic mapping of §10: one exercise result → one FSRS rating.
 *
 * Returns `null` when the activity produces no rating and therefore **no review log**:
 * M-none (the games with chance of §5, which "do not feed the scheduler"), anything with
 * `eligible: false`, M-self — where the user presses the button and there is nothing to
 * derive — and an `uncertain` AI grade. Use `feedsScheduler` to tell the cases waiting for
 * input from the ones that are finished.
 */
export function toRating(
  result: GradeResult,
  review: ReviewSpec,
  personal: PersonalPace,
  signals: RatingSignals = {},
): Grade | null {
  // Written as a comparison rather than a set lookup so the switch below stays provably
  // exhaustive: these two are the only rules that never produce a rating themselves.
  if (!review.eligible || review.rule === 'self' || review.rule === 'none') return null
  // §12 of `docs/spec/04-path-generation.md`: an `uncertain` grade affects neither Elo nor
  // FSRS. Checked before the bands so it holds whatever the score happened to be.
  if (result.meta.uncertain === true) return null

  assertScore(result.score)
  assertCount('meta.timeMs', result.meta.timeMs, 0)
  assertCount('meta.attempts', result.meta.attempts, 1)
  assertCount('meta.hintsUsed', result.meta.hintsUsed, 0)
  if (signals.pairsOutOfOrder !== undefined) {
    assertCount('pairsOutOfOrder', signals.pairsOutOfOrder, 0)
  }

  const paced = pace(result.meta, review, personal)

  let rating: Grade
  switch (review.rule) {
    case 'fuzzy':
      rating = fuzzyRating(result, paced)
      break
    case 'binary':
      rating = binaryRating(result, paced)
      break
    case 'partial':
      rating = partialRating(result, paced)
      break
    case 'ordering':
      rating = orderingRating(result, paced, signals.pairsOutOfOrder)
      break
    case 'matching':
      rating = matchingRating(result, paced)
      break
    case 'objective':
      rating = objectiveRating(result, paced)
      break
    case 'ai':
      rating = bandRating(result.score, RATING_THRESHOLDS.ai)
      break
    case 'speech':
      rating = bandRating(result.score, RATING_THRESHOLDS.speech)
      break
    default: {
      // Exhaustive: `self` and `none` returned above, and `RatingRule` has no other member.
      const unreachable: never = review.rule
      throw new RangeError(`toRating: unknown rating rule "${String(unreachable)}"`)
    }
  }

  rating = guardIncorrect(rating, review.rule, result.correct)
  return (review.context ?? 'daily') === 'exam_sim' ? examRating(rating, paced) : rating
}

/**
 * §10: *"Hard is never assigned to an incorrect answer."*
 *
 * Two steps, because the rule has two halves. Good and Easy both *lengthen* the interval,
 * and nothing the grader called wrong may do that — under any rule, measurement-driven or
 * not. Hard shortens it, so the measurement-driven rules keep their partial-credit band:
 * §10 puts a 0.7-similarity typed answer there on purpose.
 *
 * Everything else collapses to Again the moment `correct` is false, which is what makes the
 * rule structural rather than something each branch has to remember.
 */
function guardIncorrect(rating: Grade, rule: RatingRule, correct: boolean): Grade {
  if (correct) return rating
  if (!PARTIAL_CREDIT_RULES.has(rule)) return RATING.Again
  return rating > RATING.Hard ? RATING.Hard : rating
}

/**
 * The same two invariants, applied to a rating that did **not** come from `toRating` — a
 * user's own button (M-self) or their correction of a rubric (M-ai).
 *
 * A deliberate press is not second-guessed on its merits; it is only held to the rules that
 * belong to the *situation* rather than to the answer: §10's last row — no Easy in an exam —
 * and the demotion of a slow exam answer to Hard (§9). `null` is impossible here, since the
 * caller supplied the rating.
 */
export function clampForContext(
  rating: Grade,
  review: ReviewSpec,
  result: GradeResult,
  personal: PersonalPace,
): Grade {
  if ((review.context ?? 'daily') !== 'exam_sim') return rating
  return examRating(rating, pace(result.meta, review, personal))
}

/**
 * Whether an answer to this activity should be written to `review_logs` at all.
 *
 * False for the nine lesson-only types of §4 and for M-none — §10: games with chance "do
 * not feed the scheduler". True for M-self, whose rating comes from the user rather than
 * from `toRating`.
 */
export function feedsScheduler(review: Pick<ReviewSpec, 'eligible' | 'rule'>): boolean {
  return review.eligible && review.rule !== 'none'
}
