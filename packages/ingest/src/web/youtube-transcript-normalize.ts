import type { WhisperSegment } from '../sidecars/whisper'

/**
 * `youtube-transcript`'s own `TranscriptResponse` shape, redeclared rather than imported: this
 * module (and everything under `src/`) is pure and network-free, and importing the package here
 * would pull `youtube-transcript` into every consumer of `@retenia/ingest`'s barrel just to name
 * a type. `main`'s fetch code (which does depend on the real package) passes these straight
 * through.
 */
export interface RawTranscriptCue {
  text: string
  duration: number
  offset: number
}

/**
 * `youtube-transcript` parses two different YouTube caption XML formats and returns the same
 * `{ text, duration, offset }` shape for both — but **not** the same unit. Its modern "srv3"
 * path (`<p t="…" d="…">`, tried first) reports milliseconds; its older "classic" fallback path
 * (`<text start="…" dur="…">`) reports seconds, often fractional. Nothing in the response says
 * which one ran (confirmed by reading the library's source, not documented anywhere), so a
 * caller that assumes one unit gets timestamps that are either right or 1000× too small with no
 * signal to tell the two apart — cross-checked against `docs/spec/05-ingestion-rag.md` §1, which
 * only ever promises "a timestamped transcript", not which library detail produced it.
 *
 * The whole response is always one format or the other — never mixed — so this decides the unit
 * **once**, from the whole transcript, rather than per cue: a per-cue magnitude check would
 * mis-detect a seconds-format transcript's own *offset* once the video passes about 100 seconds
 * (`offset` grows without bound over the video; `duration` does not), while a single video is
 * never partly one format and partly the other.
 */
const MS_THRESHOLD = 100

function detectUnit(cues: readonly RawTranscriptCue[]): 'ms' | 's' {
  const durations = cues.map((cue) => cue.duration).filter((value) => value > 0)
  if (durations.length === 0) return 's'
  const sorted = [...durations].sort((a, b) => a - b)
  // biome-ignore lint/style/noNonNullAssertion: length just checked above
  const median = sorted[Math.floor(sorted.length / 2)]!
  return median >= MS_THRESHOLD ? 'ms' : 's'
}

/** `youtube-transcript`'s raw cues, normalized to `WhisperSegment`s — the exact shape
 *  `media/blocks.ts`'s `transcriptBlocks` already knows how to turn into timed `Block`s, so
 *  `parse-youtube.ts` reuses that function unchanged instead of re-implementing it. */
export function normalizeYouTubeTranscript(cues: readonly RawTranscriptCue[]): WhisperSegment[] {
  if (cues.length === 0) return []
  const divisor = detectUnit(cues) === 'ms' ? 1000 : 1

  return cues
    .map((cue) => {
      const startSec = cue.offset / divisor
      const durationSec = Math.max(0, cue.duration / divisor)
      return { startSec, endSec: startSec + durationSec, text: cue.text.trim() }
    })
    .filter((segment) => segment.text.length > 0)
}
