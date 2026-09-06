import { describe, expect, it } from 'vitest'
import {
  buildVtt,
  defaultThreads,
  formatVttTimestamp,
  parseTimestamp,
  parseWhisperJson,
  parseWhisperProgress,
  whisperArgs,
} from './whisper'

/**
 * The `whisper-cli` argv and the parsers for what it writes (sub-phase 6.4,
 * `docs/spec/05-ingestion-rag.md` §1: "local Whisper … timestamps per segment").
 *
 * Two unrelated risks, tested two different ways. The argv is an injection boundary, so it is
 * checked element by element: a model or WAV path folded into one string with its flag would
 * satisfy every "does it ask for JSON?" assertion and still hand whisper a path it cannot open.
 *
 * `parseWhisperJson` is the opposite risk. Whisper's `-oj` document has carried segment bounds
 * both as `offsets` in integer milliseconds and as `timestamps` in `HH:MM:SS,mmm` strings, and
 * which of the two a build populates has moved between releases — so both shapes are pinned as
 * fixtures rather than assumed. Its failure mode is silence: a lecture that transcribes,
 * reports success and yields an empty transcript, which surfaces only much later as a source
 * with no cards. That is why the malformed and half-populated documents are asserted to return
 * a value rather than to throw.
 */

/** A model and a WAV under a course folder carrying every character a shell would act on. */
const HOSTILE_MODEL = 'D:\\Modelos\\ggml "small"; q5_1.bin'
const HOSTILE_WAV = 'D:\\Cursos\\Semana 1; "clase 2" & repaso.wav'
const HOSTILE_VAD = 'D:\\Modelos\\silero; v5 & vad.bin'

/** True when `flag` is immediately followed by `value`, the only adjacency whisper reads. */
function hasPair(args: readonly string[], flag: string, value: string): boolean {
  return args.some((arg, index) => arg === flag && args[index + 1] === value)
}

/** The value whisper would take for `flag`: the element right after it. */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

/** Asserts each path arrives as exactly one whole element: present verbatim, and no *other*
 *  element merely contains it, which is what a joined `-m <path>` would look like. */
function expectPathsAreWholeArguments(args: readonly string[], paths: readonly string[]): void {
  for (const path of paths) {
    expect(args.filter((arg) => arg.includes(path))).toEqual([path])
  }
}

/** Anything beginning with `-` must be a bare option name, so `['-t', '4']` can never have been
 *  written `['-t 4']` or `['-t=4']`. Values are allowed to contain anything. */
function expectNoFlagCarriesItsValue(args: readonly string[]): void {
  for (const arg of args) {
    if (arg.startsWith('-')) expect(arg).not.toMatch(/[\s=]/)
  }
}

