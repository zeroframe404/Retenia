import type {
  AiGradeInput,
  AiGradeResult,
  AiGrader,
  AnswerEvidence,
  CriterionScore,
  Grade,
} from '@retenia/core'
import { RATING_THRESHOLDS, weightedCriterionScore } from '@retenia/core'
import { keyPointCoverage } from './coverage'
import { preGradeLongText, sanitizeGradeInput } from './pre-grade'

/**
 * `FakeAiGrader` — the deterministic stand-in for §10's AI rubric row.
 *
 * It scores an answer by **weighted key-point coverage** (the FUZ set-match of §4 row 7) and
 * spreads that score across the rubric's criteria, so a rubric breakdown, evidence quotes and a
 * rating all exist with no provider, no key and no network. Three jobs:
 *
 * 1. **Tests.** Every test of the renderer, the host and the session generator needs a grade
 *    that is the same on every run; a real model is neither.
 * 2. **Storybook.** The catalog mounts the real renderer over the real host.
 * 3. **The offline fallback.** §4 of `docs/spec/01-decisions.md` makes local operation a
 *    requirement and §6 makes cost visible, so an answer given with no provider configured — or
 *    after a failed call — still gets feedback. It is labelled *estimado* in the UI, which is
 *    what `engine: 'fake'` is for: an estimate that cost nothing must never be mistaken for a
 *    graded one.
 *
 * It is emphatically **not** a rubric grader: it cannot tell whether an argument holds. What it
 * can tell is whether the answer says the things the generator said it should, which is the same
 * signal `free_recall` is scored on anyway.
 */

/** Evidence quotes are trimmed to this many characters so the panel stays readable. */
export const EVIDENCE_MAX_CHARS = 160

/** What a rubric-only answer (no key points to match) is scored, since coverage says nothing. */
export const NO_COVERAGE_ESTIMATE = 0.5

/** The band of §10's AI row, applied to the estimate. */
function ratingFor(score: number): Grade {
  const { ai } = RATING_THRESHOLDS
  if (score < ai.again) return 1
  if (score < ai.good) return 2
  return score < ai.easy ? 3 : 4
}

/**
 * The sentence of the answer that mentions `phrase`, trimmed — the "evidence from the answer"
 * §12 asks for, found deterministically instead of quoted by a model. Falls back to the whole
 * answer when no single sentence carries the phrase's first word.
 */
function evidenceFor(answer: string, phrase: string): string {
  const sentences = answer.split(/(?<=[.!?;\n])\s+/)
  // `split(…, 1).join('')` rather than `[0] ?? ''`: the same first word, with no index whose
  // impossible `undefined` would sit in the coverage report for ever.
  const head = phrase.toLocaleLowerCase().split(/\s+/, 1).join('')
  const hit = sentences.find((sentence) => sentence.toLocaleLowerCase().includes(head))
  const quote = (hit ?? answer).trim()
  return quote.length <= EVIDENCE_MAX_CHARS ? quote : `${quote.slice(0, EVIDENCE_MAX_CHARS - 1)}…`
}

function feedbackFor(score: number, covered: number, total: number): string {
  const percent = Math.round(score * 100)
  if (total === 0) return `Estimated ${percent}%: there are no key points to check against.`
  if (covered === total) return `Estimated ${percent}%: every expected point is covered.`
  return `Estimated ${percent}%: ${covered} of ${total} expected points are covered.`
}

/**
 * Grades one answer. Runs the same pre-grade the real grader does, so "no call for an empty
 * answer" holds whichever engine is wired, and so the injection guard withholds the reference
 * here too.
 */
export function fakeAiGrade(input: AiGradeInput): AiGradeResult {
  const pre = preGradeLongText(input)
  if (pre.result !== null) return pre.result

  const seen = sanitizeGradeInput(input, pre.injectionSuspected)
  const coverage = keyPointCoverage(seen.answer, seen.keyPoints)
  const score = coverage.total === 0 ? NO_COVERAGE_ESTIMATE : coverage.score

  // No `level` is reported: picking an anchor is a rubric *judgement*, and this grader has made
  // none — it spread one coverage number across the criteria. Naming an anchor would dress an
  // estimate up as a verdict.
  const perCriterion: CriterionScore[] = (seen.rubric ?? []).map((criterion) => ({
    id: criterion.id,
    criterion: criterion.criterion,
    score,
    weight: criterion.weight !== undefined && criterion.weight > 0 ? criterion.weight : 1,
    comment: 'Estimated from key-point coverage, not from a rubric judgement.',
  }))

  const evidence: AnswerEvidence[] = (seen.keyPoints ?? [])
    .filter((point) => coverage.covered.includes(point.id))
    .map((point) => ({ quote: evidenceFor(seen.answer, point.text) }))

  // Keeping the headline the weighted mean of the criteria means the breakdown on screen always
  // adds up to the number printed next to it.
  const headline = perCriterion.length === 0 ? score : weightedCriterionScore(perCriterion)
  return {
    perCriterion,
    score: headline,
    rating: ratingFor(headline),
    feedback: feedbackFor(headline, coverage.covered.length, coverage.total),
    uncertain: false,
    evidence,
    engine: 'fake',
    injectionSuspected: pre.injectionSuspected,
  }
}

/** The port shape, for wiring the fake in where an `AiGrader` is expected. */
export function createFakeAiGrader(): AiGrader {
  return async (input) => fakeAiGrade(input)
}
