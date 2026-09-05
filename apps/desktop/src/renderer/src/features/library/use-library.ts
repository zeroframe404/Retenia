import type { SourceStatus } from '@retenia/ipc-contract'
import { useQueryClient } from '@tanstack/react-query'
import { useIpcEvent, useIpcMutation, useIpcQuery } from '../../ipc/hooks'

/**
 * The source library's data (sub-phase 6.1): importing, listing, and watching a parse
 * through to `ready`/`failed`. `library.listSources`/`getSource` refresh on their own
 * whenever `jobs.progress` reports one of our jobs settling — see `useLibraryJobEvents`,
 * called once from `LibraryPage` — so a card's status updates without polling.
 */

const LIST_KEY = ['library.listSources']

export function useSources(statuses?: SourceStatus[]) {
  return useIpcQuery('library.listSources', statuses ? { statuses } : {})
}

export function useSource(id: string) {
  return useIpcQuery('library.getSource', { id })
}

export function useSourceDoc(id: string) {
  return useIpcQuery('library.getSourceDoc', { id })
}

export function useAddSourceFromDialog() {
  const client = useQueryClient()
  return useIpcMutation('library.addSourceFromDialog', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: LIST_KEY })
    },
  })
}

export function useAddSourceFromPaths() {
  const client = useQueryClient()
  return useIpcMutation('library.addSourceFromPaths', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: LIST_KEY })
    },
  })
}

export function useAddSourceFromText() {
  const client = useQueryClient()
  return useIpcMutation('library.addSourceFromText', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: LIST_KEY })
    },
  })
}

export function useRetrySource() {
  const client = useQueryClient()
  return useIpcMutation('library.retrySource', {
    onSuccess: (source) => {
      void client.invalidateQueries({ queryKey: LIST_KEY })
      void client.invalidateQueries({ queryKey: ['library.getSource', { id: source.id }] })
    },
  })
}

export function useDeleteSource() {
  const client = useQueryClient()
  return useIpcMutation('library.deleteSource', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: LIST_KEY })
    },
  })
}

/** Refreshes the source list/detail the moment an `ingestParseSource` job settles — call
 *  once from the screen that owns the Library, not from every card. */
export function useLibraryJobEvents(): void {
  const client = useQueryClient()
  useIpcEvent('jobs.progress', (event) => {
    if (event.kind !== 'ingestParseSource' || event.subjectId === null) return
    if (event.status !== 'succeeded' && event.status !== 'failed' && event.status !== 'cancelled') {
      return
    }
    void client.invalidateQueries({ queryKey: LIST_KEY })
    void client.invalidateQueries({ queryKey: ['library.getSource', { id: event.subjectId }] })
    void client.invalidateQueries({ queryKey: ['library.getSourceDoc', { id: event.subjectId }] })
  })
}
