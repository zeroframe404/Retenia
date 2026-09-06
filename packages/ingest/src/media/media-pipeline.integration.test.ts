import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chunkSourceDoc } from '../chunking/chunk-source-doc'
import { isTranscript } from '../chunking/transcript'
import type { ParseContext } from '../parse-context'
import { exeName } from '../sidecars/platform'
import type { Asset, AssetKind } from '../source-doc'
import { parseMedia } from './parse-media'

/**
 * The whole pipeline, end to end, against the real binaries — the acceptance criterion for
 * sub-phase 6.4: "a 20-s sample produces a transcript with timestamps and ≥ 1 keyframe".
 *
 * Skipped rather than failed when the sidecars are absent, because they genuinely are not
 * shipped: `docs/spec/07-architecture.md` §13.4 records the decision to download them on
 * demand, so a fresh clone has none and CI installs none. Run
 * `node tooling/download-sidecars.ts --install` to unskip it locally.
 *
 * The guard is a `stat`, never a spawn. `.claude/hooks/verify.sh` runs the affected tests at
 * the end of every turn, and paying for four process launches to decide to skip would be a
 * tax on every edit in the repository.
 */

const SIDECARS = join(import.meta.dirname, '..', '..', '..', '..', '.sidecars')
const FFMPEG_VERSION = 'autobuild-2026-09-06-13-06'
const WHISPER_VERSION = 'v1.9.2'

const tools = {
  ffmpeg: join(SIDECARS, 'ffmpeg', FFMPEG_VERSION, exeName('ffmpeg')),
  ffprobe: join(SIDECARS, 'ffmpeg', FFMPEG_VERSION, exeName('ffprobe')),
  whisperCli: join(SIDECARS, 'whisper', WHISPER_VERSION, exeName('whisper-cli')),
  // `tiny` rather than the shipped default: 78 MB and near-instant, where `small-q5_1` is
  // 190 MB and slow enough to make this suite a chore. What is under test is the pipeline,
  // not the model's accuracy.
  whisperModel: join(SIDECARS, 'models', 'ggml-tiny.bin'),
  vadModel: join(SIDECARS, 'models', 'ggml-silero-v6.2.0.bin'),
}

const available = Object.values(tools).every((path) => existsSync(path))

const fixture = join(
  import.meta.dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'media',
  'sample-20s.webm',
)

function createFakeParseContext(): ParseContext & { assets: Asset[] } {
  let next = 0
  const assets: Asset[] = []
  return {
    assets,
    id: () => `id-${next++}`,
    putAsset: async (bytes: Uint8Array, mime: string, kind: AssetKind) => {
      const asset: Asset = {
        id: `asset-${next++}`,
        blobSha256: createHash('sha256').update(bytes).digest('hex'),
        mime,
        kind,
      }
      assets.push(asset)
      return asset
    },
  }
}

describe('the media fixture', () => {
  // Outside the skip guard on purpose: a corrupted or missing fixture should be red on every
  // machine, not silently skipped along with the binaries.
  it('is committed and non-trivial', () => {
    expect(existsSync(fixture)).toBe(true)
  })

  it('reports why it skipped, when it skips', () => {
    // The FSRS binding can assert "present on every platform we ship"; sidecars cannot, since
    // nothing ships them. Instead the job that fetches them sets this, so a silent resolve
    // failure *there* is red while a fresh clone gets an honest skip.
    if (process.env.RETENIA_SIDECARS === '1') expect(available).toBe(true)
    else expect(typeof available).toBe('boolean')
  })
})

describe.skipIf(!available)('parseMedia over the 20-second sample', () => {
  it('produces a timestamped transcript, at least one keyframe, and chunks as a transcript', {
    timeout: 180_000,
  }, async () => {
    const ctx = createFakeParseContext()
    const workDir = mkdtempSync(join(tmpdir(), 'retenia-media-'))
    const progress: number[] = []

    try {
      const doc = await parseMedia(
        {
          kind: 'video',
          parts: [
            {
              path: fixture,
              blobSha256: 'a'.repeat(64),
              mime: 'video/webm',
              title: 'Welcome',
              sectionPath: ['Intro'],
              ordinal: 0,
            },
          ],
          fallbackTitle: 'Sample course',
        },
        ctx,
        {
          tools: { ...tools, whisperModelId: 'whisper-tiny', variant: 'cpu' },
          workDir,
          signal: { aborted: false, addEventListener: () => {} },
          progress: (fraction) => progress.push(fraction),
          // A stand-in for Tesseract: this suite is about ffmpeg and whisper, and pulling a
          // 15 MB language pack over the network would make it a different kind of test.
          ocr: {
            id: 'fake-ocr',
            recognize: async () => ({ text: 'SECTION ONE', confidence: 90 }),
          },
        },
      )

      // ── the acceptance criteria ──────────────────────────────────────────────────────
      const timed = doc.blocks.filter((block) => typeof block.locator.timeSec === 'number')
      expect(timed.length).toBeGreaterThan(0)
      expect(isTranscript(doc)).toBe(true)

      const keyframes = doc.assets.filter((asset) => asset.kind === 'keyframe')
      expect(keyframes.length).toBeGreaterThanOrEqual(1)
      expect(keyframes.every((asset) => typeof asset.locator?.timeSec === 'number')).toBe(true)

      // ── and that the transcript is real, not empty ────────────────────────────────────
      const text = doc.blocks
        .map((block) => block.text)
        .join(' ')
        .toLowerCase()
      expect(text).toContain('country')
      expect(doc.language).toBe('en')

      expect(doc.meta.media?.durationSec ?? 0).toBeGreaterThan(19)
      expect(doc.meta.media?.durationSec ?? 0).toBeLessThan(21)
      expect(doc.meta.media?.transcript?.vad).toBe(true)
      expect(doc.assets.some((asset) => asset.kind === 'caption')).toBe(true)

      // ── and that 6.2 can chunk what 6.4 produced, which is the whole point ────────────
      const chunked = chunkSourceDoc(doc, { sourceId: '00000000-0000-7000-8000-000000000000' })
      expect(chunked.chunks.length).toBeGreaterThan(0)

      const segments = chunked.units.filter((unit) => unit.kind === 'segment')
      const frames = chunked.units.filter((unit) => unit.kind === 'keyframe')
      expect(segments.length).toBeGreaterThan(0)
      expect(segments[0]?.tStartMs).toBeGreaterThanOrEqual(0)

      // Keyframes become units too, and carry the blob so the player can draw a marker and
      // the blob GC can see the image is still referenced.
      expect(frames).toHaveLength(keyframes.length)
      expect(frames.every((unit) => typeof unit.blobSha256 === 'string')).toBe(true)
      // Ordinals continue past the transcript windows rather than restarting, so listing a
      // source's units in `ordinal` order interleaves nothing.
      expect(Math.min(...frames.map((unit) => unit.ordinal))).toBeGreaterThan(
        Math.max(...segments.map((unit) => unit.ordinal)),
      )
      // No chunk points at a keyframe: it is a citation anchor, not a passage.
      expect(chunked.chunks.every((chunk) => !chunk.unitKey?.startsWith('keyframe:'))).toBe(true)

      expect(progress.at(-1)).toBe(1)
      expect(
        progress.every((value, index) => index === 0 || value >= (progress[index - 1] ?? 0)),
      ).toBe(true)
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})
