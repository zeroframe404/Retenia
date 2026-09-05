import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeParseContext } from '../../test/fake-parse-context'
import { parsePptx } from './pptx'

const fixturesDir = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'pptx')

describe('parsePptx', () => {
  it('produces one section per slide, in presentation order, with page locators', async () => {
    const bytes = await readFile(join(fixturesDir, 'sample.pptx'))
    const ctx = createFakeParseContext()

    const doc = await parsePptx({ bytes, fallbackTitle: 'sample.pptx' }, ctx)

    expect(doc.kind).toBe('pptx')
    expect(doc.meta.warnings).toEqual([])
    expect(doc.meta.pageCount).toBe(2)
    expect(doc.sections.map((s) => s.title)).toEqual(['Cell Biology', 'Diagrams'])
    expect(doc.title).toBe('Cell Biology')

    for (const [i, section] of doc.sections.entries()) {
      for (const blockId of section.blocks) {
        const block = doc.blocks.find((b) => b.id === blockId)
        expect(block?.locator.page).toBe(i + 1)
      }
    }

    const slide1 = doc.sections[0]
    expect(slide1?.blocks).toHaveLength(4)
    const slide1Blocks = slide1?.blocks.map((id) => doc.blocks.find((b) => b.id === id))
    expect(slide1Blocks?.map((b) => b?.type)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'caption',
    ])
    expect(slide1Blocks?.[1]?.text).toBe('Cells are the basic building blocks of life.')
    // Speaker notes surface as a caption block, not mixed into the visible body text.
    expect(slide1Blocks?.[3]?.text).toBe('Remember to mention the cell membrane analogy.')

    const slide2 = doc.sections[1]
    const slide2Blocks = slide2?.blocks.map((id) => doc.blocks.find((b) => b.id === id))
    expect(slide2Blocks?.map((b) => b?.type)).toEqual(['heading', 'figure'])

    expect(doc.assets).toHaveLength(1)
    expect(doc.assets[0]?.mime).toBe('image/png')
    expect(ctx.assets.has(doc.assets[0]?.blobSha256 ?? '')).toBe(true)

    expect(doc).toMatchSnapshot()
  })
})
