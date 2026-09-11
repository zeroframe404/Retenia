import { describe, expect, it } from 'vitest'
import {
  type BlueprintInput,
  type BlueprintModule,
  buildBlueprint,
  cellItemCount,
  DIAGNOSTIC_APPLY_DIFFICULTIES,
  DIAGNOSTIC_CORE_DIFFICULTIES,
  largestRemainder,
  REINFORCEMENT_DIFFICULTIES,
} from './blueprint'

/**
 * Stage 9's blueprint (`docs/spec/04-path-generation.md` §3 stage 9, §8; `02-memory-system.md`
 * §9): a pure function of the draft and the graph, so every property here is checked without
 * any fake AI, repository or clock.
 */

describe('largestRemainder()', () => {
  it('sums to exactly the total, however the shares round', () => {
    const shares = [0.3, 0.5, 0.2]
    for (const total of [0, 1, 4, 7, 10, 13, 37, 100]) {
      const counts = largestRemainder(total, shares)
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(total)
    }
  })

  it('is zero everywhere when the total is zero', () => {
    expect(largestRemainder(0, [0.3, 0.5, 0.2])).toEqual([0, 0, 0])
  })

  it('is zero everywhere when there are no shares', () => {
    expect(largestRemainder(10, [])).toEqual([])
  })

  it('splits evenly when every share is zero', () => {
    // sum(shares) === 0: the normalisation falls back to an equal split rather than dividing
    // by zero into NaN.
    const counts = largestRemainder(9, [0, 0, 0])
    expect(counts).toEqual([3, 3, 3])
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(9)
  })

  it('ties the leftover unit to the earlier index', () => {
    // Two equal shares, an odd total: both remainders are 0.5, and the earlier index must
    // win rather than whichever the sort happens to leave first.
    expect(largestRemainder(1, [1, 1])).toEqual([1, 0])
    expect(largestRemainder(3, [1, 1, 1, 1])).toEqual([1, 1, 1, 0])
  })

  it('never returns a negative count for a negative share', () => {
    expect(largestRemainder(4, [-1, 1])).toEqual([0, 4])
  })
})

describe('cellItemCount()', () => {
  it('is difficulties × forms for a cell with parallel forms', () => {
    expect(
      cellItemCount({
        key: 'k',
        kind: 'exam',
        bloom: 'apply',
        difficulties: [2, 2, 3],
        forms: ['A', 'B'],
      }),
    ).toBe(6)
  })

  it('is difficulties alone (forms floored to one) for a cell with no forms', () => {
    expect(
      cellItemCount({
        key: 'k',
        kind: 'diagnostic',
        bloom: 'understand',
        difficulties: DIAGNOSTIC_CORE_DIFFICULTIES,
        forms: [],
      }),
    ).toBe(3)
  })
})

function module(id: string, overrides: Partial<BlueprintModule> = {}): BlueprintModule {
  return { id, objectiveBlooms: ['understand'], conceptBlooms: [], ...overrides }
}

function inputOf(overrides: Partial<BlueprintInput> = {}): BlueprintInput {
  return {
    modules: [module('M01')],
    topics: [{ module_id: 'M01', weight: 1 }],
    examItemCount: 20,
    ...overrides,
  }
}

