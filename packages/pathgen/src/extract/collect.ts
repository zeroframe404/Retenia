import { DEFAULT_SANITIZE_LIMITS, validateStructuredCompletion } from '@retenia/ai'
import type { Extraction, JsonObject, NewEntity } from '@retenia/core'
import { parseSourceLocator } from '@retenia/core'
import type { ExtractedChunk } from '../consolidate'
import { type ExtractChunkOutput, extractChunkOutputSchema } from '../schemas/extraction'
import type { StageUsage } from '../usage'
import type { PromptVersions } from './request'
import type { ExtractableChunk } from './task'

/**
 * From a completion to an `extractions` row: the same parse → sanitize → validate a
 * synchronous call gets (`validateStructuredCompletion` is `runStructured`'s own), then the
 * one check the schema cannot make on its own — a claim may cite only the blocks the chunk
 * actually covers.
 */

export type ExtractionValidation =
  | { readonly ok: true; readonly value: ExtractChunkOutput }
  | { readonly ok: false; readonly issues: string[] }

export function validateExtraction(text: string): ExtractionValidation {
  return validateStructuredCompletion(text, extractChunkOutputSchema, DEFAULT_SANITIZE_LIMITS)
}

/** Drops cited block ids the chunk does not cover, and repeats. Never fails the answer. */
export function postValidate(
  output: ExtractChunkOutput,
  blockIds: readonly string[],
): ExtractChunkOutput {
  const known = new Set(blockIds)
  return {
    ...output,
    claims: output.claims.map((claim) => ({
      ...claim,
      block_ids: [...new Set(claim.block_ids.filter((id) => known.has(id)))],
    })),
  }
}

export interface ExtractionRowInput {
  readonly runId: string
  readonly chunk: ExtractableChunk
  readonly customId: string
  readonly prompt: PromptVersions
  /** The profile that answered; `null` when only the model is known (a synchronous call). */
  readonly provider: string | null
  readonly model: string
  readonly output: ExtractChunkOutput
  readonly usage: StageUsage
}

export function toExtractionRow(input: ExtractionRowInput): NewEntity<Extraction> {
  return {
    runId: input.runId,
    sourceId: input.chunk.sourceId,
    chunkId: input.chunk.id,
    chunkKey: input.chunk.chunkKey,
    chunkHash: input.chunk.hash,
    customId: input.customId,
    promptVersion: input.prompt.promptVersion,
    schemaVersion: input.prompt.schemaVersion,
    provider: input.provider,
    model: input.model,
    output: input.output as JsonObject,
    conceptCount: input.output.concepts.length,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cachedTokens: input.usage.cachedTokens,
    costUsd: input.usage.usd,
  }
}

/** A stored row, parsed again: a row that no longer validates is treated as absent. */
export function readExtractionRow(row: Pick<Extraction, 'output'>): ExtractChunkOutput | undefined {
  const parsed = extractChunkOutputSchema.safeParse(row.output)
  return parsed.success ? parsed.data : undefined
}

/** The chunk as consolidation sees it. */
export function toExtractedChunk(chunk: ExtractableChunk): ExtractedChunk {
  return {
    chunkId: chunk.id,
    chunkKey: chunk.chunkKey,
    sourceId: chunk.sourceId,
    ordinal: chunk.ordinal,
    headingPath: chunk.headingPath,
    blockIds: [...parseSourceLocator(chunk).blockIds],
  }
}