describe('whisperArgs', () => {
  const args = whisperArgs({
    model: '/models/ggml-small-q5_1.bin',
    wav: '/tmp/part-01.wav',
    outPrefix: '/tmp/part-01',
  })

  it('asks for segment JSON with -oj and never for the per-token -ojf', () => {
    // `-ojf` adds per-token timings and confidences — roughly an order of magnitude more JSON
    // for a lecture — and nothing downstream reads a token: 6.2 windows whole segments into
    // 60–90 s units. Asserting the absence, not just the presence, is what keeps a future
    // "more data cannot hurt" edit from quietly multiplying the size of every transcript.
    expect(args).toContain('-oj')
    expect(args).not.toContain('-ojf')
  })

  it('also writes a VTT, which is the artefact the player reads back', () => {
    expect(args).toContain('-ovtt')
  })

  it('prints progress percentages and suppresses the running transcript', () => {
    // The two go together. `-pp` is where `parseWhisperProgress` gets its numbers; without
    // `-np` whisper interleaves the transcript with them on the same stream and a segment
    // that happens to contain "progress = 90%" would be read as a position.
    expect(args).toContain('-pp')
    expect(args).toContain('-np')
  })

  it('splits segments on word boundaries rather than mid-token', () => {
    // A citation that starts halfway through a word is unusable as lesson evidence.
    expect(args).toContain('-sow')
  })

  it('passes the model and the WAV as their own elements', () => {
    expect(hasPair(args, '-m', '/models/ggml-small-q5_1.bin')).toBe(true)
    expect(hasPair(args, '-f', '/tmp/part-01.wav')).toBe(true)
  })

  it('keeps a model and a WAV path whole however the course folder is named', () => {
    const hostile = whisperArgs({
      model: HOSTILE_MODEL,
      wav: HOSTILE_WAV,
      outPrefix: 'D:\\Cursos\\out dir; $(id)\\part-01',
      vadModel: HOSTILE_VAD,
    })
    expectPathsAreWholeArguments(hostile, [HOSTILE_MODEL, HOSTILE_WAV, HOSTILE_VAD])
    expectNoFlagCarriesItsValue(hostile)
  })

  it('gives -of a prefix with no extension, because whisper appends its own', () => {
    // whisper writes `<prefix>.json` and `<prefix>.vtt`. A prefix ending in `.json` would
    // produce `part-01.json.json`, and the reader would then look for a file that is not there.
    expect(valueAfter(args, '-of')).toBe('/tmp/part-01')
    expect(valueAfter(args, '-of')).not.toMatch(/\.(json|vtt)$/)
  })

  it('detects the language by default and honours one when it is known', () => {
    expect(hasPair(args, '-l', 'auto')).toBe(true)
    const spanish = whisperArgs({
      model: '/models/ggml-small-q5_1.bin',
      wav: '/tmp/part-01.wav',
      outPrefix: '/tmp/part-01',
      language: 'es',
    })
    expect(hasPair(spanish, '-l', 'es')).toBe(true)
    expect(spanish).not.toContain('auto')
  })

  it("uses whisper's own thread default until the caller counts the cores", () => {
    expect(hasPair(args, '-t', '4')).toBe(true)
    const wide = whisperArgs({
      model: '/models/ggml-small-q5_1.bin',
      wav: '/tmp/part-01.wav',
      outPrefix: '/tmp/part-01',
      threads: 7,
    })
    expect(hasPair(wide, '-t', '7')).toBe(true)
  })

  it('leaves out --vad entirely when no VAD weights were installed', () => {
    // The degraded path, and deliberately not a failure: whisper still produces correct
    // segment timestamps without voice activity detection. VAD only skips silence (cheaper)
    // and cuts at pauses (tidier boundaries), so a missing model costs money and neatness,
    // never correctness — and `-vm` with no path would be the actual bug.
    expect(args).not.toContain('--vad')
    expect(args).not.toContain('-vm')
    expect(args.filter((arg) => arg.startsWith('--vad'))).toEqual([])
  })

  it('turns VAD on and points it at the weights when they are there', () => {
    const vad = whisperArgs({
      model: '/models/ggml-small-q5_1.bin',
      wav: '/tmp/part-01.wav',
      outPrefix: '/tmp/part-01',
      vadModel: '/models/ggml-silero-v5.1.2.bin',
    })
    expect(vad).toContain('--vad')
    expect(hasPair(vad, '-vm', '/models/ggml-silero-v5.1.2.bin')).toBe(true)
  })

  it('spells out every VAD tuning value instead of inheriting the build defaults', () => {
    // These are whisper.cpp's own numbers today. Written out, a release that retunes them
    // cannot silently move where a transcript is cut — and therefore where a citation points
    // in a path that was generated months earlier.
    const vad = whisperArgs({
      model: '/models/ggml-small-q5_1.bin',
      wav: '/tmp/part-01.wav',
      outPrefix: '/tmp/part-01',
      vadModel: '/models/ggml-silero-v5.1.2.bin',
    })
    expect(hasPair(vad, '--vad-threshold', '0.5')).toBe(true)
    expect(hasPair(vad, '--vad-min-speech-duration-ms', '250')).toBe(true)
    expect(hasPair(vad, '--vad-min-silence-duration-ms', '100')).toBe(true)
    expect(hasPair(vad, '--vad-max-speech-duration-s', '30')).toBe(true)
    expect(hasPair(vad, '--vad-speech-pad-ms', '30')).toBe(true)
    expect(hasPair(vad, '--vad-samples-overlap', '0.1')).toBe(true)
  })

  it('never merges a flag with its value', () => {
    expectNoFlagCarriesItsValue(args)
  })
})

describe('defaultThreads', () => {
  it('leaves one core free so the app stays responsive while a course transcribes', () => {
    expect(defaultThreads(4)).toBe(3)
    expect(defaultThreads(8)).toBe(7)
  })

  it('stops at eight, past which whisper gains nothing and memory bandwidth is the limit', () => {
    expect(defaultThreads(16)).toBe(8)
    expect(defaultThreads(64)).toBe(8)
  })

  it('still asks for one thread on a single-core machine', () => {
    // `cpuCount - 1` is 0 there, and a zero would make whisper refuse to start.
    expect(defaultThreads(1)).toBe(1)
    expect(defaultThreads(0)).toBe(1)
  })
})

