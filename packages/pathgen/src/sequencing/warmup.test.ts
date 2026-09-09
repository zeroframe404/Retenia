import { describe, expect, it } from 'vitest'
import { edge, node } from '../testing/graph-fixtures'
import { DEFAULT_SEQUENCING_LIMITS } from './types'
import { assignWarmups } from './warmup'

const limits = DEFAULT_SEQUENCING_LIMITS.warmup

function lessons(...ids: string[][]) {
  return ids.map((concept_ids) => ({ concept_ids }))
}

function nodesWith(importances: Record<string, number>) {
  return new Map(
    Object.entries(importances).map(([id, importance]) => [id, node(id, { importance })]),
  )
}

describe('assignWarmups()', () => {
  it('starts two lessons in, never repeats within the cooldown, and rotates round-robin', () => {
    const nodes = nodesWith({ a: 0.9, b: 0.9, c: 0.9, d: 0.9, e: 0.9, f: 0.9, g: 0.9 })
    const warmups = assignWarmups(
      lessons(['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g']),
      nodes,
      [],
      limits,
      0.5,
    )
    // L2 can only reach `a`; L3 could reach `a` again but it is on cooldown, so `b`; and so
    // on. By L5 `a` is eligible again but has been used once, so the never-used `d` wins.
    expect(warmups).toEqual([[], [], ['a'], ['b'], ['c'], ['d'], ['e']])
  })

  it('prefers a direct prerequisite of what the lesson teaches', () => {
    const nodes = nodesWith({ a: 0.9, b: 0.9, c: 0.9, d: 0.9 })
    const warmups = assignWarmups(
      lessons(['a'], ['b'], ['c'], ['d']),
      nodes,
      [edge('b', 'd')],
      limits,
      0.5,
    )
    // L3 teaches `d`, whose prerequisite `b` beats the otherwise-first `a`.
    expect(warmups).toEqual([[], [], ['a'], ['b']])
  })

  it('prefers important concepts and falls back to the rest when there are none', () => {
    const nodes = nodesWith({ a: 0.1, b: 0.9, c: 0.2, d: 0.2, e: 0.2 })
    const warmups = assignWarmups(
      lessons(['a'], ['b'], ['c'], ['d'], ['e']),
      nodes,
      [],
      limits,
      0.5,
    )
    // L2 can only reach `a` (unimportant, but the only candidate); L3 reaches `a` and `b` and
    // takes the important one; L4 reaches `a`, `b` (cooldown) and `c` — `c` is the only
    // candidate not on cooldown besides `a`, and neither is important, so the least-used
    // and most important of them wins.
    expect(warmups).toEqual([[], [], ['a'], ['b'], ['c']])
  })

  it('gives nothing to a path shorter than the minimum distance', () => {
    expect(assignWarmups(lessons(['a']), nodesWith({ a: 1 }), [], limits, 0.5)).toEqual([[]])
    expect(assignWarmups([], nodesWith({}), [], limits, 0.5)).toEqual([])
  })

  it('ignores edges that are not prerequisites and concepts the graph does not know', () => {
    const nodes = nodesWith({ a: 0.9, b: 0.9 })
    const warmups = assignWarmups(
      lessons(['a'], ['ghost'], ['b']),
      nodes,
      [edge('ghost', 'b', 0.9, 'RELATED_TO')],
      limits,
      0.5,
    )
    expect(warmups).toEqual([[], [], ['a']])
  })

  it('warms nothing up when every reachable concept is cooling down', () => {
    const nodes = nodesWith({ a: 0.9, c: 0.9, d: 0.9 })
    const warmups = assignWarmups(lessons(['a'], [], ['c'], ['d']), nodes, [], limits, 0.5)
    // L2 reaches only `a`; L3 reaches only `a` again, which is on cooldown.
    expect(warmups).toEqual([[], [], ['a'], []])
  })

  it('rates a concept the graph does not know as unimportant', () => {
    const nodes = nodesWith({ a: 0.1, b: 0.9, c: 0.9 })
    const warmups = assignWarmups(lessons(['a'], ['ghost'], ['b'], ['c']), nodes, [], limits, 0.5)
    // L3 reaches `a` (cooling down) and `ghost`; nothing important is left, so the ghost it is.
    expect(warmups).toEqual([[], [], ['a'], ['ghost']])
  })
})
