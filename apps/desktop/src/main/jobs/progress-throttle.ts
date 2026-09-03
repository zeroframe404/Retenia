/**
 * Rate-limits job progress on its way to the renderer.
 *
 * A job that hashes a 2 GB file reports thousands of times a second. The tray redraws at
 * screen rate, so anything past ~10 Hz is work nobody sees — and every push crosses the IPC
 * bridge, is zod-validated per window, and wakes React.
 *
 * The shape that matters: the **first** update goes out immediately (a bar that waits 100 ms
 * to appear looks broken), anything inside the window is coalesced onto a trailing timer, and
 * the **last** value is never dropped. A throttle that only leads would leave a bar frozen at
 * 97% forever.
 */

export interface ProgressThrottleOptions<T> {
  emit: (payload: T) => void
  /** Minimum gap between two emits for the same job. 100 ms is the spec's 10 Hz. */
  intervalMs?: number
  now?: () => number
}

export interface ProgressThrottle<T> {
  /** Queue an update for `key`, emitting now or on the trailing edge. */
  push(key: string, payload: T): void
  /** Emit whatever is pending for `key` at once and forget it. For terminal transitions. */
  flush(key: string): void
  /** Drop everything pending, timers included. */
  dispose(): void
}

export const PROGRESS_INTERVAL_MS = 100

export function createProgressThrottle<T>({
  emit,
  intervalMs = PROGRESS_INTERVAL_MS,
  now = Date.now,
}: ProgressThrottleOptions<T>): ProgressThrottle<T> {
  interface Entry {
    lastEmittedAt: number
    pending?: T
    timer?: ReturnType<typeof setTimeout>
  }

  const entries = new Map<string, Entry>()

  const clear = (entry: Entry): void => {
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer)
      entry.timer = undefined
    }
    entry.pending = undefined
  }

  return {
    push: (key, payload) => {
      const entry = entries.get(key) ?? { lastEmittedAt: Number.NEGATIVE_INFINITY }
      entries.set(key, entry)

      const elapsed = now() - entry.lastEmittedAt
      if (elapsed >= intervalMs) {
        clear(entry)
        entry.lastEmittedAt = now()
        emit(payload)
        return
      }

      // Inside the window: keep only the newest value and make sure something is scheduled
      // to send it. Re-arming here would push the emit further out on every update, which is
      // how a busy job ends up never reporting at all.
      entry.pending = payload
      if (entry.timer !== undefined) return
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        const queued = entry.pending
        entry.pending = undefined
        if (queued === undefined) return
        entry.lastEmittedAt = now()
        emit(queued)
      }, intervalMs - elapsed)
    },

    flush: (key) => {
      const entry = entries.get(key)
      if (entry === undefined) return
      const queued = entry.pending
      clear(entry)
      entries.delete(key)
      if (queued !== undefined) emit(queued)
    },

    dispose: () => {
      for (const entry of entries.values()) clear(entry)
      entries.clear()
    },
  }
}
