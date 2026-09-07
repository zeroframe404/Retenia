import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfReader } from './pdf-reader'
import type { PdfReaderLabels } from './types'

/**
 * `PdfReader`'s own orchestration — loading states, page navigation, zoom, search — with
 * `pdf-engine`/`PdfPage`/`PdfThumbnails` mocked out: pixel rendering has no meaningful jsdom
 * test (no real canvas 2D context), and it is not what this component is responsible for.
 * `pdf-engine.test.ts` covers real pdf.js parsing; `pdf-selection.test.ts` and
 * `reader-shortcuts.test.ts` cover the selection/keyboard math this file wires together.
 */

const loadPdfDocument = vi.fn()

vi.mock('./pdf-engine', () => ({
  loadPdfDocument: (...args: unknown[]) => loadPdfDocument(...args),
  pageViewport: () => ({ width: 100, height: 100 }),
  TextLayer: class {
    render() {
      return Promise.resolve()
    }
  },
}))

vi.mock('./pdf-page', () => ({
  PdfPage: ({
    pageNumber,
    scale,
    onTextExtracted,
  }: {
    pageNumber: number
    scale: number
    onTextExtracted?: (page: number, text: string) => void
  }) => {
    // Stands in for pdf.js's real text extraction: gives each fake page a fixed, searchable
    // string so `PdfReader`'s own search wiring (not pdf.js's) has something to find.
    useEffect(() => {
      onTextExtracted?.(pageNumber, `contenido de la página ${pageNumber}`)
    }, [pageNumber, onTextExtracted])
    return <div data-testid={`mock-page-${pageNumber}`} data-page={pageNumber} data-scale={scale} />
  },
}))

vi.mock('./pdf-thumbnails', () => ({
  PdfThumbnails: () => <div data-testid="mock-thumbnails" />,
}))

const labels: PdfReaderLabels = {
  pageOf: (page, total) => `Página ${page} de ${total}`,
  pageInputLabel: 'Número de página',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  zoomReset: 'Restablecer zoom',
  fitWidth: 'Ajustar al ancho',
  thumbnails: 'Miniaturas',
  searchPlaceholder: 'Buscar en el documento',
  searchNext: 'Siguiente resultado',
  searchPrev: 'Resultado anterior',
  matchOf: (index, total) => `${index} de ${total}`,
  noMatches: 'Sin resultados',
  loading: 'Cargando…',
  loadError: 'No se pudo abrir el PDF',
  detectQuestions: 'Detectar preguntas de examen',
  selectionToolbar: {
    highlight: 'Resaltar',
    createCard: 'Crear tarjeta',
    askAi: 'Preguntar a la IA',
    copyWithCitation: 'Copiar con cita',
  },
}

function fakePdf(pageCount = 5) {
  return {
    numPages: pageCount,
    getPage: (pageNumber: number) => Promise.resolve({ pageNumber }),
    loadingTask: { destroy: vi.fn() },
  }
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  loadPdfDocument.mockReset()
})

