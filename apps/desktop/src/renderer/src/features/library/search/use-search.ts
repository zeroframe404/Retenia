import type { SearchMode, SourceKind } from '@retenia/ipc-contract'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useIpcMutation, useIpcQuery } from '../../../ipc/hooks'

/**
 * The search screen's data (sub-phase 6.3).
 *
 * The query is debounced here rather than in the component: every keystroke otherwise costs
 * a query embedding in the model host and a fusion over the whole library, and the answer to
 * a half-typed word is thrown away anyway.
 */

/** Long enough that a normal typing speed produces one request per word, short enough that
 *  the results feel like they follow the cursor. */
export const SEARCH_DEBOUNCE_MS = 200

export function useDebounced<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

export interface SearchArgs {
  query: string
  mode?: SearchMode
  sourceIds?: readonly string[]
  kinds?: readonly SourceKind[]
}

export function useLibrarySearch({ query, mode, sourceIds, kinds }: SearchArgs) {
  const trimmed = query.trim()
  return useIpcQuery(
    'library.search',
    {
      query: trimmed,
      ...(mode === undefined ? {} : { mode }),
      ...(sourceIds === undefined || sourceIds.length === 0 ? {} : { sourceIds: [...sourceIds] }),
      ...(kinds === undefined || kinds.length === 0 ? {} : { kinds: [...kinds] }),
    },
    // An empty query is not a search: it would ask main to embed `''` and fuse the whole
    // library against it.
    { enabled: trimmed.length > 0 },
  )
}

/** What retrieval is configured with — the status line under the filters. */
export function useRetrievalStatus() {
  return useIpcQuery('library.retrievalStatus', undefined)
}

/** "Crear tarjeta desde este fragmento". Invalidates the review queue, since the new card is
 *  due immediately. */
export function useCreateCardFromChunk() {
  const client = useQueryClient()
  return useIpcMutation('library.createCardFromChunk', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['session.plan'] })
      void client.invalidateQueries({ queryKey: ['memory.forecast'] })
    },
  })
}

/** "Reindexar esta fuente": drops its vectors and queues the embedding job again. */
export function useEmbedSource() {
  const client = useQueryClient()
  return useIpcMutation('library.embedSource', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['library.listSources'] })
      void client.invalidateQueries({ queryKey: ['library.retrievalStatus'] })
    },
  })
}
