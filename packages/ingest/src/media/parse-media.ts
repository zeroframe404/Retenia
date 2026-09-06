import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildTimeline, type OcrProvider, totalDuration } from '@retenia/core'
import { detectLanguage } from '../detect-language'
import type { ParseContext } from '../parse-context'
import {
  createFfmpegProgressParser,
  extractWavArgs,
  type KeyframeStrategy,
  keyframeArgs,
  type ProbeResult,
  parseProbeJson,
  parseShowinfoTime,
  probeArgs,
} from '../sidecars/ffmpeg'
import { type RunSidecarOptions, runSidecar, type SidecarRunResult } from '../sidecars/spawn'
import {
  buildVtt,
  parseWhisperJson,
  parseWhisperProgress,
  type WhisperSegment,
  whisperArgs,
} from '../sidecars/whisper'
import type { Asset, Block, MediaMeta, MediaPartMeta, Section, SourceDoc } from '../source-doc'
import { byTime, fuseSaidAndShown, type GlossaryCorrection, transcriptBlocks } from './blocks'
import { dhash, type HashedFrame, splitFrames } from './dhash'
import { sceneDetectionFailed, selectKeyframes } from './keyframes'

/**
 * The audio and video pipeline (sub-phase 6.4; `docs/spec/05-ingestion-rag.md` §1's
 * "Video / Udemy-style courses" row).
 *
 * Everything a media source becomes is produced here: a transcript with timestamps, keyframes
 * with the text that was on screen, a caption track, and a section tree taken from the course's
 * own folders. What it deliberately does *not* do is decide how any of that is chunked. The
 * whole contract with sub-phase 6.2 is one field wide — a block with a numeric
 * `locator.timeSec` — and `chunkTranscript` does the 60–90 s windowing from there.
 *
 * ### One timeline, many files
 *
 * A course folder is one source made of many lectures, so every timestamp this produces is a
 * position on a single virtual timeline (`@retenia/core`'s `buildTimeline`) rather than an
 * offset into a particular file. A single recording is simply a course with one part, so
 * audio, video and courses all take the same path through this function.
 *
 * ### Never the whole video to a model
 *
 * The spec is blunt about it: 20 h of video is ~19 M tokens and does not fit in any context
 * window. So the video never leaves the machine. ffmpeg reduces it to 16 kHz mono audio and a
 * few dozen frames; whisper turns the audio into text locally; the frames go through the OCR
 * port, whose default is local Tesseract. What a later phase may send to a cloud model is the
 * *text*, and only if the user enables it.
 */

/** Cancellation is cooperative, and the checkpoints are the phase boundaries plus every
 *  per-frame OCR call — Tesseract takes no signal, so its loop is the only place to look. */
export class MediaCancelledError extends Error {
  constructor() {
    super('the media pipeline was cancelled')
    this.name = 'MediaCancelledError'
  }
}

export interface MediaPartInput {
  /** Absolute path to the stored blob, already confined by the job. */
  path: string
  blobSha256: string
  mime: string
  /** The lesson's title, from its file name. */
  title: string
  /** Folder titles, outermost first. Empty for a single file. */
  sectionPath: readonly string[]
  ordinal: number
}

export interface MediaToolchain {
  ffmpeg: string
  /** `null` when the archive shipped none; duration then comes from the extracted WAV. */
  ffprobe: string | null
  whisperCli: string
  /** Absolute path to the GGML weights. */
  whisperModel: string
  whisperModelId: string
  /** `null` runs whisper without `--vad`, which is a degraded path and not a broken one. */
  vadModel: string | null
  /** `cpu` or a CUDA build, for `meta.media.transcript.variant`. */
  variant: string
  /** Forwarded from main; the worker's own environment is empty. */
  hostEnv?: Record<string, string>
}

