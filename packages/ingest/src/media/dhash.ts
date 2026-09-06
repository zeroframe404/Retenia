import { DHASH_BYTES, DHASH_HEIGHT, DHASH_WIDTH } from '../sidecars/ffmpeg'

/**
 * Perceptual de-duplication of keyframes (`docs/spec/05-ingestion-rag.md` §1: "sampling every
 * 10 s + dHash (Hamming < 8 = duplicate)").
 *
 * A *difference* hash rather than an average one, because of what it is being asked to ignore.
 * The frames come from a screen recording, where the same slide is captured over and over with
 * the encoder's noise, a moving cursor and a fading transition between them. dHash records only
 * whether each pixel is brighter than the one to its right, so a change in overall exposure —
 * a dimmed projector, an auto-brightness step, a re-encode at a different quality — moves every
 * pixel together and changes no bit at all. An average hash would call that a new slide.
 *
 * The input is 9×8 greyscale, 72 bytes, produced by ffmpeg itself on the second branch of the
 * keyframe filter graph (`../sidecars/ffmpeg.ts`'s `keyframeArgs`). Nine columns give eight
 * comparisons per row; eight rows give 64 bits. Taking it from ffmpeg is what keeps a PNG
 * *decoder* out of this package — `png-encoder.ts` can only write.
 */

/** Hamming distance below which two frames are the same picture. From the spec. */
export const DUPLICATE_DISTANCE = 8

/**
 * 64 bits, most significant bit first: row 0's leftmost comparison is bit 63.
 *
 * Returned as a `bigint` rather than two numbers or a hex string because the only operations
 * that matter are XOR and popcount, and a `bigint` does both exactly at 64 bits — a `number`
 * would silently lose the top bits to float precision above 2^53.
 */
export function dhash(frame: Uint8Array): bigint {
  if (frame.length !== DHASH_BYTES) {
    throw new Error(
      `a dHash frame is ${DHASH_BYTES} bytes (${DHASH_WIDTH}×${DHASH_HEIGHT}), got ${frame.length}`,
    )
  }
  let hash = 0n
  for (let y = 0; y < DHASH_HEIGHT; y += 1) {
    const row = y * DHASH_WIDTH
    for (let x = 0; x < DHASH_WIDTH - 1; x += 1) {
      hash <<= 1n
      if ((frame[row + x] as number) > (frame[row + x + 1] as number)) hash |= 1n
    }
  }
  return hash
}

/** How many of the 64 bits differ. */
export function hammingDistance(left: bigint, right: bigint): number {
  let diff = left ^ right
  let count = 0
  while (diff !== 0n) {
    diff &= diff - 1n
    count += 1
  }
  return count
}

/** Splits the concatenated raw output of one keyframe pass into per-frame buffers. */
export function splitFrames(raw: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = []
  for (let offset = 0; offset + DHASH_BYTES <= raw.length; offset += DHASH_BYTES) {
    frames.push(raw.subarray(offset, offset + DHASH_BYTES))
  }
  return frames
}

export interface HashedFrame {
  /** Index into the pass's output, which is also the PNG's number. */
  index: number
  timeSec: number
  hash: bigint
}

/**
 * Drops frames that repeat a picture already kept.
 *
 * Compared against every kept frame rather than only the previous one: a lecture that cuts
 * between a slide and the speaker and back produces A B A B A, and a
 * compare-with-predecessor rule keeps all five. Comparing against the whole kept set collapses
 * that to A B, which is what "20–60 keyframes per hour" assumes. The set stays small enough
 * (a few hundred at most, bounded by `KEYFRAME_HARD_CAP`) that the quadratic cost is nothing.
 *
 * The threshold is exclusive: exactly `DUPLICATE_DISTANCE` bits apart is *kept*, matching the
 * spec's "Hamming < 8 = duplicate".
 */
export function dedupeFrames(
  frames: readonly HashedFrame[],
  distance = DUPLICATE_DISTANCE,
): HashedFrame[] {
  const kept: HashedFrame[] = []
  for (const frame of frames) {
    if (kept.some((other) => hammingDistance(frame.hash, other.hash) < distance)) continue
    kept.push(frame)
  }
  return kept
}
