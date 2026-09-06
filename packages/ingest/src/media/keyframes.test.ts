import { describe, expect, it } from 'vitest'
import type { HashedFrame } from './dhash'
import {
  ABSOLUTE_MAX_FRAMES,
  maximumKeep,
  minimumKeep,
  sceneDetectionFailed,
  selectKeyframes,
} from './keyframes'

/**
 * The "**20–60 keyframes/hour**" budget of `docs/spec/05-ingestion-rag.md` §1, and the two
 * places where obeying it literally would break sub-phase 6.4's acceptance criterion ("a 20-s
 * sample produces a transcript with timestamps and ≥ 1 keyframe").
 *
 * Twenty frames per hour is a ninth of a frame in twenty seconds. Every rounding rule but
 * "round up, floor at one" answers zero there, and a source with no image at all is a failed
 * ingestion, not a frugal one — so the floor is tested against that exact clip length rather
 * than against a round number.
 *
 * The other place is the order of dedupe and trim inside `selectKeyframes`. Trimming by novelty
 * first looks equivalent on most inputs, so the fixture below is the shape where it is not: a
 * recording that cuts back and forth between two slides before reaching a third. Every repeat
 * is novel against the frame immediately before it, so a trim-first pass spends the budget on
 * pictures it already has and never sees the third slide.
 *
 * Hashes here are prefix masks — the low `n` bits set — so that the Hamming distance between
 * any two frames is just the difference of their two `n` values, and a fixture's dedupe and
 * novelty behaviour can be read off the numbers instead of computed.
 */

/** A hash with its `bits` lowest bits set. Distance between two of these is |bits − bits|. */
function prefixMask(bits: number): bigint {
  return (1n << BigInt(bits)) - 1n
}

function hashed(index: number, hash: bigint): HashedFrame {
  return { index, timeSec: index * 10, hash }
}

/** Three minutes: `maximumKeep` returns exactly 3, small enough to reason about by hand. */
const SHORT_CLIP_SEC = 180

describe('minimumKeep', () => {
  it('keeps at least one frame of a 20-second clip, where the rate alone gives a ninth of one', () => {
    expect(minimumKeep(20)).toBe(1)
    expect(minimumKeep(1)).toBe(1)
  })

  it('falls back to one frame when ffprobe reported no usable duration', () => {
    expect(minimumKeep(null)).toBe(1)
    expect(minimumKeep(0)).toBe(1)
    expect(minimumKeep(-1)).toBe(1)
  })

  it('is 20 frames an hour, rounded up', () => {
    expect(minimumKeep(3_600)).toBe(20)
    expect(minimumKeep(7_200)).toBe(40)
    // 1.11 frames' worth of clip still asks for two, never one.
    expect(minimumKeep(200)).toBe(2)
  })
})

describe('maximumKeep', () => {
  it('is 60 frames an hour', () => {
    expect(maximumKeep(3_600)).toBe(60)
    expect(maximumKeep(7_200)).toBe(120)
  })

  it('never falls below three, so a short clip still gets a strip rather than a single image', () => {
    expect(maximumKeep(60)).toBe(3)
    expect(maximumKeep(SHORT_CLIP_SEC)).toBe(3)
    expect(maximumKeep(240)).toBe(4)
    expect(maximumKeep(null)).toBe(3)
    expect(maximumKeep(0)).toBe(3)
  })

  it('stops at ABSOLUTE_MAX_FRAMES however long the source is', () => {
    expect(ABSOLUTE_MAX_FRAMES).toBe(400)
    // 6 h 40 min is where the rate reaches the cap; a ten-hour course does not go past it.
    expect(maximumKeep(24_000)).toBe(400)
    expect(maximumKeep(36_000)).toBe(400)
    expect(maximumKeep(360_000)).toBe(400)
  })
})

