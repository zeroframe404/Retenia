/**
 * The exact arguments ffmpeg and ffprobe are invoked with, and the parsers for what they
 * print back (`docs/spec/05-ingestion-rag.md` §1, `docs/spec/07-architecture.md` §7).
 *
 * Pure functions, deliberately: an argv array is the security boundary of this whole
 * sub-phase — `runSidecar` never uses a shell, so an argument is only dangerous if it is
 * *built* wrongly — and a builder that returns a string instead of an array is exactly how a
 * path with a space or a quote in it stops being one argument. Every path below is its own
 * element, and `ffmpeg.test.ts` asserts that rather than trusting it.
 *
 * Progress arrives on **stdout** (`-progress pipe:1`), which leaves stderr as a pure
 * diagnostics channel. Splitting them that way means a parse failure in one cannot swallow
 * the other's error message, which is what a job's `error` column ends up showing.
 */

/** Whisper wants 16 kHz mono PCM and nothing else; this is not a quality choice. */
export const WHISPER_SAMPLE_RATE = 16_000

/** The scene-change score above which a frame is a candidate keyframe. From the spec's
 *  `select='gt(scene,0.3)'`. */
export const SCENE_THRESHOLD = 0.3

/** The interval fallback when a recording has no cuts at all — a screencast of one slide
 *  deck, which is the common case for a course. From the spec's `fps=1/10`. */
export const INTERVAL_SECONDS = 10

/** dHash works on a 9×8 grey image: 8 horizontal comparisons per row, 8 rows, 64 bits. */
export const DHASH_WIDTH = 9
export const DHASH_HEIGHT = 8
export const DHASH_BYTES = DHASH_WIDTH * DHASH_HEIGHT

/** Frames ffmpeg is allowed to emit in one keyframe pass, before dedupe and the per-hour cap
 *  narrow it further. A ceiling on scratch disk, not a quality setting: a two-hour lecture
 *  with a busy screen recording can trip the scene filter thousands of times. */
export const KEYFRAME_HARD_CAP = 400

/** How much of a video's timeline a single keyframe pass is asked to cover, in seconds.
 *  `-frames:v` truncates *both* mapped outputs at once, and because they are fed by the same
 *  decode, ffmpeg stops reading the input the moment they fill — for a recording longer than
 *  this and busy enough to fill `KEYFRAME_HARD_CAP` before reaching the end, that means every
 *  page after wherever the budget ran out gets zero keyframes, not just fewer of them.
 *  `planKeyframeSegments` splits a longer recording into windows no wider than this, each
 *  with its own share of the budget, so activity near the start can no longer crowd out
 *  everything after it. */
export const KEYFRAME_SEGMENT_SEC = 600

/** However long a recording runs, never split it into more passes than this — each pass is
 *  its own `ffmpeg` spawn (and, on the scene strategy, its own decode of that slice), so an
 *  unbounded segment count would trade the front-loading bug for a slow import instead. */
export const MAX_KEYFRAME_SEGMENTS = 12

/** Arguments common to every ffmpeg run. `-nostdin` matters more than it looks: without it a
 *  spawned ffmpeg that inherits a terminal can consume the parent's input, and with
 *  `stdio: ['ignore', …]` it can spin on a closed descriptor instead of exiting. */
const BASE_ARGS = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y'] as const
const PROGRESS_ARGS = ['-progress', 'pipe:1', '-nostats'] as const

/** `ffprobe -of json` over one file: duration plus enough stream detail to know whether there
 *  is anything to transcribe or to take frames from. */
export function probeArgs(input: string): readonly string[] {
  return [
    '-v',
    'error',
    '-hide_banner',
    '-of',
    'json',
    '-show_entries',
    'format=duration:stream=index,codec_type,width,height,duration',
    '-i',
    input,
  ]
}

/**
 * 16 kHz mono PCM WAV, one part at a time.
 *
 * Per part rather than one concatenated stream: it bounds whisper's memory, makes a cancelled
 * run cheap to redo, and reduces the global-timeline arithmetic to a single addition per part.
 *
 * `-map 0:a:0` picks the first audio stream explicitly. A course recording often carries a
 * second commentary track, and letting ffmpeg choose "the best" one means the transcript
 * silently comes from a different track than the one the learner hears.
 */