describe('parseWhisperProgress', () => {
  it('reads the percentage out of a real whisper progress line', () => {
    expect(parseWhisperProgress('whisper_print_progress_callback: progress =  42%')).toBe(0.42)
  })

  it('reports both ends of the run', () => {
    expect(parseWhisperProgress('whisper_print_progress_callback: progress =   0%')).toBe(0)
    expect(parseWhisperProgress('whisper_print_progress_callback: progress = 100%')).toBe(1)
  })

  it('rejects the lines whisper prints around the progress ones', () => {
    // Model loading, system info and the timing summary all arrive on the same stream. A
    // number scavenged from one of them would drive the job's bar off the actual position.
    expect(parseWhisperProgress('whisper_init_with_params_no_state: use gpu = 1')).toBeUndefined()
    expect(parseWhisperProgress('whisper_model_load: n_mels = 80')).toBeUndefined()
    expect(
      parseWhisperProgress('whisper_print_timings:    total time =  9123.44 ms'),
    ).toBeUndefined()
    expect(parseWhisperProgress('')).toBeUndefined()
  })
})

describe('parseTimestamp', () => {
  it('reads the comma-separated spelling whisper writes in its JSON', () => {
    expect(parseTimestamp('00:01:02,340')).toBe(62.34)
  })

  it('reads the dot-separated spelling too, which the same builds use in VTT', () => {
    // Both appear in whisper's own output; a parser that took only one would turn every
    // segment of a file into an undefined start and drop the transcript on the floor.
    expect(parseTimestamp('00:01:02.340')).toBe(62.34)
  })

  it('carries hours, and a lecture longer than a day', () => {
    expect(parseTimestamp('01:00:00,000')).toBe(3_600)
    expect(parseTimestamp('26:03:04,500')).toBe(93_784.5)
  })

  it('tolerates the whitespace a line-oriented reader leaves attached', () => {
    expect(parseTimestamp('  00:00:04,120  ')).toBe(4.12)
  })

  it('rejects malformed input rather than guessing a position', () => {
    expect(parseTimestamp('1:02,340')).toBeUndefined()
    expect(parseTimestamp('00:01:02')).toBeUndefined()
    expect(parseTimestamp('00:1:02,340')).toBeUndefined()
    expect(parseTimestamp('00:01:02,3400')).toBeUndefined()
    expect(parseTimestamp('N/A')).toBeUndefined()
    expect(parseTimestamp('')).toBeUndefined()
  })
})

/** A `whisper-cli -oj` document in the shape every release populates: integer milliseconds. */
const OFFSETS_JSON = JSON.stringify({
  systeminfo: 'AVX = 1 | AVX2 = 1 | F16C = 1 | NEON = 0',
  model: { type: 'small', multilingual: true, vocab: 51_865 },
  params: { model: '/models/ggml-small-q5_1.bin', language: 'auto', translate: false },
  result: { language: 'es' },
  transcription: [
    {
      timestamps: { from: '00:00:00,000', to: '00:00:04,120' },
      offsets: { from: 0, to: 4_120 },
      text: ' Bienvenidos a la segunda clase.',
    },
    {
      timestamps: { from: '00:00:04,120', to: '00:00:09,500' },
      offsets: { from: 4_120, to: 9_500 },
      text: ' Hoy vemos la curva del olvido.',
    },
  ],
})

/** The same minute from a build that ships only the string form. Not hypothetical: this is
 *  the shape that makes an "it worked on my machine" transcript come back empty elsewhere. */
const TIMESTAMPS_JSON = JSON.stringify({
  params: { language: 'es' },
  transcription: [
    {
      timestamps: { from: '00:00:00,000', to: '00:00:04,120' },
      text: ' Bienvenidos a la segunda clase.',
    },
    {
      timestamps: { from: '00:00:04,120', to: '00:00:09,500' },
      text: ' Hoy vemos la curva del olvido.',
    },
  ],
})

