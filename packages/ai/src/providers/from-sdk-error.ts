import { APICallError, LoadAPIKeyError } from 'ai'
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
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