describe('selectKeyframes', () => {
  it('dedupes before trimming, so the budget is not spent on a picture already kept', () => {
    // The recording cuts A B A B and only then reaches a third slide, with a ceiling of 3.
    // Each repeat looks maximally novel next to its predecessor — it is a different picture
    // from the one immediately before it — so trimming first picks frames 0, 1 and 2, dedupes
    // 2 away as a copy of 0, and ends with two frames and no sight of slide C at all.
    const frames = [
      hashed(0, prefixMask(0)),
      hashed(1, prefixMask(50)),
      hashed(2, prefixMask(0)),
      hashed(3, prefixMask(50)),
      hashed(4, prefixMask(25)),
    ]

    const result = selectKeyframes(frames, SHORT_CLIP_SEC)

    expect(result.kept.map((frame) => frame.index)).toEqual([0, 1, 4])
    expect(result.duplicatesDropped).toBe(2)
    expect(result.overBudgetDropped).toBe(0)
  })

  it('keeps the most novel frames and returns them in time order', () => {
    // Novelty is the distance from the previously kept frame: 64 (nothing preceded it), then
    // 9, 30, 12, 20. The three most novel are frames 0, 2 and 4.
    const frames = [
      hashed(0, prefixMask(0)),
      hashed(1, prefixMask(9)),
      hashed(2, prefixMask(39)),
      hashed(3, prefixMask(51)),
      hashed(4, prefixMask(31)),
    ]

    const result = selectKeyframes(frames, SHORT_CLIP_SEC)

    // Sorted by novelty to choose, then back into time order: a strip read left to right must
    // follow the lecture, and the citations attached to it are timestamps.
    expect(result.kept.map((frame) => frame.index)).toEqual([0, 2, 4])
    expect(result.kept.map((frame) => frame.timeSec)).toEqual([0, 20, 40])
    expect(result.duplicatesDropped).toBe(0)
    expect(result.overBudgetDropped).toBe(2)
  })

  it('accounts for every frame it was given', () => {
    // Same five distinct pictures with a near-duplicate inserted after the first and the third,
    // so that both reasons for dropping a frame are exercised at once.
    const frames = [
      hashed(0, prefixMask(0)),
      hashed(1, prefixMask(0) ^ 0b11n),
      hashed(2, prefixMask(9)),
      hashed(3, prefixMask(39)),
      hashed(4, prefixMask(39) ^ 0b1n),
      hashed(5, prefixMask(51)),
      hashed(6, prefixMask(31)),
    ]

    const result = selectKeyframes(frames, SHORT_CLIP_SEC)

    expect(result.kept.map((frame) => frame.index)).toEqual([0, 3, 6])
    expect(result.duplicatesDropped).toBe(2)
    expect(result.overBudgetDropped).toBe(2)
    // The three numbers are what the job log and `SourceDoc.meta` report, so they have to
    // partition the input rather than merely be plausible.
    expect(result.kept.length + result.duplicatesDropped + result.overBudgetDropped).toBe(
      frames.length,
    )
  })

  it('leaves an under-budget pass untouched', () => {
    const frames = [hashed(0, prefixMask(0)), hashed(1, prefixMask(20))]
    const result = selectKeyframes(frames, 3_600)

    expect(result.kept).toEqual(frames)
    expect(result.duplicatesDropped).toBe(0)
    expect(result.overBudgetDropped).toBe(0)
  })

  it('survives a pass that produced nothing', () => {
    expect(selectKeyframes([], 3_600)).toEqual({
      kept: [],
      duplicatesDropped: 0,
      overBudgetDropped: 0,
    })
  })
})

describe('sceneDetectionFailed', () => {
  it('is true when the scene pass found fewer frames than the floor', () => {
    // An hour of screencast asks for 20; ffmpeg's `scene` score on flat slides rarely clears
    // its threshold, and that is when the `fps=1/10` interval pass has to take over.
    expect(sceneDetectionFailed(19, 3_600)).toBe(true)
    expect(sceneDetectionFailed(0, 3_600)).toBe(true)
  })

  it('is false once the floor is met, including exactly at it', () => {
    expect(sceneDetectionFailed(20, 3_600)).toBe(false)
    expect(sceneDetectionFailed(40, 3_600)).toBe(false)
  })

  it('treats a single frame as enough for a 20-second clip or an unknown duration', () => {
    expect(sceneDetectionFailed(0, 20)).toBe(true)
    expect(sceneDetectionFailed(1, 20)).toBe(false)
    expect(sceneDetectionFailed(0, null)).toBe(true)
    expect(sceneDetectionFailed(1, null)).toBe(false)
  })
})

describe('the floor and the ceiling past twenty hours', () => {
  it('never asks for more frames than it is willing to keep', () => {
    // The two rates cross at twenty hours, where both reach ABSOLUTE_MAX_FRAMES. An unclamped
    // floor would then exceed the ceiling, making `sceneDetectionFailed` true for every long
    // source however well the scene filter did — and the interval fallback unconditional.
    for (const hours of [1, 10, 20, 22, 30, 100]) {
      const seconds = hours * 3_600
      expect(minimumKeep(seconds)).toBeLessThanOrEqual(maximumKeep(seconds))
    }
  })

  it('still asks for at least one frame from a twenty-second clip', () => {
    expect(minimumKeep(20)).toBe(1)
  })
})
