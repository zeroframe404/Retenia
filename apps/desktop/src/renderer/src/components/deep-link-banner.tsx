import type { DeepLink } from '@retenia/ipc-contract'
import { Button, toast } from '@retenia/ui'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAddSourceFromUrl } from '../features/library/use-library'
import { useT } from '../i18n/use-t'
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

type ImportPhase = 'confirming' | 'started' | 'discarded'

interface BannerState {
  link: DeepLink | null
  importPhase: ImportPhase | null
}

/**
 * Surfaces the most recent `retenia://` deep link for as long as the app is open. Mounted once
 * at the app shell's root (`__root.tsx`) rather than inside the Library screen, since a link can
 * arrive while any other screen is open. `review`/`authCallback` still only get the banner text;
 * a real screen for those replaces it once they exist.
 *
 * An `import` link (the web clipper bookmarklet's whole point,
 * `docs/spec/05-ingestion-rag.md` §1's "Web" row: `retenia://import?src=<url>`) always asks
 * before fetching anything. The OS's one-time "open Retenia?" prompt for a custom protocol is
 * not a substitute: it fires for *any* page that emits the link, it never shows which URL will
 * actually be fetched, and a user can tick "always allow" and lose it entirely — at which point
 * any web page could silently drive the importer (`security-reviewer` finding H3). The importer
 * itself also refuses a private/loopback/LAN target (`main/library/url-safety.ts`), but that is
 * a safety net for the URL, not a substitute for the user choosing to import it.
 */
export function DeepLinkBanner() {
  const { t } = useTranslation('common')
  const tLibrary = useT('library')
  const [state, setState] = useState<BannerState>({ link: null, importPhase: null })
  const { link, importPhase } = state
  const startImport = useAddSourceFromUrl()

  const onDeepLink = useCallback((received: DeepLink) => {
    setState((prev) => {
      // A second `import` link arriving while the first is still awaiting the user's click is
      // ignored rather than silently swapping the pending URL out from under them — a page could
      // otherwise fire a benign-looking link, wait for the user to read it, then fire a hostile
      // one on a timer so the still-visible "Import" button now approves a different URL than
      // the one they actually read (`security-reviewer` finding "New-10"). A `review`/
      // `authCallback` link is not this attack (nothing binds a click to its target), so it still
      // replaces the pending state as before.
      if (prev.importPhase === 'confirming' && received.kind === 'import') return prev
      return { link: received, importPhase: received.kind === 'import' ? 'confirming' : null }
    })
  }, [])
  useIpcEvent('app.deepLink', onDeepLink)

  const confirmImport = useCallback(() => {
    if (link?.kind !== 'import') return
    startImport.mutate(
      { url: link.src },
      {
        // A rejected URL (the SSRF guard, a 404, a size cap, a rendering timeout) used to fail
        // silently — the banner just sat there having said nothing was wrong.
        onError: (error) => toast.error(error.message),
        onSuccess: (result) => {
          if (result.truncated) toast.warning(tLibrary('playlistTruncated'))
        },
      },
    )
    setState((prev) => ({ ...prev, importPhase: 'started' }))
  }, [link, startImport, tLibrary])

  const discardImport = useCallback(() => {
    setState((prev) => ({ ...prev, importPhase: 'discarded' }))
  }, [])

  if (!link) {
    return null
  }

  if (importPhase === 'confirming' && link.kind === 'import') {
    return (
      <div
        data-testid="deep-link-import-confirm"
        className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
      >
        <span data-testid="deep-link-import-url">
          {t('deepLink.confirmImport', { url: link.src })}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={confirmImport}
          data-testid="deep-link-import-accept"
        >
          {t('deepLink.import')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={discardImport}
          data-testid="deep-link-import-discard"
        >
          {t('deepLink.discard')}
        </Button>
      </div>
    )
  }

  return (
    <p
      data-testid="deep-link"
      data-deep-link-kind={link.kind}
      className="text-xs text-slate-500 dark:text-slate-400"
    >
      {importPhase === 'started' && link.kind === 'import'
        ? t('deepLink.importStarted', { url: link.src })
        : importPhase === 'discarded'
          ? t('deepLink.importDiscarded')
          : t('deepLink.received', { link: describe(link) })}
    </p>
  )
}
