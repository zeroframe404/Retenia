import type { DeepLink } from '@retenia/ipc-contract'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIpcEvent } from '../ipc/hooks'

function describe(link: DeepLink): string {
  switch (link.kind) {
    case 'import':
      return `import: ${link.src}`
    case 'review':
      return 'review'
    case 'authCallback':
      return 'auth callback'
  }
}

/**
 * Surfaces the most recent `retenia://` deep link for as long as the app is open. Proves
 * the main → renderer event pipeline end to end (sub-phase 1.3); a real screen (jump to
 * import, jump to today's review) replaces this once those exist.
 */
export function DeepLinkBanner() {
  const { t } = useTranslation('common')
  const [link, setLink] = useState<DeepLink | null>(null)

  useIpcEvent('app.deepLink', setLink)

  if (!link) {
    return null
  }

  return (
    <p
      data-testid="deep-link"
      data-deep-link-kind={link.kind}
      className="text-xs text-slate-500 dark:text-slate-400"
    >
      {t('deepLink.received', { link: describe(link) })}
    </p>
  )
}
