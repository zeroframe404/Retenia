import { describe, expect, it } from 'vitest'
import {
  createUuidV7Generator,
  isUuidV7,
  type RandomBytes,
  UUID_V7_PATTERN,
  uuidV7Timestamp,
  uuidv7,
} from './ids'
import type { Clock } from './ports/clock'

/** A `RandomBytes` that always returns the same byte — deterministic, and `0xff` maxes
 * out the 12-bit counter seed so overflow paths can be reached. */
function constantRandom(byte: number): RandomBytes {
  return (length) => new Uint8Array(length).fill(byte)
}

function clockAt(ms: number): Clock {
  return { now: () => new Date(ms) }
}

describe('uuidv7()', () => {
  it('produces a lower-case, hyphenated UUIDv7 with the RFC 4122 variant', () => {
    const id = uuidv7()
    expect(id).toMatch(UUID_V7_PATTERN)
    expect(id).toHaveLength(36)
    expect(id.charAt(14)).toBe('7')
    expect('89ab').toContain(id.charAt(19))
  })

  it('encodes the timestamp in the first 48 bits', () => {
    const timestampMs = Date.UTC(2026, 8, 2, 12, 34, 56, 789)
    const id = uuidv7({ timestampMs })
    expect(uuidV7Timestamp(id)).toBe(timestampMs)
    expect(id.startsWith(timestampMs.toString(16).padStart(12, '0').slice(0, 8))).toBe(true)
  })

  it('is deterministic given a fixed random source and timestamp', () => {
    const options = { timestampMs: 0, random: constantRandom(0xab) }
    expect(uuidv7(options)).toBe(uuidv7(options))
    // Version and variant win over the random bytes underneath them.
    expect(uuidv7(options)).toBe('00000000-0000-7bab-abab-abababababab')
  })

  it('rejects timestamps outside the 48-bit range', () => {
    expect(() => uuidv7({ timestampMs: -1 })).toThrow(RangeError)
    expect(() => uuidv7({ timestampMs: 2 ** 48 })).toThrow(RangeError)
    expect(() => uuidv7({ timestampMs: 1.5 })).toThrow(RangeError)
  })

  it('uses Web Crypto by default (Node exposes it as globalThis.crypto)', () => {
    const a = uuidv7()
    const b = uuidv7()
    expect(a).not.toBe(b)
  })
})

describe('createUuidV7Generator()', () => {
  it('returns strictly increasing ids inside a single millisecond', () => {
    const generator = createUuidV7Generator(clockAt(1_700_000_000_000))
    const ids = Array.from({ length: 2000 }, () => generator.next())

    for (let i = 1; i < ids.length; i++) {
      expect((ids[i] as string) > (ids[i - 1] as string)).toBe(true)
    }
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(UUID_V7_PATTERN)
  })

  it('advances the timestamp when the 12-bit counter overflows', () => {
    // The seed is 0x0fff (all bits set), so the very next id in the same ms must overflow.
    const generator = createUuidV7Generator(clockAt(1000), constantRandom(0xff))
    const first = generator.next()
    const second = generator.next()

    expect(uuidV7Timestamp(first)).toBe(1000)
    expect(uuidV7Timestamp(second)).toBe(1001)
    expect(second > first).toBe(true)
  })

  it('never goes backwards when the clock does', () => {
    let now = 5000
    const generator = createUuidV7Generator({ now: () => new Date(now) })
    const before = generator.next()
    now = 4000
    const after = generator.next()

    expect(after > before).toBe(true)
    expect(uuidV7Timestamp(after)).toBe(5000)
  })

  it('re-seeds the counter and follows the clock once it moves forward', () => {
    let now = 1
    const generator = createUuidV7Generator({ now: () => new Date(now) }, constantRandom(0x00))
    const a = generator.next()
    now = 2
    const b = generator.next()

    expect(uuidV7Timestamp(a)).toBe(1)
    expect(uuidV7Timestamp(b)).toBe(2)
    // Counter seeded to 0 by the constant random source: rand_a reads as 000.
    expect(b.slice(14, 18)).toBe('7000')
  })

  it('throws on an invalid Date from the clock', () => {
    const generator = createUuidV7Generator({ now: () => new Date(Number.NaN) })
    expect(() => generator.next()).toThrow(TypeError)
  })
})

describe('isUuidV7() / uuidV7Timestamp()', () => {
  it('accepts v7 ids and rejects everything else', () => {
    expect(isUuidV7(uuidv7())).toBe(true)
    expect(isUuidV7('019a05a4-3fc0-7b39-9bf2-1abab07b14b1')).toBe(true)
    // v4 (version nibble 4)
    expect(isUuidV7('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(false)
    // upper-case is not canonical
    expect(isUuidV7('019A05A4-3FC0-7B39-9BF2-1ABAB07B14B1')).toBe(false)
    // wrong variant
    expect(isUuidV7('019a05a4-3fc0-7b39-7bf2-1abab07b14b1')).toBe(false)
    expect(isUuidV7('')).toBe(false)
    expect(isUuidV7(42)).toBe(false)
    expect(isUuidV7(null)).toBe(false)
  })

  it('uuidV7Timestamp throws for non-v7 input', () => {
    expect(() => uuidV7Timestamp('not-an-id')).toThrow(TypeError)
  })
})
