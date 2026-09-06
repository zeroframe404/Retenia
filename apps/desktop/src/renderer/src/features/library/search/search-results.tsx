import type { SearchHit, SourceKind } from '@retenia/ipc-contract'
import { Badge, Button, cn, EmptyState, Skeleton } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'
import { parseSnippet } from './snippet'

/**
 * The results half of the Library's search screen (sub-phase 6.3;
 * `docs/spec/05-ingestion-rag.md` §4).
 *
 * Presentational on purpose — it takes hits and calls back — so the same component renders a
 * story, a test and the connected screen. Everything a citation needs is on the card: which
 * source, where in it, and the passage itself.
 */

export interface SearchResultsProps {
  hits: readonly SearchHit[]
  /** The query, for the empty state's message. */
  query: string
  loading?: boolean
  /** True when the vector branch could not run — the results are full-text only. */
  degraded?: boolean
  /** Round-trip time main measured, in milliseconds. */
  tookMs?: number
  /** "Abrir en la fuente": jump to the page, slide or timestamp the chunk came from. */
  onOpenInSource: (hit: SearchHit) => void
  /** "Crear tarjeta desde este fragmento". */
  onCreateCard: (hit: SearchHit) => void
  /** Which hit is mid-flight in `onCreateCard`, so its button can say so. */
  creatingCardFor?: string
}

/** `p. 12`, `12:30`, or nothing — whichever the chunk's locator could give. */
function locatorLabel(hit: SearchHit): string | null {
  if (hit.label !== null && hit.label.length > 0) return hit.label
  if (hit.page !== null) return `p. ${hit.page}`
  if (hit.tStartMs !== null) {
    const total = Math.floor(hit.tStartMs / 1000)
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }
  return null
}

const KIND_LABELS: Partial<Record<SourceKind, string>> = {
  pdf: 'PDF',
  docx: 'DOCX',
  epub: 'EPUB',
  pptx: 'PPTX',
  youtube: 'YouTube',
}

function Snippet({ snippet }: { snippet: string }) {
  // Never `innerHTML`: the passage is content of a file the user imported, and the only
  // markup in it that is ours is FTS5's `<b>` pair (see `parseSnippet`).
  return (
    <p className="text-text text-sm leading-relaxed">
      {parseSnippet(snippet).map((run, index) =>
        run.match ? (
          <mark
            // biome-ignore lint/suspicious/noArrayIndexKey: runs have no identity of their own
            key={index}
            className="bg-accent/25 text-text rounded-[2px] px-0.5 font-medium"
          >
            {run.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: same
          <span key={index}>{run.text}</span>
        ),
      )}
    </p>
  )
}

export function SearchResults({
  hits,
  query,
  loading = false,
  degraded = false,
  tookMs,
  onOpenInSource,
  onCreateCard,
  creatingCardFor,
}: SearchResultsProps) {
  const t = useT('library')

  if (loading) {
    return (
      <div className="flex flex-col gap-3" data-testid="search-loading">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (query.trim().length === 0) {
    return (
      <EmptyState
        title={t('search.idleTitle')}
        description={t('search.idleDescription')}
        data-testid="search-idle"
      />
    )
  }

  if (hits.length === 0) {
    return (
      <EmptyState
        title={t('search.noResultsTitle')}
        description={t('search.noResultsDescription')}
        data-testid="search-empty"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-muted flex items-center gap-2 text-xs" data-testid="search-meta">
        <span>{t('search.resultCount', { count: hits.length })}</span>
        {tookMs !== undefined && <span>· {t('search.took', { ms: Math.round(tookMs) })}</span>}
        {degraded && (
          <Badge variant="xp" data-testid="search-degraded">
            {t('search.degraded')}
          </Badge>
        )}
      </div>

      <ul className="flex flex-col gap-3">
        {hits.map((hit) => {
          const label = locatorLabel(hit)
          return (
            <li
              key={hit.chunkId}
              data-testid="search-hit"
              className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-text font-medium">{hit.sourceTitle}</span>
                <Badge variant="outline">{KIND_LABELS[hit.sourceKind] ?? hit.sourceKind}</Badge>
                {label !== null && <span className="text-muted">{label}</span>}
                {/* Which branch found it: the "why is this here" affordance, and the first
                    thing to look at when a result set disappoints. */}
                {hit.matchedFts && (
                  <Badge variant="neutral" title={t('search.matchedFtsHint')}>
                    {t('search.matchedFts')}
                  </Badge>
                )}
                {hit.matchedVector && (
                  <Badge variant="neutral" title={t('search.matchedVectorHint')}>
                    {t('search.matchedVector')}
                  </Badge>
                )}
              </div>

              {hit.headingPath !== null && (
                <p className={cn('text-muted truncate text-xs')} title={hit.headingPath}>
                  {hit.headingPath}
                </p>
              )}

              <Snippet snippet={hit.snippet} />

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => onOpenInSource(hit)}>
                  {t('search.openInSource')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={creatingCardFor === hit.chunkId}
                  onClick={() => onCreateCard(hit)}
                >
                  {creatingCardFor === hit.chunkId
                    ? t('search.creatingCard')
                    : t('search.createCard')}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
