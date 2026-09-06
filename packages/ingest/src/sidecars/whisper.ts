/**
 * The arguments `whisper-cli` is invoked with, and the parsers for its output
 * (`docs/spec/05-ingestion-rag.md` §1: "local Whisper … timestamps per segment").
 *
 * Pure, for the same reason as `./ffmpeg.ts`: these argv arrays are the injection boundary,
 * and whisper's JSON has changed shape between releases often enough that parsing it deserves
 * fixtures rather than optimism.
 */

export interface WhisperArgsOptions {
  /** GGML weights, e.g. `<models>/ggerganov/whisper.cpp/ggml-small-q5_1.bin`. */
  model: string
  /** The 16 kHz mono WAV ffmpeg just wrote. */
  wav: string
  /**
   * Silero VAD weights. `undefined` drops `--vad` entirely, which is the correct degraded
   * path rather than a bug: whisper still produces correct segment timestamps without voice
   * activity detection. VAD makes it skip silence (cheaper) and cut at pauses (tidier
   * boundaries) — a cost and quality optimisation, not a correctness requirement. That is
   * also why this sub-phase grows no energy-based detector of its own: there would be nothing
   * for it to fix.
   */
  vadModel?: string
  /** BCP-47, or `auto`. */
  language?: string
  threads?: number
  /** Output path prefix, **without** an extension — whisper appends `.json`, `.vtt`. */
  outPrefix: string
}

/** Whisper's own default is 4; one core is left for the rest of the app. */
export function defaultThreads(cpuCount: number): number {
  return Math.max(1, Math.min(8, cpuCount - 1))
}

export function whisperArgs(options: WhisperArgsOptions): readonly string[] {
  const { model, wav, vadModel, language = 'auto', threads = 4, outPrefix } = options

  const args: string[] = [
    '-m',
    model,
    '-f',
    wav,
    '-l',
    language,
    '-t',
    String(threads),
    // `-oj`, not `-ojf`. The full form adds per-token timings and confidences, roughly an
    // order of magnitude more JSON, and nothing downstream reads them: 6.2 windows whole
    // segments into 60–90 s units. `-ojf` is the switch to flip the day word-level
    // highlighting is wanted in the player.
    '-oj',
    '-ovtt',
    '-of',
    outPrefix,
    // Progress percentages on stderr for the job's bar…
    '-pp',
    // …and no real-time transcript printing, which would otherwise interleave with them and
    // make the parse ambiguous.
    '-np',
    // Split segments on word boundaries rather than mid-token, so a segment's text reads as
    // language and a citation never starts halfway through a word.
    '-sow',
  ]

  if (vadModel !== undefined) {
    args.push(
      '--vad',
      '-vm',
      vadModel,
      // whisper.cpp's own defaults, spelled out so a release that changes them cannot change
      // where our transcripts are cut.
      '--vad-threshold',
      '0.5',
      '--vad-min-speech-duration-ms',
      '250',
      '--vad-min-silence-duration-ms',
      '100',
      '--vad-max-speech-duration-s',
      '30',
      '--vad-speech-pad-ms',
      '30',
      '--vad-samples-overlap',
      '0.1',
    )
  }

  return args
}

/** `whisper_print_progress_callback: progress =  42%` → 0.42. */
export function parseWhisperProgress(line: string): number | undefined {
  const match = /progress\s*=\s*(\d{1,3})\s*%/.exec(line)
  if (match === null) return undefined
  const percent = Number.parseInt(match[1] as string, 10)
  if (!Number.isFinite(percent)) return undefined
  return Math.min(1, Math.max(0, percent / 100))
}

export interface WhisperSegment {
  /** Seconds from the start of *this* file — the caller adds the part's offset. */
  startSec: number
  endSec: number
  text: string
}

export interface WhisperTranscript {
  segments: WhisperSegment[]
  /** What whisper detected with `-l auto`, when it says. */
  language: string | null
}

