import { describe, expect, it } from 'vitest'
import { classifyModules, type ModuleEstimate } from './classify'
import type { ModuleGraph } from './types'

/**
 * §10 step 6's apply shortcut — "one 'apply' item answered correctly and confidently with
 * `known` ancestors" — checks every ancestor, not only the direct parents: a parent known on
 * its own two answers says nothing about its own prerequisites.
 */

/** A chain A → B → C: A is C's grandparent. */
const chain: ModuleGraph = {
  modules: [
    { id: 'A', sectionId: 'S', ordinal: 0, importance: 0.5, conceptIds: [] },
    { id: 'B', sectionId: 'S', ordinal: 1, importance: 0.5, conceptIds: [] },
    { id: 'C', sectionId: 'S', ordinal: 2, importance: 0.5, conceptIds: [] },
  ],
  parents: new Map([
    ['A', []],
    ['B', ['A']],
    ['C', ['B']],
  ]),
  children: new Map([
    ['A', ['B']],
    ['B', ['C']],
    ['C', []],
  ]),
  depth: new Map([
    ['A', 0],
    ['B', 1],
    ['C', 2],
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

/** C: P ≥ 0.8 on one sure, correct apply item — the shortcut's own condition. */
const shortcut = estimate({ theta: 2, answered: 1, served: 1, sureApplyCorrect: true })

describe('the apply shortcut to "known"', () => {
  it('is refused when a grandparent is not known, even with the parent known', () => {
    const verdicts = classifyModules(
      chain,
      new Map([
        ['A', estimate({ theta: -2, answered: 1, served: 1 })],
        ['B', estimate({ theta: 2, answered: 2, served: 2 })],
        ['C', shortcut],
      ]),
    )
    expect(verdicts.get('A')?.status).toBe('unknown')
    expect(verdicts.get('B')?.status).toBe('known')
    expect(verdicts.get('C')?.status).not.toBe('known')
  })

  it('is granted when every ancestor is known', () => {
    const verdicts = classifyModules(
      chain,
      new Map([
        ['A', estimate({ theta: 2, answered: 2, served: 2 })],
        ['B', estimate({ theta: 2, answered: 2, served: 2 })],
        ['C', shortcut],
      ]),
    )
    expect(verdicts.get('C')?.status).toBe('known')
  })

  it('needs no ancestors at all for a root module', () => {
    const verdicts = classifyModules(
      chain,
      new Map([['A', estimate({ theta: 2, answered: 1, served: 1, sureApplyCorrect: true })]]),
    )
    expect(verdicts.get('A')?.status).toBe('known')
  })
})
