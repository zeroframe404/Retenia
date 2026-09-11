import type { ConfidenceLevel } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { makeSyntheticPath, seededRandom } from '../testing/synthetic-learners'
import type { ModuleEstimate } from './classify'
import {
  abandonDiagnostic,
  answerItem,
  askableModules,
  DiagnosticError,
  type DiagnosticState,
  eligibleItems,
  FIXED_KNOWN_THETA,
  FIXED_UNKNOWN_THETA,
  nextItem,
  remainingEstimate,
  replayDiagnostic,
  startDiagnostic,
  stopReason,
} from './engine'
import {
  type AnswerOutcome,
  DEFAULT_TUNING,
  DIAGNOSTIC_LIMITS,
  type DiagnosticAnswer,
  type DiagnosticConfig,
  type DiagnosticItem,
  type DiagnosticModule,
  type ModuleGraph,
} from './types'

function makeGraph(
  modules: readonly Omit<DiagnosticModule, 'ordinal'>[],
  parentEdges: readonly (readonly [string, string])[],
): ModuleGraph {
  const withOrdinal: DiagnosticModule[] = modules.map((m, ordinal) => ({ ordinal, ...m }))
  const parents = new Map<string, string[]>(withOrdinal.map((m) => [m.id, []]))
  const children = new Map<string, string[]>(withOrdinal.map((m) => [m.id, []]))
  for (const [from, to] of parentEdges) {
    ;(parents.get(to) as string[]).push(from)
    ;(children.get(from) as string[]).push(to)
  }
  const depth = new Map<string, number>()
  const depthOf = (id: string): number => {
    const memo = depth.get(id)
    if (memo !== undefined) return memo
    const own = parents.get(id) as string[]
    const value = own.length === 0 ? 0 : 1 + Math.max(...own.map(depthOf))
    depth.set(id, value)
    return value
  }
  for (const module of withOrdinal) depthOf(module.id)
  return { modules: withOrdinal, parents, children, depth }
}

function makeItem(
  overrides: Partial<DiagnosticItem> & Pick<DiagnosticItem, 'id' | 'moduleId'>,
): DiagnosticItem {
  return {
    conceptIds: [overrides.id],
    difficultyLogit: 0,
    bloom: null,
    exposure: 0,
    misconceptionByOption: {},
    ...overrides,
  }
}

const FAKE_ANSWER: DiagnosticAnswer = {
  itemId: '__fake__',
  outcome: 'correct',
  confidence: 'sure',
  timeMs: 1000,
  difficulty: 0,
  chosenOptionId: null,
}

function catchCode(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return error instanceof DiagnosticError ? error.code : undefined
  }
}

