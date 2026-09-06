import type { SearchHit, SearchMode, SourceKind } from '@retenia/ipc-contract'
import { toast } from '@retenia/ui'
import { useState } from 'react'
import { useT } from '../../../i18n/use-t'
import { useSources } from '../use-library'
import { SearchFilters } from './search-filters'
import { SearchResults } from './search-results'
import {
  useCreateCardFromChunk,
  useDebounced,
  useLibrarySearch,
  useRetrievalStatus,
} from './use-search'

/**
 * The Library's search screen (sub-phase 6.3; `docs/spec/05-ingestion-rag.md` §4): a query
 * box, the collection/source/type facets, and results with a snippet, the heading path, the
 * page or timestamp, "abrir en la fuente" and "crear tarjeta desde este fragmento".
 */

export interface SearchScreenProps {
  /** The query, owned by the route so it survives a refresh and a deep link. */
  query: string
  onQueryChange: (query: string) => void
  /**
   * "Abrir en la fuente". A stub until the PDF/EPUB reader (6.6) and the media player (6.4)
   * exist to be opened *at* a page or a timestamp; the screen still carries the affordance
   * and the locator, so wiring it later is a one-line change rather than a redesign.
   */
  onOpenInSource?: (hit: SearchHit) => void
}

export function SearchScreen({ query, onQueryChange, onOpenInSource }: SearchScreenProps) {
  const t = useT('library')
  const [mode, setMode] = useState<SearchMode>('hybrid')
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [kinds, setKinds] = useState<SourceKind[]>([])
  const [creatingCardFor, setCreatingCardFor] = useState<string | undefined>()

  const debounced = useDebounced(query)
  const sourcesQuery = useSources()
  const statusQuery = useRetrievalStatus()
  const search = useLibrarySearch({ query: debounced, mode, sourceIds, kinds })
  const createCard = useCreateCardFromChunk()

  const openInSource = (hit: SearchHit): void => {
    if (onOpenInSource !== undefined) {
      onOpenInSource(hit)
      return
    }
    // The reader is not built yet. Saying so is better than a dead button, and better than
    // pretending the click did something.
    toast.info(t('search.openInSourceUnavailable'))
  }

  const createCardFromHit = (hit: SearchHit): void => {
    setCreatingCardFor(hit.chunkId)
    createCard.mutate(
      { chunkId: hit.chunkId },
      {
        onSuccess: () => toast.success(t('search.cardCreated')),
        onError: (error) => toast.error(error.message),
        onSettled: () => setCreatingCardFor(undefined),
      },
    )
  }

  return (
    <div className="flex gap-6" data-testid="search-screen">
      <SearchFilters
        sources={sourcesQuery.data?.sources ?? []}
        selectedSourceIds={sourceIds}
        onSelectedSourceIdsChange={setSourceIds}
        selectedKinds={kinds}
        onSelectedKindsChange={setKinds}
        mode={mode}
        onModeChange={setMode}
        modelId={statusQuery.data?.modelId ?? null}
        pendingSources={statusQuery.data?.pendingSources ?? 0}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          data-testid="search-input"
          className="border-border bg-surface text-text rounded-md border px-3 py-2 text-sm"
        />

        <SearchResults
          hits={search.data?.hits ?? []}
          query={debounced}
          // Only the *first* load shows skeletons: a refetch while the user types would
          // otherwise blank the list they are reading on every keystroke.
          loading={search.isLoading && debounced.trim().length > 0}
          degraded={search.data?.degraded ?? false}
          {...(search.data === undefined ? {} : { tookMs: search.data.tookMs })}
          onOpenInSource={openInSource}
          onCreateCard={createCardFromHit}
          {...(creatingCardFor === undefined ? {} : { creatingCardFor })}
        />
      </div>
    </div>
  )
}
