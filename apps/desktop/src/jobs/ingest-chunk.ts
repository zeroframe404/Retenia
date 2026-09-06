import { readFile } from 'node:fs/promises'
import type { JobContext, JobDefinition } from '@retenia/core'
import type { ChunkDraft, SourceDoc, SourceUnitDraft, TokenizerId } from '@retenia/ingest'
import { createFsBlobStore } from '../main/blobs/store'
import { confinePath } from './confine'

/**
 * Structural chunking of an already-parsed source (sub-phase 6.2;
 * `docs/spec/05-ingestion-rag.md` §4).
 *
 * Same split as `ingest-parse.ts`: the job reads a blob, computes, and writes a blob — it
 * never touches SQLite — and `apps/desktop/src/main/library/service.ts` applies the result
 * once the job settles. Chunking a 300-page book is a second or two of pure CPU, which is a
 * second or two the UI thread does not spend, and it means the whole pipeline
 * (parse → chunk → embed) is one queue with one progress bar.
 *
 * The drafts go to a blob rather than into `jobs.result` for the reason `jobSummarySchema`
 * states: a book is thousands of chunks and the result column is a summary, not a payload.
 */

export interface IngestChunkInput {
  sourceId: string
  /** The `SourceDoc` blob `ingestParseSource` wrote. */
  sourceDocBlobSha256: string
  /** Which tokenizer to measure with; part of `chunks.chunking_version`. Defaults to the
   *  `chars4` heuristic, which is what the chunker itself defaults to. */
  tokenizer?: TokenizerId
}

/** What lands in the drafts blob: everything the store needs, and nothing else. */
export interface ChunkDraftsBlob {
  sourceId: string
  chunkingVersion: string
  units: SourceUnitDraft[]
  chunks: ChunkDraft[]
}

export type IngestChunkResult = {
  chunkDraftsBlobSha256: string
  chunkingVersion: string
  chunkCount: number
  unitCount: number
  /** How many chunks were flagged as front/back matter, for the source card. */
  frontmatterCount: number
  /** Total tokens across the chunks — what a contextualization or embedding estimate is
   *  proportional to. */
  tokenCount: number
  warnings: string[]
}

const TOKENIZERS: readonly TokenizerId[] = ['chars4', 'cl100k']

export function createIngestChunkJob(
  readableRoots: readonly string[],
): JobDefinition<IngestChunkInput, IngestChunkResult> {
  return {
    type: 'ingestChunkSource',
    parseInput: (payload) => {
      const sourceId = payload.sourceId
      const sourceDocBlobSha256 = payload.sourceDocBlobSha256
      const tokenizer = payload.tokenizer
      if (typeof sourceId !== 'string' || sourceId.length === 0) {
        throw new Error('ingestChunkSource needs a non-empty string "sourceId"')
      }
      // Hex, not just 64 characters: the value is joined into a filesystem path below, and
      // `confinePath` is the backstop, not the only check. `"../".repeat(20) + "ab"` is 64
      // characters long.
      if (typeof sourceDocBlobSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sourceDocBlobSha256)) {
        throw new Error('ingestChunkSource needs a 64-character hex "sourceDocBlobSha256"')
      }
      if (
        tokenizer !== undefined &&
        !(TOKENIZERS as readonly unknown[]).includes(tokenizer as unknown)
      ) {
        throw new Error(
          `ingestChunkSource needs a known "tokenizer", got ${JSON.stringify(tokenizer)}`,
        )
      }
      return {
        sourceId,
        sourceDocBlobSha256,
        ...(tokenizer === undefined ? {} : { tokenizer: tokenizer as TokenizerId }),
      }
    },
    run: (input, ctx) => run(readableRoots, input, ctx),
  }
}

async function run(
  readableRoots: readonly string[],
  input: IngestChunkInput,
  ctx: JobContext,
): Promise<IngestChunkResult> {
  const blobStore = createFsBlobStore(readableRoots[0] as string)

  ctx.progress(0.05, 'reading the parsed document')
  const path = await confinePath(
    readableRoots,
    blobStore.path(input.sourceDocBlobSha256, 'json'),
    'ingestChunkSource',
  )
  const doc = JSON.parse(await readFile(path, 'utf-8')) as SourceDoc

  // Loaded here rather than at the top of the module for the same reason `ingest-parse.ts`
  // does it: this file is shared with main through `definitions.ts`, and only the worker
  // chunks. `js-tiktoken`'s rank table alone is ~1.7 MB main has no use for.
  const { chunkSourceDoc, createTokenCounter } = await import('@retenia/ingest')

  ctx.progress(0.2, 'chunking')
  const tokenizerId = input.tokenizer ?? 'chars4'
  const result = chunkSourceDoc(doc, {
    sourceId: input.sourceId,
    tokenizer: { id: tokenizerId, count: await createTokenCounter(tokenizerId) },
  })
  if (ctx.signal.aborted) throw new Error('ingestChunkSource was cancelled')

  ctx.progress(0.85, `saving ${result.chunks.length} chunks`)
  const payload: ChunkDraftsBlob = {
    sourceId: input.sourceId,
    chunkingVersion: result.chunkingVersion,
    units: result.units,
    chunks: result.chunks,
  }
  const { sha256 } = await blobStore.put(
    new TextEncoder().encode(JSON.stringify(payload)),
    'application/json',
  )

  ctx.progress(1, 'done')
  return {
    chunkDraftsBlobSha256: sha256,
    chunkingVersion: result.chunkingVersion,
    chunkCount: result.chunks.length,
    unitCount: result.units.length,
    frontmatterCount: result.chunks.filter((chunk) => chunk.isFrontmatter).length,
    tokenCount: result.chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
    warnings: result.warnings,
  }
}
