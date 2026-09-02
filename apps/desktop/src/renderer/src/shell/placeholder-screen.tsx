import type { Namespace } from '@retenia/i18n'
import type { ReactNode } from 'react'
import { useT } from '../i18n/use-t'

export interface PlaceholderScreenProps {
  /** A namespace with `title`/`comingSoon` keys (every section namespace except `review`,
   * which has its own richer screen — see `shell/screens/review-screen.tsx`). */
  ns: Namespace
  children?: ReactNode
}

/** The shared shape for a section whose real screen hasn't landed yet (Path, Exams,
 * Languages, Notes, Statistics — see the phase table in `docs/spec/01-decisions.md` §10.2
 * for when each one does). */
export function PlaceholderScreen({ ns, children }: PlaceholderScreenProps) {
  const t = useT(ns)
  return (
    <div data-testid={`screen-${ns}`} className="flex flex-col gap-2 p-6">
      <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted">{t('comingSoon')}</p>
      {children}
    </div>
  )
}
