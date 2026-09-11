import { describe, expect, it } from 'vitest'
import { citedPageOf, perLessonUsdOf, toLessonQaSummaryDto } from './dto'

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

describe('perLessonUsdOf() and toLessonQaSummaryDto() (sub-phase 8.4)', () => {
  const stage = (usd: number, calls = 4) => ({
    calls,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    usd,
  })

  it('adds the four QA rows to what one more lesson costs', () => {
    const run = {
      estimate: {
        chunks: 0,
        concepts: 0,
        modules: 0,
        lessons: 4,
        p1: stage(0, 0),
        p2Outline: stage(0, 0),
        p2Modules: stage(0, 0),
        p3Lessons: stage(1),
        p4Activities: stage(1),
        p5Flashcards: stage(1),
        p6Faithfulness: stage(0.4),
        p7Judge: stage(0.4),
        p8Edit: stage(0.2, 1),
        qaRegenerate: stage(0.2, 1),
        usd: 4.2,
        lowUsd: 4,
        highUsd: 5,
        minutes: { low: 1, high: 2 },
        dispatch: 'sync',
        priced: { cheap: true, smart: true, judge: true },
      },
    } as never
    expect(perLessonUsdOf(run)).toBeCloseTo((3 + 0.4 + 0.4 + 0.2 + 0.2) / 4, 9)
  })

  it('is null before the gates ran and a summary after', () => {
    expect(toLessonQaSummaryDto(null)).toBeNull()
    expect(
      toLessonQaSummaryDto({
        faithfulness: 0.95,
        pedagogy_score: 4,
        coverage_ok: true,
        warnings: [],
        version: 1,
        run_id: 'run-1',
        at: '2026-09-09T12:00:00.000Z',
        mode: 'full',
        verdict: 'pass',
        reviewed: true,
        sources_count: 2,
        iterations: { edit: 0, regenerate: 0 },
        gates: [],
        criteria: [],
        findings: [],
        cost: { usd: 0, calls: 0, cache_hits: 2 },
        models: { p6: null, p7: null, p8: null },
      }),
    ).toEqual({
      faithfulness: 0.95,
      pedagogyScore: 4,
      coverageOk: true,
      verdict: 'pass',
      reviewed: true,
      sourcesCount: 2,
      findings: 0,
    })
  })
})
