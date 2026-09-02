import { app, type MediaAccessPermissionRequest, session, shell, type WebContents } from 'electron'
import { shouldOpenExternally } from './navigation'
import { isAllowedSenderUrl } from './origins'

export interface SecurityOptions {
  /** Origins the renderer may legitimately be served from (see `allowedRendererOrigins`). */
  allowedOrigins: readonly string[]
  csp: string
}

/**
 * Apply the Electron security checklist from docs/spec/07-architecture.md §4 to the
 * default session and to every `WebContents` the app ever creates.
 */
export function applySecurity({ allowedOrigins, csp }: SecurityOptions): void {
  applySessionSecurity(allowedOrigins, csp)

  app.on('web-contents-created', (_event, contents) => {
    applyWebContentsSecurity(contents, allowedOrigins)
  })
}

function applySessionSecurity(allowedOrigins: readonly string[], csp: string): void {
  const defaultSession = session.defaultSession

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }

    // The `app://` handler already sets the policy on its own responses, and multiple CSPs
    // are enforced as an intersection rather than a replacement — so adding a second one
    // here would be at best redundant and at worst a policy nobody can reason about.
    const existing = Object.keys(responseHeaders).find(
      (name) => name.toLowerCase() === 'content-security-policy',
    )

    if (!existing) {
      responseHeaders['Content-Security-Policy'] = [csp]
    }

    callback({ responseHeaders })
  })

  // The renderer needs exactly one permission: the microphone, for pronunciation practice
  // (sub-phase 11.x). Everything else — camera, geolocation, notifications, MIDI, USB — is
  // denied until a feature actually needs it.
  defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (!details.isMainFrame || !isAllowedSenderUrl(details.requestingUrl, allowedOrigins)) {
      callback(false)
      return
    }

    if (permission !== 'media') {
      callback(false)
      return
    }

    // `media` covers the camera as well. Only the microphone is in scope, so a request
    // that also asks for video — or that does not say what it wants — is refused.
    const { mediaTypes } = details as MediaAccessPermissionRequest
    callback(
      Array.isArray(mediaTypes) && mediaTypes.length > 0 && mediaTypes.every((t) => t === 'audio'),
    )
  })

  // The check handler answers "would this be allowed?" and carries a different shape:
  // a single `mediaType` rather than the requested list.
  defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    if (!details.isMainFrame || !allowedOrigins.includes(requestingOrigin)) {
      return false
    }
    return permission === 'media' && details.mediaType === 'audio'
  })

  // Nothing in the app enumerates or pairs hardware devices.
  defaultSession.setDevicePermissionHandler(() => false)
}

function applyWebContentsSecurity(contents: WebContents, allowedOrigins: readonly string[]): void {
  // The renderer is a single-page app: it never navigates the top-level document away from
  // its own origin. A navigation elsewhere means injected content or a stray link.
  const blockForeignNavigation = (event: { preventDefault: () => void }, url: string) => {
    if (!isAllowedSenderUrl(url, allowedOrigins)) {
      event.preventDefault()
      console.warn(`[security] blocked navigation to ${url}`)
    }
  }

  contents.on('will-navigate', blockForeignNavigation)
  contents.on('will-frame-navigate', (event) => {
    blockForeignNavigation(event, event.url)
  })

  // No new Electron windows, ever. Links the user should be able to follow are handed to
  // the OS browser, where they run outside the app's privileges.
  contents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) {
      void shell.openExternal(url)
    } else {
      console.warn(`[security] blocked window.open for ${url}`)
    }
    return { action: 'deny' }
  })

  // `<webview>` is disabled via webPreferences; this refuses it a second time in case a
  // window is ever created without that flag.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
    console.warn('[security] blocked a <webview> attachment')
  })
}
