import type { FractionalRect, SelectionToolbarLabels } from '../annotate/types'

/** A persisted PDF highlight — one or more rects on a single page (a selection can span a
 *  line break, which pdf.js reports as several client rects). Mirrors
 *  `pdfHighlightAnchorSchema` in `@retenia/ipc-contract`. */
export interface PdfHighlight {
  id: string
  /** 1-based, matching pdf.js's own page numbering. */
  page: number
  rects: FractionalRect[]
  color: string
}

/** A text selection made in the reader, with everything needed to build a highlight or a
 *  card's citation from it. */
export interface PdfTextSelection {
  page: number
  rects: FractionalRect[]
  quote: string
  /** Viewport coordinates (CSS pixels) to anchor the floating `SelectionToolbar` above. */
  toolbarPosition: { x: number; y: number }
}

/** One hit from `PdfReader`'s in-document search. */
export interface PdfSearchMatch {
  page: number
  /** Index into the page's own extracted text (`getTextContent`'s items joined with spaces) —
   *  what the highlight-and-scroll-to-match logic seeks by. */
  charIndex: number
  length: number
}

export interface PdfReaderLabels {
  pageOf: (page: number, total: number) => string
  pageInputLabel: string
  zoomIn: string
  zoomOut: string
  zoomReset: string
  fitWidth: string
  thumbnails: string
  searchPlaceholder: string
  searchNext: string
  searchPrev: string
  matchOf: (index: number, total: number) => string
  noMatches: string
  loading: string
  loadError: string
  detectQuestions: string
  selectionToolbar: SelectionToolbarLabels
}

export interface PdfReaderProps {
  /** `media://blob/<sha256>.pdf`. */
  src: string
  title: string
  highlights: readonly PdfHighlight[]
  labels: PdfReaderLabels
  /** 1-based. Absent (or out of range) starts at page 1 — `library.getSource`'s
   *  `lastLocator.page` when the source has been opened before. */
  initialPage?: number
  onPageChange?: (page: number) => void
  onHighlight?: (selection: PdfTextSelection) => void
  onCreateCard?: (selection: PdfTextSelection) => void
  /** Absent hides "Preguntar a la IA" (sub-phase 9.4's tutor is not built yet). */
  onAskAi?: (selection: PdfTextSelection) => void
  onCopyWithCitation?: (selection: PdfTextSelection) => void
}
