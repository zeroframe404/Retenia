import { describe, expect, it } from 'vitest'
import {
  normalizeForMatch,
  quotedSpans,
  SPAN_SIMILARITY_THRESHOLD,
  spanMatches,
  spanSimilarity,
} from './fuzzy'

const CHUNK =
  'La memoria de trabajo retiene unos cuatro elementos a la vez, según los experimentos ' +
  'que Cowan publicó en 2001. El bucle fonológico repite la información verbal.'

describe('normalizeForMatch()', () => {
  it('folds case, diacritics and punctuation to single-spaced letters and digits', () => {
    expect(normalizeForMatch('  Según  «Cowan», ¡2001!  ')).toBe('segun cowan 2001')
  })
})

describe('quotedSpans()', () => {
  it('finds the spans in any of the three quote styles, longest first, ignoring tiny ones', () => {
    expect(
      quotedSpans('Dice «retiene unos cuatro» y "el bucle fonológico repite" y “corto”.'),
    ).toEqual(['el bucle fonológico repite', 'retiene unos cuatro'])
  })
})

describe('spanSimilarity()', () => {
  it('is 1 for a verbatim span whatever the case and punctuation', () => {
    expect(spanSimilarity('Retiene unos cuatro elementos', CHUNK)).toBe(1)
  })

  it('passes §5’s 0.85 for a span with one typo and fails it for a different figure', () => {
    expect(spanSimilarity('retiene unos cuatro elemento a la vez', CHUNK)).toBeGreaterThanOrEqual(
      SPAN_SIMILARITY_THRESHOLD,
    )
    expect(spanMatches('retiene unos cuatro elemento a la vez', CHUNK)).toBe(true)
    expect(spanSimilarity('retiene siete elementos a la vez', CHUNK)).toBeLessThan(
      SPAN_SIMILARITY_THRESHOLD,
    )
    expect(spanMatches('retiene siete elementos a la vez', CHUNK)).toBe(false)
  })

  it('is 0 for an empty span, an empty haystack, or nothing in common', () => {
    expect(spanSimilarity('', CHUNK)).toBe(0)
    expect(spanSimilarity('algo', '')).toBe(0)
    expect(spanSimilarity('fotosíntesis clorofila luz', CHUNK)).toBe(0)
  })
})