describe('startDiagnostic()', () => {
  const graph = makeGraph(
    [
      { id: 'M1', sectionId: 'S1', importance: 0.5, conceptIds: [] },
      { id: 'M2', sectionId: 'S2', importance: 0.5, conceptIds: [] },
    ],
    [],
  )

  it('fixes every module unknown, from "from_scratch", when entry is "scratch"', () => {
    const config: DiagnosticConfig = { graph, items: [], entry: 'scratch', selfAssessment: {} }
    const state = startDiagnostic(config)
    for (const module of graph.modules) {
      expect(state.estimates.get(module.id)).toMatchObject({
        theta: FIXED_UNKNOWN_THETA,
        fixed: 'unknown',
        fixedSource: 'from_scratch',
      })
    }
    expect(stopReason(state)).toBe('from_scratch')
    expect(nextItem(state)).toBeNull()
  })

  it('fixes a "never seen" section’s modules unknown and never serves them', () => {
    const config: DiagnosticConfig = {
      graph,
      items: [makeItem({ id: 'M1.i1', moduleId: 'M1' }), makeItem({ id: 'M2.i1', moduleId: 'M2' })],
      entry: 'partial',
      selfAssessment: { S1: 'never' },
    }
    const state = startDiagnostic(config)
    expect(state.estimates.get('M1')).toMatchObject({
      theta: FIXED_UNKNOWN_THETA,
      fixed: 'unknown',
      fixedSource: 'never_seen',
    })
    expect(askableModules(state).map((m) => m.id)).toEqual(['M2'])
  })

  it('defaults a section with no self-assessment entry to the "familiar" prior (-0.4)', () => {
    const config: DiagnosticConfig = { graph, items: [], entry: 'partial', selfAssessment: {} }
    const state = startDiagnostic(config)
    expect(DEFAULT_TUNING.priors.familiar).toBe(-0.4)
    expect(state.estimates.get('M1')?.theta).toBe(DEFAULT_TUNING.priors.familiar)
    expect(state.estimates.get('M1')?.fixed).toBeNull()
  })

  it('fixes a self-declared-known module known and never serves it', () => {
    const config: DiagnosticConfig = {
      graph,
      items: [makeItem({ id: 'M1.i1', moduleId: 'M1' })],
      entry: 'partial',
      selfAssessment: {},
      selfDeclaredKnown: ['M1'],
    }
    const state = startDiagnostic(config)
    expect(state.estimates.get('M1')).toMatchObject({
      theta: FIXED_KNOWN_THETA,
      fixed: 'known',
      fixedSource: 'self_declared',
    })
    expect(askableModules(state).map((m) => m.id)).not.toContain('M1')
  })
})

describe('nextItem() — first item (§10 step 2)', () => {
  const graph = makeGraph(
    [
      { id: 'M1', sectionId: 'S', importance: 0.5, conceptIds: [] },
      { id: 'M2', sectionId: 'S', importance: 0.5, conceptIds: [] },
      { id: 'M3', sectionId: 'S', importance: 0.3, conceptIds: [] },
      { id: 'M4', sectionId: 'S', importance: 0.7, conceptIds: [] },
      { id: 'M5', sectionId: 'S', importance: 0.5, conceptIds: [] },
    ],
    [
      ['M1', 'M3'],
      ['M2', 'M4'],
      ['M3', 'M5'],
    ],
  )
  const items: DiagnosticItem[] = [
    makeItem({ id: 'M1.i', moduleId: 'M1' }),
    makeItem({ id: 'M2.i', moduleId: 'M2' }),
    makeItem({ id: 'M3.i', moduleId: 'M3' }),
    makeItem({ id: 'M5.i', moduleId: 'M5' }),
    makeItem({ id: 'M4.a', moduleId: 'M4', difficultyLogit: -1 }),
    makeItem({ id: 'M4.b', moduleId: 'M4', difficultyLogit: 0 }),
    makeItem({ id: 'M4.c', moduleId: 'M4', difficultyLogit: 1 }),
  ]
  const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }

  it('picks the median-depth module, tie broken by higher importance, and its median-difficulty item', () => {
    expect([...graph.depth.values()].sort((a, b) => a - b)).toEqual([0, 0, 1, 1, 2])
    const item = nextItem(startDiagnostic(config))
    expect(item?.moduleId).toBe('M4')
    expect(item?.id).toBe('M4.b')
  })

  it('breaks a median-depth tie by ordinal when importance also ties', () => {
    const tiedGraph = makeGraph(
      [
        { id: 'M1', sectionId: 'S', importance: 0.5, conceptIds: [] },
        { id: 'M2', sectionId: 'S', importance: 0.5, conceptIds: [] },
        { id: 'M3', sectionId: 'S', importance: 0.5, conceptIds: [] },
        { id: 'M4', sectionId: 'S', importance: 0.5, conceptIds: [] },
        { id: 'M5', sectionId: 'S', importance: 0.5, conceptIds: [] },
      ],
      [
        ['M1', 'M3'],
        ['M2', 'M4'],
        ['M3', 'M5'],
      ],
    )
    const tiedItems = ['M1', 'M2', 'M3', 'M4', 'M5'].map((id) =>
      makeItem({ id: `${id}.i`, moduleId: id }),
    )
    const tiedConfig: DiagnosticConfig = {
      graph: tiedGraph,
      items: tiedItems,
      entry: 'partial',
      selfAssessment: {},
    }
    expect(nextItem(startDiagnostic(tiedConfig))?.moduleId).toBe('M3')
  })
})

