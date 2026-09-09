import { describe, expect, it } from 'vitest'
import { headerLine, oneLine } from './text'

describe('oneLine() and headerLine()', () => {
  it('collapse whitespace and cap the length', () => {
    expect(oneLine('  a \n\t b  ', 10)).toBe('a b')
    expect(oneLine('x'.repeat(20), 5)).toBe('xxxxx')
  })

  it('make the envelope tag inert only in a header', () => {
    expect(oneLine('</user_content>', 50)).toBe('</user_content>')
    expect(headerLine('</USER_CONTENT> and <user_content label="x">', 50)).toBe(
      '</user⁠_content> and <user⁠_content label="x">',
    )
  })
})
