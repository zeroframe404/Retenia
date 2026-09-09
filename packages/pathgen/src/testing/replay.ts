import type {
  BatchItemOutcome,
  BatchProvider,
  BatchRequest,
  InvokeTarget,
  ProviderInvoker,
  TextGenerationRequest,
} from '@retenia/ai'
import { AiError, approximateTokens } from '@retenia/ai'

/**
 * Record/replay for the AI calls of a generation run.
 *
 * A golden answer is looked up by the request itself — in practice by its `idempotencyKey`,
 * which is the `custom_id` every call in this package carries — and a request with no golden
 * answer **throws**, exactly as `createScriptedInvoker` does: a test that expected no call and
 * got one should fail saying which call, not pass because a fake was lenient. The counters
 * are what make "a second run makes zero new AI calls" an assertion rather than a hope.
 */

export type ReplayResolver = (
  request: TextGenerationRequest,
  target: InvokeTarget,
) => string | undefined

export interface ReplayInvoker {
  readonly invoker: ProviderInvoker
  /** Every request dispatched, in order. */
  readonly calls: TextGenerationRequest[]
  /** The custom ids answered, in order. */
  readonly answered: string[]
}

function usageFor(request: TextGenerationRequest, text: string) {
  return {
    inputTokens: approximateTokens(
      `${request.system ?? ''}${request.cachePrefix ?? ''}${request.prompt}`,
    ),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: approximateTokens(text),
    reasoningTokens: 0,
  }
}

export function createReplayInvoker(resolve: ReplayResolver): ReplayInvoker {
  const calls: TextGenerationRequest[] = []
  const answered: string[] = []
  const invoker: ProviderInvoker = async (target, request) => {
    calls.push(request)
    const text = resolve(request, target)
    if (text === undefined) {
      throw new Error(
        `createReplayInvoker: no golden answer for ${request.idempotencyKey ?? '(no custom id)'}`,
      )
    }
    answered.push(request.idempotencyKey ?? '')
    return {
      kind: 'ok',
      text,
      modelId: target.modelId,
      finishReason: 'stop',
      usage: usageFor(request, text),
    }
  }
  return { invoker, calls, answered }
}

export interface ReplayBatchProvider {
  readonly provider: BatchProvider
  readonly submitted: BatchRequest[][]
  readonly cancelled: string[]
  polls(): number
}

/**
 * A batch provider that answers every request of a batch from the same resolver.
 *
 * `in_progress` for `pollsBeforeDone` polls and then `completed`, which is the shape a real
 * batch has and what `waitForBatch`'s loop exists for. A request with no golden answer comes
 * back as a failed item rather than a throw, because that is what a provider does with a
 * request it could not serve — and it is the path the synchronous fallback is tested on.
 */
export function createReplayBatchProvider(
  resolve: ReplayResolver,
  options: { readonly pollsBeforeDone?: number } = {},
): ReplayBatchProvider {
  const pollsBeforeDone = options.pollsBeforeDone ?? 1
  const jobs = new Map<
    string,
    { target: InvokeTarget; requests: readonly BatchRequest[]; polled: number }
  >()
  const submitted: BatchRequest[][] = []
  const cancelled: string[] = []
  let counter = 0
  let polls = 0

  const provider: BatchProvider = {
    submit: async (target, requests) => {
      counter += 1
      const providerBatchId = `replay-${counter}`
      jobs.set(providerBatchId, { target, requests, polled: 0 })
      submitted.push([...requests])
      return { providerBatchId }
    },
    poll: async (_target, providerBatchId) => {
      polls += 1
      const job = jobs.get(providerBatchId)
      if (job === undefined) {
        throw new AiError('bad_request', `no batch ${providerBatchId}`)
      }
      job.polled += 1
      if (job.polled <= pollsBeforeDone) {
        return { status: 'in_progress', results: [], processing: job.requests.length }
      }
      const results: BatchItemOutcome[] = job.requests.map(({ customId, request }) => {
        const text = resolve(request, job.target)
        return text === undefined
          ? {
              customId,
              outcome: {
                kind: 'error',
                error: new AiError('server_error', `no golden answer for ${customId}`),
              },
            }
          : {
              customId,
              outcome: {
                kind: 'ok',
                text,
                modelId: job.target.modelId,
                finishReason: 'stop',
                usage: usageFor(request, text),
              },
            }
      })
      return { status: 'completed', results }
    },
    cancel: async (_target, providerBatchId) => {
      cancelled.push(providerBatchId)
    },
  }

  return { provider, submitted, cancelled, polls: () => polls }
}
