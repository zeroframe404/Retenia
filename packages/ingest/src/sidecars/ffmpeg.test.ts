import { describe, expect, it } from 'vitest'
import {
  createFfmpegProgressParser,
  DHASH_HEIGHT,
  DHASH_WIDTH,
  extractWavArgs,
  INTERVAL_SECONDS,
  KEYFRAME_HARD_CAP,
  KEYFRAME_SEGMENT_SEC,
  keyframeArgs,
  MAX_KEYFRAME_SEGMENTS,
  parseProbeJson,
  parseShowinfoTime,
  planKeyframeSegments,
  probeArgs,
  SCENE_THRESHOLD,
  WHISPER_SAMPLE_RATE,
} from './ffmpeg'

/**
 * The argv builders of sub-phase 6.4 (`docs/spec/05-ingestion-rag.md` §1), tested as the
 * injection boundary they are rather than as a list of flags.
 *
 * `runSidecar` never uses a shell, so an argument to ffmpeg can only be dangerous if it was
 * *built* wrongly — and the single mistake that does it is joining. A builder that returned
 * `-i ${input}` as one element, or its whole command as a string, would still satisfy every
 * "does it ask for 16 kHz mono?" assertion while turning a lecture filed under
 * `Semana 1; "clase 2".mp4` into four arguments and a command. Each builder is therefore
 * checked twice: once for the flags the pipeline actually depends on, and once with
 * `expectPathsAreWholeArguments` against a path carrying the spaces, quotes and semicolon a
 * real course folder can contain.
 *
 * The parsers are pinned against text ffmpeg and ffprobe really print, because the failure
 * mode there is silence: a probe that throws on a malformed container, or a progress line
 * mis-read as a position, surfaces as a stalled job rather than as an error.
 */

/**
 * A filename with spaces, both quote kinds, a semicolon and an ampersand — every character a
 * shell would act on, all of them legal on Windows except the quotes, which are legal
 * everywhere else and reach us through imported course archives.
 */
const HOSTILE_INPUT = 'D:\\Cursos\\Semana 1; "clase 2" & repaso.mp4'
const HOSTILE_PNG_PATTERN = 'D:\\Cursos\\out dir; $(id)\\kf-%04d.png'
const HOSTILE_RAW = 'D:\\Cursos\\out dir; $(id)\\frames.gray'

/** Asserts each path arrives as exactly one whole element: present verbatim, and no *other*
 *  element merely contains it, which is what a joined `-i <path>` would look like. */
function expectPathsAreWholeArguments(args: readonly string[], paths: readonly string[]): void {
  for (const path of paths) {
    expect(args.filter((arg) => arg.includes(path))).toEqual([path])
  }
}

/** Anything beginning with `-` must be a bare option name, so `['-ac', '1']` can never have
 *  been written `['-ac 1']` or `['-ac=1']`. Values are allowed to contain anything. */
function expectNoFlagCarriesItsValue(args: readonly string[]): void {
  for (const arg of args) {
    if (arg.startsWith('-')) expect(arg).not.toMatch(/[\s=]/)
  }
}

/** True when `flag` is immediately followed by `value`, which is the only adjacency ffmpeg
 *  reads — a flag and a value separated by another element mean something else entirely. */
function hasPair(args: readonly string[], flag: string, value: string): boolean {
  return args.some((arg, index) => arg === flag && args[index + 1] === value)
}

