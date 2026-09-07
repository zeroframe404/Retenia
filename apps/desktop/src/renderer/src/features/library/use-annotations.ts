import { useQueryClient } from '@tanstack/react-query'
import { useIpcMutation, useIpcQuery } from '../../ipc/hooks'

/**
 * A source's highlights and reading progress (sub-phase 6.6, `docs/spec/05-ingestion-rag.md`
 * §6.6): what is already marked, "Resaltar"/"Crear tarjeta" from the selection toolbar, and
 * where the reader last left off.
 */

function annotationsKey(sourceId: string) {
  return ['library.listAnnotations', { sourceId }]
}

export function useAnnotations(sourceId: string) {
  return useIpcQuery('library.listAnnotations', { sourceId })
}

export function useCreateAnnotation(sourceId: string) {
  const client = useQueryClient()
  return useIpcMutation('library.createAnnotation', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: annotationsKey(sourceId) })
    },
  })
}

export function useDeleteAnnotation(sourceId: string) {
  const client = useQueryClient()
  return useIpcMutation('library.deleteAnnotation', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: annotationsKey(sourceId) })
    },
  })
}

/** "Crear tarjeta desde este resaltado". Invalidates the review queue, the same as
 *  `useCreateCardFromChunk`/`useCreateCardFromClip` — the new card is due immediately. */
export function useCreateCardFromAnnotation() {
  const client = useQueryClient()
  return useIpcMutation('library.createCardFromAnnotation', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['session.plan'] })
      void client.invalidateQueries({ queryKey: ['memory.forecast'] })
    },
  })
}

/** Written on every page turn/section change so the reader (and Home's "Continuar donde
 *  estaba") can resume exactly where the user left off. */
export function useRecordProgress() {
  const client = useQueryClient()
  return useIpcMutation('library.recordProgress', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['library.listRecentlyOpened'] })
    },
  })
}

/** Home's "Continuar donde estaba": the most recently opened sources, most recent first. */
export function useRecentlyOpenedSources(limit?: number) {
  return useIpcQuery('library.listRecentlyOpened', limit === undefined ? {} : { limit })
}
