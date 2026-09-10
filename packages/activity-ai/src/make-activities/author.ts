import {
  type ActivityDraft,
  type ActivityTypeOf,
  checkActivity,
  type Issue,
  MVP_TYPES,
  toActivityOption,
  toActivityRow,
  typesOfFamily,
} from '@retenia/activity-schema'
import type { BatchRequest, ProviderRole, StructuredObjectRequest } from '@retenia/ai'
import { customId, structuredRequestFor, systemFor } from '@retenia/ai'
import type {
  AbortSignalLike,
  ActivityAuthorCollected,
  ActivityAuthorRequest,
  ActivityFamily,
  ActivityRejection,
  AuthoredActivity,
} from '@retenia/core'
import { MAKE_ACTIVITIES_SCHEMA_ID, makeActivitiesOutputSchema } from './schema'
import { buildActivityTask } from './task'

/**
 * P4 — one authoring call per activity family (`docs/spec/04-path-generation.md` §9,
 * `docs/spec/03-activities.md` §7 and §11).
 *
 * `plan` and `collect` are **pure**: they build requests and read answers, and they never
 * call a model. Dispatch — the budget guard, the worker pool, the Batch API, the result cache
 * — stays in `@retenia/pathgen`, which already does all of it for P1 and must not grow a
 * second copy. That is also why the two transports are built together, as `extract/request.ts`
 * does: `structured` and `batch` are the same bytes, so an answer paid for in one is found in
 * the other.
 *
 * Validation here is layers 1 and 2 only — zod, then the per-type rules. Layer 3, the
 * blind-solve critic, is sub-phase 8.4's and arrives with the key-stripped projection it
 * needs (`packages/activity-schema/src/validate/index.ts`).
 */

export const MAKE_ACTIVITIES_STAGE = 'P4_make_activities'
/** Room for 24 candidates of a wordy family; a full `long_text` pool is ~4,000 tokens. */
export const MAKE_ACTIVITIES_MAX_OUTPUT_TOKENS = 8_000

/**
 * The id every candidate is validated under.
 *
 * The envelope requires a UUIDv7 `id` and a draft has none, so validation needs a stand-in.
 * It is a constant rather than a minted id because ids are the repositories' to mint
 * (`docs/spec/00-conventions.md`) and a candidate the variety filter drops is a row that never
 * existed — nothing here may leave an id behind. It never reaches `toActivityRow`.
 */
const VALIDATION_ID = '01900000-0000-7000-8000-000000000000'

export interface ActivityAuthorPrompt {
  readonly template: string
  readonly promptVersion: string
  readonly schemaVersion: string
  readonly role: ProviderRole
  readonly temperature: number
}

/** The transport half of the port; `@retenia/pathgen` declares the same shape and dispatches it. */
export interface ActivityAuthorCall {
  readonly customId: string
  readonly family: ActivityFamily
  readonly types: readonly string[]
  readonly structured: StructuredObjectRequest<unknown>
  readonly batch: BatchRequest
  /** The lesson had misconceptions to build distractors from; see `mcqIssue`. */
  readonly misconceptionsAvailable: boolean
  readonly injectionSuspected: boolean
}

export interface ActivityAuthor {
  plan(
    request: ActivityAuthorRequest,
    options?: { readonly signal?: AbortSignalLike },
  ): readonly ActivityAuthorCall[]
  collect(
    call: Pick<ActivityAuthorCall, 'customId' | 'family' | 'misconceptionsAvailable'>,
    value: unknown,
  ): ActivityAuthorCollected
}

export class ActivityAuthorError extends Error {
  override readonly name = 'ActivityAuthorError'
}

/** The MVP types of one family — 8.3 generates nothing that has no renderer. */
export function authorableTypes<F extends ActivityFamily>(family: F): readonly ActivityTypeOf<F>[] {
  return typesOfFamily(family).filter((type) => MVP_TYPES.includes(type))
}

function firstError(issues: readonly Issue[]): Issue | undefined {
  return issues.find((issue) => issue.severity === 'error')
}

/**
 * §4's MCQ rule: "4 options, one unambiguously correct".
 *
 * A *generation* rule rather than a property of every MCQ that can exist — a hand-written
 * three-option question is fine and `validateChoice` is right not to refuse it — so it lives
 * here, where over-generation makes rejecting a candidate cost nothing, rather than in the
 * shared validator where it would also judge the fixture corpus and anything the user writes.
 */
const MCQ_OPTIONS = 4
/** The types §4's sentence is about. `true_false` has its own two-option rule in the validator,
 *  and the burst types are a different shape entirely. */
const MCQ_TYPES: ReadonlySet<string> = new Set(['mcq_single', 'mcq_multi'])