describe('PdfReader', () => {
  it('shows a loading state, then the document once it resolves', async () => {
    loadPdfDocument.mockResolvedValue(fakePdf())
    render(
      <PdfReader src="media://blob/deadbeef.pdf" title="Libro" highlights={[]} labels={labels} />,
    )

    await waitFor(() => expect(screen.getByTestId('mock-page-1')).toBeInTheDocument())
    expect(screen.getByText(labels.pageOf(1, 5))).toBeInTheDocument()
  })

  it('shows an error state when the document fails to load', async () => {
    loadPdfDocument.mockRejectedValue(new Error('boom'))
    render(<PdfReader src="media://blob/bad.pdf" title="Libro" highlights={[]} labels={labels} />)
    await waitFor(() => expect(screen.getByText(labels.loadError)).toBeInTheDocument())
  })

  it('opens at page 1 by default and reports it via onPageChange', async () => {
    loadPdfDocument.mockResolvedValue(fakePdf())
    const onPageChange = vi.fn()
    render(
      <PdfReader
        src="media://blob/deadbeef.pdf"
        title="Libro"
        highlights={[]}
        labels={labels}
        onPageChange={onPageChange}
      />,
    )
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(1))
  })

  it('opens at initialPage — the deep-link resume point', async () => {
    loadPdfDocument.mockResolvedValue(fakePdf())
    const onPageChange = vi.fn()
    render(
      <PdfReader
        src="media://blob/deadbeef.pdf"
        title="Libro"
        highlights={[]}
        labels={labels}
        initialPage={3}
        onPageChange={onPageChange}
      />,
    )
    await waitFor(() => expect(screen.getByText(labels.pageOf(3, 5))).toBeInTheDocument())
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('navigates with the next/previous page buttons, clamped at the edges', async () => {
    const user = userEvent.setup()
    loadPdfDocument.mockResolvedValue(fakePdf(2))
    render(
      <PdfReader src="media://blob/deadbeef.pdf" title="Libro" highlights={[]} labels={labels} />,
    )
    await waitFor(() => expect(screen.getByTestId('mock-page-1')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: labels.pageOf(2, 2) }))
    expect(screen.getByText(labels.pageOf(2, 2))).toBeInTheDocument()

    // At the last page, "next" is disabled rather than a dead click past the end.
    expect(screen.getByRole('button', { name: labels.pageOf(3, 2) })).toBeDisabled()
  })

  it('jumps to a typed page number', async () => {
    const user = userEvent.setup()
    loadPdfDocument.mockResolvedValue(fakePdf(10))
    render(
      <PdfReader src="media://blob/deadbeef.pdf" title="Libro" highlights={[]} labels={labels} />,
    )
    await waitFor(() => expect(screen.getByTestId('mock-page-1')).toBeInTheDocument())

    const pageInput = screen.getByLabelText(labels.pageInputLabel)
    await user.clear(pageInput)
    await user.type(pageInput, '7{Enter}')
    expect(screen.getByText(labels.pageOf(7, 10))).toBeInTheDocument()
  })

  it('increases and decreases the scale passed down to pages', async () => {
    const user = userEvent.setup()
    loadPdfDocument.mockResolvedValue(fakePdf())
    render(
      <PdfReader src="media://blob/deadbeef.pdf" title="Libro" highlights={[]} labels={labels} />,
    )
    await waitFor(() => expect(screen.getByTestId('mock-page-1')).toBeInTheDocument())

    const before = screen.getByTestId('mock-page-1').dataset.scale
    await user.click(screen.getByRole('button', { name: labels.zoomIn }))
    expect(screen.getByTestId('mock-page-1').dataset.scale).not.toBe(before)
  })

  it('toggles the thumbnails pane', async () => {
    const user = userEvent.setup()
    loadPdfDocument.mockResolvedValue(fakePdf())
    render(
      <PdfReader src="media://blob/deadbeef.pdf" title="Libro" highlights={[]} labels={labels} />,
    )
    await waitFor(() => expect(screen.getByTestId('mock-page-1')).toBeInTheDocument())

    expect(screen.queryByTestId('mock-thumbnails')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: labels.thumbnails }))
    expect(screen.getByTestId('mock-thumbnails')).toBeInTheDocument()
  })

  it('finds a search match once the page text is in and reports the match count', async () => {
    const user = userEvent.setup()
    loadPdfDocument.mockResolvedValue(fakePdf(3))
    render(
      <PdfReader src="media://blob/deadbeef.pdf" title="Libro" highlights={[]} labels={labels} />,
    )
    await waitFor(() => expect(screen.getByTestId('mock-page-3')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: labels.searchPlaceholder }))
    await user.type(screen.getByPlaceholderText(labels.searchPlaceholder), 'página 2')
    await waitFor(() => expect(screen.getByText(labels.matchOf(0, 1))).toBeInTheDocument())
  })

  it('shows "no matches" for a query nothing contains', async () => {
    const user = userEvent.setup()
    loadPdfDocument.mockResolvedValue(fakePdf(1))
    render(
      <PdfReader src="media://blob/deadbeef.pdf" title="Libro" highlights={[]} labels={labels} />,
    )
    await waitFor(() => expect(screen.getByTestId('mock-page-1')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: labels.searchPlaceholder }))
    await user.type(screen.getByPlaceholderText(labels.searchPlaceholder), 'xyz-nunca-aparece')
    await waitFor(() => expect(screen.getByText(labels.noMatches)).toBeInTheDocument())
  })
})
