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

/** The `chunks` rows sub-phase 6.2 produced from the source — what retrieval and citations
 *  actually use, as opposed to the parser's raw blocks. */
export function useSourceChunks(id: string, options: { excludeFrontmatter?: boolean } = {}) {
  return useIpcQuery('library.listChunks', {
    id,
    ...(options.excludeFrontmatter === true ? { excludeFrontmatter: true } : {}),
  })
}

/** What the "improved index" toggle would cost. Provider-free: it is arithmetic over the
 *  chunks, so it answers before any API key exists (`docs/spec/05-ingestion-rag.md` §4.2). */
export function useContextualizationEstimate(id: string) {
  return useIpcQuery('library.estimateContextualization', { id })
}

export function useAddSourceFromDialog() {
  const client = useQueryClient()
  return useIpcMutation('library.addSourceFromDialog', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: LIST_KEY })
    },
  })
}

export function useAddSourceFromFiles() {
  const client = useQueryClient()
  return useIpcMutation('library.addSourceFromFiles', {
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

/** The ingestion pipeline, in the order it runs over one source. */
const INGEST_JOB_KINDS = ['ingestParseSource', 'ingestChunkSource']

/** Refreshes the source list/detail the moment an ingestion job settles — call once from the
 *  screen that owns the Library, not from every card. */
export function useLibraryJobEvents(): void {
  const client = useQueryClient()
  useIpcEvent('jobs.progress', (event) => {
    if (!INGEST_JOB_KINDS.includes(event.kind) || event.subjectId === null) return
    if (event.status !== 'succeeded' && event.status !== 'failed' && event.status !== 'cancelled') {
      return
    }
    const id = event.subjectId
    void client.invalidateQueries({ queryKey: LIST_KEY })
    void client.invalidateQueries({ queryKey: ['library.getSource', { id }] })
    void client.invalidateQueries({ queryKey: ['library.getSourceDoc', { id }] })
    void client.invalidateQueries({ queryKey: ['library.listChunks'] })
    void client.invalidateQueries({ queryKey: ['library.estimateContextualization', { id }] })
  })
}
