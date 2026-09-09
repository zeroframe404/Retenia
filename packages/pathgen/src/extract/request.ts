import type { AiBinding, BatchRequest, StructuredObjectRequest } from '@retenia/ai'
import { customId, structuredRequestFor } from '@retenia/ai'
import type { AbortSignalLike } from '@retenia/core'
import { PATHGEN_PROMPT_IDS, type PathgenPrompt, systemFor } from '../prompts'
import {
  EXTRACT_CHUNK_SCHEMA_NAME,
  type ExtractChunkOutput,
  extractChunkOutputSchema,
} from '../schemas/extraction'
import {
  buildExtractTask,
  type ExtractableChunk,
  type ExtractSource,
  type ExtractTask,
} from './task'

/**
 * One P1 call, in both shapes it can be dispatched in.
 *
 * `structured` goes through `AiClient.structured` — validated, repaired, budgeted, logged and
 * cached by the client; `batch` is the byte-identical transport request the batch runner
 * submits (`structuredRequestFor` is what keeps the two identical, and with them the answer's
 * cache key). Both answer to the same `customId`, which is built from the **chunk's** identity
 * and the prompt and schema versions — never from the run — so any later run over the same
 * book finds the answer (`docs/spec/04-path-generation.md` §7).
 */

export const EXTRACT_STAGE = PATHGEN_PROMPT_IDS.extract
/** `ai_calls.purpose` for every call a generation run makes. */
export const GENERATION_PURPOSE = 'path_generation'
/** Room for 25 concepts and 30 claims with their block ids; a full answer is ~2,500 tokens. */
export const EXTRACT_MAX_OUTPUT_TOKENS = 4_000

export type PromptVersions = Pick<PathgenPrompt, 'promptVersion' | 'schemaVersion'>

export function extractCustomId(
  chunk: Pick<ExtractableChunk, 'chunkKey' | 'hash' | 'sourceId'>,
  prompt: PromptVersions,
): string {
  return customId({
    stage: EXTRACT_STAGE,
    inputIds: [chunk.chunkKey ?? chunk.hash, chunk.sourceId],
    promptVersion: prompt.promptVersion,
    schemaVersion: prompt.schemaVersion,
  })
}

export function extractBinding(
  prompt: PathgenPrompt,
  options: { readonly allowOverBudget?: boolean } = {},
): AiBinding {
  return {
    role: prompt.role,
    purpose: GENERATION_PURPOSE,
    stage: EXTRACT_STAGE,
    promptVersion: prompt.promptVersion,
    schemaVersion: prompt.schemaVersion,
    ...(options.allowOverBudget === true ? { allowOverBudget: true } : {}),
  }
}

export interface ExtractRequest {
  readonly chunk: ExtractableChunk
  readonly customId: string
  readonly task: ExtractTask
  readonly structured: StructuredObjectRequest<ExtractChunkOutput>
  readonly batch: BatchRequest
}

export function buildExtractRequest(
  chunk: ExtractableChunk,
  source: ExtractSource,
  prompt: PathgenPrompt,
  options: { readonly system?: string; readonly signal?: AbortSignalLike } = {},
): ExtractRequest {
  const id = extractCustomId(chunk, prompt)
  const task = buildExtractTask(chunk, source)
  const structured: StructuredObjectRequest<ExtractChunkOutput> = {
    system: options.system ?? systemFor(prompt.template),
    prompt: task.prompt,
    temperature: prompt.temperature,
    schema: extractChunkOutputSchema,
    schemaName: EXTRACT_CHUNK_SCHEMA_NAME,
    maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
    idempotencyKey: id,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  return {
    chunk,
    customId: id,
    task,
    structured,
    batch: { customId: id, request: structuredRequestFor(structured) },
  }
}
