import { describe, expect, it } from 'vitest'
import { AiError } from '../errors'
import { DEFAULT_SANITIZE_LIMITS, sanitizeOutput, sanitizeString } from './sanitize'

describe('sanitizeString()', () => {
  it('strips a well-formed executable element, content included', () => {
    expect(sanitizeString('a<script>alert(1)</script>b', DEFAULT_SANITIZE_LIMITS)).toBe('ab')
    expect(sanitizeString('a<iframe src="x"></iframe>b', DEFAULT_SANITIZE_LIMITS)).toBe('ab')
  })

  it('strips an unclosed opener too', () => {
    expect(sanitizeString('a<object data="x">b', DEFAULT_SANITIZE_LIMITS)).toBe('ab')
  })

  it('leaves ordinary text with angle brackets untouched', () => {
    expect(sanitizeString('a < b and <T> is a generic', DEFAULT_SANITIZE_LIMITS)).toBe(
      'a < b and <T> is a generic',
    )
  })

  it('strips an event-handler attribute that survived its element', () => {
    expect(
      sanitizeString('<img onerror="fetch(1)" src="x">', DEFAULT_SANITIZE_LIMITS),
    ).not.toContain('onerror')
  })

  it('blocks a javascript: URL rather than deleting it outright', () => {
    expect(sanitizeString('javascript:alert(1)', DEFAULT_SANITIZE_LIMITS)).toBe('blocked:alert(1)')
  })

  it('does not reassemble a live tag out of a nested, split opener', () => {
    // Stripping the inner, well-formed `<script>a</script>` in one pass would leave the
    // outer fragments `<scri` and `pt src="…">` to concatenate into a brand-new, live
    // `<script src="…">` — the reassembly bug this loop exists to close.
    const nested = '<scri<script>a</script>pt src="https://evil.example/x.js">'
    const result = sanitizeString(nested, DEFAULT_SANITIZE_LIMITS)
    expect(result).not.toContain('<script')
    expect(result).not.toContain('evil.example')
  })

  it('does not let a nest deeper than the pass budget reassemble a live tag', () => {
    // Each layer of `<scri…pt>` wrapping needs its own pass to unwind, so a nest deep
    // enough outruns the loop's own pass budget and would still be mid-reassembly when it
    // gives up — this is exactly that case, past `MAX_SANITIZE_PASSES`, caught only by the
    // escape pass that runs after the loop.
    const layers = 60
    const nested =
      '<scri'.repeat(layers) +
      '<script>a</script>' +
      'pt>'.repeat(layers - 1) +
      'pt src="https://evil.example/x.js">'
    const result = sanitizeString(nested, DEFAULT_SANITIZE_LIMITS)
    expect(result).not.toContain('<script')
    // The attribute text survives as inert prose by design (the escape pass neutralizes the
    // tag rather than deleting it); what must not survive is a live tag.
    expect(result).not.toMatch(/<\s*script/i)
  })

  it('does not reassemble a live tag out of a doubly-nested opener', () => {
    const nested = '<ifr<ifr<iframe></iframe>ame></iframe>ame src="https://evil.example/">'
    const result = sanitizeString(nested, DEFAULT_SANITIZE_LIMITS)
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('evil.example')
  })

  it('truncates a string over the character cap, after stripping', () => {
    const limits = { ...DEFAULT_SANITIZE_LIMITS, maxStringChars: 10 }
    expect(sanitizeString('0123456789extra', limits)).toBe('012345678…')
  })
})

describe('sanitizeOutput()', () => {
  it('walks strings inside arrays and objects', () => {
    const value = sanitizeOutput({ a: ['<script>x</script>', 'ok'], b: 1, c: null })
    expect(value).toEqual({ a: ['', 'ok'], b: 1, c: null })
  })

  it('sanitizes object keys as well as values', () => {
    const value = sanitizeOutput({ '<script>k</script>': 'v' }) as Record<string, unknown>
    expect(Object.keys(value)).toEqual([''])
  })

  it('drops a __proto__-named key rather than writing through the prototype chain', () => {
    const value = sanitizeOutput(JSON.parse('{"__proto__": {"polluted": true}}')) as object
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects nesting past maxDepth', () => {
    let value: unknown = 'leaf'
    for (let i = 0; i < 5; i += 1) value = [value]
    expect(() => sanitizeOutput(value, { ...DEFAULT_SANITIZE_LIMITS, maxDepth: 3 })).toThrow(
      AiError,
    )
  })

  it('rejects a total size over maxTotalChars', () => {
    const limits = { ...DEFAULT_SANITIZE_LIMITS, maxTotalChars: 5 }
    expect(() => sanitizeOutput({ a: '123456' }, limits)).toThrow(AiError)
  })
})
