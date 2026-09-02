import { Link } from '@tanstack/react-router'
import { useT } from '../i18n/use-t'

/** Rendered in place of `<Outlet/>`'s content when no route matches (`createRootRoute`'s
 * `notFoundComponent`) — the shell chrome (sidebar, top bar) stays, only the main area
 * changes. */
export function NotFound() {
  const t = useT('shell')
  return (
    <div data-testid="not-found" className="flex flex-col items-center gap-4 p-12 text-center">
      <h1 className="font-display text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="text-muted">{t('notFound.body')}</p>
      <Link to="/" className="text-brand-600 underline">
        {t('notFound.backHome')}
      </Link>
    </div>
  )
}
