/**
 * A course arrives as a folder of lectures (`docs/spec/05-ingestion-rag.md` §1: "the course
 * index (folders/modules) is already a candidate outline"), so this arithmetic is what every
 * citation, chunk boundary and seek in a multi-file source ultimately rests on. The tests pin
 * the properties the rest of the pipeline relies on — that a missing duration never invents an
 * offset, that a boundary belongs to the later part, and that `toGlobal` and `toLocal` invert
 * each other inside a part of known length — rather than the shape of the sums themselves.
 */

import { describe, expect, it } from 'vitest'
import { buildTimeline, type TimelinePart, toGlobal, toLocal, totalDuration } from './timeline'

/** Three lectures of 10, 15 and 2 minutes: offsets 0, 600 and 1500, total 1620. */
const COURSE = buildTimeline([600, 900, 120])

describe('buildTimeline()', () => {
  it('lays the parts end to end, with the first one starting at zero', () => {
    expect(COURSE).toEqual([
      { startSec: 0, durationSec: 600 },
      { startSec: 600, durationSec: 900 },
      { startSec: 1500, durationSec: 120 },
    ])
  })

  it('lets a part of unknown length contribute nothing to the offsets after it', () => {
    // The alternative is to guess the missing length, and a guess is worse than a collision:
    // every later lecture's citations would then point at a time that exists in no file, while
    // an offset that simply does not advance keeps the known parts addressable and monotone.
    expect(buildTimeline([600, null, 900])).toEqual([
      { startSec: 0, durationSec: 600 },
      { startSec: 600, durationSec: null },
      { startSec: 600, durationSec: 900 },
    ])
  })

  it('treats a zero, negative or non-finite duration as unknown', () => {
    // ffprobe reports all four for a truncated or still-downloading file; none of them is a
    // length that may be added to a cursor.
    expect(buildTimeline([0, -30, Number.NaN, Number.POSITIVE_INFINITY, 60])).toEqual([
      { startSec: 0, durationSec: null },
      { startSec: 0, durationSec: null },
      { startSec: 0, durationSec: null },
      { startSec: 0, durationSec: null },
      { startSec: 0, durationSec: 60 },
    ])
  })

  it('builds nothing from no parts', () => {
    expect(buildTimeline([])).toEqual([])
  })
})

describe('totalDuration()', () => {
  it('is the end of the last part', () => {
    expect(totalDuration(COURSE)).toBe(1620)
  })

  it('is null when the last part does not know its own length', () => {
    expect(totalDuration(buildTimeline([600, 900, null]))).toBeNull()
  })

  it('is null for an empty timeline', () => {
    expect(totalDuration([])).toBeNull()
  })

  it('is a lower bound when an earlier part is the unknown one', () => {
    // The hole is invisible in the sum: the total is the last part's end, not the real length of
    // the course. A progress bar reading this must treat it as "at least this long".
    expect(totalDuration(buildTimeline([null, 900]))).toBe(900)
  })
})

describe('toGlobal()', () => {
  it('adds the offset of the part the local time belongs to', () => {
    expect(toGlobal(COURSE, 0, 30)).toBe(30)
    expect(toGlobal(COURSE, 1, 30)).toBe(630)
    expect(toGlobal(COURSE, 2, 0)).toBe(1500)
  })

  it('clamps a negative local time to the start of its part', () => {
    expect(toGlobal(COURSE, 1, -5)).toBe(600)
  })

  it('does not clamp a local time that runs past the end of its part', () => {
    // Whisper's last segment can end a fraction after the container's declared duration; that is
    // a rounding artefact, not a reason to move a citation.
    expect(toGlobal(COURSE, 0, 600.4)).toBe(600.4)
  })

  it('throws for a part that is not on the timeline', () => {
    expect(() => toGlobal(COURSE, 3, 0)).toThrow('no media part at index 3')
    expect(() => toGlobal(COURSE, -1, 0)).toThrow('no media part at index -1')
  })
})

describe('toLocal()', () => {
  it('names the part playing at that moment and the offset inside it', () => {
    expect(toLocal(COURSE, 30)).toEqual({ part: 0, localSec: 30 })
    expect(toLocal(COURSE, 900)).toEqual({ part: 1, localSec: 300 })
    expect(toLocal(COURSE, 1560)).toEqual({ part: 2, localSec: 60 })
  })

  it('resolves a time exactly on a boundary to the later part', () => {
    // Reaching the end of lecture 2 continues into lecture 3, rather than sticking one frame
    // before an end the learner has already watched.
    expect(toLocal(COURSE, 600)).toEqual({ part: 1, localSec: 0 })
    expect(toLocal(COURSE, 1500)).toEqual({ part: 2, localSec: 0 })
  })

  it('resolves a time past the end of the course to the last part', () => {
    expect(toLocal(COURSE, 9999)).toEqual({ part: 2, localSec: 8499 })
  })

  it('clamps a negative time to the very start of the timeline', () => {
    expect(toLocal(COURSE, -1)).toEqual({ part: 0, localSec: 0 })
  })

  it('never selects a zero-length part', () => {
    // A part whose probe came back empty cannot be the one playing: were it selectable, every
    // seek past it would be swallowed by a lecture that has no frame to show.
    const afterProbeFailure: TimelinePart[] = [
      { startSec: 0, durationSec: 600 },
      { startSec: 600, durationSec: 0 },
    ]
    expect(toLocal(afterProbeFailure, 700)).toEqual({ part: 0, localSec: 700 })
  })

  it('throws on an empty timeline', () => {
    expect(() => toLocal([], 0)).toThrow('an empty timeline has no positions')
  })
})

describe('toGlobal() / toLocal() round trip', () => {
  it('returns the position it was given, for any offset inside a part', () => {
    // Only interior offsets round-trip by construction: a local time equal to the part's own
    // length is a boundary, and boundaries deliberately resolve forwards.
    const positions = [
      { part: 0, localSec: 0 },
      { part: 0, localSec: 599.75 },
      { part: 1, localSec: 0 },
      { part: 1, localSec: 450 },
      { part: 2, localSec: 119.5 },
    ]

    for (const position of positions) {
      expect(toLocal(COURSE, toGlobal(COURSE, position.part, position.localSec))).toEqual(position)
    }
  })
})

describe('a part whose length is unknown', () => {
  // `buildTimeline` gives an unmeasurable part and the one after it the same offset, because
  // it refuses to guess a duration. A backward scan alone then always answered with the later
  // part, so every timestamp belonging to the unmeasured lecture resolved into the next file.
  it('is still reachable when a later part shares its offset', () => {
    const parts = buildTimeline([600, null, 900])
    expect(parts.map((part) => part.startSec)).toEqual([0, 600, 600])

    expect(toLocal(parts, 610)).toEqual({ part: 1, localSec: 10 })
    expect(toLocal(parts, toGlobal(parts, 1, 10))).toEqual({ part: 1, localSec: 10 })
  })

  it('does not steal positions from the parts around it', () => {
    const parts = buildTimeline([600, null, 900])
    expect(toLocal(parts, 0).part).toBe(0)
    expect(toLocal(parts, 599).part).toBe(0)
  })

  it('reports a total that is a lower bound, not a fiction', () => {
    // 600 + 900, with the unmeasured lecture contributing nothing — understated rather than
    // invented, which is the trade `buildTimeline` deliberately makes.
    expect(totalDuration(buildTimeline([600, null, 900]))).toBe(1_500)
  })
})
