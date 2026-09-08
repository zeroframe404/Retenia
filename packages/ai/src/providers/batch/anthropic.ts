import type {
  BatchCallOptions,
  BatchItemOutcome,
  BatchPoll,
  BatchProvider,
  BatchRequest,
  BatchSubmission,
} from '../../batch'
import type { AiErrorContext } from '../../errors'
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
  requestText,
  retryAfterMs,
} from './http'

/**
 * Anthropic Message Batches (`docs/spec/06-ai-providers.md` §2: -50 % on everything, up to
 * 100,000 requests, "most finish in under 1 h", maximum 24 h, compatible with caching and
 * structured outputs).
 *
 * Four endpoints, all under `/v1/messages/batches`: create, retrieve, results (a JSONL file,
 * one line per request), cancel. Each entry carries the `custom_id` this app minted, which is
 * the whole reason reconciliation is a lookup by id and never a positional match against the
 * order things were submitted in.
 *
 * The request body inside each entry is a `/v1/messages` body, which is why the translation
 * below exists: this package's `TextGenerationRequest` is the AI SDK's vocabulary, and the
 * Batch API takes Anthropic's. The **cache breakpoints survive that translation** — they are
 * `cache_control` on the last content block of each cached span — because that is exactly what
 * §2 means by "compatible with caching", and a batch of forty lessons over one book is the
 * case both features were bought for.
 *
 * What is deliberately not translated is a JSON Schema bound as a *tool*. `jsonSchema` travels
 * as `output_config.format`, matching the synchronous path's `Output.object`; anything the
 * schema cannot express is the caller's problem there too, and `runStructured` re-validates
 * every answer regardless of how it was constrained.
 */

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

/**
 * Anthropic requires `max_tokens` on every message request; the SDK supplies a default and the
 * REST endpoint does not. 8,192 is comfortably above a lesson or a graded answer and below the
 * 128K ceiling of the 5.x models, and a caller that knows better sets `maxOutputTokens`.
 */
const DEFAULT_MAX_TOKENS = 8_192

export interface AnthropicBatchOptions {
  readonly fetch?: FetchLike
  readonly baseUrl?: string
  /** From core's `Clock`; only used to turn an HTTP-date `Retry-After` into a delay. */
  readonly now?: () => Date
}

