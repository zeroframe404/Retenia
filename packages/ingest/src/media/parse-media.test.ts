import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunSidecarOptions, SidecarRunResult } from '../sidecars/spawn'
import { parseMedia } from './parse-media'

/**
 * Every ffmpeg/ffprobe/whisper invocation gets a `timeoutMs` — the gap this closes: only
 * whisper ever did, so a wedged ffmpeg (a corrupted file, a hung decoder) hung the job
 * indefinitely instead of failing after a bounded wait. Driven through the `run` seam
 * `MediaParseDeps` documents for exactly this — exercising the pipeline without the real
 * binaries — rather than the gated `media-pipeline.integration.test.ts`, which needs them.
 *
 * The fixture is audio-only (`hasVideo: false` from the faked ffprobe output) on purpose: it
 * keeps this to the three calls that matter for the regression (ffprobe, the WAV extraction,
 * whisper) without also having to fabricate a keyframe pass's raw grayscale and PNG output.
 * `runKeyframePass`'s own `exec` call uses the identical `mediaPassTimeoutMs` helper as the
 * WAV extraction below it, so covering one covers the shape of both.
 */

interface Call {
  tool: string
  args: readonly string[]
  timeoutMs: number | undefined
}

describe('parseMedia gives every sidecar call a timeout', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'parse-media-test-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('passes a positive timeoutMs to ffprobe, the ffmpeg WAV extraction, and whisper', async () => {
    const calls: Call[] = []

    const run = async (options: RunSidecarOptions): Promise<SidecarRunResult> => {
      calls.push({ tool: options.tool, args: options.args, timeoutMs: options.timeoutMs })

      if (options.tool === 'ffprobe') {
        options.onStdoutLine?.(
          JSON.stringify({
            format: { duration: '20.0' },
            streams: [{ codec_type: 'audio', duration: '20.0' }],
          }),
        )
      }

      if (options.tool === 'whisper-cli') {
        // whisper-cli writes its transcript to `<outPrefix>.json`; `parseMedia` reads it back
        // unconditionally, so the fake has to leave a real file for it to find.
        const flagIndex = options.args.indexOf('-of')
        const outPrefix = options.args[flagIndex + 1] as string
        await writeFile(`${outPrefix}.json`, JSON.stringify({ transcription: [] }), 'utf-8')
      }

      return { code: 0, signal: null, stderrTail: [] }
    }

    await parseMedia(
      {
        kind: 'audio',
        parts: [
          {
            path: join(workDir, 'lesson.mp3'),
            blobSha256: '0'.repeat(64),
            mime: 'audio/mpeg',
            title: 'Lesson 1',
            sectionPath: [],
            ordinal: 0,
          },
        ],
        fallbackTitle: 'Lesson 1',
      },
      {
        id: () => 'id',
        putAsset: async () => ({
          id: 'a',
          blobSha256: '0'.repeat(64),
          mime: 'image/png',
          kind: 'keyframe',
        }),
      },
      {
        tools: {
          ffmpeg: 'ffmpeg',
          ffprobe: 'ffprobe',
          whisperCli: 'whisper-cli',
          whisperModel: 'model.bin',
          whisperModelId: 'tiny',
          vadModel: null,
          variant: 'cpu',
        },
        workDir,
        signal: { aborted: false, addEventListener: () => undefined },
        progress: () => undefined,
        run,
      },
    )

    const byTool = (tool: string): Call[] => calls.filter((call) => call.tool === tool)

    expect(byTool('ffprobe')).toHaveLength(1)
    expect(byTool('ffprobe')[0]?.timeoutMs).toBeGreaterThan(0)

    expect(byTool('ffmpeg')).toHaveLength(1)
    expect(byTool('ffmpeg')[0]?.timeoutMs).toBeGreaterThan(0)

    expect(byTool('whisper-cli')).toHaveLength(1)
    expect(byTool('whisper-cli')[0]?.timeoutMs).toBeGreaterThan(0)
  })
})