/** §4: an MCQ ships with per-option feedback and with the misconception its distractors came from. */
export function mcqIssue(
  draft: ActivityDraft,
  misconceptionIds: readonly string[],
  misconceptionsAvailable: boolean,
): { readonly code: string; readonly message: string } | null {
  if (draft.payload.family !== 'choice') return null
  for (const set of draft.payload.sets) {
    if (MCQ_TYPES.has(draft.type) && set.options.length !== MCQ_OPTIONS) {
      return {
        code: 'mcq_option_count',
        message:
          `an MCQ has ${MCQ_OPTIONS} options, got ${set.options.length}; ` +
          'fewer makes the answer guessable and more is a list to read rather than a question',
      }
    }
    const bare = set.options.filter(
      (option) => option.feedback === undefined || option.feedback.trim() === '',
    )
    if (bare.length > 0) {
      return {
        code: 'mcq_option_feedback_missing',
        message:
          `${bare.length} of ${set.options.length} options carry no feedback; ` +
          'an AI-authored MCQ needs one per option so a wrong answer teaches something',
      }
    }
  }
  if (misconceptionsAvailable && misconceptionIds.length === 0) {
    return {
      code: 'mcq_misconception_missing',
      message:
        'the lesson listed misconceptions and this MCQ names none; ' +
        'distractors are meant to be derived from them',
    }
  }
  return null
}

export function createActivityAuthor(options: {
  readonly prompt: ActivityAuthorPrompt
}): ActivityAuthor {
  const { prompt } = options
  if (prompt.schemaVersion !== MAKE_ACTIVITIES_SCHEMA_ID) {
    throw new ActivityAuthorError(
      `${MAKE_ACTIVITIES_STAGE} declares schema "${prompt.schemaVersion}" but this package ` +
        `parses "${MAKE_ACTIVITIES_SCHEMA_ID}"`,
    )
  }
  const system = systemFor(prompt.template)

  return {
    plan: (request, callOptions = {}) =>
      request.families.flatMap((family): ActivityAuthorCall[] => {
        const types = authorableTypes(family)
        if (types.length === 0) return []
        const task = buildActivityTask(request, family, types)
        const id = customId({
          stage: MAKE_ACTIVITIES_STAGE,
          // Parented on the P3 call: the same id means the same theory, which means the same
          // input. `variant` is "Más ejemplos", which must add rather than replace, so it
          // cannot be `AiBinding.force`.
          inputIds: [request.parentCustomId, family, String(request.variant)],
          promptVersion: prompt.promptVersion,
          schemaVersion: prompt.schemaVersion,
        })
        const structured: StructuredObjectRequest<unknown> = {
          system,
          prompt: task.text,
          temperature: prompt.temperature,
          schema: makeActivitiesOutputSchema(family, types),
          schemaName: `make_activities_${family}`,
          maxOutputTokens: MAKE_ACTIVITIES_MAX_OUTPUT_TOKENS,
          idempotencyKey: id,
          ...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
        }
        return [
          {
            customId: id,
            family,
            types,
            structured,
            batch: { customId: id, request: structuredRequestFor(structured) },
            misconceptionsAvailable: request.misconceptions.length > 0,
            injectionSuspected: task.injectionSuspected,
          },
        ]
      }),

    collect: (call, value) => {
      const parsed = makeActivitiesOutputSchema(
        call.family,
        authorableTypes(call.family),
      ).safeParse(value)
      if (!parsed.success) {
        return {
          activities: [],
          rejected: [{ type: call.family, code: 'schema', message: parsed.error.message }],
          notes: [],
        }
      }

      const activities: AuthoredActivity[] = []
      const rejected: ActivityRejection[] = []

      for (const [index, candidate] of parsed.data.candidates.entries()) {
        const draft = candidate.activity as ActivityDraft
        const checked = checkActivity({ ...draft, id: VALIDATION_ID })
        if (!checked.ok) {
          const issue = firstError(checked.issues)
          rejected.push({
            type: draft.type,
            code: issue?.code ?? 'schema',
            message: issue?.message ?? 'the candidate did not validate',
          })
          continue
        }
        // §4's two MCQ rules that `checkActivity` cannot carry: the shipped envelope makes
        // `feedback` optional, because a hand-authored activity may legitimately omit it, and
        // it has no per-option misconception field at all. For an *AI-authored* one both are
        // required — the feedback is what makes a wrong answer teach something, and the
        // misconception id is what links the distractor to the item bank 8.5 builds. Enforcing
        // it here rather than in the envelope keeps the rule with the parser that owns this
        // path and avoids a `schemaVersion` bump across every fixture.
        const mcq = mcqIssue(draft, candidate.misconception_ids, call.misconceptionsAvailable)
        if (mcq !== null) {
          rejected.push({ type: draft.type, code: mcq.code, message: mcq.message })
          continue
        }

        const key = `${call.customId}#${index}`
        activities.push({
          key,
          row: toActivityRow(draft, {
            bloom: candidate.bloom,
            misconceptionIds: candidate.misconception_ids,
            // Every MVP family is text-only, so nothing generated here waits on a media job.
            // `needs_review` is layer 3's verdict and arrives with it in 8.4.
            status: 'ready',
          }),
          option: {
            ...toActivityOption(checked.activity, { bloom: candidate.bloom }),
            activityId: key,
          },
        })
      }

      return { activities, rejected, notes: parsed.data.notes }
    },
  }
}