export function createAnthropicBatchProvider(options: AnthropicBatchOptions = {}): BatchProvider {
  const fetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const now = options.now ?? (() => new Date())

  const headers = (apiKey: string): Record<string, string> => ({
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
  })

  const context = (target: InvokeTarget) => ({
    profileId: target.profile.id,
    model: target.modelId,
  })

  return {
    submit: async (
      target: InvokeTarget,
      requests: readonly BatchRequest[],
      callOptions: BatchCallOptions,
    ): Promise<BatchSubmission> => {
      const body = {
        requests: requests.map(({ customId, request }) => ({
          custom_id: customId,
          params: toMessageParams(target.modelId, request),
        })),
      }

      const payload = asRecord(
        await requestJson(fetchLike, {
          url: `${baseUrl}/v1/messages/batches`,
          method: 'POST',
          headers: headers(target.apiKey),
          body,
          signal: callOptions.signal,
          apiKey: target.apiKey,
          context: context(target),
        }),
      )

      const id = asString(payload?.id)
      if (id === undefined) {
        throw new AiError(
          'server_error',
          'Anthropic accepted the batch but returned no id, so there is nothing to poll',
          context(target),
        )
      }
      return { providerBatchId: id }
    },

    poll: async (target, providerBatchId, callOptions): Promise<BatchPoll> => {
      let retryAfter: number | undefined
      let payload: Record<string, unknown> | undefined
      try {
        payload = asRecord(
          await requestJson(fetchLike, {
            url: `${baseUrl}/v1/messages/batches/${encodeURIComponent(providerBatchId)}`,
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
        // A rate-limited poll is not a failed batch: the job upstream is untouched and the
        // provider has told us when to come back. Reported as still running, with the wait it
        // asked for, rather than thrown — which would count against `MAX_POLL_FAILURES`.
        if (error instanceof AiError && error.code === 'rate_limited') {
          return {
            status: 'in_progress',
            results: [],
            ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
          }
        }
        throw error
      }

      const counts = asRecord(payload?.request_counts)
      const processing = asNumber(counts?.processing) ?? 0
      const status = asString(payload?.processing_status)

      // `ended` is Anthropic's terminal state; `in_progress` and `canceling` are not. A batch
      // that has ended still has to be *read*, which is the second call below — the status
      // alone says nothing about what each request produced.
      if (status !== 'ended') {
        return { status: 'in_progress', results: [], processing }
      }

      const resultsUrl = asString(payload?.results_url)
      if (resultsUrl === null || resultsUrl === undefined) {
        // Ended with nowhere to read the results: every request expired or was cancelled
        // before any of them ran. Treated as a failure of the batch rather than of each item,
        // because there is nothing per-item to report.
        return {
          status: 'failed',
          results: [],
          error: new AiError(
            'server_error',
            'the batch ended with no results file, so nothing it contained was produced',
            context(target),
          ),
        }
      }

      // `results_url` comes out of the provider's own response and is fetched **with the
      // API key attached**, so it is checked against the endpoint we configured before it is
      // used. Without this, anything that can answer as the batch endpoint — a spoofed
      // response, a TLS-terminating proxy, a `baseUrl` somebody makes configurable later —
      // names a host of its choosing and the key is handed to it in one hop.
      assertSameOrigin(resultsUrl, baseUrl, context(target))

      let jsonl: string
      try {
        jsonl = await requestText(fetchLike, {
          url: resultsUrl,
          method: 'GET',
          headers: headers(target.apiKey),
          signal: callOptions.signal,
          apiKey: target.apiKey,
          context: context(target),
          onResponse: (response) => {
            retryAfter = retryAfterMs(response, now())
          },
        })
      } catch (error) {
        // Same reasoning as the status call above, and easy to get wrong by scoping the
        // rate-limit handling to that one request: the batch has *ended*, its answers exist
        // upstream and have already been charged for. A 429 on the download that counted
        // against the runner's poll-failure ceiling would eventually mark a paid, finished
        // batch as failed and throw the answers away.
        if (error instanceof AiError && error.code === 'rate_limited') {
          return {
            status: 'in_progress',
            results: [],
            processing,
            ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
          }
        }
        throw error
      }

      const results = parseResults(jsonl, target.modelId)
      // Every request cancelled is a cancelled batch; anything else that ended is complete,
      // with per-item failures reported as items so only those ids are retried.
      const cancelled =
        results.length > 0 &&
        results.every(
          (item) => item.outcome.kind === 'error' && item.outcome.error.code === 'aborted',
        )
      return { status: cancelled ? 'cancelled' : 'completed', results }
    },

    cancel: async (target, providerBatchId, callOptions) => {
      await requestJson(fetchLike, {
        url: `${baseUrl}/v1/messages/batches/${encodeURIComponent(providerBatchId)}/cancel`,
        method: 'POST',
        headers: headers(target.apiKey),
        signal: callOptions.signal,
        apiKey: target.apiKey,
        context: context(target),
      })
    },
  }
}

/**
 * Refuse a URL that does not name the endpoint this adapter was configured for.
 *
 * Host **and** scheme: `http://api.anthropic.com` would put the key on the wire in clear.
 * Compared on `origin` rather than a prefix match, so `https://api.anthropic.com.evil.test`
 * is not a match — which a `startsWith` would happily accept.
 */
function assertSameOrigin(candidate: string, baseUrl: string, context: AiErrorContext): void {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new AiError('server_error', 'the batch results URL is not a URL', context)
  }
  if (url.protocol !== 'https:' || url.origin !== new URL(baseUrl).origin) {
    throw new AiError(
      'server_error',
      `refusing to send the API key to ${url.origin}: the batch results URL must be on the ` +
        'same origin as the configured endpoint',
      context,
    )
  }
}

/** `TextGenerationRequest` in the `/v1/messages` vocabulary, cache breakpoints included. */
export function toMessageParams(
  modelId: string,
  request: TextGenerationRequest,
): Record<string, unknown> {
  const cacheControl =
    request.cache === undefined ? undefined : { type: 'ephemeral' as const, ttl: request.cache.ttl }

  const content: Array<Record<string, unknown>> = []
  const prefix = request.cachePrefix ?? ''
  if (prefix !== '') {
    content.push({
      type: 'text',
      text: prefix,
      ...(cacheControl !== undefined && request.cache?.prefix === true
        ? { cache_control: cacheControl }
        : {}),
    })
  }
  content.push({ type: 'text', text: request.prompt })

  const system =
    request.system === undefined
      ? undefined
      : [
          {
            type: 'text',
            text: request.system,
            ...(cacheControl !== undefined && request.cache?.system === true
              ? { cache_control: cacheControl }
              : {}),
          },
        ]

  return {
    model: modelId,
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    temperature: request.temperature,
    ...(system === undefined ? {} : { system }),
    messages: [{ role: 'user', content }],
    ...(request.jsonSchema === undefined
      ? {}
      : {
          output_config: {
            format: {
              type: 'json_schema',
              schema: request.jsonSchema,
              ...(request.schemaName === undefined ? {} : { name: request.schemaName }),
            },
          },
        }),
  }
}

/**
 * The results file: one JSON object per line, `{ custom_id, result }`.
 *
 * A line that does not parse is **skipped rather than fatal**. One malformed entry in a file
 * of forty must not discard the thirty-nine that are fine — those were paid for, and the
 * caller's own re-run would ask for all forty again. The id simply never arrives, which the
 * runner already treats as "not reconciled".
 */
export function parseResults(jsonl: string, modelId: string): BatchItemOutcome[] {
  const items: BatchItemOutcome[] = []
  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const entry = asRecord(parsed)
    const customId = asString(entry?.custom_id)
    if (customId === undefined) continue
    items.push({ customId, outcome: toOutcome(asRecord(entry?.result), modelId) })
  }
  return items
}

function toOutcome(
  result: Record<string, unknown> | undefined,
  modelId: string,
): BatchItemOutcome['outcome'] {
  const type = asString(result?.type)

  if (type === 'succeeded') {
    const message = asRecord(result?.message)
    return {
      kind: 'ok',
      text: textOf(message?.content),
      modelId: asString(message?.model) ?? modelId,
      usage: usageOf(asRecord(message?.usage)),
      finishReason: finishReasonOf(asString(message?.stop_reason)),
      ...(asString(message?.id) === undefined
        ? {}
        : { requestId: asString(message?.id) as string }),
    }
  }

  if (type === 'canceled' || type === 'expired') {
    return {
      kind: 'error',
      error: new AiError(
        'aborted',
        type === 'expired'
          ? 'the request expired before the batch finished (Anthropic gives a batch 24 h)'
          : 'the batch was cancelled before this request ran',
      ),
    }
  }

  const error = asRecord(result?.error)
  const inner = asRecord(error?.error)
  const status = asNumber(error?.status)
  const message = asString(inner?.message) ?? asString(error?.type) ?? 'the request failed'
  return {
    kind: 'error',
    error: new AiError(
      status === undefined ? 'server_error' : codeForStatus(status),
      message,
      status === undefined ? {} : { statusCode: status },
    ),
  }
}

/** Every text block, concatenated — the same string `generateText` would return as `text`. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const record = asRecord(block)
      return record?.type === 'text' ? (asString(record.text) ?? '') : ''
    })
    .join('')
}

/**
 * Anthropic's usage, in the shape the pricing table charges for.
 *
 * `input_tokens` from this API is already the **uncached** count — cache reads and writes are
 * reported separately — which is the same disjoint split `providers/usage.ts` relies on. Read
 * it as a total and cached tokens would be billed twice.
 */
function usageOf(usage: Record<string, unknown> | undefined): BillableUsage {
  const nonNegative = (value: number | undefined): number =>
    value === undefined || value < 0 ? 0 : value
  return {
    inputTokens: nonNegative(asNumber(usage?.input_tokens)),
    cachedInputTokens: nonNegative(asNumber(usage?.cache_read_input_tokens)),
    cacheWriteTokens: nonNegative(asNumber(usage?.cache_creation_input_tokens)),
    outputTokens: nonNegative(asNumber(usage?.output_tokens)),
    reasoningTokens: 0,
  }
}

function finishReasonOf(stopReason: string | undefined): FinishReason {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool-calls'
    case 'refusal':
      return 'content-filter'
    default:
      return 'other'
  }
}