describe('buildBlueprint() — the exam bands', () => {
  it('splits 20 items 30/50/20 into 6/10/4', () => {
    const blueprint = buildBlueprint(inputOf({ examItemCount: 20 }))
    expect(blueprint.exam_item_count).toBe(20)
    const byBand = new Map(blueprint.cells.filter((c) => c.kind === 'exam').map((c) => [c.band, c]))
    expect(byBand.get('easy')?.difficulties).toHaveLength(6)
    expect(byBand.get('medium')?.difficulties).toHaveLength(10)
    expect(byBand.get('hard')?.difficulties).toHaveLength(4)
  })

  it('splits 30 items 30/50/20 into 9/15/6', () => {
    const blueprint = buildBlueprint(inputOf({ examItemCount: 30 }))
    const byBand = new Map(blueprint.cells.filter((c) => c.kind === 'exam').map((c) => [c.band, c]))
    expect(byBand.get('easy')?.difficulties).toHaveLength(9)
    expect(byBand.get('medium')?.difficulties).toHaveLength(15)
    expect(byBand.get('hard')?.difficulties).toHaveLength(6)
  })

  it('uses difficulty 2/3/4 for easy/medium/hard, on every item of the band', () => {
    const blueprint = buildBlueprint(inputOf({ examItemCount: 20 }))
    const byBand = new Map(blueprint.cells.filter((c) => c.kind === 'exam').map((c) => [c.band, c]))
    expect(new Set(byBand.get('easy')?.difficulties)).toEqual(new Set([2]))
    expect(new Set(byBand.get('medium')?.difficulties)).toEqual(new Set([3]))
    expect(new Set(byBand.get('hard')?.difficulties)).toEqual(new Set([4]))
  })

  it('gives every exam cell both parallel forms', () => {
    const blueprint = buildBlueprint(inputOf({ examItemCount: 20 }))
    for (const cell of blueprint.cells.filter((c) => c.kind === 'exam')) {
      expect(cell.forms).toEqual(['A', 'B'])
    }
  })

  it('spreads each band across modules by weight, not evenly', () => {
    const blueprint = buildBlueprint(
      inputOf({
        modules: [module('M01'), module('M02')],
        topics: [
          { module_id: 'M01', weight: 3 },
          { module_id: 'M02', weight: 1 },
        ],
        examItemCount: 20,
      }),
    )
    const byModule = new Map<string, number>()
    for (const cell of blueprint.cells.filter((c) => c.kind === 'exam')) {
      byModule.set(cell.moduleId, (byModule.get(cell.moduleId) ?? 0) + cell.difficulties.length)
    }
    // 20 total, 3:1 weight → M01 ≈ 15, M02 ≈ 5, and it must still sum to the total.
    expect((byModule.get('M01') ?? 0) + (byModule.get('M02') ?? 0)).toBe(20)
    expect(byModule.get('M01') ?? 0).toBeGreaterThan(byModule.get('M02') ?? 0)
  })

  it('weighs a module missing from the topics list at zero', () => {
    const blueprint = buildBlueprint(
      inputOf({
        modules: [module('M01'), module('M02')],
        topics: [{ module_id: 'M01', weight: 1 }],
        examItemCount: 10,
      }),
    )
    const m02Exam = blueprint.cells.filter((c) => c.kind === 'exam' && c.moduleId === 'M02')
    expect(m02Exam).toEqual([])
    const m02Topic = blueprint.topics.find((t) => t.module_id === 'M02')
    expect(m02Topic?.weight).toBe(0)
    expect(m02Topic?.exam_items).toBe(0)
  })

  it('reports exam_item_count as the sum actually placed', () => {
    const blueprint = buildBlueprint(inputOf({ examItemCount: 20 }))
    const sumFromCells = blueprint.cells
      .filter((c) => c.kind === 'exam')
      .reduce((sum, c) => sum + c.difficulties.length, 0)
    expect(blueprint.exam_item_count).toBe(sumFromCells)
  })

  it('never invents an exam cell for a zero-share band', () => {
    // A single tiny module, a single item: two of the three bands round to zero and must not
    // appear as cells at all (their `count === 0` guard).
    const blueprint = buildBlueprint(inputOf({ examItemCount: 1 }))
    const examCells = blueprint.cells.filter((c) => c.kind === 'exam')
    expect(examCells).toHaveLength(1)
    expect(examCells[0]?.difficulties).toHaveLength(1)
  })
})

describe('buildBlueprint() — topics', () => {
  it('carries weight, an exam_items count and a difficulty_mix that is always 30/50/20', () => {
    const blueprint = buildBlueprint(inputOf({ examItemCount: 20 }))
    const topic = blueprint.topics[0]
    expect(topic?.weight).toBe(1)
    expect(topic?.exam_items).toBe(20)
    expect(topic?.difficulty_mix).toEqual({ easy: 0.3, medium: 0.5, hard: 0.2 })
  })

  it('gives bloom_mix shares that sum to 1', () => {
    const blueprint = buildBlueprint(
      inputOf({
        modules: [module('M01', { objectiveBlooms: ['understand', 'apply', 'apply'] })],
      }),
    )
    const mix = blueprint.topics[0]?.bloom_mix ?? {}
    const total = Object.values(mix).reduce((sum, share) => sum + (share ?? 0), 0)
    expect(total).toBeCloseTo(1, 10)
    expect(mix.understand).toBeCloseTo(1 / 3, 10)
    expect(mix.apply).toBeCloseTo(2 / 3, 10)
  })

  it('falls back to a flat understand share when the module has no objectives or concepts', () => {
    const blueprint = buildBlueprint(
      inputOf({ modules: [module('M01', { objectiveBlooms: [], conceptBlooms: [] })] }),
    )
    expect(blueprint.topics[0]?.bloom_mix).toEqual({ understand: 1 })
  })
})

