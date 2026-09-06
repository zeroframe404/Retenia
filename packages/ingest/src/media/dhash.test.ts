import { describe, expect, it } from 'vitest'
import { DHASH_BYTES } from '../sidecars/ffmpeg'
import type { HashedFrame } from './dhash'
import { DUPLICATE_DISTANCE, dedupeFrames, dhash, hammingDistance, splitFrames } from './dhash'

/**
 * The de-duplication rule of `docs/spec/05-ingestion-rag.md` §1 ("sampling every 10 s + dHash
 * (Hamming < 8 = duplicate)"), pinned at the two places it can silently stop working.
 *
 * The first is exposure invariance. A *difference* hash was chosen over an average one so that
 * a screencast whose projector dims, or whose second half was re-encoded brighter, still reads
 * as the same slide; a rewrite that compared each pixel against the frame mean instead would
 * pass every other assertion here and fail only that one, so it is asserted directly rather
 * than inferred from a fixture.
 *
 * The second is the exact shape of the threshold. "Hamming < 8" and "Hamming ≤ 8" differ by one
 * frame per near-miss, and the count of near-misses in an hour of lecture is large; the pair
 * exactly `DUPLICATE_DISTANCE` bits apart is therefore its own test.
 *
 * Frames are built by hand rather than decoded from a fixture because the 9×8 grey buffer is
 * ffmpeg's output format, not an image — there is no PNG decoder in this package to read one
 * back with, which is the point of taking the thumbnails from ffmpeg in the first place.
 */

/** Nine pixels stepping down, so every one of the eight comparisons is "brighter than its right neighbour". */
const DESCENDING = [200, 190, 180, 170, 160, 150, 140, 130, 120]
/** The same nine pixels stepping up: eight zero bits. */
const ASCENDING = [...DESCENDING].reverse()
/** Nine equal pixels. `>` is strict, so a flat row is eight zero bits too. */
const FLAT = [64, 64, 64, 64, 64, 64, 64, 64, 64]

/** Eight rows of nine pixels, in the row-major order ffmpeg writes them. */
function frameOf(rows: readonly (readonly number[])[]): Uint8Array {
  return Uint8Array.from(rows.flat())
}

/**
 * A whole-frame exposure change, clamped the way an encoder would clamp it.
 *
 * The invariance only holds while nothing clips: two neighbours pinned to 255 compare equal and
 * lose their bit, which is a real loss of information rather than a flaw in the hash. Shifts
 * here stay inside 0–255 for every pixel of the frames they are applied to.
 */
function brighten(frame: Uint8Array, by: number): Uint8Array {
  return frame.map((value) => Math.min(255, Math.max(0, value + by)))
}

/** Alternating descending and ascending rows: 0xff00 repeated four times. */
const STRIPED = frameOf([
  DESCENDING,
  ASCENDING,
  DESCENDING,
  ASCENDING,
  DESCENDING,
  ASCENDING,
  DESCENDING,
  ASCENDING,
])

/** Flips the `bits` lowest bits of a hash, giving a frame an exact Hamming distance from it. */
function nudge(base: bigint, bits: number): bigint {
  let flipped = base
  for (let bit = 0; bit < bits; bit += 1) flipped ^= 1n << BigInt(bit)
  return flipped
}

function hashed(index: number, hash: bigint): HashedFrame {
  return { index, timeSec: index * 10, hash }
}

describe('dhash', () => {
  it('reads a 9×8 grey frame row-major, most significant bit first', () => {
    expect(STRIPED).toHaveLength(72)
    // Row 0 is descending, so bits 63–56 are all set; row 1 ascending clears bits 55–48.
    expect(dhash(STRIPED)).toBe(0xff00ff00ff00ff00n)
  })

  it('gives a flat frame no bits at all, because the comparison is strict', () => {
    expect(dhash(frameOf([FLAT, FLAT, FLAT, FLAT, FLAT, FLAT, FLAT, FLAT]))).toBe(0n)
  })

  it('compares within a row only, never across the row boundary', () => {
    // Nine columns give eight comparisons per row; a tenth bit per row would fold the last
    // pixel of one row against the first of the next and shift every subsequent bit.
    const oneBrightRow = frameOf([FLAT, FLAT, FLAT, FLAT, FLAT, FLAT, FLAT, DESCENDING])
    expect(dhash(oneBrightRow)).toBe(0xffn)
  })

  it('ignores a uniform brightness shift, which is the whole reason it is a difference hash', () => {
    // A dimmed projector, an auto-brightness step, a re-encode at another quality: every pixel
    // moves together and no pixel overtakes its right neighbour, so not one bit changes.
    expect(dhash(brighten(STRIPED, 40))).toBe(dhash(STRIPED))
    expect(dhash(brighten(STRIPED, -100))).toBe(dhash(STRIPED))
    expect(hammingDistance(dhash(brighten(STRIPED, 50)), dhash(STRIPED))).toBe(0)
  })

  it('still sees a change that alters the order of two neighbours', () => {
    // The counterpart to the previous test: invariance to exposure must not become blindness.
    const changed = Uint8Array.from(STRIPED)
    changed[1] = 255
    expect(dhash(changed)).not.toBe(dhash(STRIPED))
  })

  it('refuses a buffer that is not exactly one frame', () => {
    expect(() => dhash(new Uint8Array(DHASH_BYTES - 1))).toThrow(/72 bytes/)
    expect(() => dhash(new Uint8Array(DHASH_BYTES + 1))).toThrow(/9×8/)
    expect(() => dhash(new Uint8Array(0))).toThrow(/got 0/)
  })
})

