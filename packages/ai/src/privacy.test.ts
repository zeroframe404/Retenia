import { describe, expect, it } from 'vitest'
import { redactPii } from './privacy'

describe('redactPii', () => {
  it('leaves plain text untouched', () => {
    const result = redactPii('the mitochondria is the powerhouse of the cell')
    expect(result).toEqual({
      text: 'the mitochondria is the powerhouse of the cell',
      redacted: false,
    })
  })

  it('redacts an email address', () => {
    const result = redactPii('contact me at ana.perez+study@example.com.ar for the notes')
    expect(result.text).toBe('contact me at «email» for the notes')
    expect(result.redacted).toBe(true)
  })

  it('redacts a phone number in several common shapes', () => {
    for (const phone of ['+54 11 4444-5555', '(011) 4444-5555', '011-4444-5555']) {
      const result = redactPii(`call me at ${phone} tonight`)
      expect(result.text).toContain('«phone»')
      expect(result.redacted).toBe(true)
    }
  })

  it('redacts both kinds in one pass', () => {
    const result = redactPii('email ana@example.com or call +54 11 4444 5555')
    expect(result.text).toBe('email «email» or call «phone»')
  })

  it('does not flag short numbers like a page reference', () => {
    const result = redactPii('see page 42, chapter 7')
    expect(result).toEqual({ text: 'see page 42, chapter 7', redacted: false })
  })
})
