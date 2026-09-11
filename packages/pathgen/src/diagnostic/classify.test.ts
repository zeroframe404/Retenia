import { describe, expect, it } from 'vitest'
import { classifyModules, type ModuleEstimate } from './classify'
import { sigmoid } from './elo'
import type { ModuleGraph } from './types'

/** A root/child pair: 'A' has no prerequisites, 'B' depends on 'A'. */
const graph: ModuleGraph = {
  modules: [
    { id: 'A', sectionId: 'S', ordinal: 0, importance: 0.5, conceptIds: [] },
    { id: 'B', sectionId: 'S', ordinal: 1, importance: 0.5, conceptIds: [] },
  ],
  parents: new Map([
    ['A', []],
    ['B', ['A']],
  ]),
  children: new Map([
    ['A', ['B']],
    ['B', []],
  ]),
  depth: new Map([
    ['A', 0],
    ['B', 1],
  ]),
}

function estimate(overrides: Partial<ModuleEstimate>): ModuleEstimate {
  return {
    theta: 0,
    answered: 0,
    served: 0,
    inferred: 0,
    sureApplyCorrect: false,
    fixed: null,
    fixedSource: null,
    evidence: [],
    ...overrides,
  }
}

describe('classifyModules()', () => {
  it('reports a fixed module’s own status and source, settled', () => {
    const estimates = new Map([
      ['A', estimate({ theta: 0, fixed: 'known', fixedSource: 'self_declared' })],
    ])
    const result = classifyModules(graph, estimates)
    expect(result.get('A')).toEqual({
      status: 'known',
      settled: true,
      p: sigmoid(0),
      source: 'self_declared',
    })
  })

  it('falls back to source "diagnostic" for a fixed module with no fixedSource', () => {
    const estimates = new Map([['A', estimate({ fixed: 'unknown', fixedSource: null })]])
    expect(classifyModules(graph, estimates).get('A')?.source).toBe('diagnostic')
  })

  it('classifies known: P ≥ 0.8 and answered ≥ 2, no apply item needed', () => {
    const estimates = new Map([['A', estimate({ theta: 2, answered: 2 })]])
    const result = classifyModules(graph, estimates)
    expect(result.get('A')).toEqual({
      status: 'known',
      settled: true,
      p: sigmoid(2),
      source: 'diagnostic',
    })
  })

  it('does not classify known on P ≥ 0.8 with answered = 1 and no apply item: partial, unsettled', () => {
    const estimates = new Map([
      ['A', estimate({ theta: 2, answered: 1, inferred: 0, served: 1, sureApplyCorrect: false })],
    ])
    const result = classifyModules(graph, estimates)
    expect(result.get('A')).toEqual({
      status: 'partial',
      settled: false,
      p: sigmoid(2),
      source: 'diagnostic',
    })
  })

  it('classifies known via a sure, correct apply item when every parent is known (root module)', () => {
    // 'A' is a root: parentsKnown is vacuously true, so the apply rule alone is enough.
    const estimates = new Map([
      ['A', estimate({ theta: 2, answered: 0, inferred: 0, sureApplyCorrect: true })],
    ])
    const result = classifyModules(graph, estimates)
    expect(result.get('A')?.status).toBe('known')
  })

  it('does not classify known via the apply rule when a parent is not known', () => {
    const estimates = new Map([
      ['A', estimate({ theta: -1, answered: 1 })], // A: p < 0.4 ⇒ unknown, not known.
      ['B', estimate({ theta: 2, answered: 0, inferred: 1, sureApplyCorrect: true })],
    ])
    const result = classifyModules(graph, estimates)
    expect(result.get('A')?.status).toBe('unknown')
    // B would qualify for "known" via the apply rule if its parent were known; it is not.
    expect(result.get('B')?.status).not.toBe('known')
    expect(result.get('B')?.status).toBe('partial')
  })

  it('classifies unevidenced (no answers, no propagation) as unknown, unsettled', () => {
    const estimates = new Map([['A', estimate({ theta: 0, answered: 0, inferred: 0 })]])
    const result = classifyModules(graph, estimates)
    expect(result.get('A')).toEqual({
      status: 'unknown',
      settled: false,
      p: sigmoid(0),
      source: 'unevidenced',
    })
  })

  it('classifies unknown, settled, when P < 0.4 with evidence', () => {
    const estimates = new Map([['A', estimate({ theta: -1, answered: 1 })]])
    const result = classifyModules(graph, estimates)
    expect(result.get('A')).toEqual({
      status: 'unknown',
      settled: true,
      p: sigmoid(-1),
      source: 'diagnostic',
    })
    expect(sigmoid(-1)).toBeLessThan(0.4)
  })

  it('settles a partial module only once it has been served 3 times', () => {
    const under = new Map([['A', estimate({ theta: 0, answered: 1, served: 2 })]])
    const at = new Map([['A', estimate({ theta: 0, answered: 1, served: 3 })]])
    expect(classifyModules(graph, under).get('A')?.settled).toBe(false)
    expect(classifyModules(graph, at).get('A')?.settled).toBe(true)
  })

  it('skips a module with no estimate entirely', () => {
    const result = classifyModules(
      graph,
      new Map([['A', estimate({ theta: 0, answered: 2, fixed: 'known' })]]),
    )
    expect(result.has('B')).toBe(false)
  })

  it('defaults a missing depth to 0 and a missing parents entry to none, tie-breaking by ordinal', () => {
    const bareGraph: ModuleGraph = {
      modules: [
        { id: 'X', sectionId: 'S', ordinal: 1, importance: 0.5, conceptIds: [] },
        { id: 'Y', sectionId: 'S', ordinal: 0, importance: 0.5, conceptIds: [] },
      ],
      parents: new Map(),
      children: new Map(),
      depth: new Map(),
    }
    const estimates = new Map([
      ['X', estimate({ theta: 2, answered: 2 })],
      ['Y', estimate({ theta: 2, answered: 2 })],
    ])
    const result = classifyModules(bareGraph, estimates)
    expect(result.get('X')?.status).toBe('known')
    expect(result.get('Y')?.status).toBe('known')
  })
})