/** The value ffmpeg would honour for a repeated global option: the last occurrence wins. */
function lastValueOf(args: readonly string[], flag: string): string | undefined {
  const index = args.lastIndexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

/** The `-filter_complex` graph, asserted to be one element on the way out. */
function graphOf(args: readonly string[]): string {
  const index = args.indexOf('-filter_complex')
  expect(index).toBeGreaterThan(-1)
  return args[index + 1] as string
}

describe('probeArgs', () => {
  it('asks ffprobe for JSON and for exactly the fields the parser reads', () => {
    expect(probeArgs('/media/lecture.mkv')).toEqual([
      '-v',
      'error',
      '-hide_banner',
      '-of',
      'json',
      '-show_entries',
      'format=duration:stream=index,codec_type,width,height,duration',
      '-i',
      '/media/lecture.mkv',
    ])
  })

  it('keeps a path with spaces, quotes and a semicolon as a single argument', () => {
    const args = probeArgs(HOSTILE_INPUT)
    expectPathsAreWholeArguments(args, [HOSTILE_INPUT])
    expectNoFlagCarriesItsValue(args)
  })
})

describe('extractWavArgs', () => {
  const args = extractWavArgs('/media/part-01.mp4', '/tmp/part-01.wav')

  it('asks for the 16 kHz mono PCM whisper requires and nothing else', () => {
    expect(WHISPER_SAMPLE_RATE).toBe(16_000)
    expect(hasPair(args, '-ac', '1')).toBe(true)
    // Literal rather than `String(WHISPER_SAMPLE_RATE)`: the rate is whisper's requirement,
    // so a change to the constant should fail here rather than be echoed by the test.
    expect(hasPair(args, '-ar', '16000')).toBe(true)
    expect(hasPair(args, '-c:a', 'pcm_s16le')).toBe(true)
    expect(hasPair(args, '-f', 'wav')).toBe(true)
  })

  it('takes the first audio stream explicitly instead of letting ffmpeg choose the best one', () => {
    // A course recording often carries a second commentary track. ffmpeg's default stream
    // selection picks "the best" audio by channel count and bitrate, so without this map the
    // transcript can silently come from a track the learner never hears — and nothing in the
    // output looks wrong, which is why it is asserted rather than left to the flag list.
    expect(hasPair(args, '-map', '0:a:0')).toBe(true)
  })

  it('drops the video, subtitle and data streams', () => {
    expect(args).toContain('-vn')
    expect(args).toContain('-sn')
    expect(args).toContain('-dn')
  })

  it('passes -nostdin, without which a spawned ffmpeg can consume the parent process stdin', () => {
    expect(args).toContain('-nostdin')
  })

  it('reports progress on stdout, leaving stderr as a pure diagnostics channel', () => {
    expect(hasPair(args, '-progress', 'pipe:1')).toBe(true)
    expect(args).toContain('-nostats')
  })

  it('keeps input and output as separate whole arguments, however they are named', () => {
    const hostile = extractWavArgs(HOSTILE_INPUT, HOSTILE_RAW)
    expectPathsAreWholeArguments(hostile, [HOSTILE_INPUT, HOSTILE_RAW])
    // The output is positional and last; a builder that lost that ordering would have ffmpeg
    // read the WAV path as another input rather than write to it.
    expect(hostile[hostile.length - 1]).toBe(HOSTILE_RAW)
  })

  it('never merges a flag with its value', () => {
    expectNoFlagCarriesItsValue(extractWavArgs(HOSTILE_INPUT, HOSTILE_RAW))
  })
})

describe('keyframeArgs', () => {
  const scene = keyframeArgs({
    input: '/media/lecture.mp4',
    pngPattern: '/tmp/kf/kf-%04d.png',
    rawPath: '/tmp/kf/frames.gray',
    strategy: 'scene',
  })
  const interval = keyframeArgs({
    input: '/media/lecture.mp4',
    pngPattern: '/tmp/kf/kf-%04d.png',
    rawPath: '/tmp/kf/frames.gray',
    strategy: 'interval',
  })

  it('selects on the scene score the spec fixes, for the scene strategy', () => {
    expect(SCENE_THRESHOLD).toBe(0.3)
    expect(graphOf(scene)).toContain("select='gt(scene,0.3)'")
    expect(graphOf(scene)).not.toContain('fps=')
  })

  it('samples on a fixed interval for a screencast with no cuts at all', () => {
    expect(INTERVAL_SECONDS).toBe(10)
    expect(graphOf(interval)).toContain('fps=1/10')
    expect(graphOf(interval)).not.toContain('select=')
  })

  it.each([
    ['scene', scene],
    ['interval', interval],
  ] as const)('splits one decode into a PNG and a hash branch (%s)', (_strategy, args) => {
    const graph = graphOf(args)
    // The whole point of the single pass: nothing in this package can decode a PNG, so the
    // 9×8 grey buffer dhash needs has to come off a second branch of the same graph.
    expect(graph).toContain('split=2')
    expect(graph).toContain('showinfo')
    expect(graph).toContain(`scale=${DHASH_WIDTH}:${DHASH_HEIGHT}`)
    expect(graph).toContain('scale=9:8')
    expect(graph).toContain('format=gray')
  })

  it.each([
    ['scene', scene],
    ['interval', interval],
  ] as const)('maps both branches to their own output (%s)', (_strategy, args) => {
    expect(hasPair(args, '-map', '[full]')).toBe(true)
    expect(hasPair(args, '-map', '[thumb]')).toBe(true)
    expect(hasPair(args, '-f', 'image2')).toBe(true)
    expect(hasPair(args, '-f', 'rawvideo')).toBe(true)
    expect(hasPair(args, '-pix_fmt', 'gray')).toBe(true)
  })

  it.each([
    ['scene', scene],
    ['interval', interval],
  ] as const)('raises -loglevel to info, where showinfo writes (%s)', (_strategy, args) => {
    // `showinfo` logs at info level, so the blanket `-loglevel error` of the base arguments
    // would silence the very lines the frame timestamps are read from. ffmpeg honours the
    // last occurrence of a global option, so it is the last one that has to say `info`.
    expect(lastValueOf(args, '-loglevel')).toBe('info')
  })

  it('caps both outputs at the same frame count, so the two stay index-aligned', () => {
    expect(KEYFRAME_HARD_CAP).toBe(400)
    const caps = scene.filter((_arg, index) => scene[index - 1] === '-frames:v')
    expect(caps).toEqual(['400', '400'])

    const custom = keyframeArgs({
      input: '/media/lecture.mp4',
      pngPattern: '/tmp/kf/kf-%04d.png',
      rawPath: '/tmp/kf/frames.gray',
      strategy: 'scene',
      frameCap: 12,
    })
    expect(custom.filter((_arg, index) => custom[index - 1] === '-frames:v')).toEqual(['12', '12'])
  })

  it('bounds the stored PNG by the requested width', () => {
    const custom = keyframeArgs({
      input: '/media/lecture.mp4',
      pngPattern: '/tmp/kf/kf-%04d.png',
      rawPath: '/tmp/kf/frames.gray',
      strategy: 'scene',
      maxWidth: 640,
    })
    expect(graphOf(custom)).toContain("scale='min(640,iw)':-2")
    expect(graphOf(scene)).toContain("scale='min(1280,iw)':-2")
  })

  it('keeps all three paths as whole arguments, and none of them inside the filter graph', () => {
    const args = keyframeArgs({
      input: HOSTILE_INPUT,
      pngPattern: HOSTILE_PNG_PATTERN,
      rawPath: HOSTILE_RAW,
      strategy: 'scene',
    })
    expectPathsAreWholeArguments(args, [HOSTILE_INPUT, HOSTILE_PNG_PATTERN, HOSTILE_RAW])
    // Timestamps come from `showinfo` rather than `metadata=print:file=` precisely so that no
    // path is ever spliced into the graph, where ffmpeg's parser treats `:` as an option
    // separator and `\` as an escape and a Windows path stops being one.
    expect(graphOf(args)).not.toContain('D:\\')
  })

  it('never merges a flag with its value', () => {
    for (const strategy of ['scene', 'interval'] as const) {
      expectNoFlagCarriesItsValue(
        keyframeArgs({
          input: HOSTILE_INPUT,
          pngPattern: HOSTILE_PNG_PATTERN,
          rawPath: HOSTILE_RAW,
          strategy,
        }),
      )
    }
  })

  it('keeps the whole filter graph in one element, semicolons and quotes included', () => {
    // The graph is the one argument that legitimately contains `;`, `'` and `,`. If a builder
    // ever split on those to "tidy" it, ffmpeg would read the tail as extra options.
    expect(scene.filter((arg) => arg.includes('split=2'))).toHaveLength(1)
    expect(graphOf(scene).split(';')).toHaveLength(3)
  })

  it('reads the whole file by default: no -ss, no -t', () => {
    expect(scene).not.toContain('-ss')
    expect(scene).not.toContain('-t')
  })

  it('seeks to startSec as an input option, before -i', () => {
    const windowed = keyframeArgs({
      input: '/media/lecture.mp4',
      pngPattern: '/tmp/kf/kf-%04d.png',
      rawPath: '/tmp/kf/frames.gray',
      strategy: 'scene',
      startSec: 600,
      clipDurationSec: 300,
    })
    expect(hasPair(windowed, '-ss', '600')).toBe(true)
    expect(hasPair(windowed, '-t', '300')).toBe(true)
    expect(windowed.indexOf('-ss')).toBeLessThan(windowed.indexOf('-i'))
    expect(windowed.indexOf('-t')).toBeLessThan(windowed.indexOf('-i'))
  })

  it('never merges -ss or -t with their value', () => {
    expectNoFlagCarriesItsValue(
      keyframeArgs({
        input: HOSTILE_INPUT,
        pngPattern: HOSTILE_PNG_PATTERN,
        rawPath: HOSTILE_RAW,
        strategy: 'scene',
        startSec: 60,
        clipDurationSec: 30,
      }),
    )
  })
})

describe('planKeyframeSegments', () => {
  it('never segments a duration ffmpeg could not report', () => {
    expect(planKeyframeSegments(null)).toEqual([
      { startSec: 0, clipDurationSec: null, frameCap: KEYFRAME_HARD_CAP },
    ])
  })

  it('never segments a video that already fits in one window', () => {
    expect(KEYFRAME_SEGMENT_SEC).toBe(600)
    expect(planKeyframeSegments(20)).toEqual([
      { startSec: 0, clipDurationSec: null, frameCap: KEYFRAME_HARD_CAP },
    ])
    // The boundary itself still reads as "fits" — only strictly longer needs a second window.
    expect(planKeyframeSegments(KEYFRAME_SEGMENT_SEC)).toHaveLength(1)
  })

  it('splits a longer recording into equal windows, each with its own share of the budget', () => {
    // Exactly two hours at the 600 s window size is exactly 12 windows — the cap this fixture
    // is chosen to land on exactly, so the test does not depend on rounding either way.
    expect(MAX_KEYFRAME_SEGMENTS).toBe(12)
    const segments = planKeyframeSegments(7_200)
    expect(segments).toHaveLength(12)
    expect(segments[0]).toEqual({ startSec: 0, clipDurationSec: 600, frameCap: 34 })
    expect(segments[1]?.startSec).toBe(600)
    // Every window's own duration sums back to the whole recording, with nothing left over.
    const total = segments.reduce((sum, s) => sum + (s.clipDurationSec ?? 0), 0)
    expect(total).toBe(7_200)
    // Every frame cap divides the overall budget across the windows, none left idle.
    expect(segments.every((s) => s.frameCap === 34)).toBe(true)
  })

  it('never runs more than MAX_KEYFRAME_SEGMENTS passes, however long the recording', () => {
    // Ten hours at 600 s a window would be 60 windows; capped well below that so an import
    // never turns into sixty separate ffmpeg spawns.
    const segments = planKeyframeSegments(36_000)
    expect(segments).toHaveLength(MAX_KEYFRAME_SEGMENTS)
    const total = segments.reduce((sum, s) => sum + (s.clipDurationSec ?? 0), 0)
    expect(total).toBe(36_000)
  })

  it('spreads a duration that does not divide evenly by KEYFRAME_SEGMENT_SEC just as evenly', () => {
    // 1400 s asks for ceil(1400 / 600) = 3 windows — the window length is then *recomputed*
    // from the actual duration (1400 / 3), not left at a fixed 600 s with a short leftover
    // window at the end, so every window is still the same size and every start is
    // contiguous with the one before it.
    const segments = planKeyframeSegments(1_400)
    expect(segments).toHaveLength(3)
    for (const [index, segment] of segments.entries()) {
      expect(segment.clipDurationSec).toBeCloseTo(1_400 / 3)
      expect(segment.startSec).toBeCloseTo(index * (1_400 / 3))
    }
    const total = segments.reduce((sum, s) => sum + (s.clipDurationSec ?? 0), 0)
    expect(total).toBeCloseTo(1_400)
  })

  it('divides a custom frame budget across the windows instead of the default cap', () => {
    const segments = planKeyframeSegments(1_800, 60)
    expect(segments).toHaveLength(3)
    expect(segments.every((s) => s.frameCap === 20)).toBe(true)
  })

  it('never gives a window a zero frame budget, even with far more windows than cap', () => {
    const segments = planKeyframeSegments(7_200, 5)
    expect(segments.every((s) => s.frameCap >= 1)).toBe(true)
  })
})

describe('parseProbeJson', () => {
  /** A real `ffprobe -of json -show_entries …` body for a 30-minute lecture capture. */
  const LECTURE = JSON.stringify({
    programs: [],
    streams: [
      {
        index: 0,
        codec_type: 'video',
        width: 1920,
        height: 1080,
        duration: '1802.041000',
      },
      { index: 1, codec_type: 'audio', duration: '1802.058000' },
    ],
    format: { duration: '1802.078000' },
  })

  it('reads duration, dimensions and stream presence from real ffprobe output', () => {
    expect(parseProbeJson(LECTURE)).toEqual({
      durationSec: 1802.078,
      hasVideo: true,
      hasAudio: true,
      width: 1920,
      height: 1080,
    })
  })

  it('prefers the container duration over either stream', () => {
    // The three differ by hundredths here on purpose: the container's is the one that covers
    // the whole file, and it is what the progress fraction is divided by.
    expect(parseProbeJson(LECTURE).durationSec).toBe(1802.078)
  })

  it("falls back to a stream's duration when the container does not report one", () => {
    // MPEG-TS and some Matroska files carry duration only per stream, and ffprobe writes the
    // literal string `N/A` rather than omitting the key.
    const ts = JSON.stringify({
      streams: [
        { index: 0, codec_type: 'video', width: 1280, height: 720, duration: 'N/A' },
        { index: 1, codec_type: 'audio', duration: '95.5' },
      ],
      format: { duration: 'N/A' },
    })
    expect(parseProbeJson(ts).durationSec).toBe(95.5)
  })

  it('detects a silent screencast, which must not be queued for transcription', () => {
    const silent = JSON.stringify({
      streams: [{ index: 0, codec_type: 'video', width: 1280, height: 720 }],
      format: { duration: '61.2' },
    })
    expect(parseProbeJson(silent)).toEqual({
      durationSec: 61.2,
      hasVideo: true,
      hasAudio: false,
      width: 1280,
      height: 720,
    })
  })

  it('detects an audio-only file, which must not be queued for keyframes', () => {
    const podcast = JSON.stringify({
      streams: [{ index: 0, codec_type: 'audio', duration: '3600.0' }],
      format: { duration: '3600.0' },
    })
    expect(parseProbeJson(podcast)).toEqual({
      durationSec: 3600,
      hasVideo: false,
      hasAudio: true,
      width: null,
      height: null,
    })
  })

  it('returns all-null rather than throwing when the JSON is truncated', () => {
    // A cancelled or OOM-killed ffprobe writes a prefix of its output. One broken part of a
    // course must not sink the whole import, so this is a value, not an exception.
    expect(() => parseProbeJson('{"streams": [{"index": 0, "codec')).not.toThrow()
    expect(parseProbeJson('{"streams": [{"index": 0, "codec')).toEqual({
      durationSec: null,
      hasVideo: false,
      hasAudio: false,
      width: null,
      height: null,
    })
    expect(parseProbeJson('')).toEqual({
      durationSec: null,
      hasVideo: false,
      hasAudio: false,
      width: null,
      height: null,
    })
  })

  it('treats a zero or negative duration as unknown rather than as a zero-length file', () => {
    const broken = JSON.stringify({
      streams: [{ index: 0, codec_type: 'audio', duration: '0.000000' }],
      format: { duration: '0.000000' },
    })
    expect(parseProbeJson(broken).durationSec).toBeNull()
    expect(parseProbeJson(broken).hasAudio).toBe(true)
  })

  it('survives valid JSON that is not an ffprobe document at all', () => {
    expect(parseProbeJson('null').durationSec).toBeNull()
    expect(parseProbeJson('"unexpected"').hasVideo).toBe(false)
    expect(parseProbeJson('{"streams": {"0": {"codec_type": "audio"}}}').hasAudio).toBe(false)
  })
})

describe('createFfmpegProgressParser', () => {
  it('converts out_time_us into a fraction of the known duration', () => {
    const parser = createFfmpegProgressParser(100)
    expect(parser.line('out_time_us=25000000')).toBe(0.25)
    expect(parser.line('out_time_us=50000000')).toBe(0.5)
  })

  it('reports a complete run when ffmpeg says progress=end', () => {
    const parser = createFfmpegProgressParser(100)
    expect(parser.line('out_time_us=10000000')).toBeCloseTo(0.1)
    expect(parser.line('progress=end')).toBe(1)
  })

  it('still reports completion when the duration was never known', () => {
    const parser = createFfmpegProgressParser(null)
    expect(parser.line('out_time_us=1000000')).toBeUndefined()
    expect(parser.line('progress=end')).toBe(1)
  })

  it('ignores a line that is not key=value', () => {
    // With `-loglevel info` in the keyframe pass, ordinary ffmpeg log lines do reach here.
    const parser = createFfmpegProgressParser(100)
    expect(parser.line('[Parsed_showinfo_1 @ 0x7f8] n:0 pts:0 pts_time:0')).toBeUndefined()
    expect(parser.line('')).toBeUndefined()
    expect(parser.line('=orphan')).toBeUndefined()
    expect(parser.line('progress=continue')).toBeUndefined()
    expect(parser.line('bitrate=  1536.0kbits/s')).toBeUndefined()
  })

  it('ignores a position that would move the bar backwards', () => {
    // A seek, or a stream discontinuity in a concatenated capture, can make ffmpeg report an
    // out_time that retreats. A progress bar that goes backwards reads as a bug to the user,
    // so the retreat is dropped and the high-water mark kept; the next real advance still
    // reports, which is what proves the guard did not simply latch.
    const parser = createFfmpegProgressParser(100)
    expect(parser.line('out_time_us=50000000')).toBe(0.5)
    expect(parser.line('out_time_us=20000000')).toBeUndefined()
    expect(parser.line('out_time_us=60000000')).toBe(0.6)
  })

  it('has nothing to report while the duration is unknown or nonsensical', () => {
    expect(createFfmpegProgressParser(null).line('out_time_us=1000000')).toBeUndefined()
    expect(createFfmpegProgressParser(0).line('out_time_us=1000000')).toBeUndefined()
    expect(createFfmpegProgressParser(-5).line('out_time_us=1000000')).toBeUndefined()
  })

  it('ignores the placeholder values ffmpeg emits before the first frame', () => {
    const parser = createFfmpegProgressParser(100)
    expect(parser.line('out_time_us=N/A')).toBeUndefined()
    expect(parser.line('out_time_us=-9223372036854775807')).toBeUndefined()
  })

  it('clamps a position past the end, because a container duration is only an estimate', () => {
    const parser = createFfmpegProgressParser(10)
    expect(parser.line('out_time_us=12000000')).toBe(1)
  })
})

describe('parseShowinfoTime', () => {
  it('reads the timestamp out of a real showinfo line', () => {
    const line =
      '[Parsed_showinfo_1 @ 0x55f1c0e0a2c0] n:  12 pts:   600576 pts_time:12.512 ' +
      'duration:  1024 duration_time:0.021333 fmt:yuv420p sar:1/1 s:1920x1080 i:P iskey:1 type:I'
    expect(parseShowinfoTime(line)).toBe(12.512)
  })

  it('reads the first frame, whose timestamp ffmpeg prints without a decimal part', () => {
    expect(parseShowinfoTime('[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0')).toBe(0)
  })

  it('rejects a line that carries no pts_time', () => {
    // Everything else on stderr at info level: the scale filter's configuration line, the
    // stream mapping, the banner. Guessing a timestamp for one of these would attach an OCR
    // description to the wrong moment of the lecture.
    expect(parseShowinfoTime('[Parsed_scale_2 @ 0x1] w:1280 h:720 flags:bilinear')).toBeUndefined()
    expect(
      parseShowinfoTime('  Stream #0:0 -> #0:0 (h264 (native) -> png (native))'),
    ).toBeUndefined()
    expect(parseShowinfoTime('')).toBeUndefined()
  })

  it('rejects a pts_time ffmpeg could not compute', () => {
    expect(parseShowinfoTime('[Parsed_showinfo_1 @ 0x1] n:0 pts:N/A pts_time:N/A')).toBeUndefined()
  })
})
