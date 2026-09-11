import {
  type ActivityDraft,
  checkActivity,
  type Issue,
  toActivityRow,
} from '@retenia/activity-schema'
import type { BatchRequest, ProviderRole, StructuredObjectRequest } from '@retenia/ai'
import { customId, structuredRequestFor, systemFor } from '@retenia/ai'
import type {
  AbortSignalLike,
  ActivityRejection,
  AuthoredItem,
  ExamForm,
  ItemAuthorCollected,
  ItemAuthorRequest,
} from '@retenia/core'
import { mcqIssue } from '../make-activities/author'
import { nbmeIssues, stemOf } from './nbme'
import { MAKE_ITEMS_SCHEMA_ID, makeItemsOutputSchema } from './schema'
import { buildItemTask } from './task'

/**
 * P9 — one authoring call per blueprint cell (`docs/spec/04-path-generation.md` §9).
 *
 * `plan` and `collect` are **pure**, as P4's are: dispatch — the budget, the pool, the Batch
 * API, the result cache — is `@retenia/pathgen`'s, which already does it for P1 and P4.
 *
 * `collect` keeps an item only when it passes, in order: the zod schema; `checkActivity`
 * (layers 1–2); `mcqIssue` (four options, feedback on each, misconceptions named); the NBME
 * rules of `nbme.ts`; concept ids the cell was given; and a form exactly when the cell has
 * forms. Misconception ids the request did not list are dropped rather than trusted.
 */

export const MAKE_ITEMS_STAGE = 'P9_items'
/** Twenty-four items with four options and per-option feedback: ~6,000 tokens. */
export const MAKE_ITEMS_MAX_OUTPUT_TOKENS = 10_000

/** See `make-activities/author.ts`: validation needs an id, and no candidate may mint one. */
const VALIDATION_ID = '01900000-0000-7000-8000-000000000000'

export interface ItemAuthorPrompt {
  readonly template: string
  readonly promptVersion: string
  readonly schemaVersion: string
  readonly role: ProviderRole
  readonly temperature: number
}

/** The transport half; `@retenia/pathgen` declares the same shape and dispatches it. */
export interface ItemAuthorCall {
  readonly customId: string
  readonly cellKey: string
  readonly structured: StructuredObjectRequest<unknown>
  readonly batch: BatchRequest
  readonly injectionSuspected: boolean
  readonly misconceptionsAvailable: boolean
  readonly conceptIds: readonly string[]
  readonly misconceptionIds: readonly string[]
  readonly forms: readonly ExamForm[]
}

export interface ItemAuthor {
  plan(request: ItemAuthorRequest, options?: { readonly signal?: AbortSignalLike }): ItemAuthorCall
  collect(
    call: Pick<
      ItemAuthorCall,
      'customId' | 'misconceptionsAvailable' | 'conceptIds' | 'misconceptionIds' | 'forms'
    >,
    value: unknown,
  ): ItemAuthorCollected
}

export class ItemAuthorError extends Error {
  override readonly name = 'ItemAuthorError'
}

function firstError(issues: readonly Issue[]): Issue | undefined {
  return issues.find((issue) => issue.severity === 'error')
}

