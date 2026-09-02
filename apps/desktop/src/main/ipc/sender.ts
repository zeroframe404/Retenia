import type { IpcMainInvokeEvent, WebFrameMain } from 'electron'

/**
 * Validate `event.senderFrame` before acting on any IPC message
 * (docs/spec/07-architecture.md §4).
 *
 * `WebFrameMain.origin` is Chromium's own RFC 6454 serialization, which is what makes it
 * the right thing to compare: an `about:blank` child window reports its *parent's* origin
 * here while `frame.url` is empty, and a frame with an opaque origin reports the literal
 * string `"null"`. Deriving an origin from `frame.url` would get both of those wrong.
 */
export function makeSenderGuard(allowedOrigins: readonly string[]) {
  return (event: IpcMainInvokeEvent): boolean => {
    let frame: WebFrameMain | null
    try {
      frame = event.senderFrame
    } catch {
      // Accessing the frame of a message that outlived its sender throws.
      return false
    }

    // Null once the sending frame has navigated or been destroyed: a message from a frame
    // that no longer exists is not one to act on either.
    if (!frame || frame.isDestroyed()) {
      return false
    }

    // Only the top-level document talks to main. `nodeIntegrationInSubFrames` is off and
    // no iframe in the app has any business invoking a channel.
    if (frame.parent !== null) {
      return false
    }

    // `"null"` is how an opaque (sandboxed, data:, srcdoc) origin serializes.
    return frame.origin !== 'null' && allowedOrigins.includes(frame.origin)
  }
}