describe('hammingDistance', () => {
  it('is zero for a hash against itself', () => {
    expect(hammingDistance(dhash(STRIPED), dhash(STRIPED))).toBe(0)
    expect(hammingDistance(0n, 0n)).toBe(0)
  })

  it('is symmetric', () => {
    const left = dhash(STRIPED)
    const right = nudge(left, 13)
    expect(hammingDistance(left, right)).toBe(hammingDistance(right, left))
  })

  it('counts every differing bit, including bit 63', () => {
    expect(hammingDistance(0n, 0xffff_ffff_ffff_ffffn)).toBe(64)
    expect(hammingDistance(0b1011n, 0b0001n)).toBe(2)
    // The reason the hash is a bigint: bit 63 is past a double's 53 bits of mantissa, and a
    // number-based popcount would report 0 here.
    expect(hammingDistance(1n << 63n, 0n)).toBe(1)
    expect(hammingDistance(0xff00ff00ff00ff00n, 0x00ff00ff00ff00ffn)).toBe(64)
  })

  it('counts exactly as many bits as were flipped', () => {
    const base = dhash(STRIPED)
    for (const bits of [1, 7, 8, 9, 31, 64]) {
      expect(hammingDistance(base, nudge(base, bits))).toBe(bits)
    }
  })
})

describe('splitFrames', () => {
  it('cuts the concatenated pass output into 72-byte frames', () => {
    const raw = new Uint8Array(DHASH_BYTES * 3)
    raw.fill(1, 0, DHASH_BYTES)
    raw.fill(2, DHASH_BYTES, DHASH_BYTES * 2)
    raw.fill(3, DHASH_BYTES * 2)

    const frames = splitFrames(raw)

    expect(frames).toHaveLength(3)
    expect(frames.map((frame) => frame.length)).toEqual([72, 72, 72])
    expect(frames.map((frame) => frame[0])).toEqual([1, 2, 3])
    expect(frames[1]?.every((byte) => byte === 2)).toBe(true)
  })

  it('drops a trailing partial frame rather than hashing a short buffer', () => {
    // ffmpeg can be killed mid-write, or the pipe can close on a truncated frame; a partial
    // tail must not reach `dhash`, which would throw on it.
    expect(splitFrames(new Uint8Array(DHASH_BYTES * 2 + 5))).toHaveLength(2)
    expect(splitFrames(new Uint8Array(DHASH_BYTES - 1))).toEqual([])
    expect(splitFrames(new Uint8Array(0))).toEqual([])
  })
})

describe('dedupeFrames', () => {
  const base = dhash(STRIPED)

  it('keeps the first of a run of near-identical frames', () => {
    // The first is the one the PNG branch already wrote and the one whose timestamp the
    // lesson will cite, so "first wins" is not an arbitrary tie-break.
    const kept = dedupeFrames([
      hashed(0, base),
      hashed(1, nudge(base, 7)),
      hashed(2, nudge(base, 3)),
      hashed(3, base),
    ])

    expect(kept.map((frame) => frame.index)).toEqual([0])
    expect(kept[0]?.timeSec).toBe(0)
  })

  it('keeps a pair exactly DUPLICATE_DISTANCE apart, because the rule is "< 8"', () => {
    expect(DUPLICATE_DISTANCE).toBe(8)
    const frames = [hashed(0, base), hashed(1, nudge(base, DUPLICATE_DISTANCE))]

    expect(dedupeFrames(frames).map((frame) => frame.index)).toEqual([0, 1])
    // One bit closer and the same pair collapses.
    expect(
      dedupeFrames([hashed(0, base), hashed(1, nudge(base, DUPLICATE_DISTANCE - 1))]),
    ).toHaveLength(1)
  })

  it('compares against every kept frame, not only the previous one', () => {
    // A lecture cutting slide → speaker → slide → speaker → slide. Comparing with the
    // predecessor alone keeps all five and blows the 20–60 frames/hour budget on two pictures.
    const slide = base
    const speaker = nudge(base, 20)
    const kept = dedupeFrames([
      hashed(0, slide),
      hashed(1, speaker),
      hashed(2, slide),
      hashed(3, speaker),
      hashed(4, slide),
    ])

    expect(kept.map((frame) => frame.index)).toEqual([0, 1])
  })

  it('keeps everything when no two frames are close, and nothing from an empty pass', () => {
    const frames = [hashed(0, base), hashed(1, nudge(base, 30)), hashed(2, nudge(base, 60))]
    expect(dedupeFrames(frames)).toHaveLength(3)
    expect(dedupeFrames([])).toEqual([])
  })
})
