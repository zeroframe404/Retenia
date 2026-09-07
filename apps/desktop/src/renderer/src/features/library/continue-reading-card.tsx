import type { RecentSource } from '@retenia/ipc-contract'
import { Button, Card } from '@retenia/ui'
import { useNavigate } from '@tanstack/react-router'
import { useT } from '../../i18n/use-t'
import { useRecentlyOpenedSources } from './use-annotations'

/** How many recently opened sources Home shows — enough to matter, not enough to crowd out
 *  the Today card above it. */
const RECENT_LIMIT = 3

function readerSearch(source: RecentSource) {
  const { locator } = source
  return {
    sourceId: source.id,
    ...('page' in locator ? { page: locator.page } : {}),
    ...('cfi' in locator ? { cfi: locator.cfi } : {}),
  }
}

/**
 * Home's "Continuar donde estaba" (sub-phase 6.6): the most recently opened PDF/EPUB sources,
 * each one click from reopening at the exact page/CFI `library.recordProgress` last wrote for
 * it. Renders nothing until at least one source has been opened in the reader.
 */
export function ContinueReadingCard() {
  const t = useT('library')
  const navigate = useNavigate()
  const { data } = useRecentlyOpenedSources(RECENT_LIMIT)
  const sources = data?.sources ?? []

  if (sources.length === 0) return null

  return (
    <Card className="flex flex-col gap-3 p-6" data-testid="continue-reading-card">
      <h2 className="text-text text-sm font-medium">{t('continueReading.title')}</h2>
      <ul className="flex flex-col gap-2">
        {sources.map((source) => (
          <li key={source.id} className="flex items-center justify-between gap-3">
            <span className="text-text truncate text-sm">{source.title}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ to: '/library', search: readerSearch(source) })}
              data-testid={`continue-reading-${source.id}`}
            >
              {t('continueReading.action')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
