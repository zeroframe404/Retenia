import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeParseContext } from '../../test/fake-parse-context'
import { parsePdf } from './pdf'

const fixturesDir = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'pdf')

describe('parsePdf', () => {
  it('extracts a born-digital PDF with a correct section tree and page locators', async () => {
    const bytes = await readFile(join(fixturesDir, 'five-pages.pdf'))
    const ctx = createFakeParseContext()

    const doc = await parsePdf({ bytes, fallbackTitle: 'five-pages.pdf' }, ctx)

    expect(doc.kind).toBe('pdf')
    expect(doc.meta.pageCount).toBe(5)
    expect(doc.meta.needsOcr).toBe(false)
    expect(doc.meta.ocrPages).toBeUndefined()
    expect(doc.language).toBe('en')
    // The largest heading on the first page wins over the fallback filename.
    expect(doc.title).toBe('Chapter 1: Introduction')

    // Two distinct heading sizes (24pt/18pt) nest as two section levels.
    expect(doc.sections.map((s) => s.title)).toEqual([
      'Chapter 1: Introduction',
      'Chapter 2: Methods',
      'Chapter 3: Conclusion',
    ])
    expect(doc.sections[0]?.children.map((s) => s.title)).toEqual(['1.1 Background'])
    expect(doc.sections[1]?.children.map((s) => s.title)).toEqual(['2.1 Data collection'])
    expect(doc.sections[2]?.children).toEqual([])

    // Every block's locator names the PDF page it actually came from (1-based, verified
    // against the fixture's own page order — this is the acceptance criterion).
    const expectedPages = [1, 2, 3, 4, 5]
    expect(doc.blocks.map((b) => b.locator.page)).toEqual(expectedPages)
    for (const block of doc.blocks) {
      expect(block.locator.bbox).toHaveLength(4)
    }

    expect(doc.blocks[0]?.text).toContain('Spaced repetition schedules review')
    expect(doc.blocks[4]?.text).toContain('the rest of the document builds on it')

    expect(doc).toMatchSnapshot()
  })

  it('flags a scanned page (no extractable text) as needsOcr and renders it to an asset', async () => {
    const bytes = await readFile(join(fixturesDir, 'scanned-page.pdf'))
    const ctx = createFakeParseContext()

    const doc = await parsePdf({ bytes, fallbackTitle: 'scanned-page.pdf' }, ctx)

    expect(doc.meta.pageCount).toBe(1)
    expect(doc.meta.needsOcr).toBe(true)
    expect(doc.meta.ocrPages).toEqual([1])
    expect(doc.blocks).toEqual([])
    expect(doc.sections).toEqual([])

    // A page flagged for OCR gets a rendered PNG asset, so there is something to show for it.
    expect(doc.assets).toHaveLength(1)
    expect(doc.assets[0]?.mime).toBe('image/png')
    expect(doc.assets[0]?.kind).toBe('thumbnail')
    expect(doc.assets[0]?.locator?.page).toBe(1)
    expect(ctx.assets.has(doc.assets[0]?.blobSha256 ?? '')).toBe(true)
  })
})
