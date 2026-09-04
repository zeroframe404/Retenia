import { describe, expect, it } from 'vitest'
import { hasResponseSchema, RESPONSE_SCHEMAS, responseSchemaFor } from './responses'

/** The user's answer per family — the `attempts.answer` JSON. */
describe('RESPONSE_SCHEMAS', () => {
  it('accepts the canonical response of every MVP family', () => {
    const cases = {
      choice: { sets: [{ selected: ['a'] }], confidence: 'sure' },
      text_input: { value: 'París' },
      cloze: { gaps: { g1: 'París', g2: '' } },
      long_text: { text: '…' },
      pairs: { matches: [{ left: 'p1', right: 'p1' }] },
      ordering: { order: ['i2', 'i1'], indents: { i1: 0 } },
      categorize: { placements: { i1: ['c1'], i2: [] } },
      text_mark: { markedIds: ['t3'] },
      cards: { rating: 3 },
      disclosure: { openedIds: [] },
    } as const
    for (const [family, response] of Object.entries(cases)) {
      const schema = RESPONSE_SCHEMAS[family as keyof typeof RESPONSE_SCHEMAS]
      expect(schema.safeParse(response).success, family).toBe(true)
    }
  })

  it('is strict: unknown keys, wrong shapes and a Manual rating are rejected', () => {
    expect(RESPONSE_SCHEMAS.text_input.safeParse({ value: 'x', extra: 1 }).success).toBe(false)
    expect(RESPONSE_SCHEMAS.choice.safeParse({ sets: [] }).success).toBe(false)
    expect(
      RESPONSE_SCHEMAS.choice.safeParse({ sets: [{ selected: ['a'] }], confidence: 'maybe' })
        .success,
    ).toBe(false)
    expect(RESPONSE_SCHEMAS.cards.safeParse({ rating: 0 }).success).toBe(false)
    expect(RESPONSE_SCHEMAS.cards.safeParse({ rating: 5 }).success).toBe(false)
    expect(RESPONSE_SCHEMAS.ordering.safeParse({ order: ['a'], indents: { a: -1 } }).success).toBe(
      false,
    )
    expect(RESPONSE_SCHEMAS.cloze.safeParse({ gaps: { 'bad key': 'x' } }).success).toBe(false)
  })
})

describe('responseSchemaFor()', () => {
  it('returns the MVP family schema and throws for a placeholder family', () => {
    expect(responseSchemaFor('choice')).toBe(RESPONSE_SCHEMAS.choice)
    expect(hasResponseSchema('choice')).toBe(true)
    expect(hasResponseSchema('speech')).toBe(false)
    expect(() => responseSchemaFor('speech')).toThrow(RangeError)
  })
})