describe('nextItem() — first item, defensive graph.depth fallback', () => {
  it('defaults a module missing from graph.depth to depth 0', () => {
    const graph: ModuleGraph = {
      modules: [
        { id: 'M1', sectionId: 'S', ordinal: 0, importance: 0.5, conceptIds: [] },
        { id: 'M2', sectionId: 'S', ordinal: 1, importance: 0.5, conceptIds: [] },
      ],
      parents: new Map([
        ['M1', []],
        ['M2', []],
      ]),
      children: new Map([
        ['M1', []],
        ['M2', []],
      ]),
      depth: new Map(), // no entries: exercises the "?? 0" fallback in nextItem's depthOf
    }
    const items = [
      makeItem({ id: 'M1.i', moduleId: 'M1' }),
      makeItem({ id: 'M2.i', moduleId: 'M2' }),
    ]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const item = nextItem(startDiagnostic(config))
    expect(item).not.toBeNull()
  })
})

describe('nextItem() — later items weight uncertainty by importance (§10 step 5)', () => {
  it('the (bias+importance)·4P(1−P) score can favour a less important but more uncertain module', () => {
    const graph = makeGraph(
      [
        { id: 'A', sectionId: 'S', importance: 0.9, conceptIds: [] },
        { id: 'B', sectionId: 'S', importance: 0.1, conceptIds: [] },
      ],
      [],
    )
    const items = [makeItem({ id: 'A.i', moduleId: 'A' }), makeItem({ id: 'B.i', moduleId: 'B' })]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const base = startDiagnostic(config)
    const estimates = new Map(base.estimates)
    estimates.set('A', { ...(estimates.get('A') as ModuleEstimate), theta: 2 })
    estimates.set('B', { ...(estimates.get('B') as ModuleEstimate), theta: 0 })
    const state: DiagnosticState = { ...base, estimates, answers: [FAKE_ANSWER] }

    const p = (theta: number) => 1 / (1 + Math.exp(-theta))
    const score = (importance: number, theta: number) =>
      (DEFAULT_TUNING.importanceBias + importance) * 4 * p(theta) * (1 - p(theta))
    expect(score(0.1, 0)).toBeGreaterThan(score(0.9, 2))
    expect(nextItem(state)?.moduleId).toBe('B')
  })
})