/** `00:01:02,340` or `00:01:02.340` → 62.34. */
export function parseTimestamp(value: string): number | undefined {
  const match = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim())
  if (match === null) return undefined
  const [, h, m, s, ms] = match
  return (
    Number(h) * 3_600 + Number(m) * 60 + Number(s) + Number((ms as string).padEnd(3, '0')) / 1_000
  )
}

interface RawWhisperEntry {
  offsets?: { from?: unknown; to?: unknown }
  timestamps?: { from?: unknown; to?: unknown }
  text?: unknown
}

/**
 * Reads `whisper-cli -oj` output.
 *
 * Tolerant across two shapes on purpose. Every release ships `transcription[].offsets.{from,to}`
 * in **milliseconds**, and every release also ships `timestamps.{from,to}` as `HH:MM:SS,mmm`
 * strings; which one is authoritative has moved, and a build that emits only the strings is
 * not hypothetical. Offsets are preferred (integer milliseconds cannot lose precision the way
 * a re-parsed string can) with the strings as the fallback, so neither shape alone is a
 * silent empty transcript.
 */
export function parseWhisperJson(json: string): WhisperTranscript {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { segments: [], language: null }
  }

  const root = (parsed ?? {}) as {
    transcription?: unknown
    result?: { language?: unknown }
    params?: { language?: unknown }
  }
  const entries: RawWhisperEntry[] = Array.isArray(root.transcription)
    ? (root.transcription as RawWhisperEntry[])
    : []

  const segments: WhisperSegment[] = []
  for (const entry of entries) {
    const text = typeof entry.text === 'string' ? entry.text.trim() : ''
    if (text.length === 0) continue

    const fromMs = typeof entry.offsets?.from === 'number' ? entry.offsets.from : undefined
    const toMs = typeof entry.offsets?.to === 'number' ? entry.offsets.to : undefined

    const startSec =
      fromMs !== undefined
        ? fromMs / 1_000
        : typeof entry.timestamps?.from === 'string'
          ? parseTimestamp(entry.timestamps.from)
          : undefined
    const endSec =
      toMs !== undefined
        ? toMs / 1_000
        : typeof entry.timestamps?.to === 'string'
          ? parseTimestamp(entry.timestamps.to)
          : undefined

    if (startSec === undefined) continue
    segments.push({ startSec, endSec: endSec ?? startSec, text })
  }

  segments.sort((a, b) => a.startSec - b.startSec)

  const detected =
    typeof root.result?.language === 'string'
      ? root.result.language
      : typeof root.params?.language === 'string'
        ? root.params.language
        : null

  return { segments, language: detected === 'auto' ? null : detected }
}

/** `62.34` → `00:01:02.340`, the WebVTT spelling (a dot, and always three decimals). */
export function formatVttTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const hours = Math.floor(clamped / 3_600)
  const minutes = Math.floor((clamped % 3_600) / 60)
  const secs = Math.floor(clamped % 60)
  const millis = Math.round((clamped - Math.floor(clamped)) * 1_000)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(millis, 3)}`
}

export interface VttCue {
  startSec: number
  endSec: number
  text: string
}

/**
 * Builds one WebVTT document for the whole source.
 *
 * Written from the parsed segments rather than by concatenating whisper's own per-part `.vtt`
 * files: a course's cues have to be shifted onto the global timeline, and re-emitting them is
 * both simpler and the only way the `NOTE` headers below can mark where each part begins.
 */
export function buildVtt(
  cues: readonly VttCue[],
  parts: readonly { title: string; startSec: number }[] = [],
): string {
  const lines: string[] = ['WEBVTT', '']
  const marks = new Map(parts.map((part) => [part.startSec, part.title]))

  for (const cue of cues) {
    const mark = marks.get(cue.startSec)
    if (mark !== undefined) {
      lines.push(`NOTE ${mark}`, '')
      marks.delete(cue.startSec)
    }
    lines.push(`${formatVttTimestamp(cue.startSec)} --> ${formatVttTimestamp(cue.endSec)}`)
    lines.push(cue.text)
    lines.push('')
  }

  return lines.join('\n')
}
