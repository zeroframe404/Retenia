import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeParseContext } from '../../test/fake-parse-context'
import { parseEpub } from './epub'

const fixturesDir = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'epub')

describe('parseEpub', () => {
  it('follows the spine, nests chapters by their own headings, and titles them from nav.xhtml', async () => {
    const bytes = await readFile(join(fixturesDir, 'sample.epub'))
    const ctx = createFakeParseContext()

    const doc = await parseEpub({ bytes, fallbackTitle: 'sample.epub' }, ctx)

    expect(doc.kind).toBe('epub')
    // dc:title/dc:language from content.opf win over the imported file's name.
    expect(doc.title).toBe('Sample Study Guide')
    expect(doc.language).toBe('en')
    expect(doc.meta.warnings).toEqual([])

    expect(doc.sections).toHaveLength(2)
    // Chapter titles come from nav.xhtml's toc, not just each chapter's own <h1>.
    expect(doc.sections.map((s) => s.title)).toEqual(['Introduction', 'Advanced Topics'])

    const introduction = doc.sections[0]
    expect(introduction?.children).toHaveLength(1)
    const introHeading = introduction?.children[0]
    expect(introHeading?.title).toBe('Introduction')
    expect(introHeading?.children.map((s) => s.title)).toEqual(['Why it works'])

    // Every block carries a "<chapter-index>/<element-index>" anchor.
    for (const block of doc.blocks) {
      expect(block.locator.anchor).toMatch(/^\d+\/\d+$/)
    }
    const chapter1Blocks = doc.blocks.filter((b) => b.locator.anchor?.startsWith('0/'))
    const chapter2Blocks = doc.blocks.filter((b) => b.locator.anchor?.startsWith('1/'))
    expect(chapter1Blocks.length).toBeGreaterThan(0)
    expect(chapter2Blocks.length).toBeGreaterThan(0)

    // The embedded cover image becomes an asset and a figure block referencing it by alt text.
    expect(doc.assets).toHaveLength(1)
    expect(doc.assets[0]?.mime).toBe('image/png')
    expect(ctx.assets.has(doc.assets[0]?.blobSha256 ?? '')).toBe(true)
    const figure = doc.blocks.find((b) => b.type === 'figure')
    expect(figure?.text).toBe('Review cycle diagram')

    const table = doc.blocks.find((b) => b.type === 'table')
    expect(table?.text).toBe('Stage | Interval\nLearning | 1 day\nReview | 6 days')

    expect(doc).toMatchSnapshot()
  })
})
