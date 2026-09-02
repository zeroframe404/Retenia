import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useT } from '../i18n/use-t'

const librarySearchSchema = z.object({
  /** The library search box's current query, kept in the URL so it survives a refresh/deep
   * link — the second concrete example (with `/settings`' `tab`) of the typed, zod-validated
   * search params sub-phase 2.2 asks for. Non-functional until the source library itself
   * lands in sub-phase 6.1. */
  q: z.string().optional(),
})

function LibraryScreen() {
  const t = useT('library')
  const { q } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div data-testid="screen-library" className="flex flex-col gap-4 p-6">
      <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted">{t('comingSoon')}</p>
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
    </div>
  )
}

export const Route = createFileRoute('/library')({
  validateSearch: librarySearchSchema,
  component: LibraryScreen,
})
