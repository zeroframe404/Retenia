import { describe, expect, it } from 'vitest'
import {
  configHash,
  type GenerationConfigInput,
  isChunkInScope,
  orderedSourceIds,
  parseGenerationConfig,
} from './generation-config'

const minimal: GenerationConfigInput = {
  goal: 'Entender cómo funciona la memoria',
  level: 'beginner',
  primarySourceId: 'src-book',
  sourceIds: ['src-book', 'src-course'],
}

describe('parseGenerationConfig()', () => {
  it('applies the defaults of the panel', () => {
    const config = parseGenerationConfig(minimal)
    expect(config).toMatchObject({
      lessonLanguage: 'es-AR',
      forExam: null,
      paceHoursPerWeek: 3,
      scope: { kind: 'all' },
      budgetCapUsd: 0,
    })
    expect(config.title).toBeUndefined()
  })

  it('keeps an exam date, a pace, a scope, a cap and a title when given', () => {
    const config = parseGenerationConfig({
      ...minimal,
      lessonLanguage: 'en-GB',
      forExam: { date: '2026-12-15' },
      paceHoursPerWeek: 5,
      scope: { kind: 'selected', headingPaths: ['Libro > Cap. 3'] },
      budgetCapUsd: 4.5,
      title: 'Memoria',
    })
    expect(config.forExam).toEqual({ date: '2026-12-15' })
    expect(config.scope).toEqual({ kind: 'selected', headingPaths: ['Libro > Cap. 3'] })
    expect(config.title).toBe('Memoria')
  })

  it('refuses a primary source that is not among the sources', () => {
    expect(() => parseGenerationConfig({ ...minimal, primarySourceId: 'elsewhere' })).toThrow(
      /primary source/,
    )
  })

  it('refuses a repeated source, an empty selection and a malformed date or language', () => {
    expect(() =>
      parseGenerationConfig({ ...minimal, sourceIds: ['src-book', 'src-book'] }),
    ).toThrow(/repeat/)
    expect(() =>
      parseGenerationConfig({ ...minimal, scope: { kind: 'selected', headingPaths: [] } }),
    ).toThrow()
    expect(() => parseGenerationConfig({ ...minimal, forExam: { date: '15/12/2026' } })).toThrow()
    expect(() => parseGenerationConfig({ ...minimal, lessonLanguage: 'Spanish' })).toThrow()
  })
})

describe('orderedSourceIds()', () => {
  it('puts the primary source first and keeps the rest in the order given', () => {
    expect(orderedSourceIds({ primarySourceId: 'b', sourceIds: ['a', 'b', 'c'] })).toEqual([
      'b',
      'a',
      'c',
    ])
  })
})

describe('isChunkInScope()', () => {
  const selected = { kind: 'selected', headingPaths: ['Libro > Cap. 1'] } as const

  it('accepts everything when the scope is everything', () => {
    expect(isChunkInScope({ headingPath: null }, { kind: 'all' })).toBe(true)
  })

  it('matches the selected heading and what is nested under it, not a longer sibling', () => {
    expect(isChunkInScope({ headingPath: 'Libro > Cap. 1' }, selected)).toBe(true)
    expect(isChunkInScope({ headingPath: 'Libro > Cap. 1 > 1.2' }, selected)).toBe(true)
    expect(isChunkInScope({ headingPath: 'Libro > Cap. 10' }, selected)).toBe(false)
    expect(isChunkInScope({ headingPath: 'Libro > Cap. 2' }, selected)).toBe(false)
    expect(isChunkInScope({ headingPath: null }, selected)).toBe(false)
  })
})

describe('configHash()', () => {
  it('is 64 hex characters and stable across key order, title and budget', () => {
    const a = configHash(parseGenerationConfig({ ...minimal, title: 'A', budgetCapUsd: 1 }))
    const b = configHash(
      parseGenerationConfig({
        sourceIds: ['src-course', 'src-book'],
        primarySourceId: 'src-book',
        level: 'beginner',
        goal: 'Entender cómo funciona la memoria',
        title: 'B',
        budgetCapUsd: 9,
      }),
    )
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).toBe(a)
  })

  it('changes with anything the model is told', () => {
    const base = configHash(parseGenerationConfig(minimal))
    expect(configHash(parseGenerationConfig({ ...minimal, goal: 'Otra meta' }))).not.toBe(base)
    expect(configHash(parseGenerationConfig({ ...minimal, level: 'advanced' }))).not.toBe(base)
    expect(configHash(parseGenerationConfig({ ...minimal, lessonLanguage: 'en' }))).not.toBe(base)
    expect(
      configHash(parseGenerationConfig({ ...minimal, forExam: { date: '2026-12-15' } })),
    ).not.toBe(base)
    expect(configHash(parseGenerationConfig({ ...minimal, paceHoursPerWeek: 4 }))).not.toBe(base)
    expect(
      configHash(
        parseGenerationConfig({ ...minimal, scope: { kind: 'selected', headingPaths: ['X'] } }),
      ),
    ).not.toBe(base)
    expect(configHash(parseGenerationConfig({ ...minimal, sourceIds: ['src-book'] }))).not.toBe(
      base,
    )
  })

  it('does not depend on the order the selected headings were ticked in', () => {
    const one = configHash(
      parseGenerationConfig({ ...minimal, scope: { kind: 'selected', headingPaths: ['A', 'B'] } }),
    )
    const two = configHash(
      parseGenerationConfig({ ...minimal, scope: { kind: 'selected', headingPaths: ['B', 'A'] } }),
    )
    expect(two).toBe(one)
  })
})
