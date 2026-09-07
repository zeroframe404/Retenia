/**
 * Types shared by `PdfReader` and `EpubReader` for the highlight → item flow
 * (`docs/spec/08-ux.md` §2 "Biblioteca de fuentes"; sub-phase 6.6).
 *
 * Declared here rather than imported from `@retenia/ipc-contract`, for the same reason
 * `media/types.ts` gives: `packages/readers` may depend only on `core` and `ui`
 * (`tooling/scripts/check-deps.mjs`), which keeps a reader a *component*, renderable from a
 * Storybook story with no IPC bridge behind it.
 */

/** A rectangle as a fraction (0–1) of the page's/viewport's own width and height — resolution-
 *  independent, so the same value draws correctly at any zoom level or window size. Mirrors
 *  `pdfHighlightAnchorSchema`'s `rects` in `@retenia/ipc-contract`. */
export interface FractionalRect {
  x: number
  y: number
  width: number
  height: number
}

/** What the reader knows about the user's current text selection, enough to render the
 *  floating toolbar and to build a highlight/card from it. `quote` is the plain selected
 *  text; readers add their own kind-specific anchor (PDF: page + rects, EPUB: CFI) when they
 *  call `onHighlight`/`onCreateCard`. */
export interface ReaderSelection {
  quote: string
  /** Viewport coordinates (in CSS pixels) to anchor the floating `SelectionToolbar` above. */
  toolbarPosition: { x: number; y: number }
}

export interface SelectionToolbarLabels {
  highlight: string
  createCard: string
  askAi: string
  copyWithCitation: string
}
