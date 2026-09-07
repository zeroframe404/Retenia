import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAnnotationCfi } from './epub-cfi'
import { EpubReader } from './epub-reader'
import type { EpubHighlight, EpubReaderLabels } from './types'
import { EPUB, type EpubLoader } from './vendor/foliate-js/epub.js'

/**
 * `EpubReader` end to end, against the real vendored `epub.js`/`epubcfi.js` (no mock of
 * either): only `openEpubBook` is replaced, with a fixture book built from an in-memory
 * loader instead of `makeHttpEpubLoader`'s zip/HTTP layer (already covered by
 * `epub-loader.test.ts`). Everything downstream — section rendering into the iframe, CFI
 * anchoring, highlight restoration — runs for real, which is what actually proves the
 * acceptance criterion: "EPUB CFI highlights restore at the right position".
 */

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const CONTENT_OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Fisiología</dc:title>
    <dc:identifier id="bookid">test-book</dc:identifier>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`

const CH1_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Capítulo 1</title></head>
<body>
<p id="p1">La consolidación de la memoria ocurre durante el sueño de ondas lentas.</p>
<p id="p2">El efecto de espaciamiento distribuye los repasos en el tiempo.</p>
</body>
</html>`

const CH2_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Capítulo 2</title></head>
<body>
<p id="p1">La retroalimentación inmediata corrige el error antes de que se afiance.</p>
</body>
</html>`

const FILES: Record<string, string> = {
  'META-INF/container.xml': CONTAINER_XML,
  'OEBPS/content.opf': CONTENT_OPF,
  'OEBPS/ch1.xhtml': CH1_XHTML,
  'OEBPS/ch2.xhtml': CH2_XHTML,
}

function fixtureLoader(): EpubLoader {
  return {
    loadText: async (href) => FILES[href] ?? null,
    loadBlob: async (href) => (FILES[href] === undefined ? null : new Blob([FILES[href]])),
    getSize: (href) => FILES[href]?.length ?? 0,
  }
}

async function openFixtureBook() {
  return new EPUB(fixtureLoader()).init()
}

const openEpubBook = vi.fn()

vi.mock('./epub-book', () => ({
  openEpubBook: (...args: unknown[]) => openEpubBook(...args),
}))

const labels: EpubReaderLabels = {
  sectionOf: (index, total) => `Sección ${index} de ${total}`,
  tableOfContents: 'Índice',
  searchPlaceholder: 'Buscar en el documento',
  searchNext: 'Siguiente resultado',
  searchPrev: 'Resultado anterior',
  matchOf: (index, total) => `${index} de ${total}`,
  noMatches: 'Sin resultados',
  loading: 'Cargando…',
  loadError: 'No se pudo abrir el EPUB',
  detectQuestions: 'Detectar preguntas de examen',
  selectionToolbar: {
    highlight: 'Resaltar',
    createCard: 'Crear tarjeta',
    askAi: 'Preguntar a la IA',
    copyWithCitation: 'Copiar con cita',
  },
}

beforeEach(() => {
  openEpubBook.mockReset()
})

describe('EpubReader', () => {
  it('shows an error state when the book fails to open', async () => {
    openEpubBook.mockRejectedValue(new Error('boom'))
    render(<EpubReader src="media://blob/bad.epub" title="Libro" highlights={[]} labels={labels} />)
    await waitFor(() => expect(screen.getByText(labels.loadError)).toBeInTheDocument())
  })

  it('renders the first section by default', async () => {
    const book = await openFixtureBook()
    openEpubBook.mockResolvedValue({ book, destroy: vi.fn() })
    render(
      <EpubReader src="media://blob/deadbeef.epub" title="Libro" highlights={[]} labels={labels} />,
    )
    await waitFor(() => expect(screen.getByText(labels.sectionOf(1, 2))).toBeInTheDocument())

    const iframe = screen.getByTestId('epub-section-frame') as HTMLIFrameElement
    await waitFor(() => expect(iframe.srcdoc).toContain('consolidación'))
  })

  it('opens at initialCfi — the second section', async () => {
    const book = await openFixtureBook()
    const section2 = book.sections[1]
    if (section2 === undefined) throw new Error('fixture missing section 2')
    openEpubBook.mockResolvedValue({ book, destroy: vi.fn() })

    render(
      <EpubReader
        src="media://blob/deadbeef.epub"
        title="Libro"
        highlights={[]}
        labels={labels}
        initialCfi={section2.cfi}
      />,
    )
    await waitFor(() => expect(screen.getByText(labels.sectionOf(2, 2))).toBeInTheDocument())
  })

  it('navigates to the next/previous section, clamped at the edges', async () => {
    const user = userEvent.setup()
    const book = await openFixtureBook()
    openEpubBook.mockResolvedValue({ book, destroy: vi.fn() })
    render(
      <EpubReader src="media://blob/deadbeef.epub" title="Libro" highlights={[]} labels={labels} />,
    )
    await waitFor(() => expect(screen.getByText(labels.sectionOf(1, 2))).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: labels.sectionOf(2, 2) }))
    await waitFor(() => expect(screen.getByText(labels.sectionOf(2, 2))).toBeInTheDocument())

    await waitFor(() =>
      expect(screen.getByRole('button', { name: labels.sectionOf(3, 2) })).toBeDisabled(),
    )
  })

  it('restores a persisted CFI highlight at the right position, across a fresh render', async () => {
    // "Across a restart": a fresh parse of the book, mirroring how `epub-cfi.test.ts` proves
    // a CFI survives being closed and reopened, rather than pointing back into the same book
    // instance that computed it.
    const writingBook = await openFixtureBook()
    const section = writingBook.sections[0]
    if (section === undefined) throw new Error('fixture missing section 1')
    const doc = await section.createDocument()
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let target: Text | null = null
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent ?? '').includes('espaciamiento')) {
        target = node as Text
        break
      }
    }
    if (target === null) throw new Error('fixture text not found')
    const offset = target.textContent?.indexOf('espaciamiento') ?? -1
    const range = doc.createRange()
    range.setStart(target, offset)
    range.setEnd(target, offset + 'espaciamiento'.length)
    const cfi = computeAnnotationCfi(section.cfi, range)

    const readingBook = await openFixtureBook()
    openEpubBook.mockResolvedValue({ book: readingBook, destroy: vi.fn() })

    const highlights: EpubHighlight[] = [{ id: 'h1', cfi, color: 'yellow' }]
    render(
      <EpubReader
        src="media://blob/deadbeef.epub"
        title="Libro"
        highlights={highlights}
        labels={labels}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('epub-section-frame')).toBeInTheDocument())
    const iframe = screen.getByTestId('epub-section-frame') as HTMLIFrameElement
    await waitFor(() => expect(iframe.srcdoc).toContain('retenia-highlight'))

    // Parses the serialized `srcdoc` the same way a browser would render it, rather than
    // relying on jsdom's `<iframe>` (which does not process `srcdoc` at all — see
    // `epub-reader.tsx`'s comment on why marking happens before serialization, not after).
    const rendered = new DOMParser().parseFromString(iframe.srcdoc, 'text/html')
    const mark = rendered.querySelector('mark.retenia-highlight')
    expect(mark?.textContent).toBe('espaciamiento')
    expect((mark as HTMLElement | null)?.dataset.highlightId).toBe('h1')
  })
})
