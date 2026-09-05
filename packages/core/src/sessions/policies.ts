import type { AttemptMode, Rating } from '../entities'
import { RATING } from '../memory/types'

/**
 * §12: *"'Mistakes review' and 'Legendary' (no hints and no word bank) are **policies, not
 * new types**."*
 *
 * So nothing here adds an activity type or a renderer. A policy changes which options the
 * selector may consider and how the host is told to present the one it picks — and that is
 * all it is allowed to change.
 */

export const SESSION_POLICIES = ['standard', 'legendary'] as const
export type SessionPolicy = (typeof SESSION_POLICIES)[number]

/**
 * The MVP types whose payload hands the learner the answer's own tokens to arrange: the
 * cloze word bank and the sentence builder's token bank.
 *
 * `cloze_dropdown` and the `mcq_*` types offer *options* rather than a *bank*, which
 * Legendary handles differently — by raising the stage floor below, not by name. Keeping
 * this list to the two literal banks is what makes it checkable against the spec's own
 * wording ("no word bank") instead of a judgement call per type.
 */
export const WORD_BANK_TYPES: readonly string[] = Object.freeze([
  'cloze_wordbank',
  'sentence_builder',
])

/** How a policy and a mode together tell the `ActivityHost` to present the activity. */
export interface PresentationPolicy {
  mode: AttemptMode
  hintsAllowed: boolean
  deferFeedback: boolean
  /** Legendary and `test` put a clock on screen (§2's "time limit" common property). */
  timed: boolean
}

/**
 * `test` is the exam posture: no hints, and feedback withheld until the run ends — the same
 * contract `ActivityHost`'s machine enforces (`defersFeedback`/`allowsHints`). `study` and
 * `review` differ in *what is being served*, not in how it behaves, so they share a posture.
 *
 * Legendary layers on top of any of them: it never restores a hint that the mode withheld.
 */
export function resolvePresentation(mode: AttemptMode, policy: SessionPolicy): PresentationPolicy {
  const isTest = mode === 'test'
  const legendary = policy === 'legendary'
  return {
    mode,
    hintsAllowed: !isTest && !legendary,
    deferFeedback: isTest,
    timed: isTest || legendary,
  }
}

/** Whether a policy will consider an activity of this type at all. */
export function policyAllowsType(type: string, policy: SessionPolicy): boolean {
  return policy === 'legendary' ? !WORD_BANK_TYPES.includes(type) : true
}

// --- mistakes review ----------------------------------------------------------------------

/**
 * One graded answer, as the mistakes queue reads it. Structural rather than a `ReviewLog`:
 * the rule is about ratings over time and needs nothing else, and a narrow input is a
 * narrow test.
 */
export interface GradedAnswer {
  cardId: string
  rating: Rating
  reviewedAt: Date
}

export interface MistakesReviewOptions {
  /** How many cards the mini-session may hold. */
  limit?: number
}

export const DEFAULT_MISTAKES_LIMIT = 20

/**
 * "Mistakes review": today's wrong answers, re-queued as a mini-session.
 *
 * Deliberately **not** the runner's final drill. The drill (§12 step 6) is everything graded
 * Again *or* Hard, it lives inside one live session, and it is gone when that session ends.
 * This is the Practice Hub's "Mistakes": only what was actually got **wrong**, readable at
 * any time from `review_logs`.
 *
 * A card that was failed and then answered correctly later the same day is **not** a
 * mistake any more — it was already retrieved successfully, and re-queuing it would punish
 * the learner for the attempt that fixed it. Only `Again` counts as wrong: §10 is explicit
 * that "Hard is never assigned to an incorrect answer", so a Hard is a slow success.
 *
 * Ordering is by when the mistake happened, oldest first, so the queue reads as the session
 * did. `answers` may arrive in any order.
 */
export function composeMistakesReview(
  answers: readonly GradedAnswer[],
  options: MistakesReviewOptions = {},
): readonly string[] {
  const limit = options.limit ?? DEFAULT_MISTAKES_LIMIT
  /** Per card: when it was last failed, and when it was last recovered. */
  const failed = new Map<string, number>()
  const recovered = new Map<string, number>()

  for (const answer of answers) {
    const at = answer.reviewedAt.getTime()
    if (answer.rating === RATING.Again) {
      const previous = failed.get(answer.cardId)
      if (previous === undefined || at > previous) failed.set(answer.cardId, at)
      continue
    }
    // Manual (rating 0) is a reschedule, not a retrieval: it can neither fail a card nor
    // redeem one (`.claude/skills/fsrs-rules`).
    if (answer.rating === RATING.Manual) continue
    const previous = recovered.get(answer.cardId)
    if (previous === undefined || at > previous) recovered.set(answer.cardId, at)
  }

  const outstanding: { cardId: string; at: number }[] = []
  for (const [cardId, at] of failed) {
    const fixed = recovered.get(cardId)
    if (fixed !== undefined && fixed > at) continue
    outstanding.push({ cardId, at })
  }

  outstanding.sort((a, b) => (a.at !== b.at ? a.at - b.at : a.cardId < b.cardId ? -1 : 1))
  return outstanding.slice(0, limit).map((entry) => entry.cardId)
}