describe('nextItem() — item choice among a module’s eligible items', () => {
  const graph = makeGraph([{ id: 'C', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])

  it('picks the item whose difficulty is closest to θ', () => {
    const items = [
      makeItem({ id: 'far', moduleId: 'C', difficultyLogit: 5, conceptIds: ['far'] }),
      makeItem({ id: 'near', moduleId: 'C', difficultyLogit: 0.1, conceptIds: ['near'] }),
      makeItem({ id: 'mid', moduleId: 'C', difficultyLogit: 2, conceptIds: ['mid'] }),
    ]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state: DiagnosticState = { ...startDiagnostic(config), answers: [FAKE_ANSWER] }
    expect(nextItem(state)?.id).toBe('near')
  })

  it('breaks a distance-to-θ tie by least exposure', () => {
    const items = [
      makeItem({
        id: 'exposed',
        moduleId: 'C',
        difficultyLogit: 0,
        exposure: 5,
        conceptIds: ['exposed'],
      }),
      makeItem({
        id: 'fresh',
        moduleId: 'C',
        difficultyLogit: 0,
        exposure: 0,
        conceptIds: ['fresh'],
      }),
    ]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state: DiagnosticState = { ...startDiagnostic(config), answers: [FAKE_ANSWER] }
    expect(nextItem(state)?.id).toBe('fresh')
  })

  it('breaks a distance-to-θ and exposure tie by item id', () => {
    const items = [
      makeItem({ id: 'zzz', moduleId: 'C', difficultyLogit: 0, conceptIds: ['zzz'] }),
      makeItem({ id: 'aaa', moduleId: 'C', difficultyLogit: 0, conceptIds: ['aaa'] }),
    ]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state: DiagnosticState = { ...startDiagnostic(config), answers: [FAKE_ANSWER] }
    expect(nextItem(state)?.id).toBe('aaa')
  })
})

describe('eligibleItems() / nextItem() — no repeated concept', () => {
  it('excludes an item that shares a concept already asked, even after a skip', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])
    const items = [
      makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'] }),
      makeItem({ id: 'i2', moduleId: 'M', conceptIds: ['c1'] }), // shares c1 with i1
      makeItem({ id: 'i3', moduleId: 'M', conceptIds: ['c2'] }),
    ]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    let state = startDiagnostic(config)
    // Median of {i1, i2, i3} sorted by (difficulty, id) — all difficulty 0 — is i2.
    const first = nextItem(state) as DiagnosticItem
    expect(first.id).toBe('i2')
    state = answerItem(state, {
      itemId: first.id,
      outcome: 'skipped',
      confidence: null,
      timeMs: 1000,
      difficulty: first.difficultyLogit,
      chosenOptionId: null,
    })
    expect(eligibleItems(state, 'M').map((i) => i.id)).toEqual(['i3'])
    expect(nextItem(state)?.id).toBe('i3')
  })
})

describe('askableModules() — maximum 3 items served per module', () => {
  it('excludes a module once it has been served 3 times', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])
    const items = [1, 2, 3, 4].map((n) =>
      makeItem({ id: `i${n}`, moduleId: 'M', conceptIds: [`c${n}`] }),
    )
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const base = startDiagnostic(config)
    const estimates = new Map(base.estimates)
    estimates.set('M', {
      ...(estimates.get('M') as ModuleEstimate),
      served: DIAGNOSTIC_LIMITS.maxPerModule,
    })
    const state: DiagnosticState = { ...base, estimates }
    expect(askableModules(state)).toEqual([])
  })
})

describe('answerItem() — skip', () => {
  it('spends a served slot and the concept, leaving θ unchanged', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])
    const items = [makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'] })]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const before = startDiagnostic(config)
    const thetaBefore = before.estimates.get('M')?.theta
    const after = answerItem(before, {
      itemId: 'i1',
      outcome: 'skipped',
      confidence: null,
      timeMs: 500,
      difficulty: 0,
      chosenOptionId: null,
    })
    expect(after.estimates.get('M')?.theta).toBe(thetaBefore)
    expect(after.estimates.get('M')?.served).toBe(1)
    expect(after.estimates.get('M')?.answered).toBe(0)
    expect(after.askedConceptIds.has('c1')).toBe(true)
  })
})

