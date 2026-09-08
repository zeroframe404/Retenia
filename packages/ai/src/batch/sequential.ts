import { AiError, asAiError } from '../errors'
import type { ProviderInvoker } from '../invoker'
import type { BatchItemOutcome, BatchPoll, BatchProvider, BatchSubmission } from './provider'

/**
 * The Batch API a provider that has no Batch API gets.
 *
 * `docs/spec/06-ai-providers.md` §1 marks OpenRouter with a bare ✘ in the Batch column, and
 * 7.4's local models obviously have none. The sub-phase asks for those to fall back
 * "transparently", and transparent has to mean *at this seam* rather than at the call site:
 * if the runner had to branch, then cost reconciliation, the tray row, cancellation and the
 * `ai_results` write would each have two implementations, and the second one would be the one
 * nobody exercised.
 *
 * So a fallback batch is a real batch in every respect except the discount. It gets a row, an
 * id, a tray entry, a cancel button and one `ai_calls` line per request; `computeCostUsd`
 * refuses to apply a discount the model does not have, so it is billed at full price and the
 * estimate said so beforehand.
 *
 * Two properties worth stating, because both are the opposite of the obvious implementation:
 *
 * - **`submit` returns immediately.** The run happens in the background and `poll` reports
 *   `in_progress` until it is done, exactly as a real batch does. A `submit` that awaited the
 *   whole run would block the caller for the length of the work — which is the one thing
 *   batching exists to avoid, and would make the tray row appear only after it was pointless.
 * - **Requests run one at a time.** There is no queue upstream to absorb them; forty
 *   concurrent calls to a local model or through an aggregator is how a fallback becomes a
 *   rate limit. The loop checks for cancellation between items, so stopping is prompt.
 */
export function createSequentialBatchProvider(invoker: ProviderInvoker): BatchProvider {
  interface Run {
    readonly results: BatchItemOutcome[]
    done: boolean
    cancelled: boolean
    failure: AiError | undefined
  }

  const runs = new Map<string, Run>()
  let counter = 0

  return {
    submit: async (target, requests, options) => {
      counter += 1
      const providerBatchId = `sequential-${counter}`
      const run: Run = { results: [], done: false, cancelled: false, failure: undefined }
      runs.set(providerBatchId, run)

      // Deliberately not awaited: see the note above. Nothing inside can reject — the loop
      // catches, because an unhandled rejection from a detached promise would take the
      // process down rather than fail one batch.
      void (async () => {
        try {
          for (const { customId, request } of requests) {
            if (run.cancelled || options.signal?.aborted === true) break
            const outcome = await invoker(target, request, { signal: options.signal })
            run.results.push({ customId, outcome })
          }
        } catch (error) {
          run.failure = asAiError(error, 'network')
        } finally {
          run.done = true
        }
      })()

      return { providerBatchId } satisfies BatchSubmission
    },

    poll: async (_target, providerBatchId): Promise<BatchPoll> => {
      const run = runs.get(providerBatchId)
      if (run === undefined) {
        // The id was never minted in this process — which after a restart is every id this
        // provider ever handed out. Saying so is the honest answer: a fallback batch has no
        // durable job upstream to resume, and the caller's own re-run is answered from
        // `ai_results` for everything that did finish.
        return {
          status: 'failed',
          results: [],
          error: new AiError(
            'not_configured',
            `the sequential batch "${providerBatchId}" is not in flight in this process; ` +
              'a fallback batch has no job on a provider and does not survive a restart',
          ),
        }
      }

      if (!run.done) {
        return {
          status: 'in_progress',
          // Reported as they arrive, so a long fallback run fills `ai_results` progressively
          // rather than in one lump at the end. The runner's per-item guard makes repeating
          // an already-reconciled id harmless.
          results: [...run.results],
          processing: 0,
        }
      }

      runs.delete(providerBatchId)
      const results = [...run.results]
      if (run.cancelled) return { status: 'cancelled', results }
      return run.failure === undefined
        ? { status: 'completed', results }
        : { status: 'failed', results, error: run.failure }
    },

    cancel: async (_target, providerBatchId) => {
      // Best effort by definition: the loop may already have run every request. Setting the
      // flag stops whatever is left and turns the next poll into a `cancelled`.
      const run = runs.get(providerBatchId)
      if (run !== undefined) run.cancelled = true
    },
  }
}
