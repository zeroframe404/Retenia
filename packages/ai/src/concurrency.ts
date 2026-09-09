import PQueue from 'p-queue'
import type { InvokeOutcome, ProviderInvoker } from './invoker'

/**
 * `docs/spec/06-ai-providers.md` §6: "concurrency with `p-queue`".
 *
 * `runOnce` and `runStructured` both dispatch through exactly one `ProviderInvoker` call
 * each (`run.ts`'s single `await deps.invoker(...)`), so wrapping the invoker here — once,
 * at client construction — bounds every AI call this package makes, whichever of the two
 * paths a caller went through. Before this, nothing did: a role's parallel per-lesson
 * expansion, or simply several features asking for AI at once, could fan out to a
 * provider without limit.
 *
 * `packages/ingest`'s chunk contextualization already runs its own hand-rolled worker pool
 * at a concurrency of 4 for its own fan-out; this default matches it so the two layers do
 * not disagree about what "a reasonable number of calls in flight" means.
 */
export const DEFAULT_AI_CONCURRENCY = 4

export function withConcurrencyLimit(
  invoker: ProviderInvoker,
  concurrency: number = DEFAULT_AI_CONCURRENCY,
): ProviderInvoker {
  const queue = new PQueue({ concurrency })
  // No `timeout` is configured on the queue, so `add()` always runs the task to completion
  // and resolves with its real return value — the cast is only for the type p-queue widens
  // to in order to cover the (unused here) timed-out-and-dropped case.
  return (target, request, options) =>
    queue.add(() => invoker(target, request, options)) as Promise<InvokeOutcome>
}
