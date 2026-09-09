import type { AbortSignalLike } from '@retenia/core'
import type { z } from 'zod'
import type { PromptCacheDirective } from '../caching/directive'
import { AiError } from '../errors'
import type { AiAttempt, AiBinding, AiReview, RunDeps } from '../run'
import { DEFAULT_REPAIR_BUDGET, runOnce } from '../run'
import type { TextGenerationRequest, TextGenerationUsage } from '../text-generator'
import { toStrictJsonSchema } from './json-schema'
import { buildRepairPrompt, describeIssues, parseJsonCompletion } from './parse'
import type { SanitizeLimits } from './sanitize'
import { DEFAULT_SANITIZE_LIMITS, sanitizeOutput } from './sanitize'

/**
 * A typed value out of a language model, with the four defences
 * `docs/spec/06-ai-providers.md` §6 and `docs/spec/04-path-generation.md` §8 ask for stacked
 * in one place: the provider's own grammar where it has one, a sanitizer, a zod parse, and a
 * bounded repair loop before the next model in the role gets a turn.
 *
 * The shape of the thing is worth stating plainly, because each layer exists for a failure
 * the others cannot catch.
 *
 * 1. **Provider-native JSON Schema** (`caps.jsonStrict`) makes malformed JSON nearly
 *    impossible rather than merely unlikely — Anthropic compiles the schema to a grammar,
 *    Gemini constrains decoding. Where it is unavailable (7.4's DeepSeek, Kimi, Qwen, a local
 *    model) the adapter asks for JSON in the prompt instead and everything below is unchanged.
 * 2. **The sanitizer** runs on the parsed value before the schema sees it. These completions
 *    are written out of the user's own PDFs and scraped pages, so a `<script>` in the output
 *    usually means a `<script>` in the source; §7 of `07-architecture.md` makes the renderer's
 *    CSP strict for the same reason, and this is the other half of that.
 * 3. **The zod parse** is the contract. It holds the `min`/`max`/`pattern` refinements that
 *    `toStrictJsonSchema` had to move into descriptions to get past Claude's strict mode, so
 *    it is strictly stronger than what the provider enforced, never weaker.
 * 4. **The repair loop**, then the next model. A schema failure is not a transport failure:
 *    the same model, shown its own output and the list of what is wrong with it, fixes it
 *    most of the time for a fraction of a fresh call. Twice, and then a *different* model —
 *    which is the one thing a third repair turn cannot offer.
 *
 * Everything above sits on `runOnce`'s `review` hook rather than on a second dispatch loop,
 * so the budget gate, the ordered fallback, the `ai_results` cache and the one-row-per-attempt
 * cost log are shared and cannot drift. See `AiReview` for the argument in full.
 */

export interface StructuredRequestBase {
  /** The task itself. Untrusted spans belong in a `<user_content>` block; see `user-content.ts`. */
  readonly prompt: string
  /** The rendered prompt file. `renderPrompt()` produces it and its version together. */
  readonly system?: string
  /**
   * `docs/spec/04-path-generation.md` §7: 0 in extraction, judges and grading; 0.5–0.7 in
   * writing. Required, never defaulted — a grader that became non-deterministic by omission
   * is exactly the bug the spec's rule exists to prevent.
   */
  readonly temperature: number
  readonly maxOutputTokens?: number
  /** Names the schema for providers that want one; also what appears in a provider's logs. */
  readonly schemaName?: string
  /**
   * `custom_id` from `idempotency.ts`. With one, a retry, a restart or a resumed batch reads
   * `ai_results` instead of paying again.
   */
  readonly idempotencyKey?: string
  readonly signal?: AbortSignalLike
  /** Overrides the output caps for a call that legitimately produces a lot. */
  readonly sanitizeLimits?: SanitizeLimits
  /** Defaults to `DEFAULT_REPAIR_BUDGET` (2). Zero means "one shot, then the next model". */
  readonly repairBudget?: number
  /**
   * The stable, wrapped head of the user message and its breakpoints, as `withCache` builds
   * them (sub-phase 7.3). Carried through to the transport request untouched — and, because
   * a repair turn spreads the same base request, through every repair as well, so the
   * prefix a run paid to cache is read back on the retry rather than re-sent.
   */
  readonly cachePrefix?: string
  readonly cache?: PromptCacheDirective
}

