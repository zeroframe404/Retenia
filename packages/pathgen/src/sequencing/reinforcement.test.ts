import { describe, expect, it } from 'vitest'
import { node } from '../testing/graph-fixtures'
import { buildReinforcement, interleaveEvenly } from './reinforcement'
import { DEFAULT_SEQUENCING_LIMITS } from './types'

const limits = DEFAULT_SEQUENCING_LIMITS

function ids(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`)
}

function build(own: number, pool: number, seed = 'seed') {
  const ownIds = ids('o', own)
  const poolIds = ids('p', pool)
  const nodes = new Map(
    [...ownIds, ...poolIds].map((id, index) => [id, node(id, { importance: 1 - index * 0.01 })]),
  )
  const homeIndex = new Map(poolIds.map((id, index) => [id, index]))
  return buildReinforcement({
    moduleId: 'M03',
    ownConceptIds: ownIds,
    earlierPool: poolIds,
    nodes,
    homeIndex,
    limits,
    seed,
  })
}

describe('interleaveEvenly()', () => {
  it('spreads the earlier concepts through the own ones, so any prefix that can hold one does', () => {
    expect(interleaveEvenly(['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['x', 'y', 'z'])).toEqual([
      'a',
      'b',
      'c',
      'x',
      'd',
      'e',
      'y',
      'f',
      'g',
      'z',
    ])
    expect(interleaveEvenly(['a', 'b'], [])).toEqual(['a', 'b'])
    expect(interleaveEvenly([], ['x'])).toEqual(['x'])
    expect(interleaveEvenly([], [])).toEqual([])
    const long = interleaveEvenly(
      Array.from({ length: 35 }, (_, index) => `o${index}`),
      Array.from({ length: 15 }, (_, index) => `e${index}`),
    )
    expect(long).toHaveLength(50)
    expect(long.slice(0, 10).filter((id) => id.startsWith('e'))).toHaveLength(3)
  })
})

describe('buildReinforcement()', () => {
  it('sizes the node from the module’s concepts inside the 10–15 band', () => {
    expect([6, 8, 10, 12, 30].map((own) => build(own, 0).item_count)).toEqual([10, 10, 13, 15, 15])
    expect(build(10, 0).estimated_minutes).toBe(13)
  })

  it('draws no earlier concept for the first module and mixes its own', () => {
    const first = build(4, 0)
    expect(first).toMatchObject({ id: 'M03.reinf', kind: 'reinforcement', module_id: 'M03' })
    expect(first.earlier_concept_ids).toEqual([])
    expect([...first.concept_ids].sort()).toEqual(ids('o', 4))
  })

  it('draws about 30 % from the most important earlier concepts', () => {
    const later = build(7, 10)
    expect(later.earlier_concept_ids).toHaveLength(3)
    // From the top six of the pool by importance (`p0`…`p5`), never from the rest.
    for (const id of later.earlier_concept_ids) expect(ids('p', 6)).toContain(id)
    expect([...later.concept_ids].sort()).toEqual(
      [...ids('o', 7), ...later.earlier_concept_ids].sort(),
    )
    // Interleaved, not clustered: an earlier concept within the first four items.
    expect(later.concept_ids.slice(0, 4).some((id) => id.startsWith('p'))).toBe(true)
  })

  it('is capped by the pool, and takes the whole pool when it is small', () => {
    const small = build(7, 2)
    expect(small.earlier_concept_ids.sort()).toEqual(['p0', 'p1'])
  })

  it('is deterministic for a seed and changes with it', () => {
    expect(build(7, 10, 'one')).toEqual(build(7, 10, 'one'))
    expect(build(7, 10, 'one').concept_ids).not.toEqual(build(7, 10, 'two').concept_ids)
  })

  it('ranks the pool by importance, then by where it was taught, then by id', () => {
    const nodes = new Map(['x', 'y', 'z', 'w'].map((id) => [id, node(id, { importance: 0.5 })]))
    const result = buildReinforcement({
      moduleId: 'M02',
      ownConceptIds: ['o0', 'o1', 'o2'],
      earlierPool: ['z', 'y', 'x', 'w'],
      nodes,
      homeIndex: new Map([
        ['x', 3],
        ['y', 1],
        ['z', 1],
      ]),
      limits,
      seed: 's',
    })
    // round(3 · 3/7) = 1 earlier concept, shortlisted from the top two: `y` and `z` tie on
    // importance and home, so the id decides — `y` first, then `z`; `w` has no home and
    // sorts last, `x` was taught later.
    expect(['y', 'z']).toContain(result.earlier_concept_ids[0])
  })

  it('treats a pool concept the graph does not know as unimportant', () => {
    const result = buildReinforcement({
      moduleId: 'M02',
      ownConceptIds: ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6'],
      earlierPool: ['ghost', 'x'],
      nodes: new Map([['x', node('x', { importance: 0.5 })]]),
      homeIndex: new Map([['x', 0]]),
      limits,
      seed: 's',
    })
    expect(result.earlier_concept_ids).toHaveLength(2)
    expect(result.earlier_concept_ids).toContain('x')
  })
})
