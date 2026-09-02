import type { Clock } from './ports/clock'
import type { IdGenerator } from './ports/id-generator'

/**
 * UUIDv7 (RFC 9562 §5.7): a 48-bit Unix millisecond timestamp, the version nibble `7`,
 * 12 bits of `rand_a`, the variant bits `10`, and 62 bits of `rand_b`.
 *
 * Every id in Retenia is one of these (`docs/spec/00-conventions.md`): time-ordered so
 * `ORDER BY id` is insertion order, globally unique so a future sync never has to
 * renumber, and generated client-side so a row exists before it hits the database.
 *
 * `packages/core` has no Node imports, so randomness comes from the Web Crypto global
 * (`globalThis.crypto.getRandomValues`) — available in Node 19+, Electron, browsers and
 * workers — or from an injected `RandomBytes` for deterministic tests.
 */

/** Returns `length` cryptographically random bytes. Injectable for tests. */
export type RandomBytes = (length: number) => Uint8Array

interface WebCrypto {
  getRandomValues<T extends ArrayBufferView>(array: T): T
}

/** The Web Crypto CSPRNG, resolved lazily so importing this module never throws. */
export const webCryptoRandomBytes: RandomBytes = (length) => {
  const webCrypto = (globalThis as { crypto?: WebCrypto }).crypto
  if (webCrypto === undefined || typeof webCrypto.getRandomValues !== 'function') {
    throw new Error('UUIDv7: globalThis.crypto.getRandomValues is not available in this runtime')
  }
  return webCrypto.getRandomValues(new Uint8Array(length))
}

/** Lower-case, hyphenated, version nibble `7`, RFC 4122 variant (`8`, `9`, `a` or `b`). */
export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** The largest timestamp that fits in the 48-bit field: year 10889. */
const MAX_TIMESTAMP_MS = 2 ** 48 - 1

function formatUuid(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < 16; i++) {
    hex += HEX[bytes[i] as number]
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Lays out one UUIDv7 from its three fields. `randA` is the 12-bit field after the version
 * nibble; `randB` supplies the 62 random bits after the variant (the top two bits of the
 * first byte are overwritten by the variant).
 */
function buildUuidV7(timestampMs: number, randA: number, randB: Uint8Array): string {
  if (!Number.isInteger(timestampMs) || timestampMs < 0 || timestampMs > MAX_TIMESTAMP_MS) {
    throw new RangeError(`UUIDv7: timestamp ${timestampMs} is outside the 48-bit range`)
  }
  if (randB.length < 8) {
    throw new RangeError('UUIDv7: rand_b needs 8 bytes')
  }

  const bytes = new Uint8Array(16)
  // 48-bit big-endian timestamp. Bit ops are 32-bit in JS, so split arithmetically.
  const high = Math.floor(timestampMs / 2 ** 32)
  const low = timestampMs >>> 0
  bytes[0] = (high >>> 8) & 0xff
  bytes[1] = high & 0xff
  bytes[2] = (low >>> 24) & 0xff
  bytes[3] = (low >>> 16) & 0xff
  bytes[4] = (low >>> 8) & 0xff
  bytes[5] = low & 0xff
  // Version 7 + 12 bits of rand_a.
  bytes[6] = 0x70 | ((randA >>> 8) & 0x0f)
  bytes[7] = randA & 0xff
  // Variant 10xx + 62 bits of rand_b.
  bytes[8] = 0x80 | ((randB[0] as number) & 0x3f)
  for (let i = 1; i < 8; i++) {
    bytes[8 + i] = randB[i] as number
  }
  return formatUuid(bytes)
}

export interface UuidV7Options {
  /** Unix milliseconds to encode; defaults to `Date.now()`. */
  timestampMs?: number
  /** Randomness source; defaults to Web Crypto. */
  random?: RandomBytes
}

/**
 * One UUIDv7 with fully random `rand_a`/`rand_b`. Two calls in the same millisecond are
 * not ordered relative to each other — use `createUuidV7Generator` where ordering within
 * a millisecond matters (which is everywhere rows are inserted).
 */
export function uuidv7(options: UuidV7Options = {}): string {
  const random = options.random ?? webCryptoRandomBytes
  const timestampMs = options.timestampMs ?? Date.now()
  const rand = random(10)
  const randA = (((rand[0] as number) << 8) | (rand[1] as number)) & 0x0fff
  return buildUuidV7(timestampMs, randA, rand.subarray(2, 10))
}

/**
 * A monotonic UUIDv7 `IdGenerator` driven by a `Clock` (RFC 9562 §6.2, method 1: `rand_a`
 * is a 12-bit counter, re-seeded randomly whenever the millisecond changes).
 *
 * - Ids from one generator are strictly increasing, even inside one millisecond and even
 *   if the clock steps backwards (the generator keeps using its last timestamp until the
 *   clock catches up).
 * - If more than 4096 ids are requested in one millisecond, the timestamp is bumped by one
 *   millisecond rather than blocking — ordering is preserved, the id is at most a few
 *   milliseconds "in the future".
 */
export function createUuidV7Generator(
  clock: Clock,
  random: RandomBytes = webCryptoRandomBytes,
): IdGenerator {
  let lastTimestampMs = -1
  let counter = 0

  const seedCounter = (): number => {
    const seed = random(2)
    return (((seed[0] as number) << 8) | (seed[1] as number)) & 0x0fff
  }

  return {
    next: () => {
      const nowMs = Math.floor(clock.now().getTime())
      if (Number.isNaN(nowMs)) {
        throw new TypeError('UUIDv7: Clock.now() returned an invalid Date')
      }

      if (nowMs > lastTimestampMs) {
        lastTimestampMs = nowMs
        counter = seedCounter()
      } else {
        counter += 1
        if (counter > 0x0fff) {
          lastTimestampMs += 1
          counter = seedCounter()
        }
      }

      return buildUuidV7(lastTimestampMs, counter, random(8))
    },
  }
}

/** True for a well-formed UUIDv7 string (lower-case, hyphenated). Rejects v1/v4 ids. */
export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7_PATTERN.test(value)
}

/** The Unix-millisecond timestamp embedded in a UUIDv7 (throws on anything else). */
export function uuidV7Timestamp(id: string): number {
  if (!isUuidV7(id)) {
    throw new TypeError(`UUIDv7: "${id}" is not a UUIDv7`)
  }
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)
}
