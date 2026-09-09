import { createFakeEmbeddingProvider } from '@retenia/core/testing'
import { describe, expect, it } from 'vitest'
import type { ExtractedConcept } from '../schemas/extraction'
import {
  type ChunkExtraction,
  candidatePairs,
  conceptIdFor,
  consolidateConcepts,
  type ExtractedChunk,
} from './consolidate'

const PRIMARY = 'src-book'
const SECONDARY = 'src-course'
const options = { primarySourceId: PRIMARY, sourceIds: [PRIMARY, SECONDARY] }

function chunk(chunkId: string, ordinal: number, sourceId = PRIMARY): ExtractedChunk {
  return {
    chunkId,
    chunkKey: `key-${chunkId}`,
    sourceId,
    ordinal,
    headingPath: `Libro > ${chunkId}`,
    blockIds: [`${chunkId}-b1`],
  }
}

function concept(
  canonical: string,
  definition: string,
  overrides: Partial<ExtractedConcept> = {},
): ExtractedConcept {
  return {
    canonical,
    aliases: [],
    definition,
    kind: 'concept',
    importance: 0.6,
    difficulty: 3,
    ...overrides,
  }
}

function extraction(
  at: ExtractedChunk,
  concepts: ExtractedConcept[],
  overrides: Partial<ChunkExtraction['output']> = {},
): ChunkExtraction {
  return {
    chunk: at,
    output: {
      concepts,
      claims: [],
      objectives: [],
      prerequisites_mentioned: [],
      figures: [],
      exercises: [],
      is_frontmatter_like: false,
      ...overrides,
    },
  }
}

const RETENTION = 'Descenso exponencial de la retención con el tiempo'