export function extractWavArgs(input: string, output: string): readonly string[] {
  return [
    ...BASE_ARGS,
    ...PROGRESS_ARGS,
    '-i',
    input,
    '-vn',
    '-sn',
    '-dn',
    '-map',
    '0:a:0',
    '-ac',
    '1',
    '-ar',
    String(WHISPER_SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    output,
  ]
}

export type KeyframeStrategy = 'scene' | 'interval'

export interface KeyframeArgsOptions {
  input: string
  /** `<dir>/kf-%04d.png` — ffmpeg's own numbering, so frame *n* is the *n*th selected. */
  pngPattern: string
  /** One file of raw 9×8 grey frames, `DHASH_BYTES` each, in the same order. */
  rawPath: string
  strategy: KeyframeStrategy
  /** Longest edge of the stored PNG. */
  maxWidth?: number
  frameCap?: number
  /** Seconds into the file this pass should start reading from — a segment's own offset, for
   *  a video long enough that `planKeyframeSegments` split it. `0` (the default) reads from
   *  the start, exactly as every pass did before segmentation existed. Applied as an input
   *  option (`-ss` before `-i`) for a fast, keyframe-aligned seek: precision to the exact
   *  frame is not needed here, only that each window starts roughly where it was asked to —
   *  `runKeyframePass` adds this same offset back onto every `showinfo` timestamp the pass
   *  reports, since ffmpeg rebases a seeked input's timestamps to start near zero. */
  startSec?: number
  /** How much of the file, from `startSec`, this pass should read. `undefined` reads to EOF —
   *  what every pass did before segmentation, and still what the last (or the only) segment
   *  asks for, since only `planKeyframeSegments` knows where a video actually ends. */
  clipDurationSec?: number
}

/**
 * One pass that produces both the stored PNG and the perceptual-hash input.
 *
 * The `split` is the whole trick, and it is what keeps an image *decoder* out of this package.
 * `png-encoder.ts` can write a PNG but nothing here can read one, so hashing a frame we had
 * just written would mean adding a decoder for the sake of 72 bytes. Instead ffmpeg is asked
 * for the 9×8 grey buffer directly on a second branch of the same graph: `dhash.ts` becomes a
 * pure function over a `Uint8Array`, and the two outputs stay index-aligned because `select`
 * passes frames in order down both branches.
 *
 * Timestamps come from `showinfo` on stderr rather than `metadata=print:file=`. The file form
 * reads better until the path is a Windows one — ffmpeg's filter parser treats `:` as an option
 * separator and `\` as an escape, so `file=C:\Users\…` breaks the graph. `showinfo` needs no
 * path at all.
 */
export function keyframeArgs(options: KeyframeArgsOptions): readonly string[] {
  const {
    input,
    pngPattern,
    rawPath,
    strategy,
    maxWidth = 1280,
    frameCap = KEYFRAME_HARD_CAP,
    startSec = 0,
    clipDurationSec,
  } = options

  const selector =
    strategy === 'scene' ? `select='gt(scene,${SCENE_THRESHOLD})'` : `fps=1/${INTERVAL_SECONDS}`

  const graph = [
    `[0:v]${selector},split=2[a][b]`,
    `[a]showinfo,scale='min(${maxWidth},iw)':-2[full]`,
    `[b]scale=${DHASH_WIDTH}:${DHASH_HEIGHT},format=gray[thumb]`,
  ].join(';')

  return [
    ...BASE_ARGS,
    // `showinfo` logs at info level, so the blanket `-loglevel error` above would silence the
    // very lines the timestamps come from. Raised only for this filter.
    '-loglevel',
    'info',
    ...PROGRESS_ARGS,
    ...(startSec > 0 ? ['-ss', String(startSec)] : []),
    ...(clipDurationSec === undefined ? [] : ['-t', String(clipDurationSec)]),
    '-i',
    input,
    '-filter_complex',
    graph,
    '-map',
    '[full]',
    '-fps_mode',
    'vfr',
    '-frames:v',
    String(frameCap),
    '-f',
    'image2',
    pngPattern,
    '-map',
    '[thumb]',
    '-fps_mode',
    'vfr',
    '-frames:v',
    String(frameCap),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    rawPath,
  ]
}

export interface KeyframeSegment {
  /** Where this pass should start reading, in seconds from the file's own start. */
  startSec: number
  /** How long this pass should read, from `startSec` — `null` reads to EOF, which only the
   *  last (or the only) segment ever asks for, since only a known total duration lets a
   *  segment before it know where to stop. */
  clipDurationSec: number | null
  /** This segment's share of the overall frame budget. */
  frameCap: number
}

/**
 * Splits a video's duration into windows no single keyframe pass will overrun, each with its
 * own share of the frame budget.
 *
 * This is the fix for the front-loading bug `KEYFRAME_SEGMENT_SEC`'s own comment describes:
 * `-frames:v` truncates a whole-file pass wherever its budget runs out, which for a long,
 * cut-heavy recording is always somewhere near the start — the back half of a two-hour
 * screencast got no keyframes at all, not just fewer of them. A duration ffmpeg never
 * reported (`durationSec: null`), or one short enough to fit in a single window, gets exactly
 * the one segment every pass ran before this fix, unchanged — no seek, no offset arithmetic,
 * nothing to get subtly wrong for what is still the common case.
 */
export function planKeyframeSegments(
  durationSec: number | null,
  frameCap: number = KEYFRAME_HARD_CAP,
): readonly KeyframeSegment[] {
  if (durationSec === null || durationSec <= KEYFRAME_SEGMENT_SEC) {
    return [{ startSec: 0, clipDurationSec: null, frameCap }]
  }

  const segmentCount = Math.min(
    MAX_KEYFRAME_SEGMENTS,
    Math.ceil(durationSec / KEYFRAME_SEGMENT_SEC),
  )
  const segmentSec = durationSec / segmentCount
  const perSegmentCap = Math.max(1, Math.ceil(frameCap / segmentCount))

  return Array.from({ length: segmentCount }, (_unused, index) => {
    const startSec = index * segmentSec
    const isLast = index === segmentCount - 1
    return {
      startSec,
      clipDurationSec: isLast ? durationSec - startSec : segmentSec,
      frameCap: perSegmentCap,
    }
  })
}

export interface ProbeResult {
  /** Seconds, or `null` when the container does not say and no stream does either. A course
   *  part with a broken header must not sink the whole import. */
  durationSec: number | null
  hasVideo: boolean
  hasAudio: boolean
  width: number | null
  height: number | null
}

interface RawProbeStream {
  codec_type?: unknown
  width?: unknown
  height?: unknown
  duration?: unknown
}

function asNumber(value: unknown): number | null {
  const n =
    typeof value === 'string'
      ? Number.parseFloat(value)
      : typeof value === 'number'
        ? value
        : Number.NaN
  return Number.isFinite(n) ? n : null
}

/** Reads `ffprobe -of json`. Tolerant by design: every field is optional in some container. */
export function parseProbeJson(json: string): ProbeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { durationSec: null, hasVideo: false, hasAudio: false, width: null, height: null }
  }
  const root = (parsed ?? {}) as { format?: { duration?: unknown }; streams?: unknown }
  const streams: RawProbeStream[] = Array.isArray(root.streams)
    ? (root.streams as RawProbeStream[])
    : []

  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')

  // A container's own duration first; a stream's as the fallback, because MPEG-TS and some
  // Matroska files carry it only per stream.
  const durationSec =
    asNumber(root.format?.duration) ?? asNumber(audio?.duration) ?? asNumber(video?.duration)

  return {
    durationSec: durationSec !== null && durationSec > 0 ? durationSec : null,
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
    width: asNumber(video?.width),
    height: asNumber(video?.height),
  }
}

