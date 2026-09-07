import type { SearchHit } from '@retenia/ipc-contract'
import { SegmentedControl } from '@retenia/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { LibraryPage } from '../features/library'
import { SearchScreen } from '../features/library/search'
import { useT } from '../i18n/use-t'

const librarySearchSchema = z.object({
  /** The search box's current query, kept in the URL so it survives a refresh/deep link —
   *  the second concrete example (with `/settings`' `tab`) of the typed, zod-validated
   *  search params sub-phase 2.2 asked for. */
  q: z.string().optional(),
  /**
   * `sources` (the default) filters the grid of imported files by title; `search` is
   * sub-phase 6.3's retrieval over their contents. Two genuinely different questions — "which
   * book was that?" and "where does any of my books say this?" — so they are two views over
   * one query rather than one box that quietly changes meaning.
   */
  view: z.enum(['sources', 'search']).optional(),
  /**
   * "Ver en la fuente" (sub-phase 6.6): opens straight to this source's reader tab, at `page`
   * or `cfi` when either is known. Kept in the URL for the same reason `q`/`view` are — a
   * refresh or a `retenia://source/<id>` deep link lands on the exact page/section rather than
   * the grid.
   */
  sourceId: z.uuid().optional(),
  page: z.int().positive().optional(),
  cfi: z.string().min(1).optional(),
})

function LibraryScreen() {
  const t = useT('library')
  const { q, view, sourceId, page, cfi } = Route.useSearch()
  const navigate = Route.useNavigate()
  const active = view ?? 'sources'
  const initialReaderLocator =
    page === undefined && cfi === undefined
      ? undefined
      : { ...(page === undefined ? {} : { page }), ...(cfi === undefined ? {} : { cfi }) }

  const openInSource = (hit: SearchHit): void => {
    navigate({
      search: (prev) => ({
        ...prev,
        sourceId: hit.sourceId,
        page: hit.page ?? undefined,
        cfi: undefined,
      }),
    })
  }

  const closeSource = (): void => {
    navigate({
      search: (prev) => ({ ...prev, sourceId: undefined, page: undefined, cfi: undefined }),
    })
  }

  return (
    <div data-testid="screen-library" className="flex h-full flex-col gap-4 p-6">
      {sourceId === undefined && (
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
          <div className="flex items-center gap-3">
            <SegmentedControl<'sources' | 'search'>
              value={active}
              onValueChange={(next) =>
                navigate({
                  search: (prev) => ({ ...prev, view: next === 'sources' ? undefined : next }),
                })
              }
              options={[
                { value: 'sources', label: t('viewSources') },
                { value: 'search', label: t('viewSearch') },
              ]}
              aria-label={t('view')}
            />
            {active === 'sources' && (
              <input
                type="search"
                value={q ?? ''}
                onChange={(event) =>
                  navigate({ search: (prev) => ({ ...prev, q: event.target.value || undefined }) })
                }
                placeholder={t('searchPlaceholder')}
                data-testid="library-search"
                className="border-border bg-surface text-text max-w-sm rounded-md border px-3 py-2 text-sm"
              />
            )}
          </div>
        </div>
      )}

      {sourceId !== undefined ? (
        <LibraryPage
          openSourceId={sourceId}
          onCloseSource={closeSource}
          {...(initialReaderLocator === undefined ? {} : { initialReaderLocator })}
        />
      ) : active === 'search' ? (
        <SearchScreen
          query={q ?? ''}
          onQueryChange={(next) =>
            navigate({ search: (prev) => ({ ...prev, q: next || undefined }) })
          }
          onOpenInSource={openInSource}
        />
      ) : (
        <LibraryPage searchQuery={q} />
      )}
    </div>
  )
}

export const Route = createFileRoute('/library')({
  validateSearch: librarySearchSchema,
  component: LibraryScreen,
})
