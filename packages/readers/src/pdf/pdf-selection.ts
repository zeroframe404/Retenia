import type { FractionalRect } from '../annotate/types'
import type { PdfTextSelection } from './types'

/** The handful of `DOMRect` fields this module actually reads — accepts a real `DOMRect` or a
 *  plain object, which is what makes `toFractionalRect` testable without a live layout. */
export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/** A viewport-space rect → a rect relative to `container`, as a fraction (0–1) of its width
 *  and height — the anchor shape `pdfHighlightAnchorSchema` persists, resolution-independent
 *  so it draws correctly at any zoom level. */
export function toFractionalRect(rect: RectLike, container: RectLike): FractionalRect {
  const width = container.width === 0 ? 1 : container.width
  const height = container.height === 0 ? 1 : container.height
  return {
    x: (rect.left - container.left) / width,
    y: (rect.top - container.top) / height,
    width: rect.width / width,
    height: rect.height / height,
  }
}

/** The page container a selection sits in, and its own bounding rect (what
 *  `toFractionalRect` normalizes against) — `null` when the selection reaches outside any
 *  page (a stray click, or a selection dragged past the document's edge). */
export interface SelectionHost {
  pageNumber: number
  containerRect: RectLike
}

/**
 * A live text `Selection` → the reader's own `PdfTextSelection`, or `null` when there is
 * nothing to act on (collapsed, empty, or outside any page). `findHost` is injected so this
 * stays a pure function over plain data — `pdf-reader.tsx` supplies the real DOM lookup
 * (`element.closest('[data-page]')`), and this file's own tests supply a fake one.
 */
export function selectionToPdfSelection(
  selection: Selection | null,
  findHost: (node: Node) => SelectionHost | null,
): PdfTextSelection | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const text = selection.toString()
  if (text.trim().length === 0) return null

  const range = selection.getRangeAt(0)
  const host = findHost(range.commonAncestorContainer)
  if (host === null) return null

  const clientRects = Array.from(range.getClientRects())
  if (clientRects.length === 0) return null

  const rects = clientRects.map((rect) => toFractionalRect(rect, host.containerRect))
  const first = clientRects[0]
  if (first === undefined) return null

  return {
    page: host.pageNumber,
    rects,
    quote: text,
    toolbarPosition: { x: first.left + first.width / 2, y: first.top },
  }
}
