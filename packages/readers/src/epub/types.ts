import type { SelectionToolbarLabels } from '../annotate/types'

/** A persisted EPUB highlight — a CFI range, restored via `epub-cfi.ts`'s
 *  `resolveAnnotationCfi`. Mirrors `epubHighlightAnchorSchema` in `@retenia/ipc-contract`. */
export interface EpubHighlight {
  id: string
  cfi: string
  color: string
}

/** A text selection made in the reader, with everything needed to build a highlight or a
 *  card's citation from it. */
export interface EpubTextSelection {
  cfi: string
  quote: string
  /** Viewport coordinates (CSS pixels) to anchor the floating `SelectionToolbar` above —
   *  already translated out of the section iframe's own coordinate space. */
  toolbarPosition: { x: number; y: number }
}

export interface EpubReaderLabels {
  sectionOf: (index: number, total: number) => string
  tableOfContents: string
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

export interface EpubReaderProps {
  /** `media://blob/<sha256>.epub`. */
  src: string
  title: string
  highlights: readonly EpubHighlight[]
  labels: EpubReaderLabels
  /** A previously persisted CFI — `library.getSource`'s `lastLocator.cfi` when the source has
   *  been opened before. Absent starts at the first spine section. */
  initialCfi?: string
  onLocationChange?: (cfi: string) => void
  onHighlight?: (selection: EpubTextSelection) => void
  onCreateCard?: (selection: EpubTextSelection) => void
  /** Absent hides "Preguntar a la IA" (sub-phase 9.4's tutor is not built yet). */
  onAskAi?: (selection: EpubTextSelection) => void
  onCopyWithCitation?: (selection: EpubTextSelection) => void
}
