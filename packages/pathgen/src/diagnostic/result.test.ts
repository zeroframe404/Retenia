import { describe, expect, it } from 'vitest'
import type { ModuleEstimate } from './classify'
import type { ConfidentMisconception, DiagnosticState } from './engine'
import { answerItem, startDiagnostic } from './engine'
import { buildDiagnosticResult } from './result'
import type { DiagnosticConfig, DiagnosticItem, DiagnosticModule, ModuleGraph } from './types'

function makeGraph(modules: readonly Omit<DiagnosticModule, 'ordinal'>[]): ModuleGraph {
  const withOrdinal: DiagnosticModule[] = modules.map((m, ordinal) => ({ ordinal, ...m }))
  return {
    modules: withOrdinal,
    parents: new Map(withOrdinal.map((m) => [m.id, []])),
    children: new Map(withOrdinal.map((m) => [m.id, []])),
    depth: new Map(withOrdinal.map((m) => [m.id, 0])),
  }
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

describe('buildDiagnosticResult()', () => {
  it('gives a diagnostic-known module exactly mark_completed + seed_memory', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }])
    const config: DiagnosticConfig = { graph, items: [], entry: 'partial', selfAssessment: {} }
    const base = startDiagnostic(config)
    const estimate = base.estimates.get('M') as ModuleEstimate
    const estimates = new Map(base.estimates)
    // P(θ=2) ≈ 0.88 ≥ 0.8, answered ≥ 2: known on the evidence, without needing an apply item.
    estimates.set('M', { ...estimate, theta: 2, answered: 2, served: 2 })
    const state: DiagnosticState = { ...base, estimates, abandoned: true }
    const result = buildDiagnosticResult(state)
    const moduleResult = result.modules.find((m) => m.moduleId === 'M')
    expect(moduleResult?.status).toBe('known')
    expect(moduleResult?.source).toBe('diagnostic')
    const actionsForM = result.actions.filter((a) => a.moduleId === 'M')
    expect(actionsForM).toEqual([
      { kind: 'mark_completed', moduleId: 'M' },
      { kind: 'seed_memory', moduleId: 'M' },
    ])
  })

  it('gives self_declared / never_seen / from_scratch modules no actions at all', () => {
    const graph = makeGraph([
      { id: 'M1', sectionId: 'S1', importance: 0.5, conceptIds: [] },
      { id: 'M2', sectionId: 'S2', importance: 0.5, conceptIds: [] },
      { id: 'M3', sectionId: 'S3', importance: 0.5, conceptIds: [] },
    ])
    const config: DiagnosticConfig = {
      graph,
      items: [],
      entry: 'partial',
      selfAssessment: { S2: 'never' },
      selfDeclaredKnown: ['M1'],
    }
    const state = startDiagnostic(config)
    const result = buildDiagnosticResult(state)
    expect(result.actions).toEqual([])
    expect(result.modules.map((m) => m.source).sort()).toEqual([
      'never_seen',
      'self_declared',
      'unevidenced',
    ])
  })

  it('marks a partial module’s quickReview true', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }])
    const items = [makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'], difficultyLogit: 0 })]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state = answerItem(startDiagnostic(config), {
      itemId: 'i1',
      outcome: 'correct',
      confidence: 'unsure',
      timeMs: 500,
      difficulty: 0,
      chosenOptionId: null,
    })
    const result = buildDiagnosticResult(state)
    const moduleResult = result.modules.find((m) => m.moduleId === 'M')
    expect(moduleResult?.status).toBe('partial')
    expect(moduleResult?.quickReview).toBe(true)
  })

  it('dedupes insert_remediation per (module, misconceptionId)', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }])
    const config: DiagnosticConfig = { graph, items: [], entry: 'partial', selfAssessment: {} }
    const base = startDiagnostic(config)
    const misconceptions: readonly ConfidentMisconception[] = [
      { moduleId: 'M', itemId: 'i1', conceptIds: ['c1'], misconceptionId: 'MISC1' },
      { moduleId: 'M', itemId: 'i2', conceptIds: ['c2'], misconceptionId: 'MISC1' }, // same trigger, twice
      { moduleId: 'M', itemId: 'i3', conceptIds: ['c3'], misconceptionId: 'MISC2' },
    ]
    const state: DiagnosticState = { ...base, misconceptions, abandoned: true }
    const result = buildDiagnosticResult(state)
    const remediations = result.actions.filter((a) => a.kind === 'insert_remediation')
    expect(remediations).toHaveLength(2)
    expect(
      remediations.map((a) => (a.kind === 'insert_remediation' ? a.misconceptionId : null)),
    ).toEqual(['MISC1', 'MISC2'])
  })

  it('dedupes insert_remediation per (module, concepts) when misconceptionId is null', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }])
    const config: DiagnosticConfig = { graph, items: [], entry: 'partial', selfAssessment: {} }
    const base = startDiagnostic(config)
    const misconceptions: readonly ConfidentMisconception[] = [
      { moduleId: 'M', itemId: 'i1', conceptIds: ['c1', 'c2'], misconceptionId: null },
      { moduleId: 'M', itemId: 'i2', conceptIds: ['c1', 'c2'], misconceptionId: null }, // same concepts
      { moduleId: 'M', itemId: 'i3', conceptIds: ['c3'], misconceptionId: null }, // different concepts
    ]
    const state: DiagnosticState = { ...base, misconceptions, abandoned: true }
    const result = buildDiagnosticResult(state)
    const remediations = result.actions.filter((a) => a.kind === 'insert_remediation')
    expect(remediations).toHaveLength(2)
  })

  it('reads the stopReason of a still-running state as "abandoned"', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }])
    const items = [makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'] })]
    const config: DiagnosticConfig = { graph, items, entry: 'partial', selfAssessment: {} }
    const state = startDiagnostic(config)
    expect(buildDiagnosticResult(state).stopReason).toBe('abandoned')
  })

  it('skips a graph module that has no estimate entry (defensive)', () => {
    const graph = makeGraph([
      { id: 'M1', sectionId: 'S', importance: 0.5, conceptIds: [] },
      { id: 'M2', sectionId: 'S', importance: 0.5, conceptIds: [] },
    ])
    const config: DiagnosticConfig = { graph, items: [], entry: 'partial', selfAssessment: {} }
    const base = startDiagnostic(config)
    const estimates = new Map(base.estimates)
    estimates.delete('M2')
    const state: DiagnosticState = { ...base, estimates, abandoned: true }
    const result = buildDiagnosticResult(state)
    expect(result.modules.map((m) => m.moduleId)).toEqual(['M1'])
  })

  it('produces a JSON-serializable result', () => {
    const graph = makeGraph([{ id: 'M', sectionId: 'S', importance: 0.5, conceptIds: [] }])
    const items = [
      makeItem({ id: 'i1', moduleId: 'M', conceptIds: ['c1'], misconceptionByOption: { b: 'X' } }),
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
    const result = buildDiagnosticResult(state)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
