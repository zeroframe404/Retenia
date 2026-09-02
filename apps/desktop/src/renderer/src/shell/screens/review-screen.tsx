import { SHORTCUTS } from '@retenia/ui'
import { useEffect, useState } from 'react'
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook'
import { useT } from '../../i18n/use-t'

const REVIEW_SHORTCUTS = SHORTCUTS.filter((s) => s.scope === 'review')

/**
 * The real review session lands in sub-phase 4.x. This screen exists to prove two things
 * sub-phase 2.2 asks for, concretely and testably:
 *
 * 1. `<Activity>` keeps it mounted while the user navigates elsewhere (`shell/sticky-outlet.tsx`
 *    renders this once, wrapped in `Activity`, instead of letting the router unmount it on
 *    every visit) — the counter below only survives a real navigation away-and-back if that
 *    works.
 * 2. The `review` hotkey scope (1–4 grade, Space reveal, Enter continue, Esc back) is
 *    registered and only live while this screen is the active route.
 */
export function ReviewScreen() {
  const t = useT('review')
  const [count, setCount] = useState(0)
  const [lastShortcut, setLastShortcut] = useState<string | null>(null)
  const { enableScope, disableScope } = useHotkeysContext()

  // `enableScope`/`disableScope` run on every mount *and* on every Activity visible/hidden
  // transition (React tears down and re-runs effects across those), so the review scope is
  // only ever live while this screen is the one actually on screen — not just mounted.
  useHotkeys(
    REVIEW_SHORTCUTS.map((s) => s.keys).join(','),
    (_event, handler) => setLastShortcut(handler.keys?.join('+') ?? null),
    { scopes: ['review'], enableOnFormTags: false },
    [],
  )

  useEffect(() => {
    enableScope('review')
    return () => disableScope('review')
  }, [enableScope, disableScope])

  return (
    <div data-testid="screen-review" className="flex flex-col gap-4 p-6">
      <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted">{t('comingSoon')}</p>

      <section className="border-border flex flex-col gap-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">{t('activityDemo.heading')}</h2>
        <div className="flex items-center gap-3">
          <span data-testid="review-counter">
            {t('activityDemo.counterLabel')}: {count}
          </span>
          <button
            type="button"
            data-testid="review-increment"
            onClick={() => setCount((c) => c + 1)}
            className="bg-brand-600 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            {t('activityDemo.increment')}
          </button>
        </div>
        <p data-testid="review-last-shortcut" className="text-muted text-sm">
          {lastShortcut
            ? t('activityDemo.lastShortcut', { key: lastShortcut })
            : t('activityDemo.lastShortcutNone')}
        </p>
      </section>
    </div>
  )
}
