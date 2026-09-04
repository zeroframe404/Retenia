import { mulberry32 } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { normalizeText } from './normalize'

/**
 * Property: normalization is idempotent under every option combination
 * (`docs/spec/03-activities.md` §2 FUZ). 500 random strings over an alphabet that mixes
 * accents, combining marks, full-width forms, ligatures, typographic punctuation and odd
 * whitespace — the inputs a real answer box produces.
 */
const CASES = 500
const random = mulberry32(0x5eed)
const ALPHABET = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZáéíóúñüçßÁÉÍÓÚÑÜİ0123456789 \t ’“”–—…ﬁＡＢ１',
  '́',
  '̈',
  'é',
  'ñ',
]

function randomString(): string {
  const length = Math.floor(random() * 24)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)]
  return out
}

describe('normalizeText() idempotence', () => {
  const combos = [
    {},
    { caseSensitive: true },
    { ignoreDiacritics: false },
    { caseSensitive: true, ignoreDiacritics: false },
    { nfkc: false },
    { collapseWhitespace: false },
  ]
  it.each(combos)('normalize(normalize(s)) === normalize(s) with %o', (options) => {
    for (let i = 0; i < CASES; i++) {
      const input = randomString()
      const once = normalizeText(input, options)
      expect(normalizeText(once, options), JSON.stringify(input)).toBe(once)
    }
  })

  it('never leaves a combining mark when diacritics are ignored', () => {
    for (let i = 0; i < CASES; i++) {
      expect(normalizeText(randomString())).not.toMatch(/\p{M}/u)
    }
  })
})