describe('buildBlueprint() — the diagnostic and reinforcement cells', () => {
  it('gives every module a diagnostic|core cell at difficulties [2, 3, 3] and its lowest Bloom', () => {
    const blueprint = buildBlueprint(
      inputOf({ modules: [module('M01', { objectiveBlooms: ['apply', 'understand'] })] }),
    )
    const core = blueprint.cells.find((c) => c.kind === 'diagnostic' && c.bloom !== 'apply')
    expect(core?.difficulties).toEqual(DIAGNOSTIC_CORE_DIFFICULTIES)
    expect(core?.bloom).toBe('understand')
    expect(core?.forms).toEqual([])
  })

  it('gives every module a diagnostic|apply cell at difficulty [4]', () => {
    const blueprint = buildBlueprint(inputOf())
    const apply = blueprint.cells.find((c) => c.key === 'M01|diagnostic|apply|apply')
    expect(apply?.difficulties).toEqual(DIAGNOSTIC_APPLY_DIFFICULTIES)
    expect(apply?.bloom).toBe('apply')
  })

  it('gives every module a reinforcement cell at difficulties [2, 3, 4]', () => {
    const blueprint = buildBlueprint(inputOf())
    const reinforcement = blueprint.cells.find((c) => c.kind === 'reinforcement')
    expect(reinforcement?.difficulties).toEqual(REINFORCEMENT_DIFFICULTIES)
  })

  it("works the reinforcement at 'apply' once the module reaches it", () => {
    const blueprint = buildBlueprint(
      inputOf({ modules: [module('M01', { objectiveBlooms: ['apply', 'analyze'] })] }),
    )
    const reinforcement = blueprint.cells.find((c) => c.kind === 'reinforcement')
    expect(reinforcement?.bloom).toBe('apply')
  })

  it("works the reinforcement at the module's highest level below apply otherwise", () => {
    const blueprint = buildBlueprint(
      inputOf({ modules: [module('M01', { objectiveBlooms: ['remember', 'understand'] })] }),
    )
    const reinforcement = blueprint.cells.find((c) => c.kind === 'reinforcement')
    expect(reinforcement?.bloom).toBe('understand')
  })

  it('falls back to the concepts’ Bloom target when the module lists no objectives', () => {
    const blueprint = buildBlueprint(
      inputOf({
        modules: [module('M01', { objectiveBlooms: [], conceptBlooms: ['analyze', 'apply'] })],
      }),
    )
    const core = blueprint.cells.find((c) => c.key === 'M01|diagnostic|core|apply')
    expect(core).toBeDefined()
    expect(core?.bloom).toBe('apply')
  })

  it("falls back to 'understand' when a module has neither objectives nor concepts", () => {
    const blueprint = buildBlueprint(
      inputOf({ modules: [module('M01', { objectiveBlooms: [], conceptBlooms: [] })] }),
    )
    const core = blueprint.cells.find((c) => c.key === 'M01|diagnostic|core|understand')
    expect(core).toBeDefined()
    const reinforcement = blueprint.cells.find((c) => c.kind === 'reinforcement')
    expect(reinforcement?.bloom).toBe('understand')
  })
})

describe('buildBlueprint() — cell keys and determinism', () => {
  it('gives every cell a unique key', () => {
    const blueprint = buildBlueprint(
      inputOf({
        modules: [module('M01'), module('M02', { objectiveBlooms: ['apply'] })],
        topics: [
          { module_id: 'M01', weight: 1 },
          { module_id: 'M02', weight: 1 },
        ],
        examItemCount: 20,
      }),
    )
    const keys = blueprint.cells.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is a pure function: the same input gives the same cells in the same order', () => {
    const input = inputOf({
      modules: [module('M01'), module('M02', { objectiveBlooms: ['apply', 'analyze'] })],
      topics: [
        { module_id: 'M01', weight: 2 },
        { module_id: 'M02', weight: 1 },
      ],
      examItemCount: 17,
    })
    const first = buildBlueprint(input)
    const second = buildBlueprint(input)
    expect(second).toEqual(first)
  })
})
