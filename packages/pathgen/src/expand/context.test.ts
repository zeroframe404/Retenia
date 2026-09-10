import type { Chunk, ChunkSearchHit } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import type { CoreLessonNode } from '../schemas/path-draft'
import { buildLessonContext, contextKeyParts } from './context'

function chunk(id: string, text: string, blockIds: readonly string[]): Chunk {
  return {
    id,
    sourceId: 'src-book',
    unitId: null,
    ordinal: 1,
    text,
    charStart: 0,
    charEnd: text.length,
    tokenCount: text.length,
    hash: `hash-${id}`,
    headingPath: `Libro > ${id}`,
    context: null,
    chunkKey: `key-${id}`,
    chunkingVersion: null,
    isFrontmatter: false,
    locator: { page: 3, block_ids: [...blockIds] },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    deviceId: 'device',
    version: 1,
  }
}

function hit(row: Chunk): ChunkSearchHit {
  return {
    chunk: row,
    score: 1,
    fusionScore: 1,
    sourceLocator: {
      unitId: null,
      page: 3,
      tStartMs: null,
      tEndMs: null,
      label: null,
      selector: null,
      blockIds: ['b9'],
    },
    blockIds: ['b9'],
  }
}

const lesson: CoreLessonNode = {
  id: 'L01',
  kind: 'core',
  title: 'La memoria de trabajo',
  concept_ids: ['c1', 'c2'],
  warmup_concept_ids: [],
  objectives: [{ text: 'Explicar la capacidad limitada', bloom: 'understand' }],
  prerequisite_lesson_ids: [],
  estimated_minutes: 10,
  source_refs: [
    {
      source_id: 'src-book',
      chunk_id: 'ch1',
      chunk_key: 'key-ch1',
      block_ids: ['b1', 'b2'],
      heading_path: 'Libro > ch1',
      ordinal: 1,
    },
    {
      source_id: 'src-book',
      chunk_id: 'ch2',
      chunk_key: 'key-ch2',
      block_ids: ['b3'],
      heading_path: 'Libro > ch2',
      ordinal: 2,
    },
  ],
  origin: 'model',
}

const chunks = new Map([
  ['ch1', chunk('ch1', 'a'.repeat(400), ['b1', 'b2'])],
  ['ch2', chunk('ch2', 'b'.repeat(400), ['b3'])],
])

/** One token per character, so a budget is a character count and the arithmetic is visible. */
const countTokens = (text: string): number => text.length

