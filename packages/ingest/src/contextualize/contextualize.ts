import type { TextGenerator } from '@retenia/ai'
import type { AbortSignalLike } from '@retenia/core'
import type { ChunkDraft } from '../chunking'
import type { DocumentContext } from './task'
import { buildContextualizeTask, systemFromTemplate } from './task'

/**
 * The contextual-retrieval pass of `docs/spec/05-ingestion-rag.md` §4.2: one cheap-role call
 * per chunk asking for the 50–100 tokens of situating context that get stored in
 * `chunks.context` and indexed alongside the text.
 *
 * Anthropic's own numbers for the recipe: −35 % retrieval failures with embeddings alone,
 * −49 % with BM25 on top, −67 % with a reranker. It is off by default and costs real money
 * (§6 puts a book at ≈ USD 0.10–0.65), which is why the UI quotes `estimateContextualization`
 * before the toggle does anything.
 *
 * Failure is per chunk and never fatal. A chunk whose call failed keeps `context = null` and
 * is still indexed on its text — a worse index, not a broken one — and the run reports what it
 * could not do. That is the same offline rule the AI grader follows: the app works without a
 * provider, only less well.
 */

/** §7's determinism rule: extraction runs at temperature 0. */
export const CONTEXTUALIZE_TEMPERATURE = 0

/** Room for the 50–100 tokens asked for, plus the slack a model needs not to be cut mid-word. */
export const CONTEXTUALIZE_MAX_OUTPUT_TOKENS = 200

/** A context longer than this is a model that ignored the instruction; it is truncated rather
 *  than dropped, since the first sentences are still the useful ones. */
export const MAX_CONTEXT_CHARS = 600

export interface ContextualizeOptions {
  textGenerator: TextGenerator
  /** The contents of `prompts/contextualize.md`; `loadContextualizePrompt()` reads the file. */
  promptTemplate: string
  document: DocumentContext
  /** The source these chunks belong to, for the idempotency key. */
  sourceId: string
  /** Prompt version, from the prompt file's frontmatter. Part of the idempotency key, so a
   *  reworded prompt is a different call and a resumed run is not. */
  promptVersion?: string
  /** How many calls are in flight at once. Default 4 — enough to keep a provider busy, low
   *  enough not to trip a rate limit on a free tier. */
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignalLike
}

/** What the pass reads off a chunk. A `ChunkDraft` satisfies it, and so does a stored
 *  `chunks` row mapped onto it — which is what lets the pass run long after the ingestion job
 *  that produced the drafts has gone. */
export type ContextualizableChunk = Pick<ChunkDraft, 'key' | 'text' | 'headingPath' | 'locator'>

export interface ContextualizedChunk {
  /** `ChunkDraft.key` — what the store matches the context back onto. */
  chunkKey: string
  context: string
}

export interface ContextualizeResult {
  contexts: ContextualizedChunk[]
  /** Chunks whose call failed, with the reason, in input order. */
  failures: Array<{ chunkKey: string; error: string }>
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; usd: number }
}

/**
 * What the model returned, made safe to store: no code fence, no leading "This chunk…", one
 * paragraph, bounded length. The prompt asks for all of this; the code does not assume it got
 * it (`docs/spec/01-decisions.md` §7: "the AI proposes, the code validates").
 */
export function normalizeContext(raw: string): string {
  let text = raw.trim()
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(text)
  if (fence?.[1] !== undefined) text = fence[1].trim()
  text = text.replace(/^(context|contexto)\s*:\s*/i, '')
  text = text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS).trimEnd()}…` : text
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** §7's idempotency key, `hash(stage, input_ids, prompt_version)` — spelled out rather than
 *  hashed so a resumed batch run is legible in the provider's dashboard. */
function idempotencyKey(options: ContextualizeOptions, chunk: ContextualizableChunk): string {
  return `contextualize:${options.promptVersion ?? '1'}:${options.sourceId}:${chunk.key}`
}

export async function contextualizeChunks(
  chunks: readonly ContextualizableChunk[],
  options: ContextualizeOptions,
): Promise<ContextualizeResult> {
  const system = systemFromTemplate(options.promptTemplate)
  const contexts: Array<ContextualizedChunk | undefined> = new Array(chunks.length)
  const failures: Array<{ chunkKey: string; error: string } | undefined> = new Array(chunks.length)
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, usd: 0 }

  let next = 0
  let done = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted === true) return
      const index = next
      next += 1
      const chunk = chunks[index]
      if (chunk === undefined) return

      try {
        const result = await options.textGenerator({
          system,
          prompt: buildContextualizeTask(options.document, chunk),
          temperature: CONTEXTUALIZE_TEMPERATURE,
          maxOutputTokens: CONTEXTUALIZE_MAX_OUTPUT_TOKENS,
          idempotencyKey: idempotencyKey(options, chunk),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
        const context = normalizeContext(result.text)
        if (context.length > 0) contexts[index] = { chunkKey: chunk.key, context }
        usage.inputTokens += result.usage?.inputTokens ?? 0
        usage.outputTokens += result.usage?.outputTokens ?? 0
        usage.cachedInputTokens += result.usage?.cachedInputTokens ?? 0
        usage.usd += result.usage?.usd ?? 0
      } catch (error) {
        failures[index] = { chunkKey: chunk.key, error: errorMessage(error) }
      }

      done += 1
      options.onProgress?.(done, chunks.length)
    }
  }

  const workers = Math.max(1, Math.min(options.concurrency ?? 4, chunks.length))
  await Promise.all(Array.from({ length: workers }, () => worker()))

  return {
    // Filtered after the fact rather than pushed as they finish: the output order is the input
    // order whatever the concurrency did, which is what makes the run reproducible.
    contexts: contexts.filter((entry): entry is ContextualizedChunk => entry !== undefined),
    failures: failures.filter(
      (entry): entry is { chunkKey: string; error: string } => entry !== undefined,
    ),
    usage,
  }
}