export interface MediaParseDeps {
  tools: MediaToolchain
  /** A scratch directory the job owns and deletes. */
  workDir: string
  signal: { readonly aborted: boolean; addEventListener(t: 'abort', l: () => void): void }
  progress: (fraction: number, message: string) => void
  /** Reads the text on a keyframe. Local Tesseract by default; the `vision` role port
   *  (sub-phase 7.x) drops in here unchanged. */
  ocr?: OcrProvider
  /** Phase 8 supplies the path's domain terms; identity until then. */
  glossary?: GlossaryCorrection
  threads?: number
  /** Test seam — the whole pipeline is exercised without binaries by injecting this. */
  run?: (options: RunSidecarOptions) => Promise<SidecarRunResult>
  /** i18n-supplied prefix for a fused "on screen" block. */
  labelFrame?: (timeSec: number) => string
}

export interface MediaParseInput {
  kind: 'audio' | 'video'
  parts: readonly MediaPartInput[]
  fallbackTitle: string
  /** BCP-47, or `auto` to let whisper decide from the first part. */
  language?: string
}

/**
 * Progress bands.
 *
 * Named rather than sprinkled through the code so the phases cannot silently overlap, and so
 * a reader can see at a glance that transcription owns most of the bar — which is honest, as
 * it owns most of the wall clock.
 */
const BANDS = {
  probe: [0.02, 0.08],
  audio: [0.08, 0.2],
  transcribe: [0.2, 0.68],
  keyframes: [0.68, 0.82],
  ocr: [0.82, 0.94],
  assemble: [0.94, 1],
} as const satisfies Record<string, readonly [number, number]>

function band(name: keyof typeof BANDS, fraction: number): number {
  const [start, end] = BANDS[name]
  return start + (end - start) * Math.min(1, Math.max(0, fraction))
}

/** Generous by design: a cancel is prompt because the signal reaches the child, so this only
 *  has to catch a genuinely wedged process. Scaled by how slow the model is. */
function transcribeTimeoutMs(durationSec: number | null, realtimeFactor: number): number {
  const seconds = durationSec ?? 3_600
  return Math.max(120_000, (seconds / Math.max(0.25, realtimeFactor)) * 4_000)
}