/**
 * Turns `-progress` output into a 0–1 fraction.
 *
 * The stream is `key=value` lines terminated by `progress=continue` or `progress=end`. Only
 * `out_time_us` is trusted for the position: `out_time_ms` is famously microseconds in several
 * ffmpeg releases, and `out_time` is a formatted string that has to be re-parsed. A line that
 * is not `key=value` is ignored rather than guessed at — with `-loglevel info` in the keyframe
 * pass, ordinary log lines do reach this parser.
 */
export function createFfmpegProgressParser(durationSec: number | null): {
  line(line: string): number | undefined
} {
  let last = 0
  return {
    line(line) {
      const eq = line.indexOf('=')
      if (eq <= 0) return undefined
      const key = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim()

      if (key === 'progress' && value === 'end') {
        last = 1
        return 1
      }
      if (key !== 'out_time_us') return undefined
      if (durationSec === null || durationSec <= 0) return undefined

      const micros = Number.parseInt(value, 10)
      if (!Number.isFinite(micros) || micros < 0) return undefined

      // Monotone by construction: a seek or a stream discontinuity can make ffmpeg report a
      // position that goes backwards, and a progress bar that retreats reads as a bug.
      const fraction = Math.min(1, micros / 1_000_000 / durationSec)
      if (fraction < last) return undefined
      last = fraction
      return fraction
    },
  }
}

/** `[Parsed_showinfo_1 @ 0x…] n: 0 pts: 1024 pts_time:0.042 …` → 0.042. */
export function parseShowinfoTime(line: string): number | undefined {
  const match = /\bpts_time:\s*(-?\d+(?:\.\d+)?)/.exec(line)
  if (match === null) return undefined
  const seconds = Number.parseFloat(match[1] as string)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}
