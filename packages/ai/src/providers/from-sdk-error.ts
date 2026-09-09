import { APICallError, LoadAPIKeyError, NoObjectGeneratedError } from 'ai'
import type { AiErrorCode, AiErrorContext } from '../errors'
import { AiError, redactKey } from '../errors'

/**
 * Turn whatever the SDK threw into one of ours.
 *
 * Two rules, both load-bearing:
 *
 * 1. **The SDK error is never attached as `cause` and never re-thrown.** `APICallError`
 *    carries `url`, `requestBodyValues` (the request body — the prompt) and
 *    `responseBody` (the completion). `ai_calls.meta` is documented "never the content
 *    itself", and anything reachable from a thrown error eventually reaches a log. Only a
 *    redacted message and a status code come out.
 * 2. **Matching uses the SDK's static `isInstance` guards, never bare `instanceof`.** Two
 *    copies of `@ai-sdk/provider` in a pnpm tree are two different classes, and
 *    `instanceof` would quietly fall through to the `network` catch-all — turning a 400
 *    into something we retry.
 */
export function fromSdkError(error: unknown, context: AiErrorContext, apiKey: string): AiError {
  if (isAbort(error)) {
    return new AiError('aborted', 'the caller cancelled the request', context)
  }

  // A deadline elapsing is not the same decision as the caller cancelling: nobody asked
  // for this to stop, so the next target in the role should still get a turn.
  // `docs/spec/06-ai-providers.md` §6 asks for "ordered fallback on 429/5xx/timeout" —
  // `network` is what `retry.ts`'s `classify` already treats as retryable-then-fallback,
  // matching a 5xx rather than the give-up path a real cancellation takes.
  if (isTimeout(error)) {
    return new AiError('network', 'the request timed out', context)
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    // The model answered and the answer does not fit the schema. `sdk-invoker.ts` normally
    // catches this earlier and hands the text to the repair loop; reaching here means there
    // was no text to hand over, and the code has to say "bad output" rather than "bad
    // network" so that `classify` moves to the next model instead of asking this one again.
    return new AiError('output_invalid', 'the model produced no value matching the schema', context)
  }

  if (LoadAPIKeyError.isInstance(error)) {
    return new AiError('auth', 'the provider rejected or could not load the API key', context)
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    return new AiError(codeForStatus(status), redactKey(error.message, apiKey), {
      ...context,
      ...(status === undefined ? {} : { statusCode: status }),
    })
  }

  const message = error instanceof Error ? error.message : String(error)
  return new AiError('network', redactKey(message, apiKey), context)
}

function codeForStatus(status: number | undefined): AiErrorCode {
  if (status === undefined) return 'network'
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  // 400, 404, 413 and friends: the request is wrong. Asking again changes nothing, and
  // asking a *different* provider at least might.
  if (status >= 400) return 'bad_request'
  return 'network'
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}
