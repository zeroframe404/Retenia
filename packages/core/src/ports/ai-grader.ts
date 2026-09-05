import type { Grade } from '../memory/types'

/**
 * The two AI ports the `long_text` family needs (`docs/spec/03-activities.md` §10's **AI**
 * grader row, and `docs/spec/04-path-generation.md` §12 "Grading free-text answers").
 *
 * They live in `packages/core` because they are *domain* interfaces: the rules around them —
 * temperature 0, a rubric of 2–4 anchored criteria, evidence quoted from the answer,
 * `uncertain` affecting neither Elo nor FSRS, injection detection — belong to the product, not
 * to whichever provider answers the call. `packages/activity-ai` implements them over a
 * `TextGenerator`; `@retenia/activity-graders` implements the deterministic fake; the React host
 * only ever sees the port.
 *
 * Nothing here imports `@retenia/activity-schema` (which depends on *this* package): the shapes
 * below are structural, so a real `Activity` and its `long_text` payload satisfy them without a
 * conversion step and without an edge the dependency graph forbids.
 */

/** Markdown, as `activity-schema`'s `richTextSchema` defines it. */
export type RichText = string

/**
 * The cancellation token a grading call may carry.
 *
 * Typed structurally rather than as `AbortSignal` because `packages/core` compiles against
 * `lib: ES2023` alone — it has neither the DOM nor Node's globals, and giving it either would
 * hand the domain layer a `window` and an `fs` it is not allowed to use. A real `AbortSignal`
 * satisfies this, and the adapter that actually issues the request holds the concrete type.
 */
export interface AbortSignalLike {
  readonly aborted: boolean
}

/**
 * Which engine produced a grade, for `GradeResult.meta.engine`:
 *
 * - `ai` — a model graded the answer against the rubric.
 * - `fake` — the deterministic key-point estimate, used offline and in tests. §6 of
 *   `docs/spec/01-decisions.md` demands the cost be visible; a score that never cost anything
 *   must not look like one that did, so the UI labels it *"estimado"*.
 * - `local` — the pre-grader decided without any call at all (an empty answer, no coverage).
 */
export const AI_GRADE_ENGINES = ['ai', 'fake', 'local'] as const
export type AiGradeEngine = (typeof AI_GRADE_ENGINES)[number]

/** One anchored level of a rubric criterion (§12: "2–4 criteria with anchors 0/1/2"). */
export interface GradingRubricLevel {
  /** Normalized to `[0, 1]`; the 0/1/2 anchors of §12 are `0` / `0.5` / `1`. */
  score: number
  description: string
}

export interface GradingRubricCriterion {
  id: string
  criterion: string
  /** Relative weight; absent means `1`. */
  weight?: number
  levels: readonly GradingRubricLevel[]
}

/** A point the answer is expected to make, with the phrasings that count as making it. */
export interface GradingKeyPoint {
  id: string
  text: string
  weight?: number
  aliases?: readonly string[]
}

/** Where the grader may look for ground truth — §12: "the grader only uses the reference,
 *  the rubric and the chunks". */
export interface GradingSource {
  id: string
  quote: string
  locator?: string
}

/** The activity being graded, reduced to what a prompt or a log needs to name it. */
export interface GradedActivityRef {
  id: string
  /** `free_recall`, `essay_rubric`, … */
  type: string
  /** BCP-47: the feedback comes back in the learner's language. */
  lang: string
  prompt: RichText
  instructions?: string
}

export interface AiGradeInput {
  activity: GradedActivityRef
  /** What the learner wrote, verbatim. Never trusted as instructions (§12's injection guard). */
  answer: string
  rubric?: readonly GradingRubricCriterion[]
  keyPoints?: readonly GradingKeyPoint[]
  /** The model answer (§10: it is shown whatever the score). */
  reference?: RichText
  sources?: readonly GradingSource[]
  mustInclude?: readonly string[]
  mustNot?: readonly string[]
  minWords?: number
  maxWords?: number
  signal?: AbortSignalLike
}

/** One criterion's verdict. `score` is normalized to `[0, 1]`, whatever the anchors were. */
export interface CriterionScore {
  id: string
  criterion: string
  score: number
  weight: number
  /** The anchor the grader picked, when it named one. */
  level?: string
  comment?: string
}

/** A quote **from the learner's answer** backing a criterion's score (§12: "evidence cited
 *  from the answer"). */
export interface AnswerEvidence {
  quote: string
  criterionId?: string
}

