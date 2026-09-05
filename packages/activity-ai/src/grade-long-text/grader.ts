import {
  fakeAiGrade,
  keyPointCoverage,
  preGradeLongText,
  sanitizeGradeInput,
} from '@retenia/activity-graders'
import { normalizeText } from '@retenia/activity-schema'
import type { TextGenerator } from '@retenia/ai'
import type {
  AiGradeInput,
  AiGradeResult,
  AiGrader,
  AnswerEvidence,
  CriterionScore,
  Grade,
} from '@retenia/core'
import { RATING_THRESHOLDS, weightedCriterionScore } from '@retenia/core'
import {
  GRADE_LONG_TEXT_JSON_SCHEMA,
  GRADE_LONG_TEXT_SCHEMA_NAME,
  type GradeLongTextOutput,
  parseGradeLongTextOutput,
} from './output'
import { buildGradeLongTextTask, permuteRubric } from './task'

/**
 * P10 of `docs/spec/04-path-generation.md` §9, wired to a `TextGenerator`: the real AI grader
 * behind `@retenia/core`'s `AiGrader` port, for `free_recall` and `essay_rubric`.
 *
 * The order of operations is the whole design, and every step is a rule from §12 or §7:
 *
 * 1. **Pre-grade locally.** An empty or coverage-free answer is Again, decided with no call at
 *    all. `docs/spec/01-decisions.md` §6 puts a monthly budget on the API; the commonest
 *    failure should not be its biggest line.
 * 2. **Detect injection.** A flagged answer is still graded, but on the rubric alone — the
 *    reference and the source quotes are withheld.
 * 3. **Ask, at temperature 0.** §7: *"temperature 0 in extraction, judges and grading"*.
 * 4. **Ask again with the criteria permuted, and average if they differ.** §12 asks for
 *    exactly this. A disagreement wider than one anchor step is not averaged away — it is
 *    reported as `uncertain`, which §12 says affects neither Elo nor FSRS.
 * 5. **Validate everything the model said.** §7 rule 7 of `01-decisions.md`: *"the AI proposes,
 *    the code validates"*. The weighted score is recomputed here, the rating is derived from
 *    the §10 band table rather than taken on trust, and an evidence quote that is not in the
 *    learner's answer is dropped.
 * 6. **Fall back.** A failed call, a malformed completion or a schema violation lands on the
 *    deterministic `FakeAiGrader`, whose `engine: 'fake'` makes the UI label the score
 *    *estimado*. §4 of `01-decisions.md` requires the app to work offline; an answer the
 *    learner has already written must never be lost to a network error.
 */

export interface AiLongTextGraderOptions {
  textGenerator: TextGenerator
  /** The contents of `prompts/grade_long_text.md`; `loadGradeLongTextPrompt()` reads the file. */
  promptTemplate: string
  /** Runs the second, permuted evaluation of §12. On by default; off halves the cost. */
  doubleEvaluate?: boolean
  maxOutputTokens?: number
  /** Reports a failed call so the caller can log it; the grade still falls back. */
  onError?: (error: unknown) => void
}

/** Two runs whose weighted scores differ by more than this are averaged rather than trusted. */
export const AGREEMENT_EPSILON = 0.05

/**
 * …and past this they are not averaged either: `uncertain`. One third is one step of the 0/½/1
 * rubric §12 prescribes, so "the two runs picked different anchors on more than a third of the
 * weight" is the line, and past it the average would be a number neither run would defend.
 */
export const DISAGREEMENT_UNCERTAIN = 1 / 3

export const GRADE_LONG_TEXT_TEMPERATURE = 0

