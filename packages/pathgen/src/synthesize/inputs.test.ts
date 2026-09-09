import { describe, expect, it } from 'vitest'
import type { ConsolidatedConcept } from '../consolidate'
import {
  buildConceptBlock,
  buildSynthesisInputs,
  buildToc,
  conceptLine,
  conceptSetHash,
  firstHeadingOf,
  type TocChunk,
  type TocSource,
  tocHash,
} from './inputs'

const book: TocSource = {
  id: 'book',
  title: 'Memoria y aprendizaje',
  kind: 'pdf',
  language: 'es',
  primary: true,
}
const course: TocSource = {
  id: 'course',
  title: 'Course',
  kind: 'video',
  language: null,
  primary: false,
}

function toc(
  sourceId: string,
  ordinal: number,
  headingPath: string | null,
  page?: number,
  isFrontmatter = false,
): TocChunk {
  return {
    sourceId,
    ordinal,
    headingPath,
    isFrontmatter,
    unitId: null,
    locator: page === undefined ? null : { page },
  }
}

function concept(
  id: string,
  canonical: string,
  importance: number,
  overrides: Partial<ConsolidatedConcept> = {},
): ConsolidatedConcept {
  return {
    concept_id: id,
    canonical,
    aliases: [],
    definition: `Definición de ${canonical}`,
    kind: 'concept',
    difficulty: 2,
    importance,
    source_refs: [
      {
        source_id: 'book',
        chunk_id: 'c0',
        chunk_key: 'k0',
        block_ids: [],
        heading_path: 'Libro > Cap. 1 > 1.1 Intro',
        ordinal: 0,
      },
    ],
    first_primary_ordinal: 0,
    prerequisites_mentioned: [],
    occurrences: 1,
    ...overrides,
  }
}

describe('buildToc()', () => {
  it('lists each source with its headings nested, paged and counted, front matter left out', () => {
    const chunks = [
      toc('book', 0, 'Libro > Índice', 1, true),
      toc('book', 1, 'Libro > Cap. 1 > 1.1 Intro', 3),
      toc('book', 2, 'Libro > Cap. 1 > 1.1 Intro', 4),
      toc('book', 3, 'Libro > Cap. 1 > 1.2 Más > Muy hondo', 6),
      toc('book', 4, 'Libro > Cap. 2', 9),
      toc('course', 0, null),
      toc('course', 1, 'Transcript > Segment 1'),
    ]
    expect(buildToc([book, course], chunks)).toBe(
      [
        '# Memoria y aprendizaje (pdf, es) — 4 fragments [primary]',
        '- Libro',
        '  - Cap. 1',
        '    - 1.1 Intro (pp. 3–4, 2 fragments)',
        '    - 1.2 Más (p. 6, 1 fragment)',
        '  - Cap. 2 (p. 9, 1 fragment)',
        '# Course (video) — 2 fragments',
        '- (no heading) (1 fragment)',
        '- Transcript',
        '  - Segment 1 (1 fragment)',
      ].join('\n'),
    )
  })

  it('caps the number of headings and says how many it left out', () => {
    const chunks = Array.from({ length: 405 }, (_, index) =>
      toc('book', index, `Libro > Heading ${index}`),
    )
    const text = buildToc([book], chunks)
    expect(text.split('\n')).toHaveLength(1 + 400 + 1)
    // 'Libro' plus 405 headings is 406 entries.
    expect(text.endsWith('… 6 more headings omitted')).toBe(true)
  })

  it('is byte-identical for the same chunks in another order', () => {
    const chunks = [toc('book', 1, 'Libro > B', 2), toc('book', 0, 'Libro > A', 1)]
    expect(buildToc([book], chunks)).toBe(buildToc([book], [...chunks].reverse()))
    expect(buildToc([book], chunks)).toContain('- A (p. 1, 1 fragment)\n  - B (p. 2, 1 fragment)')
  })
})

describe('conceptLine() and firstHeadingOf()', () => {
  it('writes one line per concept with the last two heading segments and the aliases', () => {
    const entry = concept('c_1', 'Memoria | de trabajo', 0.834, {
      aliases: ['memoria operativa', 'WM'],
      difficulty: 3,
    })
    expect(conceptLine(entry)).toBe(
      'c_1 | Memoria / de trabajo | concept | imp 0.83 | diff 3 | first: "Cap. 1 > 1.1 Intro" | aliases: memoria operativa, WM',
    )
    expect(firstHeadingOf({ source_refs: [] })).toBe('—')
    expect(
      firstHeadingOf({
        source_refs: [
          {
            source_id: 's',
            chunk_id: 'c',
            chunk_key: null,
            block_ids: [],
            heading_path: null,
            ordinal: 0,
          },
        ],
      }),
    ).toBe('—')
  })
})

describe('buildConceptBlock()', () => {
  const concepts = [
    concept('c_a', 'A', 0.9),
    concept('c_b', 'B', 0.2),
    concept('c_c', 'C', 0.6),
    concept('c_d', 'D', 0.3),
    concept('c_e', 'E', 0.1),
  ]

  it('keeps every important concept and fills with the rest by importance, in book order', () => {
    const block = buildConceptBlock(concepts, { countTokens: () => 10, maxTokens: 45 })
    // 4 lines × 11 tokens = 44 fit; the fifth (E, the least important) does not.
    expect(block.included.map((entry) => entry.concept_id)).toEqual(['c_a', 'c_b', 'c_c', 'c_d'])
    expect(block.omitted).toBe(1)
    expect(block.text.split('\n')).toHaveLength(4)
  })

  it('keeps the important ones even past the budget, and stops at the concept cap', () => {
    const tight = buildConceptBlock(concepts, { countTokens: () => 100, maxTokens: 10 })
    expect(tight.included.map((entry) => entry.concept_id)).toEqual(['c_a', 'c_c'])
    const capped = buildConceptBlock(concepts, { maxConcepts: 1 })
    expect(capped.included.map((entry) => entry.concept_id)).toEqual(['c_a'])
    expect(capped.omitted).toBe(4)
  })

  it('handles no concepts', () => {
    expect(buildConceptBlock([])).toEqual({ text: '', included: [], omitted: 0, tokens: 0 })
  })
})

describe('the hashes', () => {
  it('change with the TOC text and with any listed concept’s importance, kind or difficulty', () => {
    expect(tocHash('a')).toHaveLength(64)
    expect(tocHash('a')).not.toBe(tocHash('b'))
    const base = [concept('c_a', 'A', 0.9)]
    expect(conceptSetHash(base)).toBe(conceptSetHash([concept('c_a', 'Renamed', 0.9)]))
    expect(conceptSetHash(base)).not.toBe(conceptSetHash([concept('c_a', 'A', 0.8)]))
    expect(conceptSetHash(base)).not.toBe(
      conceptSetHash([concept('c_a', 'A', 0.9, { kind: 'fact' })]),
    )
    expect(conceptSetHash(base)).not.toBe(
      conceptSetHash([concept('c_a', 'A', 0.9, { difficulty: 5 })]),
    )
  })

  it('assemble into the inputs of both P2 calls', () => {
    const inputs = buildSynthesisInputs(
      [book],
      [toc('book', 0, 'Libro > Cap. 1', 1)],
      [concept('c_a', 'A', 0.9)],
    )
    expect(inputs.toc).toContain('# Memoria y aprendizaje')
    expect(inputs.concepts.included).toHaveLength(1)
    expect(inputs.tocHash).toBe(tocHash(inputs.toc))
    expect(inputs.conceptSetHash).toBe(conceptSetHash(inputs.concepts.included))
  })
})
