import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { RawTranscriptCue } from './youtube-transcript-normalize'
import { normalizeYouTubeTranscript } from './youtube-transcript-normalize'

const FIXTURES = fileURLToPath(new URL('../../test/fixtures/youtube/', import.meta.url))

async function readCues(name: string): Promise<RawTranscriptCue[]> {
  return JSON.parse(await readFile(`${FIXTURES}${name}`, 'utf-8'))
}

describe('normalizeYouTubeTranscript', () => {
  it('converts the modern (srv3, milliseconds) format to seconds', async () => {
    const cues = await readCues('transcript-srv3-ms.json')
    const segments = normalizeYouTubeTranscript(cues)

    expect(segments).toEqual([
      { startSec: 0, endSec: 2.5, text: 'Spaced repetition beats cramming.' },
      { startSec: 2.5, endSec: 5.8, text: 'Here is why it works.' },
      { startSec: 5.8, endSec: 9.2, text: 'The interval grows every time you succeed.' },
    ])
  })

  it('keeps the classic (seconds, often fractional) format as-is', async () => {
    const cues = await readCues('transcript-classic-seconds.json')
    const segments = normalizeYouTubeTranscript(cues)

    expect(segments).toEqual([
      { startSec: 0, endSec: 2.5, text: 'Spaced repetition beats cramming.' },
      { startSec: 2.5, endSec: 5.8, text: 'Here is why it works.' },
      { startSec: 5.8, endSec: 9.2, text: 'The interval grows every time you succeed.' },
    ])
  })

  it("does not mis-detect a long seconds-format transcript's own offset as milliseconds", () => {
    // Every `duration` stays a plausible caption-cue length (seconds); `offset` climbs past the
    // 100 threshold by itself once the video runs for a while. A per-cue magnitude check would
    // wrongly treat cue 3's `offset` as milliseconds; deciding the unit from the whole
    // transcript's durations does not.
    const cues: RawTranscriptCue[] = [
      { text: 'one', offset: 5, duration: 2 },
      { text: 'two', offset: 50, duration: 2.2 },
      { text: 'three', offset: 150, duration: 1.8 },
    ]
    expect(normalizeYouTubeTranscript(cues)).toEqual([
      { startSec: 5, endSec: 7, text: 'one' },
      { startSec: 50, endSec: 52.2, text: 'two' },
      { startSec: 150, endSec: 151.8, text: 'three' },
    ])
  })

  it('drops cues with no text after trimming', () => {
    const cues: RawTranscriptCue[] = [
      { text: '   ', offset: 0, duration: 1 },
      { text: 'real line', offset: 1, duration: 1 },
    ]
    expect(normalizeYouTubeTranscript(cues)).toEqual([
      { startSec: 1, endSec: 2, text: 'real line' },
    ])
  })

  it('returns an empty array for an empty transcript', () => {
    expect(normalizeYouTubeTranscript([])).toEqual([])
  })
})