export interface StructuredObjectRequest<T> extends StructuredRequestBase {
  readonly schema: z.ZodType<T>
  readonly mode?: 'object'
}

export interface StructuredArrayRequest<T> extends StructuredRequestBase {
  /** The schema of **one element**. `Output.array` is defined over elements, not over arrays. */
  readonly schema: z.ZodType<T>
  readonly mode: 'array'
  /**
   * Called with each element the moment it validates, before the call returns and before the
   * rest of the array exists.
   *
   * This is §6's "persisting each item" and it is the reason array mode is not just
   * `runStructured` with `z.array(...)`: a 90-lesson item bank cut off by `maxOutputTokens`,
   * a crash, or a user closing the window must keep the items it already paid for. A promise
   * returned here is awaited before `runStructured` resolves, so a failed write fails the
   * call — a caller that asked for durability and did not get it should hear about it.
   *
   * **It must be an upsert on `index`.** An attempt that streams five elements and then
   * fails is retried, and the retry re-emits indices 0–4; indices are absolute across
   * continuations, so writing by index converges and appending blindly does not.
   */
  readonly onElement?: (element: T, index: number) => void | Promise<void>
  /**
   * How many times a completion cut off by `maxOutputTokens` may be continued
   * (§6: *"if `finishReason === 'length'`, continue 'from item N' with the valid partial
   * JSON"*). Each continuation is a fresh call with its own `custom_id`, so a resumed run
   * replays the ones it already has for free.
   */
  readonly maxContinuations?: number
}

export interface StructuredResult<T> {
  readonly value: T
  /** The model that produced the accepted answer. */
  readonly model: string
  readonly usage: TextGenerationUsage
  /** How many repair turns it took across every target. 0 on a clean first answer. */
  readonly repairs: number
}

/** Four is the point at which a caller has asked one call to produce far too much. */
export const DEFAULT_MAX_CONTINUATIONS = 4

/**
 * What is appended to the system prompt so that a provider **without** a grammar still knows
 * the shape.
 *
 * Sent in every request rather than only to the providers that need it. The alternative —
 * resolving the role's targets here to see whether the primary supports strict mode — would
 * be wrong in the case that matters: a role whose primary is Anthropic and whose fallback is
 * a local model would build the instruction for Anthropic and then send the *same* request to
 * the model that actually needed it. It costs a few dozen tokens and it is never wrong.
 */
function outputInstruction(jsonSchema: unknown, mode: 'object' | 'array'): string {
  const what =
    mode === 'array' ? 'a JSON array whose every element matches' : 'a JSON value matching'
  return [
    '## Output',
    '',
    `Return ${what} this JSON Schema, and nothing else — no prose before or after it, no`,
    'explanation, and no code fence:',
    '',
    JSON.stringify(jsonSchema, null, 2),
  ].join('\n')
}

function withInstruction(system: string | undefined, instruction: string): string {
  return system === undefined || system.trim() === ''
    ? instruction
    : `${system.trimEnd()}\n\n${instruction}`
}

/**
 * A JSON or sanitizer failure, phrased for the model that has to fix it.
 *
 * Both arrive as `AiError`s whose message was written for exactly this audience ("the
 * completion is not valid JSON: …", "the completion nests more than 12 levels deep"), so
 * there is nothing to translate — but an unexpected throw must not become an unhandled
 * rejection on a path whose whole job is to survive bad output.
 */
function issuesFor(error: unknown): string[] {
  if (error instanceof AiError) return [error.message]
  return [error instanceof Error ? error.message : String(error)]
}

/**
 * Parse → sanitize → validate, the three steps that stand between a completion and a value.
 *
 * Exported for the one caller that receives completions outside this loop: the Batch API
 * path, whose answers arrive from `ai_results` long after the request was built and have
 * to be held to exactly the same three steps as a synchronous one.
 */
export function validateStructuredCompletion<T>(
  text: string,
  schema: z.ZodType<T>,
  limits: SanitizeLimits,
): { ok: true; value: T } | { ok: false; issues: string[] } {
  let raw: unknown
  try {
    raw = sanitizeOutput(parseJsonCompletion(text), limits)
  } catch (error) {
    return { ok: false, issues: issuesFor(error) }
  }
  const parsed = schema.safeParse(raw)
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, issues: describeIssues(parsed.error) }
}

