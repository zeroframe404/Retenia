import { useEffect, useMemo, useRef } from 'react'
import type { PDFPageProxy } from './pdf-engine'
import { pageViewport, TextLayer } from './pdf-engine'
import type { PdfHighlight } from './types'

export interface PdfPageProps {
  page: PDFPageProxy
  pageNumber: number
  scale: number
  highlights: readonly PdfHighlight[]
  /** Reports this page's plain text once extracted, for `pdf-search.ts`'s index. Also what
   *  drives the text layer — pdf.js needs the same `TextContent` either way, so one
   *  `getTextContent()` call serves both. */
  onTextExtracted?: (pageNumber: number, text: string) => void
}

/**
 * One rendered page: pdf.js's own canvas render plus its own `TextLayer` (real, selectable
 * text positioned exactly over the glyphs it draws — the same mechanism Chrome's built-in PDF
 * viewer uses), with a highlight overlay drawn on top from already-persisted annotations.
 *
 * Pixel-level rendering is not meaningfully unit-testable — jsdom's canvas has no real 2D
 * context — so this component's own test stubs `getContext`/`page.render`/`TextLayer` and
 * asserts the *calls*, not the drawn pixels; `docs/perf/rag.md`-style visual verification is
 * `pnpm run` + Playwright's job (`apps/desktop/e2e`).
 */
export function PdfPage({ page, pageNumber, scale, highlights, onTextExtracted }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const viewport = useMemo(() => pageViewport(page, scale), [page, scale])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    canvas.width = viewport.width
    canvas.height = viewport.height
    const task = page.render({ canvasContext: context, canvas, viewport })
    // `RenderingCancelledException` is pdf.js's own signal that `task.cancel()` below fired —
    // expected on every scroll/zoom that outruns a render, not a real failure.
    task.promise.catch(() => {})
    return () => task.cancel()
  }, [page, viewport])

  // biome-ignore lint/correctness/useExhaustiveDependencies: onTextExtracted is a stable callback from the reader (wrapped in useCallback there); including it would re-run extraction on every render for no benefit.
  useEffect(() => {
    const container = textLayerRef.current
    if (!container) return
    let cancelled = false
    container.replaceChildren()

    void page.getTextContent().then((textContent) => {
      if (cancelled) return
      onTextExtracted?.(
        pageNumber,
        textContent.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      )
      const textLayer = new TextLayer({ textContentSource: textContent, container, viewport })
      void textLayer.render()
    })

    return () => {
      cancelled = true
    }
  }, [page, viewport, pageNumber])

  return (
    <div
      className="relative mx-auto my-3 bg-white shadow-md"
      style={{ width: viewport.width, height: viewport.height }}
      data-testid={`pdf-page-${pageNumber}`}
      data-page={pageNumber}
    >
      {/* The canvas is purely visual; the text layer beneath is what makes the page's
          content accessible as real, selectable text. */}
      <canvas ref={canvasRef} />
      <div
        ref={textLayerRef}
        className="textLayer absolute inset-0 overflow-hidden"
        data-testid={`pdf-text-layer-${pageNumber}`}
      />
      {highlights
        .filter((highlight) => highlight.page === pageNumber)
        .flatMap((highlight) =>
          highlight.rects.map((rect) => (
            <span
              key={`${highlight.id}-${rect.x}-${rect.y}-${rect.width}-${rect.height}`}
              className="pointer-events-none absolute mix-blend-multiply"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
                backgroundColor: highlight.color,
              }}
            />
          )),
        )}
    </div>
  )
}
