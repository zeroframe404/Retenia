import type {
  BatchItemOutcome,
  BatchPoll,
  BatchProvider,
  BatchRequest,
  BatchSubmission,
} from '../../batch'
import { AiError } from '../../errors'
import type { FinishReason, InvokeTarget } from '../../invoker'
import type { BillableUsage } from '../../pricing'
import type { TextGenerationRequest } from '../../text-generator'
import {
  asNumber,
  asRecord,
  asString,
  codeForStatus,
  type FetchLike,
  requestJson,
  retryAfterMs,
} from './http'

/**
 * Gemini Batch (`docs/spec/06-ai-providers.md` §1: -50 % on every Gemini row).
 *
 * Shaped differently from Anthropic's in two ways that matter here:
 *
 * - The batch is a **long-running operation**, not a resource with a status field. Submission
 *   returns `{ name: "batches/…" }`, and polling that name returns `{ done, response }` with
 *   the answers inlined once it is finished — so there is no results file to fetch and the
 *   poll is one call rather than two.
 * - There is no `custom_id` field. Each request carries a free-form `metadata` bag instead,
 *   and the responses come back with the same bag attached; this app puts its `custom_id`
 *   there under `key`. The runner never matches by position, here or anywhere: a provider
 *   that reorders or drops an entry would otherwise silently attribute one lesson's answer to
 *   another lesson's cache key, which is the worst failure this whole layer can have.
 *
 * Caching is **implicit** on Gemini (§2), so there is nothing to mark: `cachePrefix` is sent
 * as the first part of the user content and the provider matches the repeated prefix by
 * itself. `withCache` already knows this and returns `decision: 'implicit'` with no
 * breakpoints for a Google target, so the two halves agree without either consulting the other.
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
const API_VERSION = 'v1beta'

/** `batches/<id>`, which is what the operations API hands back and all this adapter addresses. */
const OPERATION_NAME = /^batches\/[A-Za-z0-9_-]+$/

export interface GoogleBatchOptions {
  readonly fetch?: FetchLike
  readonly baseUrl?: string
  readonly now?: () => Date
}

export function createGoogleBatchProvider(options: GoogleBatchOptions = {}): BatchProvider {
  const fetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const now = options.now ?? (() => new Date())

  const headers = (apiKey: string): Record<string, string> => ({ 'x-goog-api-key': apiKey })
  const context = (target: InvokeTarget) => ({
    profileId: target.profile.id,
    model: target.modelId,
  })

  return {
    submit: async (
      target: InvokeTarget,
      requests: readonly BatchRequest[],
      callOptions,
    ): Promise<BatchSubmission> => {
      const body = {
        batch: {
          displayName: `retenia-${target.modelId}-${requests.length}`,
          inputConfig: {
            requests: {
              requests: requests.map(({ customId, request }) => ({
                request: toGenerateContentRequest(request),
                metadata: { key: customId },
              })),
            },
          },
        },
      }

      const payload = asRecord(
        await requestJson(fetchLike, {
          url: `${baseUrl}/${API_VERSION}/models/${encodeURIComponent(target.modelId)}:batchGenerateContent`,
          method: 'POST',
          headers: headers(target.apiKey),
          body,
          signal: callOptions.signal,
          apiKey: target.apiKey,
          context: context(target),
        }),
      )

      const name = asString(payload?.name)
      if (name === undefined) {
        throw new AiError(
          'server_error',
          'Gemini accepted the batch but returned no operation name, so there is nothing to poll',
          context(target),
        )
      }
      // The name is interpolated into a URL on every later poll and cancel, and it is stored
      // in SQLite in between. Checked against its documented shape here, once, rather than
      // trusted at three call sites: a `name` carrying `../` or a query string would reach a
      // different endpoint on the provider with the key attached.
      if (!OPERATION_NAME.test(name)) {
        throw new AiError(
          'server_error',
          `Gemini returned an operation name this adapter will not address ("${name}")`,
          context(target),
        )
      }
      return { providerBatchId: name }
    },

    poll: async (target, providerBatchId, callOptions): Promise<BatchPoll> => {
      let retryAfter: number | undefined
      let payload: Record<string, unknown> | undefined
      try {
        payload = asRecord(
          await requestJson(fetchLike, {
            url: `${baseUrl}/${API_VERSION}/${providerBatchId}`,
            method: 'GET',
            headers: headers(target.apiKey),
            signal: callOptions.signal,
            apiKey: target.apiKey,
            context: context(target),
            onResponse: (response) => {
              retryAfter = retryAfterMs(response, now())
            },
          }),
        )
      } catch (error) {
        // Same reasoning as the Anthropic adapter: a throttled poll leaves the job upstream
        // untouched, so it is reported as "still running, come back later" and never counts
        // against the runner's poll-failure ceiling.
        if (error instanceof AiError && error.code === 'rate_limited') {
          return {
            status: 'in_progress',
            results: [],
            ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
          }
        }
        throw error
      }

      if (payload?.done !== true) return { status: 'in_progress', results: [] }

      // An operation that finished *badly* carries `error` instead of `response`: the whole
      // job failed, and there is nothing per item to attribute.
      const operationError = asRecord(payload.error)
      if (operationError !== undefined) {
        const status = asNumber(operationError.code)
        return {
          status: 'failed',
          results: [],
          error: new AiError(
            status === undefined ? 'server_error' : codeForStatus(status),
            asString(operationError.message) ?? 'the batch operation failed',
            status === undefined ? {} : { statusCode: status },
          ),
        }
      }

      return { status: 'completed', results: parseInlined(payload.response, target.modelId) }
    },

    cancel: async (target, providerBatchId, callOptions) => {
      await requestJson(fetchLike, {
        url: `${baseUrl}/${API_VERSION}/${providerBatchId}:cancel`,
        method: 'POST',
        headers: headers(target.apiKey),
        body: {},
        signal: callOptions.signal,
        apiKey: target.apiKey,
        context: context(target),
      })
    },
  }
}

