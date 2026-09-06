import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobContext } from '@retenia/core'
import type { SourceDoc } from '@retenia/ingest'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFsBlobStore } from '../main/blobs/store'
import { createIngestParseJob } from './ingest-parse'

// `run` imports the parser stack lazily (pdfjs, tesseract, mammoth, …) so main never loads
// it. Its first load is a few seconds on a cold, busy machine — a CI runner, or this suite
// alongside the e2e build — which is not what the 5 s per-test budget below is meant to
// measure. Warm it once, outside any test.
beforeAll(async () => {
  await import('@retenia/ingest')
})

/**
 * The job definition end to end, against a real (temp-directory) `BlobStore` — the same
 * "reads a confined path, writes blobs directly" shape `apps/desktop/src/main/library` will
 * drive in production. Markdown is the fixture here because it needs no other native
 * dependency to parse; the parsers themselves are `packages/ingest`'s own tests.
 */

function context(): JobContext & { stages: Array<[number, string | undefined]> } {
  const stages: Array<[number, string | undefined]> = []
  return {
    jobId: 'test-job',
    progress: (value, message) => stages.push([value, message]),
    signal: { aborted: false, addEventListener: () => {}, removeEventListener: () => {} },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    stages,
  }
}

describe('ingestParseSource', () => {
  let dir: string

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'retenia-ingest-')))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a payload missing any required field', () => {
    const job = createIngestParseJob([dir])
    expect(() => job.parseInput({})).toThrow(/non-empty string "sourceId"/)
    expect(() =>
      job.parseInput({
        sourceId: 's1',
        blobSha256: 'too-short',
        ext: 'md',
        kind: 'markdown',
        title: 't',
      }),
    ).toThrow(/64-character hex "blobSha256"/)
    expect(() =>
      job.parseInput({
        sourceId: 's1',
        blobSha256: 'a'.repeat(64),
        ext: 'md',
        kind: 'not-a-real-kind',
        title: 't',
      }),
    ).toThrow(/known source "kind"/)
  })

  it('reads the confined blob, parses it, and writes the SourceDoc as a new blob', async () => {
    const blobStore = createFsBlobStore(dir)
    const markdown = '# Cell Biology\n\nCells are the basic building blocks of life.\n'
    const put = await blobStore.put(new TextEncoder().encode(markdown), 'text/markdown')

    const job = createIngestParseJob([dir])
    const ctx = context()
    const result = await job.run(
      {
        sourceId: 'source-1',
        blobSha256: put.sha256,
        ext: put.ext,
        kind: 'markdown',
        title: 'Cells.md',
      },
      ctx,
    )

    expect(result.title).toBe('Cell Biology')
    expect(result.language).toBe('en')
    expect(result.blockCount).toBe(1)
    expect(result.assetCount).toBe(0)
    expect(result.needsOcr).toBe(false)
    expect(result.warnings).toEqual([])
    expect(result.sourceDocBlobSha256).toMatch(/^[0-9a-f]{64}$/)

    const stored = await blobStore.get(result.sourceDocBlobSha256, 'json')
    const doc = JSON.parse(new TextDecoder().decode(stored)) as SourceDoc
    expect(doc.kind).toBe('markdown')
    expect(doc.title).toBe('Cell Biology')

    expect(ctx.stages.at(-1)).toEqual([1, 'done'])
  })

  it('fails clearly when the referenced blob does not exist', async () => {
    // Same confinement path `confinePath` always builds (inside `dir`, a real readable
    // root) — just nothing was ever written there. `isInsideRoot`/`confinePath`'s actual
    // escape-prevention logic (symlinks, sibling directories, Windows case/short-name
    // quirks) is `apps/desktop/src/jobs/definitions.test.ts`'s job, not this one's; what
    // this checks is that a missing blob fails with a real filesystem error rather than
    // silently producing an empty document.
    const job = createIngestParseJob([dir])
    const ctx = context()
    await expect(
      job.run(
        { sourceId: 's1', blobSha256: 'a'.repeat(64), ext: 'md', kind: 'markdown', title: 't.md' },
        ctx,
      ),
    ).rejects.toThrow(/ENOENT/)
  })
})
