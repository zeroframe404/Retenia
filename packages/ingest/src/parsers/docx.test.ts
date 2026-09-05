import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createFakeParseContext } from '../../test/fake-parse-context'
import { countOmmlEquations, parseDocx } from './docx'

const fixturesDir = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'docx')

describe('parseDocx', () => {
  it('extracts a table alongside its surrounding paragraphs', async () => {
    const bytes = await readFile(join(fixturesDir, 'tables.docx'))
    const ctx = createFakeParseContext()

    const doc = await parseDocx({ bytes, fallbackTitle: 'tables.docx' }, ctx)

    expect(doc.kind).toBe('docx')
    expect(doc.meta.warnings).toEqual([])
    expect(doc.blocks.map((b) => b.type)).toEqual(['paragraph', 'table', 'paragraph'])
    expect(doc.blocks[0]?.text).toBe('Above')
    expect(doc.blocks[2]?.text).toBe('Below')

    const table = doc.blocks[1]
    expect(table?.text).toBe('Top left | Top right\nBottom left | Bottom right')
    expect(table?.html).toContain('<table>')

    // No headings in this fixture: everything lands in one synthetic preamble section.
    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0]?.blocks).toEqual(doc.blocks.map((b) => b.id))

    expect(doc).toMatchSnapshot()
  })

  it('extracts an embedded image as an asset and a figure block', async () => {
    const bytes = await readFile(join(fixturesDir, 'tiny-picture.docx'))
    const ctx = createFakeParseContext()

    const doc = await parseDocx({ bytes, fallbackTitle: 'tiny-picture.docx' }, ctx)

    expect(doc.assets).toHaveLength(1)
    expect(doc.assets[0]?.mime).toBe('image/png')
    expect(ctx.assets.has(doc.assets[0]?.blobSha256 ?? '')).toBe(true)

    const figure = doc.blocks.find((b) => b.type === 'figure')
    expect(figure).toBeDefined()
  })

  it('warns once when the document contains equations mammoth silently drops', async () => {
    const original = await readFile(join(fixturesDir, 'tables.docx'))
    const files = unzipSync(original)
    const documentXml = strFromU8(files['word/document.xml'] as Uint8Array)
    files['word/document.xml'] = strToU8(
      documentXml.replace(
        '<w:body>',
        '<w:body><w:p><m:oMath><m:r><m:t>x^2</m:t></m:r></m:oMath></w:p>',
      ),
    )
    const withEquation = zipSync(files)

    const doc = await parseDocx(
      { bytes: withEquation, fallbackTitle: 'tables.docx' },
      createFakeParseContext(),
    )

    expect(doc.meta.warnings).toEqual([
      '1 equation could not be converted and is not represented in this document',
    ])
  })
})

describe('countOmmlEquations', () => {
  it('counts <m:oMath> occurrences in word/document.xml', () => {
    const xml = `<w:document><w:body>
      <m:oMath><m:r>x</m:r></m:oMath>
      <w:p>text</w:p>
      <m:oMath><m:r>y</m:r></m:oMath>
    </w:body></w:document>`
    const zip = zipSync({ 'word/document.xml': strToU8(xml) })

    expect(countOmmlEquations(zip)).toBe(2)
  })

  it('is 0 for a document with no equations, and does not throw on garbage input', () => {
    const zip = zipSync({ 'word/document.xml': strToU8('<w:document/>') })
    expect(countOmmlEquations(zip)).toBe(0)
    expect(countOmmlEquations(new Uint8Array([1, 2, 3]))).toBe(0)
  })
})
