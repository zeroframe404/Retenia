/**
 * A fixed number of workers over a list, in order.
 *
 * The same shape `@retenia/ingest`'s contextualiser uses: each worker takes the next index
 * until the list is exhausted or `shouldStop` says so, and a worker that throws fails the
 * pool — so a per-item failure that should *not* stop the run is the worker's to catch.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0
  const run = async (): Promise<void> => {
    for (;;) {
      if (shouldStop()) return
      const index = next
      next += 1
      if (index >= items.length) return
      await worker(items[index] as T, index)
    }
  }
  const workers = Math.max(1, Math.min(Math.floor(concurrency), items.length))
  await Promise.all(Array.from({ length: workers }, run))
}
