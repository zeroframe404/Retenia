import { describe, expect, it } from 'vitest'
import { normalizeText } from './normalize'

/** `docs/spec/03-activities.md` §2 FUZ: Unicode normalization before any comparison. */
describe('normalizeText()', () => {
  it('applies NFKC: ligatures, full-width forms and compatibility characters', () => {
    expect(normalizeText('ﬁnal')).toBe('final')
    expect(normalizeText('ＡＢＣ１２３')).toBe('abc123')
    expect(normalizeText('①')).toBe('1')
  })

  it('strips diacritics and lower-cases by default', () => {
    expect(normalizeText('Café Crème')).toBe('cafe creme')
    expect(normalizeText('Año')).toBe('ano')
    expect(normalizeText('Straße')).toBe('straße')
  })

  it('keeps diacritics and case when asked', () => {
    expect(normalizeText('Café', { ignoreDiacritics: false })).toBe('café')
    expect(normalizeText('Café', { caseSensitive: true })).toBe('Cafe')
    expect(normalizeText('Café', { caseSensitive: true, ignoreDiacritics: false })).toBe('Café')
  })

  it('folds typographic quotes, dashes and ellipses to their ASCII forms', () => {
    expect(normalizeText('“don’t” — wait…')).toBe('"don\'t" - wait...')
    expect(normalizeText('3 − 1')).toBe('3 - 1')
  })

  it('trims and collapses whitespace, including NBSP and tabs', () => {
    expect(normalizeText('  a  \t b\n\nc ')).toBe('a b c')
    expect(normalizeText('  a   b ', { collapseWhitespace: false })).toBe('  a   b ')
  })

  it('can skip NFKC and still produce NFC output', () => {
    expect(normalizeText('ﬁ', { nfkc: false })).toBe('ﬁ')
    expect(normalizeText('é', { nfkc: false, ignoreDiacritics: false })).toBe('é')
  })

  it('is idempotent on the cases where lower-casing produces a combining mark', () => {
    const once = normalizeText('İstanbul')
    expect(once).toBe('istanbul')
    expect(normalizeText(once)).toBe(once)
  })
})