export function runStructured<T>(
  deps: RunDeps,
  binding: AiBinding,
  request: StructuredObjectRequest<T>,
): Promise<StructuredResult<T>>
export function runStructured<T>(
  deps: RunDeps,
  binding: AiBinding,
  request: StructuredArrayRequest<T>,
): Promise<StructuredResult<T[]>>
export function runStructured<T>(
  deps: RunDeps,
  binding: AiBinding,
  request: StructuredObjectRequest<T> | StructuredArrayRequest<T>,
): Promise<StructuredResult<T> | StructuredResult<T[]>> {
  return request.mode === 'array'
    ? runStructuredArray(deps, binding, request)
    : runStructuredObject(deps, binding, request)
}

/**
 * The `TextGenerationRequest` a structured object call dispatches.
 *
 * Public because the Batch API path has to build the very same request without going
 * through `runStructured` — its requests are submitted as a list and answered later — and
 * a request built anywhere else would drift: a different instruction text is a different
 * cached prefix and, with the schema, a different answer. `runStructuredObject` below uses
 * this and nothing else, which is what keeps the two paths byte-identical.
 */
export function structuredRequestFor<T>(
  request: StructuredObjectRequest<T>,
): TextGenerationRequest {
  const jsonSchema = toStrictJsonSchema(request.schema)
  return {
    ...(request.system === undefined && jsonSchema === undefined
      ? {}
      : { system: withInstruction(request.system, outputInstruction(jsonSchema, 'object')) }),
    prompt: request.prompt,
    temperature: request.temperature,
    jsonSchema,
    structuredMode: 'object',
    ...(request.schemaName === undefined ? {} : { schemaName: request.schemaName }),
    ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
    ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
    ...(request.cachePrefix === undefined ? {} : { cachePrefix: request.cachePrefix }),
    ...(request.cache === undefined ? {} : { cache: request.cache }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  }
}

async function runStructuredObject<T>(
  deps: RunDeps,
  binding: AiBinding,
  request: StructuredObjectRequest<T>,
): Promise<StructuredResult<T>> {
  const limits = request.sanitizeLimits ?? DEFAULT_SANITIZE_LIMITS

  let accepted: { value: T } | undefined
  let repairs = 0

  const base = structuredRequestFor(request)

  const review = (attempt: AiAttempt): AiReview => {
    const outcome = validateStructuredCompletion(attempt.text, request.schema, limits)
    if (outcome.ok) {
      accepted = { value: outcome.value }
      return { kind: 'accept' }
    }
    repairs = Math.max(repairs, attempt.repair + 1)
    return {
      kind: 'repair',
      request: { ...base, prompt: buildRepairPrompt(attempt.text, outcome.issues) },
    }
  }

  const result = await runOnce(deps, binding, base, {
    review,
    repairBudget: request.repairBudget ?? DEFAULT_REPAIR_BUDGET,
  })

  if (accepted === undefined) {
    // Unreachable: `runOnce` only returns after `review` accepted, and `review` sets this
    // whenever it accepts. Stated as an error rather than a `!` so that a future change to
    // either side fails loudly instead of returning `undefined` as a validated value.
    throw new AiError('output_invalid', 'the accepted completion produced no value')
  }
  return { value: accepted.value, model: result.model, usage: result.usage ?? {}, repairs }
}

/**
 * The array path: stream, validate and hand over each element, then continue where a
 * `length` cut-off left off.
 *
 * Two behaviours are worth spelling out because they look like leniency and are not.
 *
 * **A bad element does not throw away the good ones.** Elements that validate are kept and
 * handed to `onElement`; the ones that do not become the repair turn's issue list. An
 * all-or-nothing parse would discard 89 correct flashcards because the 90th had a null where
 * a string belonged, and then charge for all 90 again.
 *
 * **A continuation that produces nothing stops the loop.** A model that answers "continue
 * from item 40" with an empty array is not going to answer it better on the next turn, and
 * `maxContinuations` alone would let it be asked four times.
 */
async function runStructuredArray<T>(
  deps: RunDeps,
  binding: AiBinding,
  request: StructuredArrayRequest<T>,
): Promise<StructuredResult<T[]>> {
  const elementSchema = toStrictJsonSchema(request.schema)
  const limits = request.sanitizeLimits ?? DEFAULT_SANITIZE_LIMITS
  const maxContinuations = request.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS

  const collected: T[] = []
  const writes: Array<Promise<void>> = []
  let repairs = 0
  let model = ''
  const usage: TextGenerationUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    usd: 0,
  }

  const instruction = outputInstruction(elementSchema, 'array')

  for (let continuation = 0; continuation <= maxContinuations; continuation += 1) {
    const startedAt = collected.length
    const outcome = await runArrayPass({
      deps,
      binding,
      request,
      limits,
      instruction,
      elementSchema,
      collected,
      writes,
      continuation,
    })

    model = outcome.model
    usage.inputTokens = (usage.inputTokens ?? 0) + (outcome.usage.inputTokens ?? 0)
    usage.outputTokens = (usage.outputTokens ?? 0) + (outcome.usage.outputTokens ?? 0)
    usage.cachedInputTokens =
      (usage.cachedInputTokens ?? 0) + (outcome.usage.cachedInputTokens ?? 0)
    usage.reasoningTokens = (usage.reasoningTokens ?? 0) + (outcome.usage.reasoningTokens ?? 0)
    usage.usd = (usage.usd ?? 0) + (outcome.usage.usd ?? 0)
    repairs += outcome.repairs

    if (outcome.finishReason !== 'length') break
    if (collected.length === startedAt) break
  }

  // Awaited here rather than per element so the calls overlap; awaited *before* returning so
  // that "these items are stored" is true by the time the caller is told the array is done.
  await Promise.all(writes)

  return { value: collected, model, usage, repairs }
}