describe('answerItem() — errors', () => {
  const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])
  const items = [makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'] })]
  const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
  const validAnswer = {
    outcome: 'correct' as const,
    confidence: 'sure' as const,
    timeMs: 500,
    difficulty: 0,
    chosenOptionId: null,
  }

  it('throws unknown_item for an item id absent from the config', () => {
    const state = startDiagnostic(config)
    expect(() => answerItem(state, { ...validAnswer, itemId: 'ghost' })).toThrow(DiagnosticError)
    expect(catchCode(() => answerItem(state, { ...validAnswer, itemId: 'ghost' }))).toBe(
      'unknown_item',
    )
  })

  it('throws item_already_answered on a second answer to the same item', () => {
    // A second eligible item on M keeps the diagnostic running after the first answer, so the
    // repeat on "i1" reaches the usedItemIds check instead of the stop check.
    const twoItemConfig: DiagnosticConfig = {
      graph,
      items: [...items, makeItem({ id: 'i2', moduleId: 'M', conceptIds: ['c2'] })],
      entry: 'partial',
      selfAssessment: {},
    }
    let state = startDiagnostic(twoItemConfig)
    state = answerItem(state, { ...validAnswer, itemId: 'i1' })
    expect(stopReason(state)).toBeNull()
    expect(catchCode(() => answerItem(state, { ...validAnswer, itemId: 'i1' }))).toBe(
      'item_already_answered',
    )
  })

  it('throws module_not_askable for an item whose module is fixed', () => {
    // A second, unfixed module N keeps the diagnostic running while M is self-declared known.
    const graphWithN = makeGraph(
      [
        { id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] },
        { id: 'N', sectionId: 'S', importance: 0.5, conceptIds: [] },
      ],
      [],
    )
    const declaredConfig: DiagnosticConfig = {
      graph: graphWithN,
      items: [...items, makeItem({ id: 'n1', moduleId: 'N', conceptIds: ['c2'] })],
      entry: 'partial',
      selfAssessment: {},
      selfDeclaredKnown: ['M'],
    }
    const state = startDiagnostic(declaredConfig)
    expect(stopReason(state)).toBeNull()
    expect(catchCode(() => answerItem(state, { ...validAnswer, itemId: 'i1' }))).toBe(
      'module_not_askable',
    )
  })

  it('throws invalid_answer for a negative or NaN timeMs', () => {
    const state = startDiagnostic(config)
    expect(catchCode(() => answerItem(state, { ...validAnswer, itemId: 'i1', timeMs: -1 }))).toBe(
      'invalid_answer',
    )
    expect(
      catchCode(() => answerItem(state, { ...validAnswer, itemId: 'i1', timeMs: Number.NaN })),
    ).toBe('invalid_answer')
  })

  it('throws invalid_answer for a NaN difficulty', () => {
    const state = startDiagnostic(config)
    expect(
      catchCode(() => answerItem(state, { ...validAnswer, itemId: 'i1', difficulty: Number.NaN })),
    ).toBe('invalid_answer')
  })

  it('throws invalid_answer for an unknown outcome', () => {
    const state = startDiagnostic(config)
    expect(
      catchCode(() =>
        answerItem(state, { ...validAnswer, itemId: 'i1', outcome: 'maybe' as AnswerOutcome }),
      ),
    ).toBe('invalid_answer')
  })

  it('throws diagnostic_stopped after abandonment', () => {
    const state = abandonDiagnostic(startDiagnostic(config))
    expect(catchCode(() => answerItem(state, { ...validAnswer, itemId: 'i1' }))).toBe(
      'diagnostic_stopped',
    )
  })

  it('throws diagnostic_stopped once max_items (30) has been reached', () => {
    const base = startDiagnostic(config)
    const fakeAnswers = Array.from({ length: DIAGNOSTIC_LIMITS.maxItems }, (_, i) => ({
      ...validAnswer,
      itemId: `x${i}`,
    }))
    const state: DiagnosticState = { ...base, answers: fakeAnswers }
    expect(stopReason(state)).toBe('max_items')
    expect(catchCode(() => answerItem(state, { ...validAnswer, itemId: 'i1' }))).toBe(
      'diagnostic_stopped',
    )
  })
})