export function createItemAuthor(options: { readonly prompt: ItemAuthorPrompt }): ItemAuthor {
  const { prompt } = options
  if (prompt.schemaVersion !== MAKE_ITEMS_SCHEMA_ID) {
    throw new ItemAuthorError(
      `${MAKE_ITEMS_STAGE} declares schema "${prompt.schemaVersion}" but this package parses ` +
        `"${MAKE_ITEMS_SCHEMA_ID}"`,
    )
  }
  const system = systemFor(prompt.template)
  const schema = makeItemsOutputSchema()

  return {
    plan: (request, callOptions = {}) => {
      const task = buildItemTask(request)
      const id = customId({
        stage: MAKE_ITEMS_STAGE,
        inputIds: [request.blueprintKey, request.cell.key],
        promptVersion: prompt.promptVersion,
        schemaVersion: prompt.schemaVersion,
      })
      const structured: StructuredObjectRequest<unknown> = {
        system,
        prompt: task.text,
        temperature: prompt.temperature,
        schema,
        schemaName: 'make_items',
        maxOutputTokens: MAKE_ITEMS_MAX_OUTPUT_TOKENS,
        idempotencyKey: id,
        ...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
      }
      return {
        customId: id,
        cellKey: request.cell.key,
        structured,
        batch: { customId: id, request: structuredRequestFor(structured) },
        injectionSuspected: task.injectionSuspected,
        misconceptionsAvailable: request.misconceptions.length > 0,
        conceptIds: request.concepts.map((concept) => concept.id),
        misconceptionIds: request.misconceptions.map((misconception) => misconception.id),
        forms: request.cell.forms,
      }
    },

    collect: (call, value) => {
      const parsed = schema.safeParse(value)
      if (!parsed.success) {
        return {
          items: [],
          rejected: [{ type: 'choice', code: 'schema', message: parsed.error.message }],
          notes: [],
        }
      }

      const allowedConcepts = new Set(call.conceptIds)
      const allowedMisconceptions = new Set(call.misconceptionIds)
      const items: AuthoredItem[] = []
      const rejected: ActivityRejection[] = []
      const reject = (type: string, code: string, message: string) =>
        rejected.push({ type, code, message })

      for (const [index, candidate] of parsed.data.items.entries()) {
        const draft = candidate.activity as ActivityDraft
        const checked = checkActivity({ ...draft, id: VALIDATION_ID })
        if (!checked.ok) {
          const issue = firstError(checked.issues)
          reject(draft.type, issue?.code ?? 'schema', issue?.message ?? 'the item did not validate')
          continue
        }

        const optionIds =
          draft.payload.family === 'choice'
            ? new Set(draft.payload.sets.flatMap((set) => set.options.map((option) => option.id)))
            : new Set<string>()
        const misconceptionByOption: Record<string, string> = {}
        for (const pair of candidate.option_misconceptions) {
          if (optionIds.has(pair.option_id) && allowedMisconceptions.has(pair.misconception_id)) {
            misconceptionByOption[pair.option_id] = pair.misconception_id
          }
        }
        const misconceptionIds = [
          ...new Set([...candidate.misconception_ids, ...Object.values(misconceptionByOption)]),
        ].filter((id) => allowedMisconceptions.has(id))

        const mcq = mcqIssue(draft, misconceptionIds, call.misconceptionsAvailable)
        if (mcq !== null) {
          reject(draft.type, mcq.code, mcq.message)
          continue
        }
        const nbme = nbmeIssues(draft, {
          misconceptionsAvailable: call.misconceptionsAvailable,
          misconceptionByOption,
        })
        if (nbme.length > 0) {
          const first = nbme[0] as (typeof nbme)[number]
          reject(draft.type, first.code, first.message)
          continue
        }
        if (draft.skills.length === 0 || draft.skills.some((id) => !allowedConcepts.has(id))) {
          reject(
            draft.type,
            'item_concept_unknown',
            'the item names a concept the cell was not given',
          )
          continue
        }
        const form = call.forms.length === 0 ? null : candidate.form
        if (form === null ? call.forms.length > 0 : !call.forms.includes(form)) {
          reject(draft.type, 'item_form_missing', 'an exam cell needs every item on form A or B')
          continue
        }

        items.push({
          key: `${call.customId}#${index}`,
          row: toActivityRow(draft, { bloom: candidate.bloom, misconceptionIds, status: 'ready' }),
          form,
          difficulty: draft.difficulty,
          conceptIds: [...draft.skills],
          misconceptionByOption,
          stem: stemOf(draft),
        })
      }

      return { items, rejected, notes: parsed.data.notes }
    },
  }
}
