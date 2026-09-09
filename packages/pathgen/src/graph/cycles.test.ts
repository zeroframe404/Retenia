import { describe, expect, it } from 'vitest'
import { breakCycles, type WeightedEdge } from './cycles'

const edge = (from: string, to: string, confidence: number): WeightedEdge => ({
  from,
  to,
  confidence,
})

describe('breakCycles()', () => {
  it('leaves a DAG untouched, in its original order', () => {
    const edges = [edge('a', 'b', 0.2), edge('b', 'c', 0.9), edge('a', 'c', 0.5)]
    const { kept, removed } = breakCycles(edges)
    expect(kept).toEqual(edges)
    expect(removed).toEqual([])
  })

  it('removes the weaker edge of a two-cycle, not the stronger one', () => {
    const strong = edge('a', 'b', 0.9)
    const weak = edge('b', 'a', 0.4)
    const { kept, removed } = breakCycles([strong, weak])
    expect(kept).toEqual([strong])
    expect(removed).toEqual([weak])
  })

  it('breaks a tie on confidence by (from, to) in code-unit order', () => {
    const { removed } = breakCycles([edge('b', 'a', 0.5), edge('a', 'b', 0.5)])
    expect(removed).toEqual([edge('a', 'b', 0.5)])
  })

  it('removes one edge per disjoint cycle, in order of the cycle’s smallest id', () => {
    const { removed, kept } = breakCycles([
      edge('m', 'n', 0.9),
      edge('n', 'm', 0.3),
      edge('a', 'b', 0.8),
      edge('b', 'a', 0.1),
    ])
    expect(removed).toEqual([edge('b', 'a', 0.1), edge('n', 'm', 0.3)])
    expect(kept).toEqual([edge('m', 'n', 0.9), edge('a', 'b', 0.8)])
  })

  it('needs two passes for a figure-eight and records the removals in order', () => {
    // a ⇄ b and b ⇄ c share b: one component, whose weakest edge is removed first; what is
    // left is still a cycle, so a second pass removes the next weakest.
    const { removed, kept } = breakCycles([
      edge('a', 'b', 0.9),
      edge('b', 'a', 0.2),
      edge('b', 'c', 0.8),
      edge('c', 'b', 0.3),
    ])
    expect(removed).toEqual([edge('b', 'a', 0.2), edge('c', 'b', 0.3)])
    expect(kept).toEqual([edge('a', 'b', 0.9), edge('b', 'c', 0.8)])
  })

  it('treats a self-loop as a cycle of its own', () => {
    const loop = edge('a', 'a', 0.7)
    const { kept, removed } = breakCycles([edge('a', 'b', 0.5), loop])
    expect(removed).toEqual([loop])
    expect(kept).toEqual([edge('a', 'b', 0.5)])
  })

  it('keeps the richer edge objects it was given', () => {
    const rich = [
      { from: 'a', to: 'b', confidence: 0.6, kind: 'PREREQ_OF' as const },
      { from: 'b', to: 'a', confidence: 0.6, kind: 'PREREQ_OF' as const },
    ]
    const { kept, removed } = breakCycles(rich)
    expect(kept[0]).toBe(rich[1])
    expect(removed[0]).toBe(rich[0])
  })

  it('does not depend on the order the edges were given in', () => {
    const edges = [
      edge('a', 'b', 0.9),
      edge('b', 'c', 0.4),
      edge('c', 'a', 0.7),
      edge('c', 'd', 0.5),
    ]
    const forward = breakCycles(edges)
    const backward = breakCycles([...edges].reverse())
    expect(forward.removed).toEqual(backward.removed)
    expect(new Set(forward.kept)).toEqual(new Set(backward.kept))
    expect(forward.removed).toEqual([edge('b', 'c', 0.4)])
  })

  it("breaks a tie on confidence and on 'from' by 'to'", () => {
    // Four equal edges in one component: (a, b) is the least by (confidence, from, to), and
    // the pass after it removes (a, c) — the only other edge starting at 'a'.
    const { removed } = breakCycles([
      edge('c', 'a', 0.5),
      edge('a', 'c', 0.5),
      edge('b', 'a', 0.5),
      edge('a', 'b', 0.5),
    ])
    expect(removed).toEqual([edge('a', 'b', 0.5), edge('a', 'c', 0.5)])
  })
})