/** `TextGenerationRequest` as a `generateContent` body. */
export function toGenerateContentRequest(request: TextGenerationRequest): Record<string, unknown> {
  const parts: Array<Record<string, unknown>> = []
  const prefix = request.cachePrefix ?? ''
  // Prefix first, always: implicit caching matches on a repeated *leading* span, so putting
  // the volatile task ahead of the stable sources would defeat the only caching this
  // provider offers, silently and at full price.
  if (prefix !== '') parts.push({ text: prefix })
  parts.push({ text: request.prompt })

  return {
    contents: [{ role: 'user', parts }],
    ...(request.system === undefined
      ? {}
      : { systemInstruction: { parts: [{ text: request.system }] } }),
    generationConfig: {
      temperature: request.temperature,
      ...(request.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: request.maxOutputTokens }),
      ...(request.jsonSchema === undefined
        ? {}
        : {
            responseMimeType: 'application/json',
            responseJsonSchema: request.jsonSchema,
          }),
    },
  }
}

/**
 * The inlined responses of a finished operation, matched back to their `custom_id`s.
 *
 * An entry with no `metadata.key` is dropped rather than guessed at: without the id there is
 * no unit of work to attribute it to, and attributing it by position is exactly the mistake
 * the metadata exists to prevent.
 */
export function parseInlined(response: unknown, modelId: string): BatchItemOutcome[] {
  const inlined = asRecord(asRecord(response)?.inlinedResponses)?.inlinedResponses
  if (!Array.isArray(inlined)) return []

  const items: BatchItemOutcome[] = []
  for (const raw of inlined) {
    const entry = asRecord(raw)
    const customId = asString(asRecord(entry?.metadata)?.key)
    if (customId === undefined) continue

    const failure = asRecord(entry?.error)
    if (failure !== undefined) {
      const status = asNumber(failure.code)
      items.push({
        customId,
        outcome: {
          kind: 'error',
          error: new AiError(
            status === undefined ? 'server_error' : codeForStatus(status),
            asString(failure.message) ?? 'the request failed',
            status === undefined ? {} : { statusCode: status },
          ),
        },
      })
      continue
    }

    const answer = asRecord(entry?.response)
    const candidate = asRecord(Array.isArray(answer?.candidates) ? answer.candidates[0] : undefined)
    items.push({
      customId,
      outcome: {
        kind: 'ok',
        text: textOf(asRecord(candidate?.content)?.parts),
        modelId: asString(answer?.modelVersion) ?? modelId,
        usage: usageOf(asRecord(answer?.usageMetadata)),
        finishReason: finishReasonOf(asString(candidate?.finishReason)),
      },
    })
  }
  return items
}

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) return ''
  return parts.map((part) => asString(asRecord(part)?.text) ?? '').join('')
}

/**
 * Gemini's usage, in the shape the pricing table charges for.
 *
 * `promptTokenCount` is the **total** prompt, cached tokens included — the opposite of
 * Anthropic's convention — so the cached count is subtracted out. Left as reported, every
 * implicitly cached token would be billed once at the input rate and again at the cache rate.
 */
function usageOf(usage: Record<string, unknown> | undefined): BillableUsage {
  const nonNegative = (value: number | undefined): number =>
    value === undefined || value < 0 ? 0 : value
  const cachedInputTokens = nonNegative(asNumber(usage?.cachedContentTokenCount))
  const prompt = nonNegative(asNumber(usage?.promptTokenCount))
  const outputTokens = nonNegative(asNumber(usage?.candidatesTokenCount))
  return {
    inputTokens: Math.max(0, prompt - cachedInputTokens),
    cachedInputTokens,
    // Implicit caching is not billed as a write at all (§2): there is nothing to create.
    cacheWriteTokens: 0,
    outputTokens,
    reasoningTokens: Math.min(outputTokens, nonNegative(asNumber(usage?.thoughtsTokenCount))),
  }
}

function finishReasonOf(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'STOP':
      return 'stop'
    case 'MAX_TOKENS':
      return 'length'
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
      return 'content-filter'
    default:
      return 'other'
  }
}