describe('parseWhisperJson', () => {
  it('reads the offsets shape, converting milliseconds to seconds', () => {
    expect(parseWhisperJson(OFFSETS_JSON)).toEqual({
      language: 'es',
      segments: [
        { startSec: 0, endSec: 4.12, text: 'Bienvenidos a la segunda clase.' },
        { startSec: 4.12, endSec: 9.5, text: 'Hoy vemos la curva del olvido.' },
      ],
    })
  })

  it('reads the timestamps-only shape to exactly the same segments', () => {
    expect(parseWhisperJson(TIMESTAMPS_JSON).segments).toEqual(
      parseWhisperJson(OFFSETS_JSON).segments,
    )
  })

  it('prefers the offsets when a document carries both and they disagree', () => {
    // Integer milliseconds cannot lose precision the way a re-parsed string can, so the
    // tie-break is fixed rather than left to whichever branch is written first. The two are
    // made to disagree here because agreement would prove nothing.
    const conflicting = JSON.stringify({
      transcription: [
        {
          timestamps: { from: '00:00:59,000', to: '00:01:00,000' },
          offsets: { from: 1_500, to: 2_500 },
          text: 'Un segmento.',
        },
      ],
    })
    expect(parseWhisperJson(conflicting).segments).toEqual([
      { startSec: 1.5, endSec: 2.5, text: 'Un segmento.' },
    ])
  })

  it('falls back per field, so a half-populated entry still lands', () => {
    const mixed = JSON.stringify({
      transcription: [
        {
          timestamps: { from: '00:00:01,000', to: '00:00:06,250' },
          offsets: { from: 1_000 },
          text: 'Mitad y mitad.',
        },
      ],
    })
    expect(parseWhisperJson(mixed).segments).toEqual([
      { startSec: 1, endSec: 6.25, text: 'Mitad y mitad.' },
    ])
  })

  it('skips the empty segments whisper emits over silence', () => {
    // Both spellings occur: an entry whose text is a single space, and one that is empty.
    // Kept, they would become zero-content chunks that dilute every retrieval over the source.
    const silences = JSON.stringify({
      transcription: [
        { offsets: { from: 0, to: 1_000 }, text: ' ' },
        { offsets: { from: 1_000, to: 2_000 }, text: '' },
        { offsets: { from: 2_000, to: 3_000 }, text: ' Habla.' },
      ],
    })
    expect(parseWhisperJson(silences).segments).toEqual([
      { startSec: 2, endSec: 3, text: 'Habla.' },
    ])
  })

  it('drops an entry with no usable start rather than placing it at zero', () => {
    const unplaceable = JSON.stringify({
      transcription: [
        { text: 'Sin posición.' },
        { timestamps: { from: 'N/A', to: 'N/A' }, text: 'Tampoco.' },
        { offsets: { from: 500, to: 900 }, text: 'Con posición.' },
      ],
    })
    expect(parseWhisperJson(unplaceable).segments).toEqual([
      { startSec: 0.5, endSec: 0.9, text: 'Con posición.' },
    ])
  })

  it('returns the segments in start order whatever order the document listed them', () => {
    // Ordering is the pipeline's contract, not whisper's: 6.2 windows the segments in
    // sequence, so one out of place would cut a window across a jump in the lecture.
    const shuffled = JSON.stringify({
      transcription: [
        { offsets: { from: 9_500, to: 12_000 }, text: 'Tercero.' },
        { offsets: { from: 0, to: 4_120 }, text: 'Primero.' },
        { offsets: { from: 4_120, to: 9_500 }, text: 'Segundo.' },
      ],
    })
    expect(parseWhisperJson(shuffled).segments.map((segment) => segment.text)).toEqual([
      'Primero.',
      'Segundo.',
      'Tercero.',
    ])
  })

  it('returns an empty transcript instead of throwing on a truncated document', () => {
    // A cancelled or OOM-killed whisper leaves a prefix of its JSON on disk. One broken part
    // of a course must not sink the import of the rest, so this is a value, not an exception.
    const truncated = '{"transcription": [{"offsets": {"from": 0, "to": 41'
    expect(() => parseWhisperJson(truncated)).not.toThrow()
    expect(parseWhisperJson(truncated)).toEqual({ segments: [], language: null })
    expect(parseWhisperJson('')).toEqual({ segments: [], language: null })
  })

  it('survives valid JSON that is not a whisper document at all', () => {
    expect(parseWhisperJson('null')).toEqual({ segments: [], language: null })
    expect(parseWhisperJson('"unexpected"')).toEqual({ segments: [], language: null })
    expect(parseWhisperJson('{"transcription": {"0": {"text": "x"}}}').segments).toEqual([])
  })

  it('reads the detected language, which is what the source row is filed under', () => {
    expect(parseWhisperJson(OFFSETS_JSON).language).toBe('es')
  })

  it('falls back to the requested language when the result block is missing', () => {
    expect(parseWhisperJson(TIMESTAMPS_JSON).language).toBe('es')
  })

  it("normalises 'auto' to null, because it is a request and not a detection", () => {
    // `params.language` echoes the `-l auto` we sent. Storing the literal "auto" as the
    // source's language would make it a language code nothing can match on.
    const undetected = JSON.stringify({ params: { language: 'auto' }, transcription: [] })
    expect(parseWhisperJson(undetected).language).toBeNull()
    expect(parseWhisperJson('{"transcription": []}').language).toBeNull()
  })
})