describe('stopReason() — stop rules', () => {
  function openModuleState(importance: number): DiagnosticState {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance, conceptIds: [] }], [])
    const items = [makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'] })]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    return startDiagnostic(config)
  }
  const answersOf = (n: number): DiagnosticAnswer[] =>
    Array.from({ length: n }, (_, i) => ({
      itemId: `x${i}`,
      outcome: 'correct' as const,
      confidence: 'sure' as const,
      timeMs: 1,
      difficulty: 0,
      chosenOptionId: null,
    }))

  it('stops hard at 30 items regardless of an important open module', () => {
    expect(stopReason({ ...openModuleState(0.9), answers: answersOf(30) })).toBe('max_items')
  })

  it('stops softly at 25 items only when no open module is important (≥ 0.5)', () => {
    expect(stopReason({ ...openModuleState(0.3), answers: answersOf(25) })).toBe('max_items')
    expect(stopReason({ ...openModuleState(0.5), answers: answersOf(25) })).toBeNull()
  })

  it('stops hard at the 15-minute mark regardless of importance', () => {
    expect(stopReason({ ...openModuleState(0.9), elapsedMs: DIAGNOSTIC_LIMITS.hardTimeMs })).toBe(
      'time_limit',
    )
  })

  it('stops softly at the 12-minute mark only when no open module is important', () => {
    expect(stopReason({ ...openModuleState(0.3), elapsedMs: DIAGNOSTIC_LIMITS.softTimeMs })).toBe(
      'time_limit',
    )
    expect(
      stopReason({ ...openModuleState(0.5), elapsedMs: DIAGNOSTIC_LIMITS.softTimeMs }),
    ).toBeNull()
  })

  it('stops with all_classified when every module is settled', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])
    const config: DiagnosticConfig = {
      graph,
      items: [],
      entry: 'partial',
      selfAssessment: {},
      selfDeclaredKnown: ['M'],
    }
    expect(stopReason(startDiagnostic(config))).toBe('all_classified')
  })

  it('stops with no_items when an unsettled module has nothing left to ask', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])
    const config: DiagnosticConfig = { graph, items: [], entry: 'partial', selfAssessment: {} }
    expect(stopReason(startDiagnostic(config))).toBe('no_items')
  })

  it('stops with abandoned once abandonDiagnostic has been called', () => {
    expect(stopReason(abandonDiagnostic(openModuleState(0.5)))).toBe('abandoned')
  })
})

describe('replayDiagnostic() — resumability', () => {
  it('replaying every prefix of a real run reproduces the state reached step by step', () => {
    const random = seededRandom(1234)
    const path = makeSyntheticPath(random, 12)
    const config: DiagnosticConfig = {
      graph: path.graph,
      items: path.items,
      entry: 'partial',
      selfAssessment: {},
    }
    let state = startDiagnostic(config)
    const states: DiagnosticState[] = [state]
    const answers: DiagnosticAnswer[] = []
    const confidences: readonly ConfidenceLevel[] = ['sure', 'unsure', 'guessed']
    for (let i = 0; i < 25; i++) {
      const item = nextItem(state)
      if (item === null) break
      const answer: DiagnosticAnswer = {
        itemId: item.id,
        outcome: i % 3 === 0 ? 'wrong' : 'correct',
        confidence: confidences[i % 3] as ConfidenceLevel,
        timeMs: 1000 + i,
        difficulty: item.difficultyLogit,
        chosenOptionId: i % 3 === 0 ? 'b' : null,
      }
      state = answerItem(state, answer)
      answers.push(answer)
      states.push(state)
    }
    expect(answers.length).toBeGreaterThan(10)
    for (let k = 0; k <= answers.length; k++) {
      expect(replayDiagnostic(config, answers.slice(0, k))).toEqual(states[k])
    }
  })

  it('uses the difficulty recorded on the answer, not the item’s current difficulty in config', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])
    const items = [makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'], difficultyLogit: 0 })]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const answer: DiagnosticAnswer = {
      itemId: 'i1',
      outcome: 'correct',
      confidence: 'sure',
      timeMs: 500,
      difficulty: 0,
      chosenOptionId: null,
    }
    const original = replayDiagnostic(config, [answer])

    const laterConfig: DiagnosticConfig = {
      ...config,
      items: [{ ...(items[0] as DiagnosticItem), difficultyLogit: 3 }],
    }
    const replayed = replayDiagnostic(laterConfig, [answer])
    expect(replayed.estimates.get('M')?.theta).toBe(original.estimates.get('M')?.theta)
  })
})

