import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobContext } from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFsBlobStore } from '../main/blobs/store'
import { createIngestEmbedJob, type EmbedTextsBlob, type EmbedVectorsBlob } from './ingest-embed'

/**
 * The embedding job (sub-phase 6.3): what it accepts, and what it writes.
 *
 * Its provider path is exercised end to end through the Ollama branch against a fake server —
 * that keeps the whole round trip (texts blob in, vectors blob out) real without a 300 MB
 * ONNX download in CI, and the local branch's own behaviour is covered in
 * `packages/ingest/src/embeddings/transformers.test.ts`.
 */

const DIMS = 768

function context(signal = { aborted: false }): JobContext & {
  readonly reports: [number, string | undefined][]
} {
  const reports: [number, string | undefined][] = []
  return {
    jobId: 'job-1',
    progress: (value, message) => reports.push([value, message]),
    signal: { ...signal, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reports,
  }
}

/** A server that answers with a deterministic, never-zero vector per text. */
function fakeOllama(): typeof globalThis.fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { input: string[] }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: body.input.map((text, index) => ({
          index,
          embedding: Array.from(
            { length: DIMS },
            (_unused, at) => ((text.charCodeAt(at % text.length) + at) % 13) - 6 + 1,
          ),
        })),
      }),
    }
  }) as unknown as typeof globalThis.fetch
}

describe('the ingestEmbedSource job', () => {
  let root: string
  let blobStore: ReturnType<typeof createFsBlobStore>
  const originalFetch = globalThis.fetch

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'retenia-embed-job-'))
    blobStore = createFsBlobStore(root)
    globalThis.fetch = fakeOllama()
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  })

  const job = () => createIngestEmbedJob(join(tmpdir(), 'models'), [root])

  describe('the payload it accepts', () => {
    const parse = (payload: Record<string, unknown>) => job().parseInput(payload)
    const sha = 'a'.repeat(64)

    it('takes a local model or a server, and keeps the optional knobs', () => {
      expect(parse({ sourceId: 's', textsBlobSha256: sha, modelId: 'bge-m3' })).toEqual({
        sourceId: 's',
        textsBlobSha256: sha,
        modelId: 'bge-m3',
      })
      expect(
        parse({
          sourceId: 's',
          textsBlobSha256: sha,
          ollama: { baseUrl: 'http://x', model: 'bge-m3', nativeDims: 1024 },
          device: 'cuda',
          batchSize: 8,
        }),
      ).toMatchObject({ device: 'cuda', batchSize: 8 })
    })

    it('insists on a hex sha, not merely 64 characters', () => {
      // The value is joined into a filesystem path; `confinePath` is the backstop, not the
      // only check. `"../".repeat(20) + "ab"` is 64 characters long.
      expect(() =>
        parse({ sourceId: 's', textsBlobSha256: `${'../'.repeat(20)}ab`, modelId: 'bge-m3' }),
      ).toThrow(/64-character hex/)
    })

    it('refuses a payload that names no provider at all', () => {
      expect(() => parse({ sourceId: 's', textsBlobSha256: sha })).toThrow(
        /either a "modelId" or an "ollama" server/,
      )
    })

    it('refuses a malformed server description', () => {
      expect(() =>
        parse({
          sourceId: 's',
          textsBlobSha256: sha,
          ollama: { baseUrl: 'http://x', nativeDims: 1024 },
        }),
      ).toThrow(/"model"/)
      expect(() =>
        parse({
          sourceId: 's',
          textsBlobSha256: sha,
          ollama: { baseUrl: 'http://x', model: 'm', nativeDims: 0 },
        }),
      ).toThrow(/positive integer "ollama\.nativeDims"/)
    })

    it('refuses a nonsensical batch size', () => {
      expect(() =>
        parse({ sourceId: 's', textsBlobSha256: sha, modelId: 'bge-m3', batchSize: -1 }),
      ).toThrow(/positive integer "batchSize"/)
    })
  })

  describe('the vectors it writes', () => {
    const seedTexts = async (texts: readonly string[]): Promise<string> => {
      const payload: EmbedTextsBlob = {
        sourceId: 'source-1',
        chunks: texts.map((text, index) => ({ chunkId: `chunk-${index}`, text })),
      }
      const { sha256 } = await blobStore.put(
        new TextEncoder().encode(JSON.stringify(payload)),
        'application/json',
      )
      return sha256
    }

    const readVectors = async (sha256: string): Promise<EmbedVectorsBlob> =>
      JSON.parse(new TextDecoder().decode(await blobStore.get(sha256, 'json'))) as EmbedVectorsBlob

    it('writes one unit vector per chunk, in order, under the space it used', async () => {
      const textsBlobSha256 = await seedTexts(['El corazón bombea sangre.', 'Las mitocondrias.'])
      const ctx = context()
      const result = await job().run(
        {
          sourceId: 'source-1',
          textsBlobSha256,
          ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'bge-m3', nativeDims: DIMS },
        },
        ctx,
      )

      expect(result.chunkCount).toBe(2)
      expect(result.dims).toBe(DIMS)
      expect(result.modelId).toBe('ollama:bge-m3@768')

      const blob = await readVectors(result.vectorsBlobSha256)
      expect(blob.chunkIds).toEqual(['chunk-0', 'chunk-1'])
      const flat = new Float32Array(Uint8Array.from(Buffer.from(blob.vectors, 'base64')).buffer)
      expect(flat).toHaveLength(2 * DIMS)

      for (let index = 0; index < 2; index++) {
        let norm = 0
        for (const value of flat.subarray(index * DIMS, (index + 1) * DIMS)) norm += value * value
        expect(Math.sqrt(norm)).toBeCloseTo(1, 4)
      }
    })

    it('reports progress from the model phase through to done', async () => {
      const textsBlobSha256 = await seedTexts(['a', 'b'])
      const ctx = context()
      await job().run(
        {
          sourceId: 'source-1',
          textsBlobSha256,
          ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'bge-m3', nativeDims: DIMS },
        },
        ctx,
      )
      const values = ctx.reports.map(([value]) => value)
      expect(values.at(-1)).toBe(1)
      expect(values).toEqual([...values].sort((left, right) => left - right))
    })

    it('stops when the job is cancelled instead of embedding the rest of the book', async () => {
      const textsBlobSha256 = await seedTexts(['a', 'b', 'c'])
      await expect(
        job().run(
          {
            sourceId: 'source-1',
            textsBlobSha256,
            ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'bge-m3', nativeDims: DIMS },
          },
          context({ aborted: true }),
        ),
      ).rejects.toThrow(/cancelled/)
    })
  })
})
