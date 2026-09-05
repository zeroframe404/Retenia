import type { AiGradeInput, AiGradeResult } from '@retenia/core'
import { countWords, looksLikeInjection, RATING } from '@retenia/core'
import { type KeyPointCoverage, keyPointCoverage } from './coverage'

/**
 * The **local pre-grader**: everything that can be decided about a free-text answer without
 * spending a token.
 *
 * `docs/spec/01-decisions.md` §6 makes the per-call cost visible and puts a monthly budget on
 * it, and §9 of `docs/spec/04-path-generation.md` lists "hidden costs (retries, critic loops)"
 * as a known pitfall. An empty answer, or one that covers none of the key points, has a verdict
 * the rubric cannot change: it is Again either way. Deciding it here means the common failure
 * costs nothing and answers arrive at the model already sanity-checked.
 *
 * The second job is §12's guard: *"injection detection in the student's answer"*. The pre-grader
 * only *flags* it — the answer is still graded, but on the rubric alone, with the reference and
 * the sources withheld, so an answer that addresses the grader cannot talk its way to the model
 * answer. Flagging rather than refusing is deliberate: the patterns are heuristics, and refusing
 * to grade would punish a false positive with a lost answer, which §7 rule 5 forbids.
 */

/** Below this, an answer is too short for a rubric to say anything about it. */
export const MIN_GRADABLE_WORDS = 5

export interface PreGradeDecision {
  /** `true` when the verdict is settled and **no AI call must be made**. */
  settled: boolean
  /** The finished grade, when `settled`. */
  result: AiGradeResult | null
  coverage: KeyPointCoverage
  words: number
  /** §12's injection detection: grade on the rubric alone. */
  injectionSuspected: boolean
  /** Why it was settled, for the feedback line and for tests. */
  reason: 'too-short' | 'no-coverage' | null
}

function again(feedback: string, injectionSuspected: boolean): AiGradeResult {
  return {
    perCriterion: [],
    score: 0,
    rating: RATING.Again,
    feedback,
    uncertain: false,
    evidence: [],
    engine: 'local',
    injectionSuspected,
  }
}

/**
 * Decides whether the answer needs the model at all.
 *
 * Coverage only settles the verdict when the activity *has* key points: an `essay_rubric` with
 * a rubric and no key points has nothing to be uncovered, and zero coverage there would mean
 * "we did not look", not "nothing was said".
 */
export function preGradeLongText(input: AiGradeInput): PreGradeDecision {
  const words = countWords(input.answer)
  const coverage = keyPointCoverage(input.answer, input.keyPoints)
  const injectionSuspected = looksLikeInjection(input.answer)
  const base = { coverage, words, injectionSuspected }

  if (words < MIN_GRADABLE_WORDS) {
    return {
      ...base,
      settled: true,
      reason: 'too-short',
      result: again(
        words === 0
          ? 'No answer was written.'
          : `The answer is ${words} word${words === 1 ? '' : 's'} long; at least ${MIN_GRADABLE_WORDS} are needed to grade it.`,
        injectionSuspected,
      ),
    }
  }

  if (coverage.total > 0 && coverage.score === 0) {
    return {
      ...base,
      settled: true,
      reason: 'no-coverage',
      result: again('The answer covers none of the expected points.', injectionSuspected),
    }
  }

  return { ...base, settled: false, reason: null, result: null }
}

/**
 * The input the model is actually shown. When injection is suspected the reference answer and
 * the source quotes are withheld: §12 says the grader may use "the reference, the rubric and
 * the chunks", and an answer trying to steer it is exactly when the reference and the chunks
 * stop being safe to put in front of it.
 */
export function sanitizeGradeInput(input: AiGradeInput, injectionSuspected: boolean): AiGradeInput {
  if (!injectionSuspected) return input
  const { reference: _reference, sources: _sources, keyPoints: _keyPoints, ...rest } = input
  return rest
}
