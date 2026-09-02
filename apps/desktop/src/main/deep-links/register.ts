import type { DeepLink } from '@retenia/ipc-contract'
import { app } from 'electron'
import { DEEP_LINK_PROTOCOL, parseDeepLink } from './parse'

/** Pull the `retenia://…` argument out of a `second-instance` argv (Windows/Linux). */
export function deepLinkFromArgv(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`))
}

export interface DeepLinkOptions {
  onDeepLink: (link: DeepLink) => void
  /** A second launch was blocked by the instance lock — focus the existing window. */
  onSecondInstance?: () => void
}

/**
 * Register `retenia://` as the app's protocol and wire up both delivery paths a deep link
 * can arrive through: a relaunch's argv on Windows/Linux (`second-instance`), or `open-url`
 * on macOS. Must run before `app.whenReady()` — the electron-builder config declares the
 * protocol so the OS knows to launch this app for it.
 *
 * Returns `false` when another instance already holds the lock — the caller has nothing
 * left to do (this process is already quitting).
 */
export function registerDeepLinks({ onDeepLink, onSecondInstance }: DeepLinkOptions): boolean {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return false
  }

  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL)

  app.on('second-instance', (_event, argv) => {
    onSecondInstance?.()
    const url = deepLinkFromArgv(argv)
    const link = url ? parseDeepLink(url) : null
    if (link) {
      onDeepLink(link)
    }
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    const link = parseDeepLink(url)
    if (link) {
      onDeepLink(link)
    }
  })

  return true
}
