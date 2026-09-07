import type { DeepLink } from '@retenia/ipc-contract'
import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useIpcEvent } from '../ipc/hooks'

/**
 * "Ver en la fuente" (sub-phase 6.6): a `retenia://source/<id>?page=12` (or `?cfi=...`) deep
 * link navigates straight to that source's reader tab, at the exact page/CFI.
 *
 * Split out of `DeepLinkBanner` rather than added there: that component's own tests render it
 * with no router context, and `useNavigate` needs one. This one is mounted only from
 * `__root.tsx`, always inside `RouterProvider`, and renders nothing of its own — the banner
 * still shows the received-link text for every kind, this only adds navigation for `source`.
 */
export function SourceDeepLinkListener() {
  const navigate = useNavigate()

  const onDeepLink = useCallback(
    (link: DeepLink) => {
      if (link.kind !== 'source') return
      navigate({
        to: '/library',
        search: {
          sourceId: link.id,
          ...(link.page === undefined ? {} : { page: link.page }),
          ...(link.cfi === undefined ? {} : { cfi: link.cfi }),
        },
      })
    },
    [navigate],
  )
  useIpcEvent('app.deepLink', onDeepLink)

  return null
}
