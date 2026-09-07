import { Button } from '@retenia/ui'
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from './pdf-engine'
import { pageViewport } from './pdf-engine'

const THUMBNAIL_WIDTH = 120

interface PdfThumbnailProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  active: boolean
  onSelect: (page: number) => void
}

/** One page's thumbnail, rendered only once it scrolls into view — the pane that keeps a
 *  300-page book from rendering 300 canvases on open. */
function PdfThumbnail({ pdf, pageNumber, active, onSelect }: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
      },
      { rootMargin: '200px' },
    )
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void pdf.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      const unscaled = pageViewport(page, 1)
      const viewport = pageViewport(page, THUMBNAIL_WIDTH / unscaled.width)
      canvas.width = viewport.width
      canvas.height = viewport.height
      void page.render({ canvasContext: context, canvas, viewport }).promise.catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber, visible])

  return (
    <Button
      variant="ghost"
      onClick={() => onSelect(pageNumber)}
      aria-current={active ? 'true' : undefined}
      className={`flex h-auto flex-col items-center gap-1 rounded-md p-1.5 ${
        active ? 'ring-brand-500 ring-2' : ''
      }`}
      data-testid={`pdf-thumbnail-${pageNumber}`}
    >
      <canvas ref={canvasRef} style={{ width: THUMBNAIL_WIDTH }} className="bg-white shadow-sm" />
      <span className="text-muted text-xs tabular-nums">{pageNumber}</span>
    </Button>
  )
}

export interface PdfThumbnailsProps {
  pdf: PDFDocumentProxy
  pageCount: number
  currentPage: number
  onSelectPage: (page: number) => void
  label: string
}

/** The page-thumbnails pane: a scrollable strip of small renders, one per page. */
export function PdfThumbnails({
  pdf,
  pageCount,
  currentPage,
  onSelectPage,
  label,
}: PdfThumbnailsProps) {
  return (
    <nav aria-label={label} className="flex h-full flex-col items-center gap-2 overflow-y-auto p-2">
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
        <PdfThumbnail
          key={pageNumber}
          pdf={pdf}
          pageNumber={pageNumber}
          active={pageNumber === currentPage}
          onSelect={onSelectPage}
        />
      ))}
    </nav>
  )
}