/** §10's AI band, applied to the score the code computed. */
export function ratingForScore(score: number): Grade {
  const { ai } = RATING_THRESHOLDS
  if (score < ai.again) return 1
  if (score < ai.good) return 2
  return score < ai.easy ? 3 : 4
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * The model's criterion scores, reconciled with the rubric it was given: one entry per authored
 * criterion, in the *authored* order (so the permuted run lines up with the first), unknown ids
 * dropped, and a criterion the model skipped scored 0 — a criterion nobody argued for has not
 * been earned.
 */
function reconcile(input: AiGradeInput, output: GradeLongTextOutput): CriterionScore[] {
  const byId = new Map(output.perCriterion.map((entry) => [entry.id, entry]))
  return (input.rubric ?? []).map((criterion) => {
    const said = byId.get(criterion.id)
    return {
      id: criterion.id,
      criterion: criterion.criterion,
      score: said === undefined ? 0 : clamp01(said.score),
      weight: criterion.weight !== undefined && criterion.weight > 0 ? criterion.weight : 1,
      ...(said?.level === undefined ? {} : { level: said.level }),
      ...(said?.comment === undefined ? {} : { comment: said.comment }),
    }
  })
}

/**
 * Keeps only the quotes that really are in the learner's answer (§12: "evidence cited **from
 * the answer**"). Compared after the same Unicode normalization the fuzzy graders use, so an
 * accent or a stray double space does not discard a genuine quote.
 */
function verifyEvidence(answer: string, output: GradeLongTextOutput): AnswerEvidence[] {
  const haystack = normalizeText(answer)
  return output.evidence
    .filter((entry) => haystack.includes(normalizeText(entry.quote)))
    .map((entry) => ({
      quote: entry.quote,
      ...(entry.criterionId === undefined ? {} : { criterionId: entry.criterionId }),
    }))
}

/** The headline score: the weighted rubric mean, or — with no rubric — key-point coverage,
 *  falling back to what the model reported when there is neither. */
function headlineScore(
  input: AiGradeInput,
  perCriterion: readonly CriterionScore[],
  output: GradeLongTextOutput,
): number {
  if (perCriterion.length > 0) return weightedCriterionScore(perCriterion)
  const coverage = keyPointCoverage(input.answer, input.keyPoints)
  return coverage.total > 0 ? coverage.score : clamp01(output.score)
}

interface Run {
  perCriterion: CriterionScore[]
  score: number
  evidence: AnswerEvidence[]
  output: GradeLongTextOutput
  model: string
}

export function createAiLongTextGrader(options: AiLongTextGraderOptions): AiGrader {
  const { textGenerator, promptTemplate, doubleEvaluate = true } = options

  async function runOnce(seen: AiGradeInput): Promise<Run> {
    const completion = await textGenerator({
      system: promptTemplate.replace('{{task}}', '').trimEnd(),
      prompt: buildGradeLongTextTask(seen),
      temperature: GRADE_LONG_TEXT_TEMPERATURE,
      jsonSchema: GRADE_LONG_TEXT_JSON_SCHEMA,
      schemaName: GRADE_LONG_TEXT_SCHEMA_NAME,
      ...(options.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: options.maxOutputTokens }),
      ...(seen.signal === undefined ? {} : { signal: seen.signal }),
    })
    const output = parseGradeLongTextOutput(completion.text)
    const perCriterion = reconcile(seen, output)
    return {
      perCriterion,
      score: headlineScore(seen, perCriterion, output),
      evidence: verifyEvidence(seen.answer, output),
      output,
      model: completion.model,
    }
  }

  return async (input) => {
    const pre = preGradeLongText(input)
    if (pre.result !== null) return pre.result
    const seen = sanitizeGradeInput(input, pre.injectionSuspected)

    try {
      const first = await runOnce(seen)
      // §12's second opinion, and only where it can say something: with fewer than two criteria
      // there is no permutation, so the run would be a verbatim repeat at someone's expense.
      const second =
        doubleEvaluate && (seen.rubric?.length ?? 0) >= 2
          ? await runOnce(permuteRubric(seen))
          : null

      const gap = second === null ? 0 : Math.abs(first.score - second.score)
      const agreed = second === null || gap <= AGREEMENT_EPSILON
      const score = agreed ? first.score : (first.score + second.score) / 2
      const uncertain =
        first.output.uncertain ||
        (second?.output.uncertain ?? false) ||
        gap > DISAGREEMENT_UNCERTAIN

      // The permuted run reports its criteria in the permuted order, so the two are merged **by
      // id**, never by position — pairing them by index would average c1 against c2, which is
      // precisely the mix-up the permutation was introduced to expose.
      const secondById = new Map(
        (second?.perCriterion ?? []).map((criterion) => [criterion.id, criterion.score]),
      )

      return {
        // The first run's breakdown carries the authored order the panel renders in.
        perCriterion: agreed
          ? first.perCriterion
          : first.perCriterion.map((criterion) => ({
              ...criterion,
              score: (criterion.score + (secondById.get(criterion.id) ?? criterion.score)) / 2,
            })),
        score,
        rating: uncertain ? null : ratingForScore(score),
        feedback: first.output.feedback,
        uncertain,
        evidence: first.evidence,
        engine: 'ai',
        injectionSuspected: pre.injectionSuspected,
        model: first.model,
      } satisfies AiGradeResult
    } catch (error) {
      options.onError?.(error)
      // The learner's answer is not lost to a provider outage: the deterministic estimate takes
      // over, and `engine: 'fake'` is what tells the UI to call it one.
      return fakeAiGrade(input)
    }
  }
}
