import type { BatchRequest, StructuredObjectRequest } from '@retenia/ai'
import type {
  AbortSignalLike,
  ActivityAuthorCollected,
  ActivityAuthorRequest,
  ActivityFamily,
} from '@retenia/core'

/**
 * The transport half of the activity-authoring port. The data half is `@retenia/core`'s
 * `ports/activity-author.ts`; the implementation is `@retenia/activity-ai`'s
 * `createActivityAuthor`.
 *
 * Declared here, in the consumer, for the reason `run/deps.ts` gives for `GenerationRepos`: a
 * port says what *this* package may do, and narrowing it here is what lets a test's fake be
 * exactly as small as the surface. `@retenia/activity-ai` never imports this package —
 * `tooling/scripts/check-deps.mjs` would not allow it either way — and satisfies the shape
 * structurally; `apps/desktop` imports both and is where the two are actually joined, so a
 * drift is a compile error at the wiring site rather than a surprise at run time.
 *
 * `plan` and `collect` are pure. Everything that costs money — the budget guard, the worker
 * pool, `BatchRunner`, the result cache — is this package's, and `expand-lessons.ts` runs P4
 * through exactly the machinery `extract-chunks.ts` runs P1 through.
 *
 * When sub-phase 8.4 adds the blind-solve critic it takes a *second* port of the same shape
 * (`ActivityCritic`), also implemented in `@retenia/activity-ai`, rather than widening this
 * one: a critic calls a model, and this one must stay pure.
 */

export interface ActivityAuthorCall {
  readonly customId: string
  readonly family: ActivityFamily
  /** The `type` enum this call was narrowed to (§7). Reported, never re-derived. */
  readonly types: readonly string[]
  readonly structured: StructuredObjectRequest<unknown>
  /** `structuredRequestFor(structured)`: the same bytes, so one answer serves both paths. */
  readonly batch: BatchRequest
  /**
   * The lesson gave this call misconceptions to build distractors from, so §4's "distractors
   * derived from the listed misconceptions" is enforceable on its answers. False for a lesson
   * whose theory named none, where requiring an id would reject every candidate.
   */
  readonly misconceptionsAvailable: boolean
  readonly injectionSuspected: boolean
}

export interface ActivityAuthor {
  /** One call per allowed family, asking for `overGeneration ×` the wanted count. */
  plan(
    request: ActivityAuthorRequest,
    options?: { readonly signal?: AbortSignalLike },
  ): readonly ActivityAuthorCall[]
  /** Parse, validate (layers 1 and 2) and map one family's answer. Never throws. */
  collect(
    call: Pick<ActivityAuthorCall, 'customId' | 'family'>,
    value: unknown,
  ): ActivityAuthorCollected
}
