import { describe, expect, it } from 'vitest'
import { compareCfi, computeAnnotationCfi, resolveAnnotationCfi } from './epub-cfi'
import { EPUB, type EpubLoader } from './vendor/foliate-js/epub.js'

/**
 * The CFI round trip is the acceptance criterion `docs/spec/07-architecture.md`'s sub-phase
 * 6.6 names explicitly: "EPUB CFI highlights restore at the right position". This exercises
 * the real vendored `epub.js`/`epubcfi.js` — no mocking of the CFI math — over a minimal but
 * genuine EPUB structure (container → OPF → one XHTML section).
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

/** An in-memory loader over the fixture above — the same `EpubLoader` shape
 *  `epub-loader.ts`'s `makeHttpEpubLoader` builds over `media://`, minus the network. */
function fixtureLoader(): EpubLoader {
  return {
    loadText: async (href) => FILES[href] ?? null,
    loadBlob: async (href) => (FILES[href] === undefined ? null : new Blob([FILES[href]])),
    getSize: (href) => FILES[href]?.length ?? 0,
  }
}

async function openFixtureBook(): Promise<EPUB> {
  return new EPUB(fixtureLoader()).init()
}

/** Finds the text node containing `needle` inside `doc` and returns a collapsed `Range` right
 *  before it — enough to prove a CFI resolves to the correct paragraph and offset. */
function rangeAt(doc: Document, needle: string): Range {
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    const offset = text.indexOf(needle)
    if (offset !== -1) {
      const range = doc.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + needle.length)
      return range
    }
  }
  throw new Error(`fixture text not found: ${needle}`)
}

describe('EPUB CFI round trip (vendored foliate-js)', () => {
  it('computes a CFI for a selection and resolves it back to the same section and text', async () => {
    const book = await openFixtureBook()
    const section = book.sections[0]
    if (section === undefined) throw new Error('fixture has no sections')

    const doc = await section.createDocument()
    const selection = rangeAt(doc, 'espaciamiento')
    const cfi = computeAnnotationCfi(section.cfi, selection)
    expect(cfi.startsWith('epubcfi(')).toBe(true)

    // A fresh parse of the same content stands in for "closed and reopened": the CFI has to
    // point to the right place in a document object the first parse never touched.
    const reopened = await openFixtureBook()
    const resolved = resolveAnnotationCfi(reopened, cfi)
    expect(resolved?.sectionIndex).toBe(0)

    const reopenedDoc = await reopened.sections[0]?.createDocument()
    if (reopenedDoc === undefined) throw new Error('unreachable')
    const range = resolved?.resolveRange(reopenedDoc)
    expect(range?.toString()).toBe('espaciamiento')
  })

  it('resolves a highlight in the second section to index 1, not 0', async () => {
    const book = await openFixtureBook()
    const section = book.sections[1]
    if (section === undefined) throw new Error('fixture has no second section')

    const doc = await section.createDocument()
    const selection = rangeAt(doc, 'retroalimentación')
    const cfi = computeAnnotationCfi(section.cfi, selection)

    const resolved = resolveAnnotationCfi(book, cfi)
    expect(resolved?.sectionIndex).toBe(1)
  })

  it('returns null for a CFI naming no section in this book', async () => {
    const book = await openFixtureBook()
    const resolved = resolveAnnotationCfi(book, 'epubcfi(/6/99!/4/2,/1:0,/1:5)')
    expect(resolved).toBeNull()
  })

  it('orders two CFIs in the same section by document position', async () => {
    const book = await openFixtureBook()
    const section = book.sections[0]
    if (section === undefined) throw new Error('fixture has no sections')
    const doc = await section.createDocument()

    const first = computeAnnotationCfi(section.cfi, rangeAt(doc, 'consolidación'))
    const second = computeAnnotationCfi(section.cfi, rangeAt(doc, 'espaciamiento'))

    expect(compareCfi(first, second)).toBeLessThan(0)
    expect(compareCfi(second, first)).toBeGreaterThan(0)
  })
})