export async function parseMedia(
  input: MediaParseInput,
  ctx: ParseContext,
  deps: MediaParseDeps,
): Promise<SourceDoc> {
  const { parts, kind } = input
  const { tools, workDir, signal, progress } = deps
  const run = deps.run ?? runSidecar
  const throwIfAborted = (): void => {
    if (signal.aborted) throw new MediaCancelledError()
  }

  if (parts.length === 0) throw new Error('a media source needs at least one part')

  const exec = (
    exe: string,
    tool: string,
    args: readonly string[],
    extra: Partial<RunSidecarOptions> = {},
  ): Promise<SidecarRunResult> =>
    run({
      exe,
      tool,
      args,
      signal,
      ...(tools.hostEnv === undefined ? {} : { hostEnv: tools.hostEnv }),
      ...extra,
    })

  // ── Probe ────────────────────────────────────────────────────────────────────────────────
  // Every part first, before anything is transcribed: the timeline's offsets depend on knowing
  // how long each earlier part is, and a block written with a provisional offset would be a
  // citation pointing at a moment that does not exist.
  progress(band('probe', 0), 'reading the media')
  const probes: ProbeResult[] = []
  for (const [index, part] of parts.entries()) {
    throwIfAborted()
    probes.push(await probePart(part, tools, exec))
    progress(band('probe', (index + 1) / parts.length), 'reading the media')
  }

  const timeline = buildTimeline(probes.map((probe) => probe.durationSec))
  const weights = probes.map((probe) => Math.max(1, probe.durationSec ?? 60))
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  /** How much of a phase's band each part is worth, so a 12-lecture course advances smoothly
   *  rather than in twelve jumps. */
  const shareBefore = (index: number): number =>
    weights.slice(0, index).reduce((sum, value) => sum + value, 0) / weightTotal
  const share = (index: number): number => (weights[index] as number) / weightTotal

  // ── Audio and transcription, part by part ────────────────────────────────────────────────
  const blocks: Block[] = []
  const assets: Asset[] = []
  const warnings: string[] = []
  const allCues: { startSec: number; endSec: number; text: string }[] = []
  const partBlockIds: string[][] = parts.map(() => [])
  let detectedLanguage: string | null = null

  for (const [index, part] of parts.entries()) {
    throwIfAborted()
    const probe = probes[index] as ProbeResult
    const offsetSec = timeline[index]?.startSec ?? 0

    if (!probe.hasAudio) {
      warnings.push(`"${part.title}" has no audio track, so it was not transcribed`)
      continue
    }

    // 16 kHz mono PCM into the job's scratch directory — never the blob store: a two-hour
    // course is ~230 MB of WAV that nothing will ever want again.
    const wav = join(workDir, `${index}.wav`)
    const wavProgress = createFfmpegProgressParser(probe.durationSec)
    await exec(tools.ffmpeg, 'ffmpeg', extractWavArgs(part.path, wav), {
      onStdoutLine: (line) => {
        const fraction = wavProgress.line(line)
        if (fraction !== undefined) {
          progress(
            band('audio', shareBefore(index) + share(index) * fraction),
            `extracting audio from "${part.title}"`,
          )
        }
      },
    })

    throwIfAborted()

    // whisper is asked to detect the language on the first part only and told it thereafter:
    // a course does not change language between lessons, and re-detecting per part is both
    // slower and a way to get one lecture transcribed as Portuguese because its intro was
    // musical.
    const language = input.language ?? detectedLanguage ?? 'auto'
    const prefix = join(workDir, String(index))
    await exec(
      tools.whisperCli,
      'whisper-cli',
      whisperArgs({
        model: tools.whisperModel,
        wav,
        ...(tools.vadModel === null ? {} : { vadModel: tools.vadModel }),
        language,
        ...(deps.threads === undefined ? {} : { threads: deps.threads }),
        outPrefix: prefix,
      }),
      {
        timeoutMs: transcribeTimeoutMs(probe.durationSec, 4),
        onStderrLine: (line) => {
          const fraction = parseWhisperProgress(line)
          if (fraction !== undefined) {
            progress(
              band('transcribe', shareBefore(index) + share(index) * fraction),
              `transcribing "${part.title}"`,
            )
          }
        },
      },
    )

    const transcript = parseWhisperJson(await readFile(`${prefix}.json`, 'utf-8'))
    if (detectedLanguage === null && transcript.language !== null) {
      detectedLanguage = transcript.language
    }
    if (transcript.segments.length === 0) {
      warnings.push(`No speech was recognised in "${part.title}"`)
    }

    const partBlocks = transcriptBlocks({
      segments: transcript.segments,
      offsetSec,
      id: ctx.id,
      ...(deps.glossary === undefined ? {} : { glossary: deps.glossary }),
    })
    blocks.push(...partBlocks)
    partBlockIds[index] = partBlocks.map((block) => block.id)

    for (const segment of transcript.segments as readonly WhisperSegment[]) {
      allCues.push({
        startSec: offsetSec + segment.startSec,
        endSec: offsetSec + segment.endSec,
        text: segment.text,
      })
    }

    // The WAV is the largest thing this pipeline writes and it is worthless the moment
    // whisper has read it.
    await rm(wav, { force: true })
  }

  // ── Keyframes ────────────────────────────────────────────────────────────────────────────
  const shown: { timeSec: number; text: string }[] = []
  let keyframeMeta: MediaMeta['keyframes'] = null

  if (kind === 'video') {
    const collected = await collectKeyframes({
      parts,
      probes,
      timeline: timeline.map((entry) => entry.startSec),
      tools,
      workDir,
      exec,
      throwIfAborted,
      progress: (fraction, message) => progress(band('keyframes', fraction), message),
    })
    keyframeMeta = collected.meta

    // OCR, one frame at a time. Tesseract takes no abort signal, so the loop boundary is the
    // only checkpoint there is — which is why the frames are walked here rather than mapped.
    for (const [index, frame] of collected.frames.entries()) {
      throwIfAborted()
      const bytes = await readFile(frame.pngPath)
      let text = ''
      if (deps.ocr !== undefined) {
        try {
          const result = await deps.ocr.recognize(new Uint8Array(bytes))
          text = result.text.trim()
        } catch (error) {
          // A frame Tesseract cannot read is a frame with no caption, not a failed import.
          warnings.push(
            `Could not read the text on the frame at ${frame.timeSec.toFixed(0)}s: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }

      const asset = await ctx.putAsset(new Uint8Array(bytes), 'image/png', 'keyframe')
      assets.push({
        ...asset,
        locator: { timeSec: frame.timeSec },
        ...(text.length > 0 ? { text } : {}),
      })
      if (text.length > 0) shown.push({ timeSec: frame.timeSec, text })

      progress(
        band('ocr', (index + 1) / Math.max(1, collected.frames.length)),
        'reading the slides',
      )
    }

    blocks.push(
      ...fuseSaidAndShown({
        frames: shown,
        id: ctx.id,
        ...(deps.labelFrame === undefined ? {} : { label: deps.labelFrame }),
      }),
    )

    if (collected.frames.length > 0 && deps.ocr !== undefined && shown.length === 0) {
      warnings.push('No readable text was found on any keyframe')
    }
  }

  // ── Assemble ─────────────────────────────────────────────────────────────────────────────
  throwIfAborted()
  progress(band('assemble', 0), 'saving the transcript')

  const ordered = byTime(blocks)

  let vttBlobSha256: string | null = null
  if (allCues.length > 0) {
    const vtt = buildVtt(
      allCues,
      parts.map((part, index) => ({
        title: part.title,
        startSec: timeline[index]?.startSec ?? 0,
      })),
    )
    const asset = await ctx.putAsset(new TextEncoder().encode(vtt), 'text/vtt', 'caption')
    assets.push(asset)
    vttBlobSha256 = asset.blobSha256
  }

  const title = parts.length === 1 ? (parts[0]?.title ?? input.fallbackTitle) : input.fallbackTitle
  const sections = buildSections(
    parts,
    partBlockIds,
    timeline.map((entry) => entry.startSec),
    ordered,
    title,
    ctx,
  )

  const mediaParts: MediaPartMeta[] = parts.map((part, index) => ({
    blobSha256: part.blobSha256,
    mime: part.mime,
    title: part.title,
    startSec: timeline[index]?.startSec ?? 0,
    durationSec: timeline[index]?.durationSec ?? null,
    ordinal: part.ordinal,
  }))

  const media: MediaMeta = {
    durationSec: totalDuration(timeline),
    parts: mediaParts,
    transcript: {
      engine: 'whisper.cpp',
      modelId: tools.whisperModelId,
      variant: tools.variant,
      language: detectedLanguage,
      vad: tools.vadModel !== null,
      vttBlobSha256,
    },
    keyframes: keyframeMeta,
    vision:
      deps.ocr === undefined || kind !== 'video'
        ? null
        : {
            provider: deps.ocr.id,
            framesDescribed: shown.length,
          },
  }

  progress(band('assemble', 1), 'done')

  return {
    id: ctx.id(),
    kind,
    title,
    // whisper's own detection first — it heard the audio — with a text-based check as the
    // fallback for a build that does not report one.
    language: detectedLanguage ?? detectLanguage(ordered.map((block) => block.text).join(' ')),
    sections,
    blocks: ordered,
    assets,
    meta: { warnings, media },
  }
}

async function probePart(
  part: MediaPartInput,
  tools: MediaToolchain,
  exec: (
    exe: string,
    tool: string,
    args: readonly string[],
    extra?: Partial<RunSidecarOptions>,
  ) => Promise<SidecarRunResult>,
): Promise<ProbeResult> {
  if (tools.ffprobe === null) {
    // No ffprobe in the archive. The duration is recoverable from the WAV's own byte count
    // later, and `hasVideo` is guessed from the mime — worse than probing, better than
    // refusing the import.
    return {
      durationSec: null,
      hasVideo: part.mime.startsWith('video/'),
      hasAudio: true,
      width: null,
      height: null,
    }
  }
  let stdout = ''
  await exec(tools.ffprobe, 'ffprobe', probeArgs(part.path), {
    onStdoutLine: (line) => {
      stdout += line
    },
  })
  return parseProbeJson(stdout)
}

interface CollectedFrame {
  pngPath: string
  timeSec: number
}

/**
 * Runs the keyframe pass over every video part and returns the frames worth keeping.
 *
 * The scene filter is tried first, as the spec prescribes, and the interval pass is the
 * fallback — but "fallback" understates how often it runs. ffmpeg normalises its `scene` score
 * by frame complexity, so a cut between two flat slides scores well below the spec's 0.3 while
 * a cut in camera footage clears it easily. Screencasts are therefore the content the scene
 * filter is *worst* at, and they are most of what a course folder contains.
 */
async function collectKeyframes(options: {
  parts: readonly MediaPartInput[]
  probes: readonly ProbeResult[]
  timeline: readonly number[]
  tools: MediaToolchain
  workDir: string
  exec: (
    exe: string,
    tool: string,
    args: readonly string[],
    extra?: Partial<RunSidecarOptions>,
  ) => Promise<SidecarRunResult>
  throwIfAborted: () => void
  progress: (fraction: number, message: string) => void
}): Promise<{ frames: CollectedFrame[]; meta: MediaMeta['keyframes'] }> {
  const { parts, probes, timeline, tools, workDir, exec, throwIfAborted, progress } = options

  const frames: CollectedFrame[] = []
  let duplicatesDropped = 0
  let overBudgetDropped = 0
  let strategy: KeyframeStrategy = 'scene'

  for (const [index, part] of parts.entries()) {
    throwIfAborted()
    const probe = probes[index] as ProbeResult
    if (!probe.hasVideo) continue
    const offsetSec = timeline[index] ?? 0

    let pass = await runKeyframePass(part, index, 'scene', workDir, tools, exec)
    if (sceneDetectionFailed(pass.times.length, probe.durationSec)) {
      await removePngs(workDir, index)
      pass = await runKeyframePass(part, index, 'interval', workDir, tools, exec)
      strategy = 'interval'
    }

    // The two ffmpeg outputs are index-aligned by construction — `select` passes frames in
    // order down both branches of the `split` — so frame *n*'s picture, its 72-byte hash input
    // and its timestamp all carry the same index. Anything shorter than the shortest of the
    // three is a truncated pass, and trusting the longer one would pair a hash with the wrong
    // picture.
    const usable = Math.min(pass.times.length, pass.pngs.length, pass.hashes.length)
    const hashed: HashedFrame[] = []
    for (let i = 0; i < usable; i += 1) {
      hashed.push({
        index: i,
        timeSec: offsetSec + (pass.times[i] as number),
        hash: pass.hashes[i] as bigint,
      })
    }

    const selection = selectKeyframes(hashed, probe.durationSec)
    duplicatesDropped += selection.duplicatesDropped
    overBudgetDropped += selection.overBudgetDropped
    for (const frame of selection.kept) {
      frames.push({ pngPath: pass.pngs[frame.index] as string, timeSec: frame.timeSec })
    }

    progress((index + 1) / parts.length, 'looking for slides')
  }

  return {
    frames,
    meta: { count: frames.length, strategy, duplicatesDropped, overBudgetDropped },
  }
}

async function removePngs(workDir: string, index: number): Promise<void> {
  const prefix = `kf-${index}-`
  for (const name of await readdir(workDir).catch(() => [])) {
    if (name.startsWith(prefix)) await rm(join(workDir, name), { force: true })
  }
}

async function runKeyframePass(
  part: MediaPartInput,
  index: number,
  strategy: KeyframeStrategy,
  workDir: string,
  tools: MediaToolchain,
  exec: (
    exe: string,
    tool: string,
    args: readonly string[],
    extra?: Partial<RunSidecarOptions>,
  ) => Promise<SidecarRunResult>,
): Promise<{ times: number[]; pngs: string[]; hashes: bigint[] }> {
  const rawPath = join(workDir, `kf-${index}.raw`)
  const times: number[] = []

  await exec(
    tools.ffmpeg,
    'ffmpeg',
    keyframeArgs({
      input: part.path,
      pngPattern: join(workDir, `kf-${index}-%04d.png`),
      rawPath,
      strategy,
    }),
    {
      onStderrLine: (line) => {
        const time = parseShowinfoTime(line)
        if (time !== undefined) times.push(time)
      },
    },
  )

  const pngs = (await readdir(workDir))
    .filter((name) => name.startsWith(`kf-${index}-`) && name.endsWith('.png'))
    .sort()
    .map((name) => join(workDir, name))

  const raw = await readFile(rawPath).catch(() => Buffer.alloc(0))
  const hashes = splitFrames(new Uint8Array(raw)).map(dhash)
  await rm(rawPath, { force: true })

  return { times, pngs, hashes }
}

/**
 * The course's folders, as a section tree.
 *
 * This is the outline sub-phase 8.1 reads instead of asking a model to invent one, so it
 * mirrors the directory structure rather than anything derived from the transcript: one
 * section per folder, one child per lesson, in the author's own numbering. A single recording
 * gets one section named after itself, which keeps every consumer on one shape.
 *
 * Blocks fused from keyframes belong to no part's transcript, so they are placed by time —
 * into whichever lesson was playing when the slide was on screen. Leaving them out would make
 * the section tree an incomplete index of the document, and every consumer that walks sections
 * to render a source (`source-detail.tsx` does) would silently drop them.
 */
function buildSections(
  parts: readonly MediaPartInput[],
  partBlockIds: readonly string[][],
  partStartSec: readonly number[],
  ordered: readonly Block[],
  title: string,
  ctx: ParseContext,
): Section[] {
  const transcribed = new Set(partBlockIds.flat())
  const extrasByPart = new Map<number, string[]>()
  for (const block of ordered) {
    if (transcribed.has(block.id)) continue
    const timeSec = block.locator.timeSec ?? 0
    let owner = 0
    for (let i = partStartSec.length - 1; i >= 0; i -= 1) {
      if (timeSec >= (partStartSec[i] as number)) {
        owner = i
        break
      }
    }
    const list = extrasByPart.get(owner) ?? []
    list.push(block.id)
    extrasByPart.set(owner, list)
  }

  const roots: Section[] = []
  const byPath = new Map<string, Section>()

  /** Creates (or finds) the folder chain a lesson sits in, and returns its deepest node. */
  const sectionFor = (path: readonly string[]): Section | null => {
    let parent: Section | null = null
    let key = ''
    for (const name of path) {
      key = key === '' ? name : `${key}/${name}`
      let node = byPath.get(key)
      if (node === undefined) {
        node = { id: ctx.id(), title: name, level: key.split('/').length, blocks: [], children: [] }
        byPath.set(key, node)
        if (parent === null) roots.push(node)
        else parent.children.push(node)
      }
      parent = node
    }
    return parent
  }

  parts.forEach((part, index) => {
    const own = [...(partBlockIds[index] ?? []), ...(extrasByPart.get(index) ?? [])]
    // Reading order within the lesson, which is the order `ordered` already has.
    const position = new Map(ordered.map((block, at) => [block.id, at]))
    own.sort((left, right) => (position.get(left) ?? 0) - (position.get(right) ?? 0))

    const parent = sectionFor(part.sectionPath)
    const lesson: Section = {
      id: ctx.id(),
      title: part.title,
      level: part.sectionPath.length + 1,
      blocks: own,
      children: [],
    }
    if (parent === null) roots.push(lesson)
    else parent.children.push(lesson)
  })

  if (roots.length === 0) {
    roots.push({
      id: ctx.id(),
      title,
      level: 1,
      blocks: ordered.map((block) => block.id),
      children: [],
    })
  }
  return roots
}
