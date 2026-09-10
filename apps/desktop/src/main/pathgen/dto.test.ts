import { describe, expect, it } from 'vitest'
import { citedPageOf } from './dto'

/**
 * `firstCitation.page` is the half of "Reportar error" that makes it a deep link rather than
 * "open the book", and it is the one field of the lesson summary derived from two records that
 * nothing types together: the citation names a `source_id` and a `chunk_id`, and the page comes
 * off the chunk.
 */

const citation = { source_id: 'src-book', chunk_id: 'chunk-1' }
const chunk = (locator: unknown, sourceId = 'src-book') =>
  ({ sourceId, unitId: null, locator }) as Parameters<typeof citedPageOf>[1]

describe('citedPageOf()', () => {
  it('takes the page off the chunk the citation names', () => {
    expect(citedPageOf(citation, chunk({ page: 8, block_ids: ['b1'] }))).toBe(8)
  })

  it('is null when the chunk is gone or names another source', () => {
    expect(citedPageOf(citation, undefined)).toBeNull()
    // `lessonCitationSchema` types both ids as bare strings, so only `resolveCitations` writing
    // them from one fragment keeps them in step. Opening source A at source B's page is the
    // failure this rules out.
    expect(citedPageOf(citation, chunk({ page: 8 }, 'src-course'))).toBeNull()
  })

  it.each([
    ['a 0-based page from an importer', 0],
    ['a negative page', -3],
    ['a fractional page estimate', 2.5],
  ])('refuses %s rather than failing the whole answer', (_, page) => {
    // `parseSourceLocator` is permissive on purpose — the `locator` column is written by
    // ingestion parsers and, later, by importers of other apps' data — while the DTO is
    // `z.int().positive()` and `registerHandlers` validates the *whole* answer. One such page
    // anywhere in a path would turn `pathgen.getLessons` into INVALID_OUTPUT for every lesson
    // in it, so the panel would show an error instead of one lesson with no deep link.
    expect(citedPageOf(citation, chunk({ page }))).toBeNull()
  })

  it('is null for a source that has no pages at all', () => {
    // A transcript locates by timestamp. The link still opens the source, at its start.
    expect(citedPageOf(citation, chunk({ t_start: 750_000 }))).toBeNull()
  })
})
