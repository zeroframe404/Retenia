/** The handful of `KeyboardEvent` fields this module reads — matches both a native
 *  `KeyboardEvent` and React's synthetic one, so the same handler attaches either as a JSX
 *  `onKeyDown` prop or via `addEventListener` on a plain ref (`PdfReader`'s own root: N/P/H/C
 *  must reach it from anywhere inside the reader, and a bare `<div>` with a JSX key handler
 *  is a static-element-interactivity lint violation with no real interactive role to give
 *  it). */
export interface ReaderKeyboardEvent {
  key: string
  target: EventTarget | null
  preventDefault(): void
}

/**
 * N next page, P previous, H highlight the current selection, C create a card from it
 * (`docs/spec/08-ux.md` §2). Shared by `PdfReader` and `EpubReader` so the same four keys do
 * the same thing in both.
 */
export interface ReaderShortcutHandlers {
  onNextPage?: () => void
  onPrevPage?: () => void
  /** Acts on whatever is currently selected; absent (nothing selected) means the key does
   *  nothing, exactly like the toolbar button it mirrors would not be shown for one. */
  onHighlight?: () => void
  onCreateCard?: () => void
}

/** A block/text field inside the reader — a search box, a note being typed — where N/P/H/C
 *  must type normally rather than page or highlight. */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]'

/**
 * Builds the reader's `onKeyDown` handler. A factory rather than a hook: there is no effect
 * or subscription to manage, only a closure over the handlers the caller already has —
 * `useCallback`-wrapping the result at the call site (as `MediaPlayer` does for its own
 * J/K/L) is enough to keep it stable across renders.
 */
export function createReaderShortcutHandler(handlers: ReaderShortcutHandlers) {
  return (event: ReaderKeyboardEvent): void => {
    const target = event.target
    if (target instanceof HTMLElement && target.closest(EDITABLE_SELECTOR)) return

    switch (event.key.toLowerCase()) {
      case 'n':
        handlers.onNextPage?.()
        break
      case 'p':
        handlers.onPrevPage?.()
        break
      case 'h':
        handlers.onHighlight?.()
        break
      case 'c':
        handlers.onCreateCard?.()
        break
      default:
        return
    }
    event.preventDefault()
  }
}