interface ArrayPassInput<T> {
  deps: RunDeps
  binding: AiBinding
  request: StructuredArrayRequest<T>
  limits: SanitizeLimits
  instruction: string
  elementSchema: unknown
  collected: T[]
  writes: Array<Promise<void>>
  continuation: number
}

interface ArrayPassOutcome {
  model: string
  usage: TextGenerationUsage
  finishReason: string
  repairs: number
}

async function runArrayPass<T>(input: ArrayPassInput<T>): Promise<ArrayPassOutcome> {
  const { deps, binding, request, limits, collected, writes } = input

  const prompt =
    input.continuation === 0
      ? request.prompt
      : [
          request.prompt,
          '',
          '---',
          '',
          `You have already produced ${collected.length} items and your answer was cut off.`,
          `Continue from item ${collected.length + 1}. Return only the remaining items, as a`,
          'JSON array. Do not repeat any item you have already produced, and do not restate',
          'the ones above.',
        ].join('\n')

  const base: TextGenerationRequest = {
    system: withInstruction(request.system, input.instruction),
    prompt,
    temperature: request.temperature,
    jsonSchema: input.elementSchema,
    structuredMode: 'array',
    ...(request.schemaName === undefined ? {} : { schemaName: request.schemaName }),
    ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
    // Each continuation is its own unit of work with its own entry, so a resumed run replays
    // the parts it already has instead of re-generating the whole array to reach part three.
    ...(request.idempotencyKey === undefined
      ? {}
      : {
          idempotencyKey:
            input.continuation === 0
              ? request.idempotencyKey
              : `${request.idempotencyKey}#${input.continuation}`,
        }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  }

  /**
   * The attempt in flight, kept apart from `collected` until it is accepted.
   *
   * Elements are handed to the caller's `onElement` the moment they arrive — that is the
   * durability the whole array path exists for — but they only join the returned array once
   * the attempt is accepted. A stream that emits ten items and *then* 500s would otherwise
   * leave those ten in front of the retry's ten.
   *
   * Which is why `onElement` is documented as an upsert: a retried attempt re-emits the same
   * indices, and a caller that appends blindly would store them twice. Indices are absolute
   * (`collected.length + pending.length`), so an upsert keyed on them converges.
   */
  let pending: T[] = []
  let streamed = false
  let issues: string[] = []

  const take = (raw: unknown): boolean => {
    let sanitized: unknown
    try {
      sanitized = sanitizeOutput(raw, limits)
    } catch (error) {
      if (issues.length === 0) issues = issuesFor(error)
      return false
    }
    const parsed = request.schema.safeParse(sanitized)
    if (!parsed.success) {
      if (issues.length === 0) issues = describeIssues(parsed.error)
      return false
    }
    pending.push(parsed.data)
    const write = request.onElement?.(parsed.data, collected.length + pending.length - 1)
    if (write !== undefined) writes.push(write)
    return true
  }

  let repairs = 0
  let finishReason = 'stop'

  const review = (attempt: AiAttempt): AiReview => {
    finishReason = attempt.finishReason

    if (!streamed) {
      // No `elementStream` from this adapter: the whole completion is the array. Parsed
      // leniently, because a `length` cut-off leaves a truncated array whose *prefix* is
      // still the items we paid for — dropping it would make the continuation pointless.
      const value = tolerantArray(attempt.text)
      if (value === undefined) issues = ['the completion is not a JSON array']
      else for (const entry of value) take(entry)
    }

    // Accepted when there is something to show for the call, or when a continuation
    // legitimately had nothing left to add. A cut-off answer is not a broken one: the items
    // that arrived are kept and the outer loop asks for the rest.
    const accept =
      (issues.length === 0 && (pending.length > 0 || input.continuation > 0)) ||
      (attempt.finishReason === 'length' && pending.length > 0)

    if (accept) {
      collected.push(...pending)
      return { kind: 'accept' }
    }

    repairs = attempt.repair + 1
    const reported = issues.length > 0 ? issues : ['the completion contained no valid items']
    return {
      kind: 'repair',
      request: { ...base, prompt: buildRepairPrompt(attempt.text, reported) },
    }
  }

  const result = await runOnce(deps, binding, base, {
    review,
    repairBudget: request.repairBudget ?? DEFAULT_REPAIR_BUDGET,
    onDispatch: () => {
      pending = []
      issues = []
      streamed = false
    },
    onElement: (raw) => {
      streamed = true
      take(raw)
    },
  })

  return { model: result.model, usage: result.usage ?? {}, finishReason, repairs }
}

/**
 * The array in a completion, including one the model did not finish writing.
 *
 * `JSON.parse` refuses a truncated array outright, which is the wrong answer when the whole
 * point of `finishReason: 'length'` handling is to keep the prefix. So the elements are read
 * one balanced value at a time and the incomplete tail is dropped.
 */
export function tolerantArray(completion: string): unknown[] | undefined {
  const strict = (): unknown[] | undefined => {
    try {
      const value = parseJsonCompletion(completion)
      return Array.isArray(value) ? value : undefined
    } catch {
      return undefined
    }
  }

  const whole = strict()
  if (whole !== undefined) return whole

  const start = completion.indexOf('[')
  if (start < 0) return undefined

  const elements: unknown[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let elementStart = -1

  /** One balanced element, or nothing when the model was cut off mid-token. */
  const flush = (from: number, to: number): void => {
    if (from < 0) return
    const slice = completion.slice(from, to).trim()
    if (slice === '') return
    try {
      elements.push(JSON.parse(slice))
    } catch {
      // The tail the model did not finish. Everything before it stands.
    }
  }

  for (let index = start + 1; index < completion.length; index += 1) {
    const character = completion[index]

    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      if (depth === 0 && elementStart < 0) elementStart = index
      inString = true
      continue
    }
    if (character === '{' || character === '[') {
      if (depth === 0) elementStart = index
      depth += 1
      continue
    }
    if (character === '}' || character === ']') {
      if (depth === 0) {
        // The array closed after a scalar that had not been flushed by a comma.
        flush(elementStart, index)
        break
      }
      depth -= 1
      if (depth === 0 && elementStart >= 0) {
        flush(elementStart, index + 1)
        elementStart = -1
      }
      continue
    }
    if (depth === 0 && character === ',' && elementStart >= 0) {
      flush(elementStart, index)
      elementStart = -1
      continue
    }
    if (depth === 0 && elementStart < 0 && character !== undefined && !/\s/.test(character)) {
      elementStart = index
    }
  }

  return elements
}
