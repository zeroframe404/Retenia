import { describe, expect, it } from 'vitest'
import { parseGenerationConfig } from '../config/generation-config'
import { BOOK, COURSE, chunkRow, createMiniWorld, sourceRow } from '../testing/mini-world'
import { planChunks } from './plan-chunks'

describe('planChunks()', () => {
  const world = createMiniWorld()
  const bySource = new Map(
    world.sources.map((source) => [
      source.id,
      world.chunks.filter((chunk) => chunk.sourceId === source.id),
    ]),
  )

  it('orders the sources primary first and the chunks by ordinal, counting front matter', () => {
    const plan = planChunks(
      [...world.sources].reverse(),
      new Map([...bySource].map(([id, chunks]) => [id, [...chunks].reverse()])),
      parseGenerationConfig({ ...world.config, primarySourceId: COURSE }),
    )
    expect(plan.sources.map((source) => source.id)).toEqual([COURSE, BOOK])
    expect(plan.scoped.map((chunk) => chunk.id)).toEqual([
      's0',
      's1',
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
    ])
    expect(plan.extractable.map((chunk) => chunk.id)).not.toContain('c0')
    expect(plan.chunkIndex.get('c0')).toEqual({
      chunkId: 'c0',
      sourceId: BOOK,
      ordinal: 0,
      headingPath: 'Libro > Índice',
      isFrontmatter: true,
    })
    expect(plan).toMatchObject({ total: 10, frontmatter: 1, outOfScope: 0 })
  })

  it('applies the selected scope and counts what falls outside', () => {
    const plan = planChunks(
      world.sources,
      bySource,
      parseGenerationConfig({
        ...world.config,
        scope: { kind: 'selected', headingPaths: ['Libro > Cap. 1', 'Transcript'] },
      }),
    )
    expect(plan.scoped.map((chunk) => chunk.id)).toEqual(['c1', 'c2', 's0', 's1'])
    expect(plan.outOfScope).toBe(6)
    expect(plan.frontmatter).toBe(0)
  })

  it('skips a source with no chunks and a source that was not found', () => {
    const lonely = sourceRow('lonely', 'Lonely', 'text', null)
    const plan = planChunks(
      [lonely],
      new Map([['other', [chunkRow('x', 'other', 0, null, 'x')]]]),
      parseGenerationConfig({
        goal: 'g',
        level: 'l',
        primarySourceId: 'lonely',
        sourceIds: ['lonely', 'missing'],
      }),
    )
    expect(plan.sources.map((source) => source.id)).toEqual(['lonely'])
    expect(plan.chunksBySource.get('lonely')).toEqual([])
    expect(plan.extractable).toEqual([])
    expect(plan.total).toBe(0)
  })
})
