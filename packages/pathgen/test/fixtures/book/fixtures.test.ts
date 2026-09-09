import { describe, expect, it } from 'vitest'
import { loadPathgenPrompts } from '../../../src/node'
import { extractChunkOutputSchema } from '../../../src/schemas/extraction'
import { buildBook, CHAPTERS, TRANSCRIPT } from './build-book'

/**
 * The record step: `vitest -u` rewrites the JSON beside this file, and a diff in it is a
 * change to the inputs of the end-to-end test that somebody has to look at.
 */
describe('the fixture book', () => {
  const book = buildBook(loadPathgenPrompts())

  it('has twelve chapters of three sections, front matter, an appendix and a transcript', () => {
    expect(CHAPTERS).toHaveLength(12)
    expect(CHAPTERS.every((chapter) => chapter.sections.length === 3)).toBe(true)
    expect(TRANSCRIPT).toHaveLength(8)
    expect(book.chunks.filter((chunk) => chunk.isFrontmatter)).toHaveLength(5)
    expect(book.chunks.filter((chunk) => chunk.sourceId === 'src-book')).toHaveLength(4 + 36 + 3)
    expect(book.chunks.filter((chunk) => chunk.sourceId === 'src-course')).toHaveLength(8)
    for (const output of Object.values(book.extractionsByKey)) {
      expect(extractChunkOutputSchema.safeParse(output).success).toBe(true)
    }
  })

  it('matches the committed rows and goldens', async () => {
    await expect(JSON.stringify(book.sources, null, 2)).toMatchFileSnapshot('./sources.json')
    await expect(JSON.stringify(book.chunks, null, 2)).toMatchFileSnapshot('./chunks.json')
    await expect(JSON.stringify(book.extractionsByKey, null, 2)).toMatchFileSnapshot(
      './p1-extractions.json',
    )
  })
})
