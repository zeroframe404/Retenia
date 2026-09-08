/**
 * Sync or batch, and how much of a run goes each way.
 *
 * `docs/spec/06-ai-providers.md` §2 buys the discount with latency: "most finish in under
 * 1 h, maximum 24 h". `docs/spec/04-path-generation.md` §14 lists that as pitfall 18 —
 * *"batch latency (up to 24 h: generate the first lessons synchronously)"* — and §3 stage 7
 * writes the resolution into the pipeline: the first two lessons are synchronous so the user
 * starts reading in under a minute, and the remaining thirty-eight are batched at half price
 * while they do.
 *
 * Both rules live here, as functions over plain data, so that Phase 8 states them once
 * instead of re-deriving them in the expansion job, the regeneration path and the item bank.
 */

/**
 * Below five requests the discount is not worth the wait.
 *
 * The arithmetic behind the number: a batch saves 50 % of what it contains, so four Sonnet 5
 * lessons save about USD 0.06 — and cost an hour of the user watching an empty path. Five is
 * where the saving starts to be worth a coffee, and it is the figure the sub-phase names.
 */
export const BATCH_MIN_REQUESTS = 5

/** §3 stage 7: two, so the reader has something to open while the rest is queued. */
export const SYNCHRONOUS_HEAD = 2

export interface DispatchPolicyInput {
  /** The caller has said this work tolerates a delay of up to a day. */
  readonly batchable: boolean
  /** How many requests this unit of work would submit. */
  readonly count: number
  /**
   * Somebody is looking at a spinner right now.
   *
   * The one input that overrides everything else, and the reason it is a separate flag from
   * `batchable`: the same call — expand this lesson — is batchable when a generation run
   * produces it and emphatically not when the user pressed "Regenerate" and is waiting.
   */
  readonly userWaiting: boolean
  /**
   * The resolved target actually has a Batch API.
   *
   * A profile without one is not an error and does not disqualify the work: it takes the
   * sequential fallback, which behaves identically and simply does not save anything. This
   * flag exists so the *policy* can prefer a synchronous call when the batch would be a
   * sequential run in disguise with none of the discount and all of the bookkeeping.
   */
  readonly batchSupported: boolean
}

export type Dispatch = 'sync' | 'batch'

/** `batchable && n >= 5 && !userWaiting`, with the fallback caveat spelled out. */
export function chooseDispatch(input: DispatchPolicyInput): Dispatch {
  if (!input.batchable) return 'sync'
  if (input.userWaiting) return 'sync'
  if (input.count < BATCH_MIN_REQUESTS) return 'sync'
  return input.batchSupported ? 'batch' : 'sync'
}

export interface Split<T> {
  /** Dispatched synchronously, in order, before anything is submitted. */
  readonly head: readonly T[]
  /** Submitted as one batch — or run sequentially, if the policy declined. */
  readonly rest: readonly T[]
}

/**
 * §3 stage 7's "first two lessons in real time, the rest in batch".
 *
 * A pure split rather than a method on the runner, because Phase 8 needs the *shape* of the
 * decision in its progress UI ("2 listas, 38 en cola") before any of it has been dispatched.
 */
export function splitSynchronousHead<T>(
  items: readonly T[],
  head: number = SYNCHRONOUS_HEAD,
): Split<T> {
  const size = Math.max(0, Math.min(head, items.length))
  return { head: items.slice(0, size), rest: items.slice(size) }
}
