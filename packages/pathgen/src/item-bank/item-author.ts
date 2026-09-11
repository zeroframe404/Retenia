import type { BatchRequest, StructuredObjectRequest } from '@retenia/ai'
import type {
  AbortSignalLike,
  ExamForm,
  ItemAuthorCollected,
  ItemAuthorRequest,
} from '@retenia/core'

/**
 * The transport half of the item-authoring port (P9). The data half is `@retenia/core`'s
 * `ports/item-author.ts`; the implementation is `@retenia/activity-ai`'s `createItemAuthor`,
 * which satisfies this shape structurally — the arrangement `expand/activity-author.ts`
 * explains for P4, for the same reasons: this package may not import the activity schema,
 * and `apps/desktop` is where the two halves meet, so a drift is a compile error there.
 */

export interface ItemAuthorCall {
  readonly customId: string
  readonly cellKey: string
  readonly structured: StructuredObjectRequest<unknown>
  /** `structuredRequestFor(structured)`: the same bytes, so one answer serves both paths. */
  readonly batch: BatchRequest
  readonly injectionSuspected: boolean
  readonly misconceptionsAvailable: boolean
  readonly conceptIds: readonly string[]
  readonly misconceptionIds: readonly string[]
  readonly forms: readonly ExamForm[]
}

export interface ItemAuthor {
  /** One call per blueprint cell. */
  plan(request: ItemAuthorRequest, options?: { readonly signal?: AbortSignalLike }): ItemAuthorCall
  /** Parse and validate one cell's answer (schema, `checkActivity`, MCQ and NBME rules). */
  collect(
    call: Pick<
      ItemAuthorCall,
      'customId' | 'misconceptionsAvailable' | 'conceptIds' | 'misconceptionIds' | 'forms'
    >,
    value: unknown,
  ): ItemAuthorCollected
}