describe('formatVttTimestamp', () => {
  it('writes a dot and exactly three decimals, as WebVTT requires', () => {
    // A comma is what whisper's JSON uses and what SRT uses; a VTT parser rejects the cue.
    for (const seconds of [0, 4.12, 62.34, 599.5, 3_661.007, 7_200]) {
      expect(formatVttTimestamp(seconds)).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/)
    }
    expect(formatVttTimestamp(62.34)).toBe('00:01:02.340')
    expect(formatVttTimestamp(3_661.007)).toBe('01:01:01.007')
  })

  it('pads every field, so cues sort as text and align in a diff', () => {
    expect(formatVttTimestamp(0)).toBe('00:00:00.000')
    expect(formatVttTimestamp(9.05)).toBe('00:00:09.050')
  })

  it('clamps a negative position to zero', () => {
    // Reachable by arithmetic rather than by data: a part offset subtracted from a segment
    // that a re-encode moved slightly earlier. A negative cue would break the whole file.
    expect(formatVttTimestamp(-5)).toBe('00:00:00.000')
  })
})

describe('buildVtt', () => {
  const cues = [
    { startSec: 0, endSec: 4.12, text: 'Bienvenidos a la segunda clase.' },
    { startSec: 4.12, endSec: 9.5, text: 'Hoy vemos la curva del olvido.' },
    { startSec: 610.25, endSec: 615, text: 'Segunda parte: el intervalo óptimo.' },
  ]
  const parts = [
    { title: 'Parte 1 — Repaso', startSec: 0 },
    { title: 'Parte 2 — Intervalos', startSec: 610.25 },
  ]

  it('opens with the WEBVTT header a player refuses the file without', () => {
    expect(buildVtt(cues).startsWith('WEBVTT\n\n')).toBe(true)
  })

  it('emits one cue per segment, timings and text together', () => {
    const vtt = buildVtt(cues)
    expect(vtt.match(/-->/g)).toHaveLength(cues.length)
    expect(vtt).toContain('00:00:04.120 --> 00:00:09.500\nHoy vemos la curva del olvido.')
  })

  it('marks where each part begins with a NOTE before that part\u2019s first cue', () => {
    // The whole reason the VTT is re-emitted rather than concatenated from whisper's own
    // per-part files: a course's cues live on one global timeline, and this is the only trace
    // left of which lecture file a moment came from.
    expect(buildVtt(cues, parts)).toBe(
      [
        'WEBVTT',
        '',
        'NOTE Parte 1 — Repaso',
        '',
        '00:00:00.000 --> 00:00:04.120',
        'Bienvenidos a la segunda clase.',
        '',
        '00:00:04.120 --> 00:00:09.500',
        'Hoy vemos la curva del olvido.',
        '',
        'NOTE Parte 2 — Intervalos',
        '',
        '00:10:10.250 --> 00:10:15.000',
        'Segunda parte: el intervalo óptimo.',
        '',
      ].join('\n'),
    )
  })

  it('writes each header once, even where two cues share a start', () => {
    const doubled = [
      { startSec: 0, endSec: 1, text: 'Uno.' },
      { startSec: 0, endSec: 2, text: 'Dos.' },
    ]
    expect(buildVtt(doubled, [{ title: 'Parte 1', startSec: 0 }]).match(/^NOTE /gm)).toHaveLength(1)
  })

  it('says nothing about a part boundary that no cue begins at', () => {
    // A NOTE has to sit before a cue to mean anything, so a boundary landing inside silence
    // simply has nowhere to go. Quiet is right here; inventing a cue for it would not be.
    expect(buildVtt(cues, [{ title: 'Parte 3', startSec: 999 }])).not.toContain('NOTE')
  })

  it('produces a header-only document for a part with no speech in it', () => {
    expect(buildVtt([], parts)).toBe('WEBVTT\n')
  })
})
