import type { BatchRequest, StructuredObjectRequest } from '@retenia/ai'
import type {
  AbortSignalLike,
  RemediationAuthorCollected,
  RemediationAuthorRequest,
} from '@retenia/core'

/**
 * The transport half of the remediation-authoring port (P11). The data half is
 * `@retenia/core`'s `ports/remediation-author.ts`; the implementation is
 * `@retenia/activity-ai`'s `createRemediationAuthor`, which satisfies this shape structurally —
 * the arrangement `item-bank/item-author.ts` explains for P9.
 */

export interface RemediationAuthorCall {
  readonly customId: string
  readonly structured: StructuredObjectRequest<unknown>
  readonly batch: BatchRequest
  readonly injectionSuspected: boolean
  readonly conceptIds: readonly string[]
  readonly misconceptionIds: readonly string[]
  readonly misconceptionsAvailable: boolean
  readonly itemsWanted: number
}

export interface RemediationAuthor {
  plan(
    request: RemediationAuthorRequest,
    options?: { readonly signal?: AbortSignalLike },
  ): RemediationAuthorCall
  collect(
    call: Pick<
      RemediationAuthorCall,
      'customId' | 'conceptIds' | 'misconceptionIds' | 'misconceptionsAvailable' | 'itemsWanted'
    >,
    value: unknown,
  ): RemediationAuthorCollected
}
