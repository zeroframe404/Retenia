import type { SearchMode, SourceKind, SourceSummary } from '@retenia/ipc-contract'
import { Badge, Button, cn, SegmentedControl } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'

/**
 * The filter panel of the search screen: which sources, which types, and which retrieval
 * mode (sub-phase 6.3).
 *
 * `docs/spec/05-ingestion-rag.md` asks for "collection / source / type". There is no
 * *collection* entity in the schema yet — `sources` is the only grouping the data model has —
 * so this offers source and type, and the collection facet arrives with the entity rather
 * than as an empty control that promises something the app cannot do.
 */

export interface SearchFiltersProps {
  sources: readonly SourceSummary[]
  selectedSourceIds: readonly string[]
  onSelectedSourceIdsChange: (ids: string[]) => void
  selectedKinds: readonly SourceKind[]
  onSelectedKindsChange: (kinds: SourceKind[]) => void
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
  /** The active embedding space, for the status line; `null` when none is configured. */
  modelId?: string | null
  /** Sources not yet embedded in that space. */
  pendingSources?: number
}

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
}

export function SearchFilters({
  sources,
  selectedSourceIds,
  onSelectedSourceIdsChange,
  selectedKinds,
  onSelectedKindsChange,
  mode,
  onModeChange,
  modelId,
  pendingSources = 0,
}: SearchFiltersProps) {
  const t = useT('library')

  // Only the kinds the library actually holds: a filter for a type the user has never
  // imported is noise, and it makes the panel grow with the format list rather than with
  // what is in front of them.
  const kinds = [...new Set(sources.map((source) => source.kind))].sort()

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5" data-testid="search-filters">
      <div className="flex flex-col gap-2">
        <span className="text-muted text-xs font-medium uppercase tracking-wide">
          {t('search.mode')}
        </span>
        <SegmentedControl<SearchMode>
          value={mode}
          onValueChange={onModeChange}
          options={[
            { value: 'hybrid', label: t('search.modeHybrid') },
            { value: 'fts', label: t('search.modeFts') },
            { value: 'vector', label: t('search.modeVector') },
          ]}
          aria-label={t('search.mode')}
        />
      </div>

      {kinds.length > 1 && (
        <div className="flex flex-col gap-2">
          <span className="text-muted text-xs font-medium uppercase tracking-wide">
            {t('search.type')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={selectedKinds.includes(kind)}
                onClick={() => onSelectedKindsChange(toggle(selectedKinds, kind))}
                className="cursor-pointer"
              >
                <Badge variant={selectedKinds.includes(kind) ? 'brand' : 'outline'}>{kind}</Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-muted text-xs font-medium uppercase tracking-wide">
            {t('search.source')}
          </span>
          {selectedSourceIds.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onSelectedSourceIdsChange([])}>
              {t('search.clear')}
            </Button>
          )}
        </div>
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {sources.map((source) => {
            const checked = selectedSourceIds.includes(source.id)
            return (
              <li key={source.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm',
                    'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onSelectedSourceIdsChange(toggle(selectedSourceIds, source.id))}
                  />
                  <span className="truncate" title={source.title}>
                    {source.title}
                  </span>
                  {/* A source whose vectors are missing still answers full-text queries, so
                      it stays in the list — with a mark saying why it may score lower. */}
                  {source.embeddingStatus !== 'ready' && (
                    <span
                      className="text-muted ml-auto text-xs"
                      title={t('search.notEmbeddedHint')}
                    >
                      ○
                    </span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="text-muted flex flex-col gap-1 text-xs" data-testid="search-status">
        {modelId === null || modelId === undefined ? (
          <span>{t('search.noModel')}</span>
        ) : (
          <span title={modelId}>{t('search.model', { model: modelId })}</span>
        )}
        {pendingSources > 0 && <span>{t('search.pending', { count: pendingSources })}</span>}
      </div>
    </aside>
  )
}
