/**
 * The one error type this layer throws, and the redaction that keeps a key out of it.
 *
 * A single class with a `code` discriminant rather than a class per failure: `instanceof`
 * does not survive a bundle boundary (two copies of a package in a pnpm tree are two
 * different classes), and `ai_calls.meta.code` has to be a string anyway. Only `classify`
 * and the tests ever discriminate.
 */

/**
 * Why a call failed, in the vocabulary `classify` and `ai_calls.meta.code` share.
 */
export const AI_ERROR_CODES = [
  /** No profile is configured for this role, or no key is stored for the one it names. */
  'not_configured',
  /** 401/403, or the SDK refusing to build a client without a key. */
  'auth',
  /** 429. */
  'rate_limited',
  /** 5xx, including Anthropic's 529 "overloaded". */
  'server_error',
  /** Transport failure with no HTTP status. */
  'network',
  /**
   * `local.ts`'s offline gate refused to dial a cloud target because the device has no
   * connectivity — never thrown for a `local: true` target, which needs no network at all.
   * Not retryable (going offline for 500ms and back is not what this reports), and
   * `classify`'s default case already sends it to the next target, which — if the role has
   * a `local` primary and this is the cloud fallback — simply fails the same way twice.
   */
  'offline',
  /** 400/404/413 — the request is wrong, not the connection. */
  'bad_request',
  /** The month's spend has reached `ai.budget.monthlyUsd`. */
  'budget_exceeded',
  /** A routing or pricing-table bug. Never answered with a cost of zero. */
  'model_not_priced',
  'aborted',
  /**
   * The brief's `AiOutputInvalid`: the completion was not JSON, or was JSON the schema
   * rejects, and the repair loop of `runStructured` could not fix it within its budget.
   *
   * It is a *provider* failure rather than a caller one — the request was well formed and
   * the model answered badly — so `classify` sends it to the next model, which is a
   * different model and may well parse where this one did not.
   */
  'output_invalid',
  /** Every target in the role failed; carries the last one as `cause`. */
  'all_targets_failed',
] as const

export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

export interface AiErrorContext {
  profileId?: string
  model?: string
  statusCode?: number
}

/**
 * Could the *same* target plausibly succeed on a second attempt?
 *
 * A 429 is excluded on purpose: see `classify` in `retry.ts` for why the answer to a rate
 * limit is a different provider rather than a longer wait.
 */
const RETRYABLE: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>(['server_error', 'network'])

export class AiError extends Error {
  override readonly name = 'AiError'
  readonly code: AiErrorCode
  readonly retryable: boolean
  readonly profileId: string | undefined
  readonly model: string | undefined
  readonly statusCode: number | undefined

  constructor(
    code: AiErrorCode,
    message: string,
    context: AiErrorContext = {},
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.code = code
    this.retryable = RETRYABLE.has(code)
    this.profileId = context.profileId
    this.model = context.model
    this.statusCode = context.statusCode
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError
}

/**
 * Whatever was thrown, as an `AiError` with a code somebody chose.
 *
 * For the boundaries that catch rather than classify — a batch adapter's `fetch`, the
 * detached loop in the sequential fallback — where the alternative is either losing the
 * message or letting an `unknown` reach a field typed as an error. `fallback` is required
 * because there is no code that is right for every caller, and a default here would be a
 * silent decision made in the wrong place.
 *
 * An `AiError` passes through unchanged: it already has the code its thrower meant.
 */
export function asAiError(
  error: unknown,
  fallback: AiErrorCode,
  context: AiErrorContext = {},
): AiError {
  if (isAiError(error)) return error
  const message = error instanceof Error ? error.message : String(error)
  return new AiError(fallback, message, context, { cause: error })
}

/** What `ai_calls.error` is capped at. Long enough for a provider's own message. */
export const MAX_ERROR_CHARS = 500

/**
 * Remove the key from a message before it is stored or logged.
 *
 * Exact replacement of the plaintext we hold, not a shape heuristic: a regex for
 * "something that looks like a key" both misses formats we have never seen and mangles
 * unrelated text, and this process holds the one string that actually matters. The cap is
 * applied after, so a provider that echoes a huge request body cannot fill the column.
 */
export function redactKey(text: string, apiKey: string | undefined): string {
  const redacted =
    apiKey === undefined || apiKey.length === 0 ? text : text.split(apiKey).join('«redacted»')
  return redacted.length <= MAX_ERROR_CHARS
    ? redacted
    : `${redacted.slice(0, MAX_ERROR_CHARS - 1)}…`
}