describe('buildLessonContext()', () => {
  it('cites the mapped chunks first, in the draft’s order', () => {
    const context = buildLessonContext(
      { lesson, chunks, retrieved: [], previous: [], glossary: [] },
      { countTokens },
    )
    expect(context.citable.map((fragment) => fragment.citeId)).toEqual(['B01', 'B02'])
    expect(context.citable.map((fragment) => fragment.chunkId)).toEqual(['ch1', 'ch2'])
    expect(context.citable[0]?.origin).toBe('mapped')
  })

  it('takes block ids from the chunk, not from the draft’s copy of them', () => {
    const stale = new Map(chunks)
    stale.set('ch1', chunk('ch1', 'a'.repeat(400), ['b1-renamed']))
    const context = buildLessonContext(
      { lesson, chunks: stale, retrieved: [], previous: [], glossary: [] },
      { countTokens },
    )
    expect(context.citable[0]?.blockIds).toEqual(['b1-renamed'])
  })

  it('never trims a mapped chunk to fit a retrieved one', () => {
    const extra = chunk('ch9', 'c'.repeat(400), ['b9'])
    const context = buildLessonContext(
      { lesson, chunks, retrieved: [hit(extra)], previous: [], glossary: [] },
      { countTokens, budgetTokens: 500 },
    )
    // The two mapped chunks are 800 tokens on their own and stay; the hit does not fit.
    expect(context.citable.map((fragment) => fragment.chunkId)).toEqual(['ch1', 'ch2'])
    expect(context.trimmed).toBe(1)
    // Over budget *and* trimming: the mapped pair alone already passed 500, which is the case
    // the budget cannot fix by dropping hits, so both are reported.
    expect(context.warnings.map((entry) => entry.code)).toEqual([
      'lesson_context_over_budget',
      'lesson_context_trimmed',
    ])
  })

  it('says when the mapped chunks alone are over budget, and still keeps every one of them', () => {
    const context = buildLessonContext(
      { lesson, chunks, retrieved: [], previous: [], glossary: [] },
      { countTokens, budgetTokens: 500 },
    )
    // Nothing is dropped — the point of the warning is that trimming is the wrong answer here
    // and the call is going to run long anyway, so something has to say so.
    expect(context.citable.map((fragment) => fragment.chunkId)).toEqual(['ch1', 'ch2'])
    expect(context.trimmed).toBe(0)
    expect(context.warnings.map((entry) => entry.code)).toEqual(['lesson_context_over_budget'])
  })

  it('charges the previous-lesson summary and the glossary to the same budget', () => {
    const extra = chunk('ch9', 'c'.repeat(400), ['b9'])
    const framing = {
      previous: [{ specId: 'L01', title: 'x'.repeat(50), objective: 'y'.repeat(50) }],
      glossary: [{ conceptId: 'c1', name: 'z'.repeat(50), definition: 'w'.repeat(50) }],
    }
    // 800 mapped + 400 retrieved fits a 1_200 budget exactly. The framing is 200 more tokens
    // of the same call, and leaving it uncounted was how a lesson went over a budget it had
    // already checked.
    expect(
      buildLessonContext(
        { lesson, chunks, retrieved: [hit(extra)], previous: [], glossary: [] },
        { countTokens, budgetTokens: 1_200 },
      ).trimmed,
    ).toBe(0)
    expect(
      buildLessonContext(
        { lesson, chunks, retrieved: [hit(extra)], ...framing },
        { countTokens, budgetTokens: 1_200 },
      ).trimmed,
    ).toBe(1)
  })

  it('adds a retrieved chunk when the budget allows it, and never twice', () => {
    const extra = chunk('ch9', 'c'.repeat(400), ['b9'])
    const context = buildLessonContext(
      { lesson, chunks, retrieved: [hit(extra), hit(extra)], previous: [], glossary: [] },
      { countTokens, budgetTokens: 5_000 },
    )
    expect(context.citable.map((fragment) => fragment.chunkId)).toEqual(['ch1', 'ch2', 'ch9'])
    expect(context.citable[2]?.origin).toBe('retrieved')
    expect(context.trimmed).toBe(0)
  })

  it('skips a mapped ref whose chunk is gone', () => {
    const context = buildLessonContext(
      {
        lesson,
        chunks: new Map([['ch2', chunks.get('ch2') as Chunk]]),
        retrieved: [],
        previous: [],
        glossary: [],
      },
      { countTokens },
    )
    expect(context.citable.map((fragment) => fragment.chunkId)).toEqual(['ch2'])
    expect(context.citable[0]?.citeId).toBe('B01')
  })
})

describe('contextKeyParts()', () => {
  it('names what was sent, so a different hit set is a different call', () => {
    const base = buildLessonContext(
      { lesson, chunks, retrieved: [], previous: [], glossary: [] },
      { countTokens },
    )
    const withHit = buildLessonContext(
      {
        lesson,
        chunks,
        retrieved: [hit(chunk('ch9', 'c'.repeat(10), ['b9']))],
        previous: [],
        glossary: [],
      },
      { countTokens, budgetTokens: 5_000 },
    )
    expect(contextKeyParts(base)).not.toEqual(contextKeyParts(withHit))
  })

  it('is stable across two builds of the same context', () => {
    const build = () =>
      contextKeyParts(
        buildLessonContext(
          { lesson, chunks, retrieved: [], previous: [], glossary: [] },
          { countTokens },
        ),
      )
    expect(build()).toEqual(build())
  })
})