export interface AiGradeResult {
  perCriterion: readonly CriterionScore[]
  /** Weighted mean of `perCriterion`, or the key-point coverage when there is no rubric. */
  score: number
  /**
   * The FSRS grade, or `null` when the caller must decide — `uncertain`, or an engine that
   * declines to rate. §3's M-ai: "the rubric returns a rating and the user can correct it".
   */
  rating: Grade | null
  feedback: RichText
  /**
   * §12: "when in doubt it declares `uncertain`", which "affects neither Elo nor FSRS". A
   * `true` here means no review log is written and the UI asks the learner to self-rate.
   */
  uncertain: boolean
  evidence: readonly AnswerEvidence[]
  engine: AiGradeEngine
  /** §12's injection detection: the answer was graded on the rubric alone. */
  injectionSuspected: boolean
  /** The provider's model id, when one graded it. */
  model?: string
}

export type AiGrader = (input: AiGradeInput) => Promise<AiGradeResult>

export interface ExplainAnswerRequest {
  activity: GradedActivityRef
  answer: string
  /** The grade being explained, or `null` when the learner asked before answering. */
  gradeResult: AiGradeResult | null
  signal?: AbortSignalLike
}

/**
 * §9's "Explain my answer" / *Explicame*, and §12's "for each error (why it is wrong, which
 * misconception it activates, citation)".
 */
export type ExplainAnswer = (input: ExplainAnswerRequest) => Promise<RichText>

/**
 * §12's "injection detection in the student's answer": an answer that addresses the grader
 * instead of the question.
 *
 * Deliberately a small, high-precision list of *imperatives aimed at a model*. A learner writing
 * about prompt injection should still be graded normally — and the flag does not reject the
 * answer in any case, it only narrows what the grader is allowed to see (the rubric, not the
 * sources or the reference), which is the cheapest correct response to an uncertain signal.
 *
 * Word boundaries are spelled out as Unicode lookarounds rather than `\b`, which is ASCII-only:
 * `\bignorá\b` never matches, because JavaScript does not consider `á` a word character. Half
 * the phrases this has to catch are Spanish.
 */
const WORD_START = String.raw`(?<![\p{L}\p{N}])`
const WORD_END = String.raw`(?![\p{L}\p{N}])`

function injectionPattern(source: string): RegExp {
  return new RegExp(source, 'iu')
}

export const INJECTION_PATTERNS: readonly RegExp[] = Object.freeze([
  // "ignore the previous instructions", "ignorá las instrucciones anteriores"
  injectionPattern(
    `${WORD_START}(?:ignor\\p{L}*|disregard)${WORD_END}[^.\\n]{0,40}${WORD_START}(?:previous|prior|above|instructions?|anterior\\p{L}*|instruccion\\p{L}*|consigna\\p{L}*)${WORD_END}`,
  ),
  // "you are a helpful assistant", "sos el corrector", "act as a teacher"
  injectionPattern(
    `${WORD_START}(?:you\\s+are|act\\s+as|sos|eres|act[uú]\\p{L}*)${WORD_END}[^.\\n]{0,40}${WORD_START}(?:assistant|grader|model|ai|chatgpt|claude|corrector\\p{L}*|profesor\\p{L}*|modelo|evaluador\\p{L}*)${WORD_END}`,
  ),
  injectionPattern(`${WORD_START}(?:system|developer)${WORD_END}\\s*(?:prompt|message)${WORD_END}`),
  injectionPattern(`</?(?:system|instructions?)>`),
  // "give me full marks", "dame la máxima nota"
  injectionPattern(
    `${WORD_START}(?:give|award|dame|pon[eé]\\p{L}*|asign\\p{L}*)${WORD_END}[^.\\n]{0,30}(?:full marks|m[aá]xima nota|nota m[aá]xima|10\\s*/\\s*10|100\\s*%|puntaje m[aá]ximo)`,
  ),
  injectionPattern(
    `${WORD_START}(?:new|nuevas?)${WORD_END}\\s+(?:instructions?|instrucciones)${WORD_END}`,
  ),
])

/** Whether the answer contains instruction-like text aimed at the grader. */
export function looksLikeInjection(answer: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(answer))
}

/** Words in an answer, by the same rule the renderer's counter uses. */
export function countWords(answer: string): number {
  const trimmed = answer.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/**
 * The weighted mean of a rubric's criterion scores, in `[0, 1]`.
 *
 * An empty rubric scores `0` rather than throwing: a grader that returned no criteria has told
 * us nothing, and `uncertain` — not an exception — is how that is reported.
 */
export function weightedCriterionScore(perCriterion: readonly CriterionScore[]): number {
  let total = 0
  let earned = 0
  for (const criterion of perCriterion) {
    const weight = criterion.weight > 0 ? criterion.weight : 1
    total += weight
    earned += weight * Math.min(1, Math.max(0, criterion.score))
  }
  return total === 0 ? 0 : earned / total
}
