import type { Activity } from '@retenia/activity-schema'
import type { AbortSignalLike, AiGradeInput, GradingSource } from '@retenia/core'

/**
 * `Activity<'long_text'>` → the `AiGradeInput` of `@retenia/core`'s AI grader port.
 *
 * The port is structural on purpose (core may not import `activity-schema`), so this is the one
 * place that knows how a `long_text` payload maps onto it. Everything downstream — the
 * deterministic pre-grader, the fake grader, the real rubric grader in `@retenia/activity-ai` —
 * takes the port's shape and never an `Activity`.
 */

/** `SourceRef[]` (§7) → the quoted chunks §12 lets the grader look at. A ref with no `quote`
 *  is dropped: an id alone is not ground truth, and passing it would only invite invention. */
export function gradingSourcesOf(activity: Activity): GradingSource[] {
  const sources: GradingSource[] = []
  for (const [index, ref] of (activity.sources ?? []).entries()) {
    if (ref.quote === undefined) continue
    const locator = typeof ref.span === 'string' ? ref.span : undefined
    sources.push({
      id: `${ref.docId}#${index}`,
      quote: ref.quote,
      ...(locator === undefined ? {} : { locator }),
    })
  }
  return sources
}

export function aiGradeInputFor(
  activity: Activity<'long_text'>,
  answer: string,
  signal?: AbortSignalLike,
): AiGradeInput {
  const { minWords, maxWords, keyPoints, rubric, modelAnswer } = activity.payload
  const sources = gradingSourcesOf(activity)
  return {
    activity: {
      id: activity.id,
      type: activity.type,
      lang: activity.lang,
      prompt: activity.prompt,
      ...(activity.instructions === undefined ? {} : { instructions: activity.instructions }),
    },
    answer,
    ...(rubric === undefined ? {} : { rubric }),
    ...(keyPoints === undefined ? {} : { keyPoints }),
    ...(modelAnswer === undefined ? {} : { reference: modelAnswer }),
    ...(sources.length === 0 ? {} : { sources }),
    ...(minWords === undefined ? {} : { minWords }),
    ...(maxWords === undefined ? {} : { maxWords }),
    ...(signal === undefined ? {} : { signal }),
  }
}
