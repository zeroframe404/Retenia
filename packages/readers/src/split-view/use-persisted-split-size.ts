import { useCallback, useState } from 'react'

/**
 * A split ratio (0–100) persisted to `localStorage`, so a reader remembers how wide the user
 * dragged its notes/cards panel the same way `chrome-store.ts` remembers the sidebar's
 * collapsed state — ephemeral UI chrome, not a documented Settings field.
 *
 * Reads/writes are wrapped in `try`/`catch`: a private window, cleared site data, or a
 * storage quota can make `localStorage` throw, and a remembered pane width is not worth
 * crashing the reader over.
 */
export function usePersistedSplitSize(
  key: string,
  fallback: number,
): [number, (next: number) => void] {
  const [size, setSize] = useState<number>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      const parsed = stored === null ? Number.NaN : Number(stored)
      return Number.isFinite(parsed) ? parsed : fallback
    } catch {
      return fallback
    }
  })

  const persist = useCallback(
    (next: number) => {
      setSize(next)
      try {
        window.localStorage.setItem(key, String(next))
      } catch {
        // Best-effort only — the layout still works for this session.
      }
    },
    [key],
  )

  return [size, persist]
}