describe('consolidateConcepts()', () => {
  it('merges the same name, an alias and a near-identical meaning, and keeps every ref', async () => {
    const result = await consolidateConcepts(
      [
        extraction(
          chunk('c0', 0),
          [
            concept('Memoria de trabajo', 'Sistema de capacidad limitada', {
              importance: 0.9,
              aliases: ['memoria operativa'],
              difficulty: 2,
            }),
            concept('Curva del olvido', RETENTION, { importance: 0.5, difficulty: 4 }),
          ],
          { prerequisites_mentioned: ['atención', 'Memoria de trabajo'] },
        ),
        extraction(chunk('c3', 3), [
          concept('la memoria de trabajo.', 'Otra definición', { importance: 0.6, difficulty: 3 }),
          concept('Curva del olvido (Ebbinghaus)', RETENTION, { importance: 0.7, difficulty: 3 }),
        ]),
        extraction(chunk('s1', 1, SECONDARY), [
          concept('Memoria operativa', 'Working memory in the course', {
            importance: 0.95,
            difficulty: 5,
            kind: 'procedure',
          }),
        ]),
      ],
      { ...options, embeddings: createFakeEmbeddingProvider() },
    )

    expect(result.concepts.map((entry) => entry.canonical)).toEqual([
      'Memoria de trabajo',
      'Curva del olvido',
    ])
    const [memoria, curva] = result.concepts
    expect(memoria).toMatchObject({
      concept_id: conceptIdFor('memoria de trabajo'),
      // The course spelt it as a canonical, the book only as an alias: the canonical wins.
      aliases: ['Memoria operativa'],
      // The primary source's most important occurrence defines it, whatever the course says.
      definition: 'Sistema de capacidad limitada',
      kind: 'concept',
      difficulty: 3,
      first_primary_ordinal: 0,
      prerequisites_mentioned: ['atención'],
      occurrences: 3,
    })
    expect(memoria?.source_refs.map((ref) => ref.chunk_id)).toEqual(['c0', 'c3', 's1'])
    expect(memoria?.importance).toBeCloseTo(Math.min(1, 0.95 * (1 + 0.15 * Math.log(3)) + 0.05))
    expect(curva).toMatchObject({
      aliases: ['Curva del olvido (Ebbinghaus)'],
      definition: RETENTION,
      importance: 0.7 * (1 + 0.15 * Math.log(2)),
      difficulty: 4,
      first_primary_ordinal: 0,
    })
    expect(result.stats).toEqual({
      extractions: 3,
      frontmatterLike: 0,
      occurrences: 5,
      mergedByAlias: 2,
      mergedByEmbedding: 1,
      concepts: 2,
    })
    expect(result.embeddingModelId).toBe('fake-hash-768')
    expect(result.warnings).toEqual([])
  })

  it('never merges across kinds by meaning, and skips front-matter-like extractions', async () => {
    const result = await consolidateConcepts(
      [
        extraction(chunk('c0', 0), [
          concept('Curva del olvido', RETENTION),
          concept('Curva del olvido (mito)', RETENTION, { kind: 'misconception' }),
        ]),
        extraction(chunk('c1', 1), [concept('Índice', 'Lista de temas')], {
          is_frontmatter_like: true,
        }),
      ],
      { ...options, embeddings: createFakeEmbeddingProvider() },
    )
    expect(result.concepts.map((entry) => [entry.canonical, entry.kind])).toEqual([
      ['Curva del olvido', 'concept'],
      ['Curva del olvido (mito)', 'misconception'],
    ])
    expect(result.stats.frontmatterLike).toBe(1)
    expect(result.stats.mergedByEmbedding).toBe(0)
  })

  it('falls back to names alone without an embedding provider, and says so', async () => {
    const result = await consolidateConcepts(
      [
        extraction(chunk('c0', 0), [concept('Curva del olvido', RETENTION)]),
        extraction(chunk('c1', 1), [concept('Curva del olvido (Ebbinghaus)', RETENTION)]),
      ],
      options,
    )
    expect(result.concepts).toHaveLength(2)
    expect(result.embeddingModelId).toBeNull()
    expect(result.warnings).toEqual([
      { code: 'embeddings_unavailable', stage: 'consolidate', params: {} },
    ])
  })

  it('picks the most frequent spelling, the majority kind and the median difficulty', async () => {
    const result = await consolidateConcepts(
      [
        extraction(chunk('c0', 0), [
          concept('Sinapsis', 'Unión entre neuronas', { difficulty: 1 }),
        ]),
        extraction(chunk('c1', 1), [concept('sinapsis', 'Unión', { kind: 'fact', difficulty: 5 })]),
        extraction(chunk('c2', 2), [concept('SINAPSIS', 'Unión', { kind: 'fact', difficulty: 4 })]),
        extraction(chunk('c3', 3), [
          concept('Las sinapsis', 'Unión', { kind: 'fact', difficulty: 2 }),
        ]),
      ],
      options,
    )
    expect(result.concepts).toHaveLength(1)
    expect(result.concepts[0]).toMatchObject({
      canonical: 'Sinapsis',
      kind: 'fact',
      difficulty: 3,
      aliases: [],
      occurrences: 4,
    })
  })

  it('lets the canonical occurrence decide a tie on kind', async () => {
    const result = await consolidateConcepts(
      [
        extraction(chunk('c0', 0), [concept('Sinapsis', 'x', { kind: 'principle' })]),
        extraction(chunk('c1', 1), [concept('sinapsis', 'x', { kind: 'fact' })]),
      ],
      options,
    )
    expect(result.concepts[0]?.kind).toBe('principle')
  })

  it('sorts by the primary source, then importance, then id, with secondary-only concepts last', async () => {
    const result = await consolidateConcepts(
      [
        extraction(chunk('s0', 0, SECONDARY), [concept('Solo curso', 'x', { importance: 1 })]),
        extraction(chunk('c5', 5), [
          concept('Tarde', 'x', { importance: 0.3 }),
          concept('Tarde también', 'y', { importance: 0.8 }),
        ]),
        extraction(chunk('c2', 2), [concept('Temprano', 'x', { importance: 0.2 })]),
      ],
      options,
    )
    expect(result.concepts.map((entry) => entry.canonical)).toEqual([
      'Temprano',
      'Tarde también',
      'Tarde',
      'Solo curso',
    ])
    expect(result.concepts[3]?.first_primary_ordinal).toBe(Number.POSITIVE_INFINITY)
  })

  it('keeps apart two concepts whose names are too short to match, with distinct ids', async () => {
    const result = await consolidateConcepts(
      [
        extraction(chunk('c0', 0), [concept('AI', 'Artificial intelligence')]),
        extraction(chunk('c1', 1), [concept('AI', 'Adobe Illustrator')]),
      ],
      options,
    )
    expect(result.concepts.map((entry) => entry.concept_id)).toEqual([
      conceptIdFor('ai'),
      `${conceptIdFor('ai')}-2`,
    ])
  })

  it('drops a concept whose name normalises to nothing', async () => {
    const result = await consolidateConcepts(
      [extraction(chunk('c0', 0), [concept('---', 'nada'), concept('Algo', 'x')])],
      options,
    )
    expect(result.concepts.map((entry) => entry.canonical)).toEqual(['Algo'])
    expect(result.stats.occurrences).toBe(1)
  })

  it('is the same whatever order the extractions arrive in', async () => {
    const extractions = [
      extraction(chunk('c0', 0), [concept('Uno', 'a'), concept('Dos', 'b')]),
      extraction(chunk('c1', 1), [concept('dos', 'b'), concept('Tres', 'c')]),
      extraction(chunk('s0', 0, SECONDARY), [concept('Tres', 'c')]),
    ]
    const forward = await consolidateConcepts(extractions, options)
    const backward = await consolidateConcepts([...extractions].reverse(), options)
    expect(backward).toEqual(forward)
  })

  it('embeds in pages and blocks candidate pairs on shared tokens past the pairwise cap', async () => {
    const extractions = Array.from({ length: 7 }, (_, index) =>
      extraction(chunk(`c${index}`, index), [
        concept(`Concepto ${index}`, `Definición ${index}`),
        concept(`Otro concepto ${index}`, `Definición ${index}`),
      ]),
    )
    const result = await consolidateConcepts(extractions, {
      ...options,
      embeddings: createFakeEmbeddingProvider(),
      batchSize: 3,
      maxPairwise: 5,
    })
    expect(result.concepts.length).toBeGreaterThan(0)
  })
})

describe('candidatePairs()', () => {
  const occurrence = (index: number, normalizedCanonical: string) =>
    ({ index, normalizedCanonical }) as never

  it('compares every pair while the count is small', () => {
    const pairs = candidatePairs([occurrence(0, 'a'), occurrence(1, 'b'), occurrence(2, 'c')], 10)
    expect(pairs).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ])
  })

  it('compares only pairs that share a long token past the cap, each pair once', () => {
    const pairs = candidatePairs(
      [
        occurrence(0, 'memoria de trabajo'),
        occurrence(1, 'memoria episodica'),
        occurrence(2, 'trabajo memoria'),
        occurrence(3, 'olvido'),
      ],
      2,
    )
    expect(pairs).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ])
  })
})