describe('answerItem() — confident misconceptions', () => {
  const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])

  it('records a misconception for a sure, wrong answer, mapped by the chosen option', () => {
    const items = [
      makeItem({
        id: 'i1',
        moduleId: 'M',
        conceptIds: ['c1'],
        misconceptionByOption: { b: 'MISC1' },
      }),
    ]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state = answerItem(startDiagnostic(config), {
      itemId: 'i1',
      outcome: 'wrong',
      confidence: 'sure',
      timeMs: 500,
      difficulty: 0,
      chosenOptionId: 'b',
    })
    expect(state.misconceptions).toEqual([
      { moduleId: 'M', itemId: 'i1', conceptIds: ['c1'], misconceptionId: 'MISC1' },
    ])
  })

  it('records a null misconceptionId when no option was chosen', () => {
    const items = [makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'] })]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state = answerItem(startDiagnostic(config), {
      itemId: 'i1',
      outcome: 'wrong',
      confidence: 'sure',
      timeMs: 500,
      difficulty: 0,
      chosenOptionId: null,
    })
    expect(state.misconceptions[0]?.misconceptionId).toBeNull()
  })

  it('records a null misconceptionId when the chosen option is not mapped', () => {
    const items = [
      makeItem({
        id: 'i1',
        moduleId: 'M',
        conceptIds: ['c1'],
        misconceptionByOption: { a: 'MISC1' },
      }),
    ]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state = answerItem(startDiagnostic(config), {
      itemId: 'i1',
      outcome: 'wrong',
      confidence: 'sure',
      timeMs: 500,
      difficulty: 0,
      chosenOptionId: 'b', // not in the map
    })
    expect(state.misconceptions[0]?.misconceptionId).toBeNull()
  })

  it('does not record a misconception for a wrong answer given without "sure" confidence', () => {
    const items = [
      makeItem({
        id: 'i1',
        moduleId: 'M',
        conceptIds: ['c1'],
        misconceptionByOption: { b: 'MISC1' },
      }),
    ]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state = answerItem(startDiagnostic(config), {
      itemId: 'i1',
      outcome: 'wrong',
      confidence: 'unsure',
      timeMs: 500,
      difficulty: 0,
      chosenOptionId: 'b',
    })
    expect(state.misconceptions).toEqual([])
  })

  it('does not record a misconception for a correct, sure answer', () => {
    const items = [
      makeItem({
        id: 'i1',
        moduleId: 'M',
        conceptIds: ['c1'],
        misconceptionByOption: { a: 'MISC1' },
      }),
    ]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state = answerItem(startDiagnostic(config), {
      itemId: 'i1',
      outcome: 'correct',
      confidence: 'sure',
      timeMs: 500,
      difficulty: 0,
      chosenOptionId: 'a',
    })
    expect(state.misconceptions).toEqual([])
  })
})

describe('remainingEstimate()', () => {
  it('is 0 once the diagnostic has stopped', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])
    const config: DiagnosticConfig = { graph, items: [], entry: 'scratch', selfAssessment: {} }
    expect(remainingEstimate(startDiagnostic(config))).toBe(0)
  })

  it('is at least 1 while running', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }], [])
    const items = [makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'] })]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    expect(remainingEstimate(startDiagnostic(config))).toBeGreaterThanOrEqual(1)
  })

  it('never exceeds 30 minus the number already asked, over a real run', () => {
    const random = seededRandom(99)
    const path = makeSyntheticPath(random, 10)
    const config: DiagnosticConfig = {
      graph: path.graph,
      items: path.items,
      entry: 'partial',
      selfAssessment: {},
    }
    let state = startDiagnostic(config)
    for (let i = 0; i < 20; i++) {
      const item = nextItem(state)
      if (item === null) break
      expect(remainingEstimate(state)).toBeLessThanOrEqual(
        DIAGNOSTIC_LIMITS.maxItems - state.answers.length,
      )
      state = answerItem(state, {
        itemId: item.id,
        outcome: i % 2 === 0 ? 'correct' : 'wrong',
        confidence: 'sure',
        timeMs: 1000,
        difficulty: item.difficultyLogit,
        chosenOptionId: i % 2 === 0 ? null : 'b',
      })
    }
  })
})
