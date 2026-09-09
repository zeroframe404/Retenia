import type { AiBatchRecord, BatchRunner, Timers } from '@retenia/ai'
import { isTerminalBatchStatus } from '@retenia/ai'
import type { AbortSignalLike, Clock } from '@retenia/core'

/**
 * Wait for one batch to reach a terminal status, a poll at a time.
 *
 * The runner schedules its own polls on the `Timers` port, but a generation run is a caller
 * that has to *await* the result, so it drives `poll` itself: sleep until the runner's own
 * `nextPollAt` (never less than five seconds, so a provider that answers `Retry-After: 1`
 * cannot turn this into a busy loop), then poll. Two overlapping polls of one batch are
 * folded into one by the runner, so polling from here and from its timer is safe.
 */

export const MIN_BATCH_POLL_MS = 5_000
export const BATCH_POLL_SLACK_MS = 1_000

export interface AwaitBatchDeps {
  readonly runner: Pick<BatchRunner, 'poll' | 'list'>
  readonly clock: Clock
  readonly timers: Pick<Timers, 'sleep'>
  readonly signal?: AbortSignalLike
  /** Every non-terminal record seen, for progress. */
  readonly onPoll?: (batch: AiBatchRecord) => void
}

export function batchPollDelayMs(batch: Pick<AiBatchRecord, 'nextPollAt'>, now: Date): number {
  const due = batch.nextPollAt === null ? 0 : batch.nextPollAt.getTime() - now.getTime()
  return Math.max(MIN_BATCH_POLL_MS, due + BATCH_POLL_SLACK_MS)
}

/**
 * Returns the terminal record, the last one seen when the signal aborted, or `undefined`
 * when the runner has no such batch.
 */
export async function waitForBatch(
  id: string,
  deps: AwaitBatchDeps,
  initial?: AiBatchRecord,
): Promise<AiBatchRecord | undefined> {
  // A function, not a narrowed property: the flag flips while this sleeps.
  const aborted = (): boolean => deps.signal?.aborted === true
  let batch =
    initial ??
    (await deps.runner.list()).find((row) => row.id === id) ??
    (await deps.runner.poll(id))
  while (batch !== undefined && !isTerminalBatchStatus(batch.status)) {
    deps.onPoll?.(batch)
    if (aborted()) return batch
    await deps.timers.sleep(batchPollDelayMs(batch, deps.clock.now()))
    if (aborted()) return batch
    batch = await deps.runner.poll(id)
  }
  return batch
}
