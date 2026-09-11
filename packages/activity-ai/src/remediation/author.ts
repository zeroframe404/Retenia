import type { BatchRequest, ProviderRole, StructuredObjectRequest } from '@retenia/ai'
import { customId, structuredRequestFor, systemFor } from '@retenia/ai'
import type {
  AbortSignalLike,
  ActivityRejection,
  RemediationAuthorCollected,
  RemediationAuthorRequest,
  RemediationBlock,
} from '@retenia/core'
import { collectItemCandidates } from '../make-items/author'
import { REMEDIATE_SCHEMA_ID, remediateOutputSchema } from './schema'
import { buildRemediationTask } from './task'

/**
 * P11 — one call per detour (`docs/spec/04-path-generation.md` §9, §11).
 *
 * `plan` and `collect` are pure, as P4's and P9's are: dispatch is `@retenia/pathgen`'s. What
 * `collect` enforces is what the prompt asks and the code can check — at most one worked
 * example (the first is kept), items that pass every P9 rule on this one concept, and no more
 * items than the bank left to write. Citations are resolved by the caller, which holds the
 * fragments.
 */

export const REMEDIATE_STAGE = 'P11_remediation'
/** 250 words of explanation, a worked example and three items with feedback: ~3,000 tokens. */
export const REMEDIATE_MAX_OUTPUT_TOKENS = 6_000

export interface RemediationAuthorPrompt {
  readonly template: string
  readonly promptVersion: string
  readonly schemaVersion: string
  readonly role: ProviderRole
  readonly temperature: number
}

/** The transport half; `@retenia/pathgen` declares the same shape and dispatches it. */
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

export class RemediationAuthorError extends Error {
  override readonly name = 'RemediationAuthorError'
}

export function createRemediationAuthor(options: {
  readonly prompt: RemediationAuthorPrompt
}): RemediationAuthor {
  const { prompt } = options
  if (prompt.schemaVersion !== REMEDIATE_SCHEMA_ID) {
    throw new RemediationAuthorError(
      `${REMEDIATE_STAGE} declares schema "${prompt.schemaVersion}" but this package parses ` +
        `"${REMEDIATE_SCHEMA_ID}"`,
    )
  }
  const system = systemFor(prompt.template)
  const schema = remediateOutputSchema()

  return {
    plan: (request, callOptions = {}) => {
      const task = buildRemediationTask(request)
      const id = customId({
        stage: REMEDIATE_STAGE,
        inputIds: [request.pathVersionId, request.specId, request.concept.id],
        promptVersion: prompt.promptVersion,
        schemaVersion: prompt.schemaVersion,
      })
      const structured: StructuredObjectRequest<unknown> = {
        system,
        prompt: task.text,
        temperature: prompt.temperature,
        schema,
        schemaName: 'remediate',
        maxOutputTokens: REMEDIATE_MAX_OUTPUT_TOKENS,
        idempotencyKey: id,
        ...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
      }
      return {
        customId: id,
        structured,
        batch: { customId: id, request: structuredRequestFor(structured) },
        injectionSuspected: task.injectionSuspected,
        conceptIds: [request.concept.id],
        misconceptionIds: request.misconception === null ? [] : [request.misconception.id],
        misconceptionsAvailable: request.misconception !== null,
        itemsWanted: Math.max(0, Math.floor(request.itemsWanted)),
      }
    },

    collect: (call, value) => {
      const parsed = schema.safeParse(value)
      if (!parsed.success) {
        return {
          title: null,
          blocks: [],
          items: [],
          contrastCard: null,
          rejected: [{ type: 'remediation', code: 'schema', message: parsed.error.message }],
          notes: [],
        }
      }

      const rejected: ActivityRejection[] = []
      let workedExamples = 0
      const blocks: RemediationBlock[] = []
      for (const block of parsed.data.blocks) {
        if (block.type === 'worked_example') {
          workedExamples += 1
          if (workedExamples > 1) {
            rejected.push({
              type: 'remediation',
              code: 'worked_example_extra',
              message: 'P11 writes exactly one worked example; the extra one was dropped',
            })
            continue
          }
        }
        blocks.push({ type: block.type, content: block.content, citations: [...block.citations] })
      }
      if (workedExamples === 0) {
        rejected.push({
          type: 'remediation',
          code: 'worked_example_missing',
          message: 'the detour has no worked example',
        })
      }

      const collected = collectItemCandidates({ ...call, forms: [] }, parsed.data.items)
      rejected.push(...collected.rejected)
      const items = collected.items.slice(0, call.itemsWanted)
      if (collected.items.length > call.itemsWanted) {
        rejected.push({
          type: 'remediation',
          code: 'items_extra',
          message: `${collected.items.length - call.itemsWanted} item(s) beyond the ${call.itemsWanted} asked for were dropped`,
        })
      }

      const card = parsed.data.contrast_card
      return {
        title: parsed.data.title,
        blocks,
        items,
        contrastCard:
          card === null
            ? null
            : { front: card.front, back: card.back, citations: [...card.citations] },
        rejected,
        notes: parsed.data.notes,
      }
    },
  }
}
