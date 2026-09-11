import { describe, expect, it } from 'vitest'
import { activityStem, readAuthoring, usageFor } from './stems'

/** The small readers `build.ts` and `reconcile.ts` share (`docs/spec/04-path-generation.md` §8). */

describe('activityStem()', () => {
  it("prefers the choice set's own stem when there is one", () => {
    const stem = activityStem({
      config: {
        prompt: 'Elegí la opción correcta',
        payload: { sets: [{ stem: '¿Cuánto retiene?' }] },
      },
    })
    expect(stem).toBe('¿Cuánto retiene?')
  })

  it('falls back to the prompt when there is no payload stem', () => {
    const stem = activityStem({ config: { prompt: '¿Cuánto retiene?' } })
    expect(stem).toBe('¿Cuánto retiene?')
  })

  it('falls back to the prompt when the set stem is blank', () => {
    const stem = activityStem({
      config: { prompt: '¿Cuánto retiene?', payload: { sets: [{ stem: '   ' }] } },
    })
    expect(stem).toBe('¿Cuánto retiene?')
  })

  it('falls back to the prompt when there is no set at all', () => {
    const stem = activityStem({ config: { prompt: '¿Cuánto retiene?', payload: { sets: [] } } })
    expect(stem).toBe('¿Cuánto retiene?')
  })

  it("is '' when there is neither a stem nor a prompt", () => {
    expect(activityStem({ config: {} })).toBe('')
    expect(activityStem({ config: { prompt: 42 } })).toBe('')
  })
})

describe('readAuthoring()', () => {
  it('reads a well-formed row', () => {
    const authoring = readAuthoring({
      authoring: {
        cell_key: 'M01|exam|apply|hard',
        stem: '¿Cuánto retiene?',
        misconception_by_option: { b: 'X001', c: 'X002' },
      },
    })
    expect(authoring).toEqual({
      cellKey: 'M01|exam|apply|hard',
      stem: '¿Cuánto retiene?',
      conceptIds: [],
      misconceptionByOption: { b: 'X001', c: 'X002' },
    })
  })

  it('is all null/empty for an entry written before the column existed ({})', () => {
    expect(readAuthoring({ authoring: {} })).toEqual({
      cellKey: null,
      stem: null,
      conceptIds: [],
      misconceptionByOption: {},
    })
  })

  it('tolerates garbage fields instead of throwing', () => {
    const authoring = readAuthoring({
      authoring: {
        cell_key: 42,
        stem: null,
        misconception_by_option: 'not an object',
      } as never,
    })
    expect(authoring).toEqual({
      cellKey: null,
      stem: null,
      conceptIds: [],
      misconceptionByOption: {},
    })
  })

  it('reads the concept ids the item covers, keeping only strings', () => {
    const authoring = readAuthoring({
      authoring: { concept_ids: ['c1', 7, null, 'c2'] } as never,
    })
    expect(authoring.conceptIds).toEqual(['c1', 'c2'])
  })

  it('tolerates a null misconception_by_option', () => {
    const authoring = readAuthoring({ authoring: { misconception_by_option: null } as never })
    expect(authoring.misconceptionByOption).toEqual({})
  })

  it('keeps only the string-valued misconception ids, dropping the rest', () => {
    const authoring = readAuthoring({
      authoring: {
        misconception_by_option: { a: 'X001', b: 42, c: null, d: 'X002' },
      } as never,
    })
    expect(authoring.misconceptionByOption).toEqual({ a: 'X001', d: 'X002' })
  })
})

describe('usageFor()', () => {
  it("tags a diagnostic item ['diagnostic'], whatever form it carries", () => {
    expect(usageFor('diagnostic', null)).toEqual(['diagnostic'])
    expect(usageFor('diagnostic', 'A')).toEqual(['diagnostic'])
  })

  it("tags a reinforcement item ['reinforcement', 'remediation']", () => {
    expect(usageFor('reinforcement', null)).toEqual(['reinforcement', 'remediation'])
  })

  it("tags an exam form A item ['final_exam_A', 'mock']", () => {
    expect(usageFor('exam', 'A')).toEqual(['final_exam_A', 'mock'])
  })

  it("tags an exam form B item ['final_exam_B']", () => {
    expect(usageFor('exam', 'B')).toEqual(['final_exam_B'])
  })

  it('treats a formless exam cell as form A', () => {
    expect(usageFor('exam', null)).toEqual(['final_exam_A', 'mock'])
  })
})
